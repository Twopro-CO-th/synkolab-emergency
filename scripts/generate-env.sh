#!/usr/bin/env bash
# ============================================================
# generate-env.sh — สร้างไฟล์ .env พร้อม production secrets
# Usage: bash scripts/generate-env.sh
# ============================================================

set -euo pipefail

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
    echo "พบ $ENV_FILE อยู่แล้ว — สร้าง backup เป็น .env.bak"
    cp "$ENV_FILE" ".env.bak"
fi

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
API_KEY="sk_$(openssl rand -hex 24)"
DEVICE_SECRET=$(openssl rand -hex 32)
TURN_SECRET=$(openssl rand -hex 32)
LIVEKIT_API_KEY="API$(openssl rand -hex 8)"
LIVEKIT_API_SECRET=$(openssl rand -hex 32)

cat > "$ENV_FILE" <<EOF
# ============================================================
# synkolab-emergency — Environment Configuration
# Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# ============================================================

# ---------- Server ----------
NODE_ENV=production
HOST=0.0.0.0
PORT=4000

# ---------- SSL ----------
SSL_ENABLED=true
SSL_CERT_PATH=/app/certs/fullchain.pem
SSL_KEY_PATH=/app/certs/privkey.pem

# ---------- Domain ----------
PUBLIC_URL=https://call.stu-link.com
ALLOWED_ORIGINS=https://comm-link.cmru.ac.th,https://call.stu-link.com,http://localhost:3000,http://localhost:5555

# ---------- Authentication ----------
JWT_SECRET=${JWT_SECRET}
JWT_ISSUER=community-link
JWT_AUDIENCE=synkolab-emergency
JWT_EXPIRES_IN=2h

# API Key สำหรับ community-link server เรียก
API_KEYS=${API_KEY}

# Secret สำหรับ verify Raspberry Pi device tokens
DEVICE_SECRET=${DEVICE_SECRET}

# ---------- TURN Server ----------
TURN_SECRET=${TURN_SECRET}
TURN_SERVERS=turns:call.stu-link.com:5349,turn:call.stu-link.com:3478
TURN_TTL=86400

# ---------- Database ----------
DB_PATH=./data/emergency.db

# ---------- Redis ----------
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379

# ---------- Rate Limiting ----------
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# ---------- WebSocket ----------
WS_PING_INTERVAL=30000
WS_AUTH_TIMEOUT=5000
WS_MAX_PAYLOAD=4096
WS_MAX_CONNECTIONS=500

# ---------- Call Settings ----------
CALL_RING_TIMEOUT=30000
CALL_MAX_DURATION=3600000

# ---------- LiveKit (SFU สำหรับ group/broadcast calls) ----------
LIVEKIT_ENABLED=true
LIVEKIT_URL=ws://livekit:7880
LIVEKIT_PUBLIC_URL=wss://call.stu-link.com
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_TOKEN_TTL=3600
LIVEKIT_DEVICE_TOKEN_TTL=86400

# ---------- Logging ----------
LOG_LEVEL=info
EOF

echo ""
echo "====================================="
echo "  .env สร้างเรียบร้อยแล้ว!"
echo "====================================="
echo ""
echo "Keys ที่สร้าง:"
echo "  JWT_SECRET    = ${JWT_SECRET}"
echo "  API_KEYS      = ${API_KEY}"
echo "  DEVICE_SECRET = ${DEVICE_SECRET}"
echo "  TURN_SECRET   = ${TURN_SECRET}"
echo ""
echo "สำคัญ: เก็บค่า API_KEYS ไว้ใส่ใน community-link server ด้วย"
echo "สำคัญ: TURN_SECRET ต้องตรงกับ static-auth-secret ใน config/turnserver.conf"
echo ""
echo "อัพเดท turnserver.conf:"
sed -i "s/^static-auth-secret=.*/static-auth-secret=${TURN_SECRET}/" config/turnserver.conf
echo "  turnserver.conf อัพเดทแล้ว"
echo ""
echo "อัพเดท livekit.yaml:"
sed -i "s/^  .*: .*# livekit-api-key-secret/  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}/" config/livekit.yaml 2>/dev/null
# Replace keys section entirely
sed -i "/^keys:/,/^[a-z]/{/^keys:/!{/^[a-z]/!d}}" config/livekit.yaml 2>/dev/null
sed -i "s/^keys:/keys:\n  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}/" config/livekit.yaml 2>/dev/null
echo "  livekit.yaml อัพเดทแล้ว"
echo ""
echo "พร้อม deploy:"
echo "  docker compose -f docker-compose.prod.yml up -d"
