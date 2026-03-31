# synkolab-emergency — API Reference

## Authentication

### 3 วิธี Authentication

| วิธี | ใช้สำหรับ | Header / Message |
|------|----------|-----------------|
| **API Key** | Service-to-service (community-link) | `X-API-Key: sk_xxx` |
| **JWT Bearer** | Web users | `Authorization: Bearer eyJhbG...` |
| **Device Token** | Pi / Hardware devices | WebSocket auth message |

### API Key (Service)
```
X-API-Key: sk_e0da2fa633ff4da77c1a289bda45af6a4c0c7d1b57aac6bc
X-Request-User: user_id_to_act_on_behalf  (optional)
```

### JWT Token
```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```
Payload: `{ sub: "userId", role: "user"|"admin", name: "...", iss: "community-link", aud: "synkolab-emergency" }`

### Device Token (WebSocket only)
```json
{ "type": "auth", "clientType": "device", "deviceId": "xxx", "token": "hmac-sha256-hex" }
```
Token = `HMAC-SHA256(deviceId, DEVICE_SECRET)` หรือ `HMAC-SHA256(deviceId:timestamp, DEVICE_SECRET)`

---

## REST API

### GET /health
Health check (ไม่ต้อง auth)

**Response 200:**
```json
{ "status": "ok", "timestamp": "2026-03-31T12:00:00.000Z" }
```

---

### POST /auth/token
Issue JWT token (API Key only)

**Request:**
```json
{ "userId": "alice", "role": "admin", "name": "Alice" }
```

**Response 200:**
```json
{ "token": "eyJhbG...", "userId": "alice", "role": "admin" }
```

---

### POST /calls/initiate
เริ่มการโทร

**Request:**
```json
{
  "calleeId": "bob",                          // required for normal
  "type": "normal" | "emergency" | "broadcast",  // default: "normal"
  "calleeType": "user" | "device",              // default: "user"
  "targetIds": ["id1", "id2"]                   // optional, broadcast only
}
```

**Response 200:**
```json
{
  "callId": "mP1Mk7vF1iz3CQm08gaxW",
  "roomName": "call-mP1Mk7vF1iz3CQm08gaxW",
  "type": "normal",
  "mediaMode": "sfu" | "p2p",
  "livekit": {
    "token": "eyJhbG...",
    "url": "wss://call.stu-link.com"
  }
}
```

**Side effects:**
- `normal`: ส่ง `incoming_call` WS ถึง callee
- `emergency`: broadcast `incoming_call` ถึงทุกคนออนไลน์
- `broadcast`: broadcast `broadcast_start` ถึงทุกคน (หรือ targetIds)

---

### POST /calls/respond
รับ/ปฏิเสธสาย

**Request:**
```json
{ "callId": "mP1Mk7vF1iz3CQm08gaxW", "action": "accept" | "reject" }
```

**Response 200 (accept):**
```json
{
  "ok": true,
  "roomName": "call-mP1Mk7vF1iz3CQm08gaxW",
  "mediaMode": "sfu",
  "livekit": { "token": "eyJhbG...", "url": "wss://call.stu-link.com" }
}
```

**Side effects:**
- `accept`: ส่ง `call_accepted` WS ถึง caller
- `reject`: ส่ง `call_rejected` WS ถึง caller

---

### POST /calls/end
วางสาย

**Request:**
```json
{ "callId": "mP1Mk7vF1iz3CQm08gaxW" }
```

**Response 200:**
```json
{ "ok": true, "duration": 300 }
```

**Side effects:** ส่ง `call_ended` WS ถึงทุก participant

---

### GET /calls/history?page=1&limit=20&type=normal
ประวัติการโทร (admin เห็นทั้งหมด, user เห็นเฉพาะของตัวเอง)

**Response 200:**
```json
{
  "calls": [{
    "id": "callId", "caller_id": "alice", "callee_id": "bob",
    "type": "normal", "status": "completed", "duration": 300,
    "started_at": "...", "answered_at": "...", "ended_at": "..."
  }],
  "pagination": { "page": 1, "limit": 20, "total": 150, "pages": 8 }
}
```

---

### GET /calls/online-count
จำนวนคนออนไลน์

**Response 200:**
```json
{ "users": 5, "devices": 3, "total": 8 }
```

---

### GET /calls/online
รายชื่อคนออนไลน์

**Response 200:**
```json
{
  "users": [{ "id": "alice", "type": "user", "name": "Alice", "online": true }],
  "devices": [{ "id": "devId", "type": "device", "name": "Pi Kitchen", "identity": "pi_kitchen", "online": true }]
}
```

---

### POST /devices/register
ลงทะเบียน device (admin only)

**Request:**
```json
{
  "name": "Pi Kitchen",
  "identity": "pi_kitchen",
  "location": { "lat": 18.7, "lng": 98.9, "description": "ห้องครัว" },
  "config": {}
}
```

**Response 201:**
```json
{
  "id": "3xUXcEJx9Kiwrz5p1BZCS",
  "name": "Pi Kitchen",
  "identity": "pi_kitchen",
  "token": "b50f8db1..."
}
```
> Token แสดงครั้งเดียวเท่านั้น

---

### GET /devices
รายการ devices ทั้งหมด

**Response 200:**
```json
[{
  "id": "3xUXcEJx9Kiwrz5p1BZCS",
  "name": "Pi Kitchen",
  "identity": "pi_kitchen",
  "status": "online",
  "last_seen": "2026-03-31T12:00:00Z",
  "location": { "lat": 18.7, "lng": 98.9, "description": "ห้องครัว" }
}]
```

---

### PATCH /devices/:id
อัพเดท device (admin only)

**Request:**
```json
{ "name": "New Name", "status": "offline", "location": {...}, "config": {...} }
```

---

### POST /devices/heartbeat
Device heartbeat

**Request:**
```json
{ "deviceId": "3xUXcEJx9Kiwrz5p1BZCS", "health": { "cpu": 45.2 } }
```

---

### GET /turn/credentials
TURN credentials (time-limited)

**Response 200:**
```json
{
  "urls": ["turns:call.stu-link.com:5349", "turn:call.stu-link.com:3478"],
  "username": "1711896896:alice",
  "credential": "base64-hmac-sha1",
  "ttl": 86400
}
```

---

### POST /livekit/token
LiveKit room token

**Request:**
```json
{ "roomName": "call-xxx", "canPublish": true, "canSubscribe": true }
```

**Response 200:**
```json
{ "token": "eyJhbG...", "url": "wss://call.stu-link.com", "roomName": "call-xxx" }
```

---

### GET /livekit/config
LiveKit public config

**Response 200:**
```json
{
  "enabled": true,
  "url": "wss://call.stu-link.com",
  "turnServers": ["turns:call.stu-link.com:5349", "turn:call.stu-link.com:3478"]
}
```

---

### GET /livekit/rooms
List active rooms (admin only)

### GET /livekit/rooms/:roomName/participants
List participants in room (admin only)

### DELETE /livekit/rooms/:roomName
Delete/close room (admin only)

### DELETE /livekit/rooms/:roomName/participants/:identity
Kick participant (admin only)

### POST /livekit/rooms/:roomName/mute
Mute participant (admin only)

**Request:** `{ "identity": "alice", "muted": true }`

---

## WebSocket Protocol

**URL:** `wss://call.stu-link.com/ws`

### Client → Server

| Type | Fields | รายละเอียด |
|------|--------|------------|
| `auth` | `token`, `clientType?`, `deviceId?`, `ts?` | Authentication (ภายใน 5 วินาที) |
| `offer` | `targetId`, `sdp` | WebRTC SDP offer |
| `answer` | `targetId`, `sdp` | WebRTC SDP answer |
| `ice-candidate` | `targetId`, `candidate` | ICE candidate |
| `ping` / `heartbeat` | - | Keep-alive |

### Server → Client

| Type | Fields | รายละเอียด |
|------|--------|------------|
| `auth_ok` | `id` | Auth success |
| `auth_error` | `reason` | Auth failed |
| `incoming_call` | `callId`, `callerId`, `callerName`, `callType`, `roomName` | มีสายเข้า |
| `call_accepted` | `callId`, `answererId` | สายถูกรับ |
| `call_rejected` | `callId` | สายถูกปฏิเสธ |
| `call_ended` | `callId`, `reason` | สายจบ |
| `broadcast_start` | `callId`, `roomName`, `from`, `mediaMode`, `livekitUrl?` | Broadcast เริ่ม |
| `offer` | `fromId`, `sdp` | WebRTC offer จาก peer |
| `answer` | `fromId`, `sdp` | WebRTC answer จาก peer |
| `ice-candidate` | `fromId`, `candidate` | ICE จาก peer |
| `pong` | - | ตอบ ping |
| `error` | `message` | Error |

### Limits
- **Max payload:** 4096 bytes
- **Rate limit:** 30 msg/sec
- **Auth timeout:** 5 sec
- **Ping interval:** 30 sec
- **Connection replace:** ถ้า user เดิมเชื่อมต่อใหม่ connection เก่าจะถูกปิด (code 4000)

---

## Call Flow Diagrams

### Normal 1-to-1 Call (SFU mode)

```
Alice (Web)                    Server                     Bob (Web)
    |                            |                            |
    |  POST /calls/initiate      |                            |
    |  {calleeId:"bob"}          |                            |
    |--------------------------->|                            |
    |  {callId, roomName,        |                            |
    |   livekit:{token,url}}     |  WS: incoming_call         |
    |<---------------------------|--------------------------->|
    |                            |                            |
    |                            |  POST /calls/respond       |
    |                            |  {action:"accept"}         |
    |  WS: call_accepted         |<---------------------------|
    |<---------------------------|  {roomName, livekit:token}  |
    |                            |                            |
    |  LiveKit: join room        |  LiveKit: join room        |
    |========== AUDIO ================================================|
    |                            |                            |
    |  POST /calls/end           |                            |
    |--------------------------->|  WS: call_ended            |
    |  {ok, duration}            |--------------------------->|
    |<---------------------------|                            |
```

### Emergency Broadcast

```
Alice (Web)                    Server              Bob    Carol   Pi
    |                            |                  |       |      |
    |  POST /calls/initiate      |                  |       |      |
    |  {type:"emergency"}        |                  |       |      |
    |--------------------------->|  incoming_call    |       |      |
    |  {callId, roomName}        |----------------->|       |      |
    |<---------------------------|----------------->|------>|----->|
    |                            |                  |       |      |
    |                         (anyone can accept)   |       |      |
```

---

## Testing

### Test Files

| ไฟล์ | จำนวน tests | ทดสอบอะไร |
|------|-------------|-----------|
| `test/ws-test.mjs` | 39 tests | Auth, Signaling, Call Flow, Broadcast, Rate Limit, Error Handling |
| `test/call-1to1-test.mjs` | 19 tests | Full 1-to-1 call: WS connect → initiate → accept → LiveKit join → audio → end → history |
| `test/livekit-test.mjs` | 23 tests | LiveKit: config, token, WS handshake, room connect, publish audio, 2-party relay, room service |

### รัน test

```bash
# จาก server (อ่าน .env อัตโนมัติ)
node test/ws-test.mjs
node test/call-1to1-test.mjs
node test/livekit-test.mjs

# จากเครื่องอื่น (ต้องส่ง env)
API_URL="https://call.stu-link.com" \
JWT_SECRET="xxx" \
API_KEY="sk_xxx" \
DEVICE_SECRET="xxx" \
node test/ws-test.mjs
```

### Test Client (Web UI)

```bash
cd test-client
npm install
npm run dev    # http://localhost:5555
```

ใส่ API Key แล้วทดสอบทุกฟังก์ชันผ่าน UI:
- Connect WebSocket
- Initiate call / Accept / End
- Emergency broadcast
- LiveKit room join
- Device management
- Call history

เปลี่ยน server: `VITE_API_URL=http://localhost:4000 npm run dev`

### ผลทดสอบล่าสุด (2026-03-31)

| Test | Result |
|------|--------|
| ws-test.mjs | **39/39 passed** |
| call-1to1-test.mjs | **19/19 passed** |
| livekit-test.mjs | **23/23 passed** |
| **Total** | **81/81 passed** |
