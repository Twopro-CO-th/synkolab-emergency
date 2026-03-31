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

## Production (SSL)

```bash
# Let's Encrypt
docker compose -f docker-compose.prod.yml --profile certbot run --rm certbot

# Start
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
