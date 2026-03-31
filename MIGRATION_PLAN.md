# Migration Plan: community-link → call.stu-link.com

## สถานการณ์ปัจจุบัน

### community-link (comm-link.cmru.ac.th)
เป็น Next.js monolith ที่รวมทุกอย่างไว้ใน Docker compose เดียวกัน:

```
Docker containers (community-link):
├── app          (Next.js — web + API + WebSocket signaling)
├── mongo        (MongoDB — users, projects, tickets, calls, devices)
├── nginx        (reverse proxy :8881)
├── livekit      (SFU — WebRTC media)
├── redis        (LiveKit state)
├── coturn       (TURN/TURNS server)
├── qdrant       (vector DB — ไม่เกี่ยวกับ call)
└── ollama       (LLM — ไม่เกี่ยวกับ call)
```

**2 ระบบ call ที่ทำงานคล้ายกัน:**

| | Intercom (`/intercom`) | Emergency (`/emergency`) |
|---|---|---|
| **ใช้สำหรับ** | Pi device ↔ Agent (help desk) | User ↔ User / SOS broadcast |
| **Signaling** | WebSocket (port 3001) | SSE (Server-Sent Events) |
| **Auth (device)** | `X-Device-Token` + bcrypt hash | - |
| **Auth (user)** | NextAuth session | NextAuth session |
| **Call model** | `CallTicket` (escalation, queue) | `EmergencyCall` (direct/broadcast) |
| **Device model** | `IntercomDevice` (per project) | `EmergencyDevice` |
| **Project model** | `IntercomProject` (multi-tenant) | ไม่มี (global) |
| **Escalation** | Agent queue (longest-idle first, 30s/agent, auto-miss 60s) | ไม่มี |
| **Recording** | LiveKit Egress (optional) | ไม่มี |
| **Database** | MongoDB | MongoDB |
| **Media** | LiveKit SFU | LiveKit SFU |
| **TURN** | coturn (shared) | coturn (shared) |

### synkolab-emergency (call.stu-link.com)
Microservice แยกต่างหาก ทำงานครบทุกฟีเจอร์ call:

```
Docker containers (synkolab-emergency):
├── app          (Fastify — REST API + WebSocket signaling)
├── redis        (session/state)
├── livekit      (SFU — WebRTC media)
└── coturn       (TURN/TURNS — host network)
```

**ฟีเจอร์ที่มี:**
- REST API + WebSocket signaling (รวมเป็นหนึ่งเดียว)
- 3 auth methods: API Key, JWT, Device Token (HMAC-SHA256)
- Call types: normal, emergency, broadcast
- P2P mode + SFU mode (LiveKit)
- Device registration + heartbeat
- Call history + online tracking
- TURN credentials generation
- SSL end-to-end
- **ผ่าน test 81/81**

---

## เป้าหมาย

**ย้ายฟีเจอร์ call ทั้งหมดออกจาก community-link ไปใช้ call.stu-link.com**

```
ก่อน:
  community-link (8 containers) — ทำทุกอย่าง
  
หลัง:
  community-link (4 containers) — Web UI + business logic เท่านั้น
  call.stu-link.com (4 containers) — ทุกอย่างเกี่ยวกับ call
```

### Containers ที่ลดได้จาก community-link

| Container | ลด? | เหตุผล |
|-----------|-----|--------|
| **livekit** | ลด | ใช้ call.stu-link.com แทน |
| **redis** (LiveKit) | ลด | ใช้ call.stu-link.com แทน |
| **coturn** | ลด | ใช้ call.stu-link.com แทน |
| **qdrant** | คงไว้ | ไม่เกี่ยวกับ call |
| **ollama** | คงไว้ | ไม่เกี่ยวกับ call |
| **mongo** | คงไว้ | ยังใช้สำหรับ users, projects, tickets |
| **nginx** | คงไว้ | reverse proxy สำหรับ Next.js |
| **app** | คงไว้ | Next.js web UI |

**ผลลัพธ์: ลด 3 containers** (livekit, redis, coturn)

---

## แผนการทำงาน

### Phase 1: community-link เรียก API ของ call.stu-link.com

ไม่ต้องแก้ฝั่ง synkolab-emergency — แก้แค่ฝั่ง community-link

#### 1.1 สร้าง API Client

สร้าง `src/lib/emergency-api.ts`:

```typescript
// Emergency API client — เรียก call.stu-link.com แทน local
const API_URL = process.env.EMERGENCY_API_URL || 'https://call.stu-link.com';
const API_KEY = process.env.EMERGENCY_API_KEY || '';

async function callApi(method: string, path: string, body?: any) {
  const headers: Record<string, string> = {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export const emergencyApi = {
  // Auth
  issueToken: (userId: string, role: string, name: string) =>
    callApi('POST', '/auth/token', { userId, role, name }),

  // Calls
  initiateCall: (callerId: string, body: any) =>
    callApi('POST', '/calls/initiate', body),
  respondCall: (userId: string, body: any) =>
    callApi('POST', '/calls/respond', body),
  endCall: (userId: string, body: any) =>
    callApi('POST', '/calls/end', body),
  callHistory: (page: number, limit: number, type?: string) =>
    callApi('GET', `/calls/history?page=${page}&limit=${limit}${type ? `&type=${type}` : ''}`),
  onlineCount: () => callApi('GET', '/calls/online-count'),
  onlineList: () => callApi('GET', '/calls/online'),

  // Devices
  registerDevice: (body: any) => callApi('POST', '/devices/register', body),
  listDevices: () => callApi('GET', '/devices'),

  // TURN
  turnCredentials: () => callApi('GET', '/turn/credentials'),

  // LiveKit
  livekitToken: (body: any) => callApi('POST', '/livekit/token', body),
  livekitConfig: () => callApi('GET', '/livekit/config'),
};
```

#### 1.2 แก้ API Routes ใน community-link

แทนที่จะทำงานเอง ให้ proxy ไปที่ call.stu-link.com:

| Route เดิม (community-link) | เปลี่ยนเป็น |
|------------------------------|------------|
| `POST /api/emergency/call/initiate` | → `POST call.stu-link.com/calls/initiate` |
| `POST /api/emergency/call/respond` | → `POST call.stu-link.com/calls/respond` |
| `POST /api/emergency/call/end` | → `POST call.stu-link.com/calls/end` |
| `GET /api/emergency/call/events` (SSE) | → เปลี่ยนเป็น WSS `call.stu-link.com/ws` |
| `POST /api/emergency/token` | → `POST call.stu-link.com/livekit/token` |
| `GET /api/emergency/config` | → `GET call.stu-link.com/livekit/config` |
| `GET /api/emergency/history` | → `GET call.stu-link.com/calls/history` |
| `GET /api/emergency/online-count` | → `GET call.stu-link.com/calls/online-count` |
| `POST /api/emergency/devices` | → `POST call.stu-link.com/devices/register` |
| `GET /api/emergency/devices` | → `GET call.stu-link.com/devices` |
| `POST /api/intercom/call/initiate` | → `POST call.stu-link.com/calls/initiate` |
| `POST /api/intercom/call/respond` | → `POST call.stu-link.com/calls/respond` |
| `POST /api/intercom/call/end` | → `POST call.stu-link.com/calls/end` |
| `POST /api/intercom/token` | → `POST call.stu-link.com/livekit/token` |

#### 1.3 แก้ Frontend Components

**EmergencyDashboard.tsx / CallRoom.tsx:**
- เปลี่ยน LiveKit URL จาก `NEXT_PUBLIC_LIVEKIT_URL` เป็น `wss://call.stu-link.com`
- WebSocket signaling เปลี่ยนจาก `ws://localhost:3001` เป็น `wss://call.stu-link.com/ws`
- Token ขอจาก `call.stu-link.com/livekit/token` แทน local
- TURN credentials จาก `call.stu-link.com/turn/credentials` แทน local

**Intercom layout.tsx:**
- WebSocket เปลี่ยนจาก port 3001 ไปใช้ `wss://call.stu-link.com/ws`
- Auth เปลี่ยนจาก `auth_agent` message เป็น JWT auth

#### 1.4 แก้ .env

เพิ่มใน community-link `.env`:
```
# Emergency Call API (external service)
EMERGENCY_API_URL=https://call.stu-link.com
EMERGENCY_API_KEY=sk_e0da2fa633ff4da77c1a289bda45af6a4c0c7d1b57aac6bc
EMERGENCY_JWT_SECRET=d4f20f8f87046e5f8ff76040fd79dd8420e0eee9f7a49e85e9241414a2a673cd
```

ลบ:
```
# ไม่ต้องใช้แล้ว
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
NEXT_PUBLIC_LIVEKIT_URL=...
LIVEKIT_URL=...
TURN_SECRET=...
WS_PORT=...
```

---

### Phase 2: ลบ Docker containers ที่ไม่ใช้

#### 2.1 แก้ docker-compose.prod.yml ของ community-link

ลบ services:
```yaml
# ลบทั้งหมดนี้:
livekit:
redis:
coturn:
```

#### 2.2 ลบ WebSocket server

ลบ WS server จาก `src/instrumentation.ts` (port 3001)

#### 2.3 ลบ source code ที่ไม่ใช้

```
# ลบ local signaling
src/lib/intercom/wsSignaling.ts      → ใช้ call.stu-link.com/ws แทน
src/lib/emergency/callSignaling.ts   → ใช้ call.stu-link.com/ws แทน
src/lib/intercom/turnCredentials.ts  → ใช้ call.stu-link.com/turn/credentials แทน

# config files ไม่ต้องใช้
config/livekit.yaml     → ใช้ของ call.stu-link.com
config/turnserver.conf  → ใช้ของ call.stu-link.com
```

---

### Phase 3: รวม Intercom + Emergency เข้าด้วยกัน

ทั้ง Intercom และ Emergency ทำงานคล้ายกันมาก ต่างกันแค่ business logic:

| ฟีเจอร์ | synkolab-emergency รองรับแล้ว | ต้องเพิ่ม |
|---------|-------------------------------|----------|
| Normal call (1-to-1) | YES | - |
| Emergency SOS broadcast | YES | - |
| Broadcast to all | YES | - |
| Device registration | YES | - |
| Device heartbeat | YES | - |
| WebSocket signaling | YES | - |
| P2P + SFU mode | YES | - |
| TURN/TURNS | YES | - |
| Call history | YES | - |
| Online tracking | YES | - |
| **Agent escalation queue** | NO | เพิ่มใน Phase 3 |
| **Project-based multi-tenant** | NO | เพิ่มใน Phase 3 |
| **Agent availability** | NO | เพิ่มใน Phase 3 |
| **Call recording** | NO | เพิ่มใน Phase 3 |
| **Emergency contacts** | NO | จัดการฝั่ง community-link |

#### 3.1 เพิ่ม Escalation Engine ใน synkolab-emergency

```
POST /calls/initiate  { type: "intercom", projectId: "xxx" }
  → ระบบจะ:
  1. สร้าง call record
  2. หา agents ที่ว่างใน project
  3. ring agent ที่ idle นานสุด
  4. ถ้าไม่รับ 30 วินาที → ring คนถัดไป
  5. ถ้าไม่มีใครรับ 60 วินาที → mark as missed
```

#### 3.2 เพิ่ม Project concept

```
POST /projects  { name, members: [{userId, role}] }
GET /projects/:id/agents  → online agents in project
```

#### 3.3 Unified Call UI

community-link ใช้ UI เดียวกันสำหรับทั้ง intercom และ emergency:
- `/intercom/[projectId]/call/[roomName]` → ใช้ CallRoom component
- `/emergency/call/[roomName]` → ใช้ CallRoom component เดียวกัน
- ทั้งคู่เรียก `call.stu-link.com` API

---

## สรุป Timeline

| Phase | งาน | ผลลัพธ์ |
|-------|-----|---------|
| **Phase 1** | community-link เรียก API call.stu-link.com | ทำงานได้เหมือนเดิม ผ่าน external API |
| **Phase 2** | ลบ livekit/redis/coturn จาก community-link | ลด 3 containers |
| **Phase 3** | เพิ่ม escalation + project ใน synkolab-emergency | รวม intercom + emergency เป็นหนึ่งเดียว |

---

## Env ที่ต้องแชร์ระหว่าง 2 ระบบ

| ค่า | community-link | call.stu-link.com |
|-----|---------------|-------------------|
| `API_KEY` | `EMERGENCY_API_KEY=sk_xxx` | `API_KEYS=sk_xxx` |
| `JWT_SECRET` | `EMERGENCY_JWT_SECRET=xxx` | `JWT_SECRET=xxx` (ต้องตรงกัน) |
| LiveKit URL | `wss://call.stu-link.com` (client) | `ws://livekit:7880` (internal) |
| TURN | ไม่ต้องตั้งค่า | `TURN_SECRET`, `TURN_SERVERS` |

---

## Mapping: MongoDB → SQLite

ข้อมูลจาก MongoDB ที่ต้อง migrate หรือ sync:

| MongoDB (community-link) | SQLite (synkolab-emergency) | วิธี |
|--------------------------|---------------------------|------|
| `EmergencyCall` | `calls` table | community-link เรียก API สร้างใหม่ |
| `EmergencyDevice` | `devices` table | ลงทะเบียนใหม่ผ่าน API |
| `CallTicket` | `calls` table | community-link เรียก API สร้างใหม่ |
| `IntercomDevice` | `devices` table | ลงทะเบียนใหม่ผ่าน API |
| `IntercomProject` | ยังอยู่ใน MongoDB | Phase 3 ถึงจะย้าย |
| `User` | ยังอยู่ใน MongoDB | ใช้ JWT ส่งข้อมูล user |

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| call.stu-link.com ล่ม | call ใช้ไม่ได้ทั้งหมด | Monitor + health check + auto-restart |
| Network latency (2 servers) | call delay เพิ่ม | ทั้งสอง server อยู่ใน CMRU network |
| JWT secret ไม่ตรงกัน | auth fail | ใช้ env ค่าเดียวกัน |
| Pi device ต้อง re-register | downtime สั้น | Script อัตโนมัติ + token เก็บไว้ |
| Escalation logic ยังไม่มี | intercom ไม่มี queue | Phase 1 ใช้ broadcast ก่อน, Phase 3 เพิ่ม |
