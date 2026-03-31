# synkolab-emergency

Emergency Call API Service — WebRTC P2P + LiveKit SFU signaling server

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Twopro-CO-th/synkolab-emergency.git
cd synkolab-emergency

# 2. Install
npm install

# 3. Setup env
cp .env.example .env

# 4. Build
npm run build

# 5. Run (เลือกวิธีใดวิธีหนึ่ง)
```

### วิธี A: Docker (แนะนำ)

```bash
# P2P mode (ไม่ต้อง LiveKit)
docker compose up -d

# SFU mode (มี LiveKit + Redis)
docker compose --profile livekit up -d
```

### วิธี B: Node.js ตรง

```bash
npm run dev    # development (auto-reload)
npm start      # production
```

## Production (SSL — Docker)

Domain: `call.stu-link.com` (Sectigo Wildcard `*.stu-link.com`)

### 1. วาง SSL Certificate

วางไฟล์ 2 ตัวใน `certs/`:

```
certs/
  fullchain.pem    ← server cert + intermediate chain
  privkey.pem      ← private key
```

### 2. สร้าง .env

```bash
# สร้างอัตโนมัติพร้อม generate secrets ทั้งหมด
bash scripts/generate-env.sh
```

Script จะสร้าง JWT_SECRET, API_KEYS, DEVICE_SECRET, TURN_SECRET และอัพเดท `turnserver.conf` ให้ตรงกัน

> **สำคัญ:** เก็บค่า `API_KEYS` ที่ได้ไปใส่ใน community-link server ด้วย

### 3. Start Services

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Services ที่รัน

| Service | Port | รายละเอียด |
|---------|------|------------|
| **emergency-api** | 4000 (internal) | Node.js app (SSL enabled) |
| **emergency-nginx** | 80, 443 | Reverse proxy + SSL |
| **emergency-coturn** | 3478, 5349 (TLS) | TURN/TURNS server |

### Firewall ports ที่ต้องเปิด

```
80/tcp       — HTTP (redirect → HTTPS)
443/tcp      — HTTPS
3478/tcp+udp — TURN
5349/tcp     — TURNS (TLS)
```

### Let's Encrypt (ทางเลือก)

ถ้าไม่มี cert ของตัวเอง สามารถใช้ Let's Encrypt:

```bash
docker compose -f docker-compose.prod.yml --profile certbot run --rm certbot
docker compose -f docker-compose.prod.yml up -d
```

## Test

```bash
# WebSocket + Auth + Signaling (39 tests)
node test/ws-test.mjs

# LiveKit integration (23 tests)
node test/livekit-test.mjs

# 1-to-1 Call full flow (19 tests)
node test/call-1to1-test.mjs
```

## Test Client (Web UI)

```bash
cd test-client
npm install
npm run dev     # http://localhost:5555
```

## API Reference

ดูรายละเอียดทั้งหมดใน [SUMMARY.md](./SUMMARY.md)

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/health` | Health check |
| POST | `/auth/token` | Issue JWT (via API key) |
| POST | `/calls/initiate` | Start call (normal/emergency/broadcast) |
| POST | `/calls/respond` | Accept/reject call |
| POST | `/calls/end` | End call |
| GET | `/calls/history` | Call history |
| GET | `/calls/online` | Online users + devices |
| POST | `/devices/register` | Register Pi device |
| GET | `/devices` | List devices |
| GET | `/turn/credentials` | TURN credentials |
| POST | `/livekit/token` | LiveKit room token |
| WS | `/ws` | WebSocket signaling |
