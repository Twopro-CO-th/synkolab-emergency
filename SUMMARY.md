# synkolab-emergency — Emergency Call API Service

## ภาพรวม

Microservice สำหรับระบบ Emergency Call แยกออกจาก community-link เพื่อให้ deploy บน server แยกได้
รองรับทั้งการโทร 1-to-1, Emergency SOS broadcast, และ Group call

## สถาปัตยกรรม

```
Browser / Pi                                          Server แยก
┌──────────┐     HTTPS/WSS      ┌──────────────────────────────────┐
│  Web     │◄──────────────────►│  Nginx (SSL termination)         │
│  Client  │                    │         │                        │
└──────────┘                    │         ▼                        │
                                │  ┌─────────────────────┐        │
┌──────────┐     WSS            │  │  Fastify API :4000  │        │
│  Rasp-   │◄──────────────────►│  │  ├─ REST endpoints  │        │
│  berry   │                    │  │  ├─ WebSocket /ws    │        │
│  Pi      │                    │  │  └─ Auth middleware  │        │
└──────────┘                    │  └──────┬──────────────┘        │
                                │         │                        │
                                │    ┌────┴────┐                   │
                                │    ▼         ▼                   │
                                │  SQLite   LiveKit SFU :7880      │
                                │  (WAL)    + built-in TURN :3478  │
                                │           + Redis                │
                                └──────────────────────────────────┘
```

## เทคนิคที่ใช้

### Signaling — ส่งสัญญาณโทร/รับ/วาง

| ส่วน | เทคโนโลยี | ทำไม |
|------|-----------|------|
| HTTP API | **Fastify** | เร็วที่สุดใน Node.js, รองรับ plugin ecosystem |
| Realtime events | **Native WebSocket** (ws) | latency ต่ำ, ไม่ต้องพึ่ง Socket.IO |
| Call state | **SQLite WAL mode** | sync I/O เร็ว, ไม่ต้อง DB server แยก |

### Media — ส่งเสียงจริง

| โหมด | เทคโนโลยี | ใช้เมื่อ |
|------|-----------|---------|
| **SFU** | **LiveKit** | `LIVEKIT_ENABLED=true` — รองรับทุกรูปแบบ call |
| **P2P** | **WebRTC direct** | `LIVEKIT_ENABLED=false` — เบาสุด, CPU server ≈ 0 |

### ความปลอดภัย

| ชั้น | วิธีการ |
|------|--------|
| Server → Server | **API Key** (`X-API-Key` header), constant-time compare |
| Browser → API | **JWT** (HS256, signed by community-link, verify by emergency API) |
| Pi device → API | **HMAC-SHA256** device token + timestamp (replay protection 5 นาที) |
| WebSocket | Auth timeout 5s, rate limit 30 msg/s, max payload 4KB |
| Media encryption | **DTLS-SRTP** (WebRTC built-in, end-to-end) |
| NAT traversal | **TURN** (built-in LiveKit / coturn), time-limited credentials |
| HTTP | Helmet headers, CORS whitelist, rate limit 100 req/min |
| SSL | Nginx TLS 1.2/1.3 + HSTS (production) |

## ประเภทการโทร

### 1. Normal Call (1-to-1)

```
Alice                      API + WS                        Bob
  │ POST /calls/initiate ───►│                               │
  │ ◄── callId + LK token   │── WS: incoming_call ─────────►│
  │                          │                               │
  │                          │◄── POST /calls/respond ───────│
  │◄── WS: call_accepted ───│── roomName + LK token ───────►│
  │                          │                               │
  │         ┌── LiveKit SFU Room ──┐                         │
  │         │ Alice ◄──audio──► Bob │                        │
  │         └──────────────────────┘                         │
  │ POST /calls/end ────────►│── WS: call_ended ────────────►│
```

### 2. Emergency SOS

```
SOS User                   API + WS                    ทุกคน online
  │ POST /calls/initiate ──►│                               │
  │   type: "emergency"     │── WS: incoming_call ─────────►│ User A
  │                         │── WS: incoming_call ─────────►│ User B
  │                         │── WS: incoming_call ─────────►│ Admin
  │ ◄── callId + LK token  │                               │
  │                         │                               │
  │                         │◄── คนแรกที่รับ (first responder)
  │◄── WS: call_accepted   │                               │
  │    ┌── LiveKit Room ──┐ │                               │
  │    │ SOS ◄──audio──► Responder                          │
  │    └──────────────────┘ │                               │
```

### 3. Broadcast (Admin)

```
Admin                      API + WS                    ทุกคน online
  │ POST /calls/initiate ──►│                               │
  │   type: "broadcast"     │── WS: broadcast_start ───────►│ ทุกคน
  │ ◄── callId + LK token  │   (includes roomName +        │
  │                         │    mediaMode + livekitUrl)     │
  │                         │                               │
  │ Auto-join LiveKit       │     ผู้รับ: POST /livekit/token │
  │ as publisher (mic on)   │     (canPublish=false)        │
  │                         │     แล้ว join เป็น listener     │
  │                         │                               │
  │ ┌── LiveKit Room ──────────────────────────────────┐    │
  │ │ Admin (publish) ──audio──► Listener A (subscribe) │   │
  │ │                  ──audio──► Listener B (subscribe) │   │
  │ │                  ──audio──► Listener C (subscribe) │   │
  │ └──────────────────────────────────────────────────┘    │
  │                         │                               │
  │ POST /calls/end ───────►│── WS: call_ended ────────────►│
  │ Leave LiveKit           │     Listeners leave LiveKit   │
```

**หมายเหตุ:** ผู้สร้าง broadcast auto-join เป็น publisher (เปิดไมค์),
ผู้รับ auto-join เป็น listener (ฟังอย่างเดียว, ไม่เปิดไมค์)

## API Endpoints

| Method | Path | Auth | คำอธิบาย |
|--------|------|------|----------|
| GET | `/health` | — | Health check |
| POST | `/auth/token` | API Key | ออก JWT สำหรับ user |
| POST | `/calls/initiate` | JWT/API Key | เริ่ม call |
| POST | `/calls/respond` | JWT/API Key | accept/reject call |
| POST | `/calls/end` | JWT/API Key | วางสาย |
| GET | `/calls/history` | JWT/API Key | ประวัติ call (paginated) |
| GET | `/calls/online-count` | JWT/API Key | จำนวนคน online |
| POST | `/devices/register` | Admin | ลงทะเบียน Pi device |
| GET | `/devices` | JWT/API Key | รายการ devices |
| POST | `/devices/heartbeat` | JWT/API Key | Pi health check |
| GET | `/turn/credentials` | JWT/API Key | TURN server credentials |
| POST | `/livekit/token` | JWT/API Key | LiveKit room token |
| GET | `/livekit/config` | JWT/API Key | LiveKit config (public URL) |
| GET | `/livekit/rooms` | Admin | Active LiveKit rooms |
| WS | `/ws` | JWT/HMAC | WebSocket signaling |

## WebSocket Messages

### Client → Server
| type | คำอธิบาย |
|------|----------|
| `auth` | ส่ง JWT/HMAC token เพื่อ authenticate |
| `offer` | WebRTC SDP offer (P2P mode) |
| `answer` | WebRTC SDP answer (P2P mode) |
| `ice-candidate` | ICE candidate (P2P mode) |
| `ping` | Heartbeat |

### Server → Client
| type | คำอธิบาย |
|------|----------|
| `auth_ok` | Authenticated สำเร็จ |
| `incoming_call` | มีสายเรียกเข้า |
| `call_accepted` | สายถูกรับแล้ว |
| `call_rejected` | สายถูกปฏิเสธ |
| `call_ended` | สายจบแล้ว |
| `broadcast_start` | เริ่ม broadcast |
| `offer/answer/ice-candidate` | WebRTC relay (P2P mode) |
| `pong` | Heartbeat response |

## Deploy

### Development (local Docker)
```bash
cp .env.example .env
# แก้ค่าใน .env

# P2P mode (ไม่ต้อง LiveKit)
docker compose up -d

# SFU mode (มี LiveKit)
docker compose --profile livekit up -d
```

### Production (SSL + Nginx)
```bash
# Let's Encrypt
docker compose -f docker-compose.prod.yml --profile certbot run --rm certbot

# Start
docker compose -f docker-compose.prod.yml up -d
```

### Environment Variables สำคัญ

| Variable | คำอธิบาย |
|----------|----------|
| `JWT_SECRET` | ต้องตรงกับ community-link |
| `API_KEYS` | community-link ใช้เรียก API |
| `DEVICE_SECRET` | Pi device HMAC auth |
| `LIVEKIT_ENABLED` | `true` = SFU, `false` = P2P only |
| `ALLOWED_ORIGINS` | CORS whitelist |

## ผลทดสอบ

| Test Suite | ผ่าน | รวม | คำอธิบาย |
|------------|------|-----|----------|
| WebSocket Test | 39 | 39 | Auth, signaling, call events, rate limit, error handling |
| LiveKit Test | 23 | 23 | Config, token, WS handshake, room connect, audio publish, 2-participant relay, full call flow |
| 1-to-1 Call Test | 19 | 19 | Complete call lifecycle: initiate → notify → accept → join → audio exchange → end → history |
| **Total** | **81** | **81** | |

## โครงสร้างไฟล์

```
synkolab-emergency/
├── src/
│   ├── index.ts              # Fastify server + SSL
│   ├── config.ts             # Environment config
│   ├── auth/
│   │   ├── jwt.ts            # JWT sign/verify
│   │   ├── device.ts         # HMAC device auth
│   │   └── middleware.ts     # Auth middleware (3 modes)
│   ├── db/
│   │   ├── schema.ts         # SQLite tables
│   │   └── index.ts          # DB connection
│   ├── routes/
│   │   ├── calls.ts          # Call CRUD + LiveKit token
│   │   ├── devices.ts        # Device management
│   │   ├── health.ts         # Health + auth/token
│   │   ├── turn.ts           # TURN credentials
│   │   └── livekit.ts        # LiveKit management
│   ├── services/
│   │   └── livekit.ts        # LiveKit SDK wrapper
│   ├── ws/
│   │   ├── handler.ts        # WebSocket auth + message routing
│   │   └── rooms.ts          # Client tracking + broadcast
│   └── types/index.ts
├── test/
│   ├── ws-test.mjs           # WebSocket test suite (39 tests)
│   ├── livekit-test.mjs      # LiveKit test suite (23 tests)
│   └── call-1to1-test.mjs    # 1-to-1 call test (19 tests)
├── test-client/              # Web UI สำหรับทดสอบ manual
├── config/
│   ├── livekit.yaml          # LiveKit + TURN config
│   └── turnserver.conf       # coturn config (production)
├── nginx/nginx.conf          # SSL reverse proxy
├── Dockerfile
├── docker-compose.yml        # Development
├── docker-compose.prod.yml   # Production + SSL + certbot
└── .env.example
```
