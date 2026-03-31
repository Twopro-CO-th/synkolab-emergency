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

## Production Deploy

Domain: `call.stu-link.com` (Sectigo Wildcard `*.stu-link.com`)

### Architecture

```
Client (HTTPS/WSS)
  │
  ▼
Host Nginx (port 443 SSL)
  ├── /ws      → emergency-api (127.0.0.1:4000 HTTPS)
  ├── /rtc     → livekit (127.0.0.1:7880 WS)
  ├── /health  → emergency-api
  └── /*       → emergency-api
  
TURN/TURNS (coturn)
  ├── port 3478 (TURN)
  └── port 5349 (TURNS/TLS)
```

### Services ทั้งหมด

| Service | Container | Port | รายละเอียด |
|---------|-----------|------|------------|
| **emergency-api** | Node.js + Fastify | 127.0.0.1:4000 | API + WebSocket signaling (SSL) |
| **emergency-redis** | Redis 7 | internal | Session/state management |
| **emergency-livekit** | LiveKit SFU | 7880, 7881, 50000-50060/udp | Group/broadcast calls |
| **emergency-coturn** | coturn | 3478, 5349 | TURN/TURNS relay |
| **Host Nginx** | nginx (existing) | 80, 443 | SSL termination + reverse proxy |

### SSL End-to-End

| จุด | Protocol |
|-----|----------|
| Client → Nginx | HTTPS (443) |
| Nginx → App | HTTPS (4000) |
| Client → TURN | TURNS/TLS (5349) |
| Client → LiveKit | WSS ผ่าน Nginx (`/rtc`) |
| ภายใน Docker | ไม่เข้ารหัส (internal network) |

### Step-by-Step Deploy

#### 1. Clone & Build

```bash
git clone https://github.com/Twopro-CO-th/synkolab-emergency.git
cd synkolab-emergency
npm install
npm run build
```

#### 2. วาง SSL Certificate

วางไฟล์ 2 ตัวใน `certs/`:

```
certs/
  fullchain.pem    ← server cert + intermediate chain
  privkey.pem      ← private key
```

รวมถึงคัดลอกไปที่ host Nginx ใช้:

```bash
sudo cp certs/fullchain.pem /home/superadmin/ssl3/fullchain.pem
sudo cp certs/privkey.pem /home/superadmin/ssl3/stu_link.com.key
```

#### 3. สร้าง .env

```bash
bash scripts/generate-env.sh
```

Script จะสร้าง JWT_SECRET, API_KEYS, DEVICE_SECRET, TURN_SECRET, LiveKit keys และอัพเดท `turnserver.conf` + `livekit.yaml` ให้ตรงกัน

> **สำคัญ:** เก็บค่า `API_KEYS` ที่ได้ไปใส่ใน community-link server ด้วย

#### 4. ตั้งค่า Host Nginx

```bash
sudo cp nginx/call.stu-link.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. เปิด Firewall

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
```

> Port 80/443 ใช้ host Nginx ที่เปิดอยู่แล้ว

#### 6. Start Services

```bash
docker compose -f docker-compose.prod.yml up -d
```

#### อัพเดท .env แล้ว restart

เมื่อแก้ไข `.env` ให้ลบ containers ทั้งหมดแล้วสร้างใหม่:

```bash
# 1. หยุดและลบ containers + networks + volumes ทั้งหมด
docker compose -f docker-compose.prod.yml down --remove-orphans --volumes

# 2. ลบ images เก่า (ถ้าต้องการ build ใหม่ทั้งหมด)
docker compose -f docker-compose.prod.yml down --rmi all --remove-orphans --volumes

# 3. สร้างใหม่ทั้งหมด
docker compose -f docker-compose.prod.yml up -d --build
```

> `--remove-orphans` จะลบ container เก่าที่ไม่ได้อยู่ใน compose file แล้ว
> `--volumes` จะลบ volumes ด้วย (ระวัง: ข้อมูล DB จะหายถ้าใช้ flag นี้)

ถ้าต้องการเก็บข้อมูล DB ไว้ ใช้แบบไม่มี `--volumes`:

```bash
docker compose -f docker-compose.prod.yml down --remove-orphans
docker compose -f docker-compose.prod.yml up -d --build
```

#### อัพเดท Nginx config แล้ว reload

```bash
sudo cp nginx/call.stu-link.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Let's Encrypt (ทางเลือก)

ถ้าไม่มี cert ของตัวเอง:

```bash
sudo certbot --nginx -d call.stu-link.com
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
