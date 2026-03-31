# synkolab-emergency — Deployment & Operations Guide

## สารบัญ

- [Architecture](#architecture)
- [SSL Certificate](#ssl-certificate)
- [Docker Services](#docker-services)
- [Environment Variables](#environment-variables)
- [Host Nginx Config](#host-nginx-config)
- [Firewall](#firewall)
- [Deploy Step-by-Step](#deploy-step-by-step)
- [Update & Restart](#update--restart)
- [Pi Device Setup](#pi-device-setup)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
Client (Browser / Pi)
  │
  ▼ HTTPS / WSS (port 443)
Host Nginx (existing, handles all *.stu-link.com subdomains)
  │
  ├── /ws        → emergency-api (127.0.0.1:4000 HTTPS)  WebSocket signaling
  ├── /rtc       → livekit (127.0.0.1:7880 WS)           LiveKit WebSocket
  ├── /twirp/    → livekit (127.0.0.1:7880 HTTP)          LiveKit Room Service API
  ├── /health    → emergency-api                           Health check
  └── /*         → emergency-api                           REST API
  
Docker containers (internal network):
  ├── emergency-api     (Node.js + Fastify, SSL enabled, port 4000)
  ├── emergency-redis   (Redis 7, session/state)
  ├── emergency-livekit (LiveKit SFU, port 7880)
  └── emergency-coturn  (TURN/TURNS, host network, port 3478/5349)
```

### SSL End-to-End

| จุด | Protocol | รายละเอียด |
|-----|----------|------------|
| Client → Nginx | HTTPS (443) | Sectigo Wildcard `*.stu-link.com` |
| Nginx → App | HTTPS (4000) | self-signed ภายใน, `proxy_ssl_verify off` |
| Client → TURN | TURNS/TLS (5349) | Sectigo cert เดียวกัน |
| Client → LiveKit | WSS ผ่าน Nginx `/rtc` | SSL ที่ Nginx |
| ภายใน Docker | ไม่เข้ารหัส | internal network ปลอดภัย |

---

## SSL Certificate

**ประเภท:** Sectigo PositiveSSL Wildcard
**Domain:** `*.stu-link.com` + `stu-link.com`
**Key:** RSA 4096-bit
**หมดอายุ:** 10 ต.ค. 2026

### ไฟล์ที่ต้องมี

```
certs/
  fullchain.pem    ← server cert + intermediate chain (3 certs)
  privkey.pem      ← private key (RSA 4096)
```

### ไฟล์ต้นฉบับ (ไม่ได้ใช้โดยตรง)

```
certs/
  _.stu-link.com.crt   ← server cert อย่างเดียว
  _.stu-link.com.pem   ← bundle 4 certs (รวม root)
  _.stu-link.com.csr   ← CSR (ไม่จำเป็น)
```

### สร้าง fullchain.pem จากไฟล์ต้นฉบับ

```bash
# รวม server cert + CA chain (ตัด root ออก = 3 certs)
cat "Certificate (.crt).txt" > fullchain.pem
echo >> fullchain.pem
cat "CA certificate (-ca.crt).txt" >> fullchain.pem
```

### คัดลอกไปที่ host Nginx ใช้

```bash
sudo cp certs/fullchain.pem /home/superadmin/ssl3/fullchain.pem
sudo cp certs/privkey.pem /home/superadmin/ssl3/stu_link.com.key
```

### ตรวจสอบ cert

```bash
# ดูข้อมูล cert
openssl x509 -in certs/fullchain.pem -noout -subject -dates

# ตรวจ key ตรงกับ cert
openssl pkey -in certs/privkey.pem -pubout | openssl md5
openssl x509 -in certs/fullchain.pem -pubkey -noout | openssl md5
# ค่า MD5 ต้องตรงกัน

# Verify chain
openssl verify -untrusted certs/fullchain.pem certs/_.stu-link.com.crt
```

---

## Docker Services

### docker-compose.prod.yml

| Service | Image | Port | Network | รายละเอียด |
|---------|-------|------|---------|------------|
| **app** | synkolab-emergency-app (build) | 127.0.0.1:4000 | emergency-net | Node.js API + WebSocket |
| **redis** | redis:7-alpine | internal | emergency-net | Session/state management |
| **livekit** | livekit/livekit-server:latest | 7880, 7881, 50000-50060/udp | emergency-net | SFU สำหรับ group calls |
| **coturn** | coturn/coturn:latest | 3478, 5349 | host network | TURN/TURNS relay |

### Volumes

| Volume | Mount | รายละเอียด |
|--------|-------|------------|
| `app-data` | `/app/data` | SQLite database |
| `redis-data` | `/data` | Redis persistence |
| `certs/fullchain.pem` | `/app/certs/fullchain.pem` (app), `/etc/coturn/certs/` (coturn) | SSL cert |
| `certs/privkey.pem` | `/app/certs/privkey.pem` (app), `/etc/coturn/certs/` (coturn) | SSL key |

### Config Files

| ไฟล์ | Mount ใน container | รายละเอียด |
|------|-------------------|------------|
| `config/turnserver.conf` | `/etc/turnserver.conf` (coturn) | TURN server config |
| `config/livekit.yaml` | `/etc/livekit.yaml` (livekit) | LiveKit server config |
| `.env` | env_file (app) | Environment variables |

---

## Environment Variables

### Server
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `NODE_ENV` | `production` | Environment mode |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `4000` | Listen port |

### SSL
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `SSL_ENABLED` | `true` | เปิด HTTPS/WSS บน app |
| `SSL_CERT_PATH` | `/app/certs/fullchain.pem` | Certificate file |
| `SSL_KEY_PATH` | `/app/certs/privkey.pem` | Private key file |

### Domain
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `PUBLIC_URL` | `https://call.stu-link.com` | Public URL |
| `ALLOWED_ORIGINS` | `https://comm-link.cmru.ac.th,...` | CORS origins (CSV) |

### Authentication
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `JWT_SECRET` | - | **ต้องสร้างใหม่** `openssl rand -hex 32` |
| `JWT_ISSUER` | `community-link` | JWT issuer claim |
| `JWT_AUDIENCE` | `synkolab-emergency` | JWT audience claim |
| `JWT_EXPIRES_IN` | `2h` | Token expiry |
| `API_KEYS` | - | **ต้องสร้างใหม่** API key สำหรับ service calls (CSV) |
| `DEVICE_SECRET` | - | **ต้องสร้างใหม่** Secret สำหรับ device token |

### TURN Server
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `TURN_SECRET` | - | **ต้องสร้างใหม่** ต้องตรงกับ `turnserver.conf` |
| `TURN_SERVERS` | `turns:call.stu-link.com:5349,turn:call.stu-link.com:3478` | TURN URLs |
| `TURN_TTL` | `86400` | Credential TTL (seconds) |

### Redis
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `REDIS_ENABLED` | `true` | เปิด Redis |
| `REDIS_URL` | `redis://redis:6379` | Redis URL |

### LiveKit
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `LIVEKIT_ENABLED` | `true` | เปิด SFU mode |
| `LIVEKIT_URL` | `ws://livekit:7880` | Internal URL (Docker) |
| `LIVEKIT_PUBLIC_URL` | `wss://call.stu-link.com` | Public URL (ผ่าน Nginx `/rtc`) |
| `LIVEKIT_API_KEY` | - | **ต้องสร้างใหม่** ต้องตรงกับ `livekit.yaml` |
| `LIVEKIT_API_SECRET` | - | **ต้องสร้างใหม่** ต้องตรงกับ `livekit.yaml` |
| `LIVEKIT_TOKEN_TTL` | `3600` | User token TTL |
| `LIVEKIT_DEVICE_TOKEN_TTL` | `86400` | Device token TTL (Pi) |

### WebSocket
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `WS_PING_INTERVAL` | `30000` | Ping ทุก 30 วินาที |
| `WS_AUTH_TIMEOUT` | `5000` | Timeout auth 5 วินาที |
| `WS_MAX_PAYLOAD` | `4096` | Max message size |
| `WS_MAX_CONNECTIONS` | `500` | Max connections |

### Call Settings
| Variable | Default | รายละเอียด |
|----------|---------|------------|
| `CALL_RING_TIMEOUT` | `30000` | Ring timeout 30 วินาที |
| `CALL_MAX_DURATION` | `3600000` | Max call 1 ชั่วโมง |

---

## Host Nginx Config

ไฟล์: `nginx/call.stu-link.com.conf` → `/etc/nginx/sites-enabled/`

```bash
sudo cp nginx/call.stu-link.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Proxy paths

| Path | Target | Protocol |
|------|--------|----------|
| `/ws` | `https://127.0.0.1:4000` | WebSocket upgrade, timeout 3600s |
| `/rtc` | `http://127.0.0.1:7880` | LiveKit WebSocket, timeout 3600s |
| `/twirp/` | `http://127.0.0.1:7880` | LiveKit Room Service API |
| `/health` | `https://127.0.0.1:4000` | Health check |
| `/*` | `https://127.0.0.1:4000` | API routes |

---

## Firewall

```bash
sudo ufw allow 3478/tcp    # TURN
sudo ufw allow 3478/udp    # TURN
sudo ufw allow 5349/tcp    # TURNS (TLS)
```

Port 80/443 ใช้ host Nginx ที่เปิดอยู่แล้ว

---

## Deploy Step-by-Step

### ครั้งแรก (Fresh Install)

```bash
# 1. Clone
git clone https://github.com/Twopro-CO-th/synkolab-emergency.git
cd synkolab-emergency

# 2. Install & Build
npm install
npm run build

# 3. วาง SSL cert
# คัดลอก fullchain.pem + privkey.pem → certs/

# 4. สร้าง .env (auto-generate secrets)
bash scripts/generate-env.sh

# 5. ตั้งค่า host Nginx
sudo cp nginx/call.stu-link.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. เปิด Firewall
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp

# 7. Start
docker compose -f docker-compose.prod.yml up -d
```

### ค่าสำคัญที่ต้องเก็บ

หลังรัน `generate-env.sh` จดค่าเหล่านี้:

| ค่า | ใช้ที่ไหน |
|-----|----------|
| `API_KEYS` | ใส่ใน community-link server + test-client |
| `JWT_SECRET` | ต้องตรงกับ community-link server |
| `TURN_SECRET` | auto-update ใน turnserver.conf |
| `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` | auto-update ใน livekit.yaml |

---

## Update & Restart

### อัพเดท code

```bash
cd ~/synkolab-emergency
git pull
npm run build
docker compose -f docker-compose.prod.yml up -d --build
```

### แก้ .env แล้ว restart

```bash
# เก็บ DB ไว้
docker compose -f docker-compose.prod.yml down --remove-orphans
docker compose -f docker-compose.prod.yml up -d --build

# ลบทั้งหมดรวม DB (clean install)
docker compose -f docker-compose.prod.yml down --remove-orphans --volumes
docker compose -f docker-compose.prod.yml up -d --build
```

### อัพเดท Nginx

```bash
sudo cp nginx/call.stu-link.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Pi Device Setup

### ขั้นตอนลงทะเบียน device

```bash
# รันจากเครื่องไหนก็ได้
curl -sk -X POST https://call.stu-link.com/devices/register \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Pi Kitchen", "identity": "pi_kitchen"}'
```

Response:
```json
{
  "id": "device-id",
  "name": "Pi Kitchen",
  "identity": "pi_kitchen",
  "token": "device-token-keep-this"
}
```

> **สำคัญ:** Token จะแสดงแค่ครั้งเดียวตอน register

### สร้าง config บน Pi

```bash
sudo mkdir -p /etc/voice-pi
sudo tee /etc/voice-pi/config.json << EOF
{
  "serverUrl": "https://call.stu-link.com",
  "deviceId": "device-id-from-register",
  "deviceToken": "device-token-from-register",
  "livekitUrl": "wss://call.stu-link.com",
  "roomName": "general",
  "identity": "pi_kitchen",
  "deviceName": "Pi Kitchen",
  "reconnectInterval": 5000
}
EOF
```

### Install & Run

```bash
cd ~/community-link/apps/pi
git pull
npm install
npm start
```

### Pi ที่ลงทะเบียนแล้ว

| Device | Identity | ID | IP |
|--------|----------|-----|-----|
| Pi 4 Kitchen | pi_kitchen | `3xUXcEJx9Kiwrz5p1BZCS` | 192.168.8.172 |

### Auto setup script

```bash
cd ~/community-link
git pull
bash scripts/setup-pi-emergency.sh
```

### WebSocket Auth จาก Pi

Pi ส่ง auth message ในรูปแบบ:
```json
{
  "type": "auth",
  "clientType": "device",
  "deviceId": "3xUXcEJx9Kiwrz5p1BZCS",
  "token": "hmac-sha256-token"
}
```

Server ตอบ: `{ "type": "auth_ok", "id": "3xUXcEJx9Kiwrz5p1BZCS" }`

### Pi Service (systemd)

```bash
# ดู log
journalctl -u voice-pi -f

# Restart
sudo systemctl restart voice-pi

# ดูสถานะ
curl localhost:8080/status

# โทรออก (เหมือนกดปุ่ม)
curl -X POST localhost:8080/call

# วางสาย
curl -X POST localhost:8080/hangup
```

---

## Troubleshooting

### Container ไม่ start

```bash
# ดู logs
docker logs emergency-api
docker logs emergency-livekit
docker logs emergency-coturn

# ดูสถานะ
docker ps -a
```

### Healthcheck fail (unhealthy)

**สาเหตุ:** `wget` ใช้ localhost ซึ่ง resolve เป็น IPv6 `[::1]` แต่ app listen IPv4

**แก้ไข:** ใช้ `127.0.0.1` แทน `localhost` ใน healthcheck (แก้แล้ว)

### Port conflict

```bash
# ตรวจว่า port ถูกใช้อยู่
sudo lsof -i :80
sudo lsof -i :443
sudo lsof -i :4000
```

**แก้ไข:** ใช้ host Nginx แทน Docker nginx เพื่อไม่ต้องแย่ง port 80/443

### Network "still in use"

```bash
docker compose -f docker-compose.prod.yml down --remove-orphans
```

### SSL cert หมดอายุ

```bash
# ตรวจวันหมดอายุ
openssl x509 -in certs/fullchain.pem -noout -dates

# เปลี่ยน cert ใหม่
cp new-fullchain.pem certs/fullchain.pem
cp new-privkey.pem certs/privkey.pem
sudo cp certs/fullchain.pem /home/superadmin/ssl3/fullchain.pem
sudo cp certs/privkey.pem /home/superadmin/ssl3/stu_link.com.key
docker compose -f docker-compose.prod.yml restart
sudo systemctl reload nginx
```

### Pi เชื่อมต่อไม่ได้

1. ตรวจ config: `cat /etc/voice-pi/config.json`
2. ตรวจ network: `curl -sk https://call.stu-link.com/health`
3. ตรวจ device auth:
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('wss://call.stu-link.com/ws', {rejectUnauthorized:false});
ws.on('open', () => ws.send(JSON.stringify({
  type:'auth', clientType:'device',
  deviceId:'YOUR_ID', token:'YOUR_TOKEN'
})));
ws.on('message', d => { console.log(d.toString()); ws.close(); });
"
```

### LiveKit ไม่ทำงาน

1. ตรวจ container: `docker logs emergency-livekit`
2. ตรวจ config: keys ใน `livekit.yaml` ต้องตรงกับ `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` ใน `.env`
3. ตรวจ Nginx: `/rtc` path ต้อง proxy ไป `127.0.0.1:7880`
4. ตรวจ `LIVEKIT_PUBLIC_URL`: ต้องเป็น `wss://call.stu-link.com` (ไม่มี port)
