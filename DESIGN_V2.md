# synkolab-emergency V2 — Project + Map + Device Alert Design

## ภาพรวม

ระบบ Emergency Call ที่ admin สร้าง Project → เพิ่มอุปกรณ์ Pi พร้อมพิกัด GPS → แสดงบน Map dashboard
เมื่ออุปกรณ์แจ้งเตือน map จะ zoom ไปที่ตำแหน่ง + หมุดกระพริบแดง + ป้ายขยาย → กดรับสาย

---

## User Flow

### 1. Admin สร้าง Project

```
Admin → สร้างโปรเจค "อาคาร A" → กำหนดแผนที่หลัก (center lat/lng, zoom level)
      → เพิ่มอุปกรณ์ "Pi ชั้น 1" → ใส่ GPS (lat: 18.89, lng: 98.95)
      → เพิ่มอุปกรณ์ "Pi ชั้น 2" → ใส่ GPS (lat: 18.89, lng: 98.96)
      → เพิ่ม members (agents ที่รับสาย)
```

### 2. Dashboard Map (ปกติ)

```
┌─────────────────────────────────────────────┐
│  🗺️ Project: อาคาร A                        │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │         📍 Pi ชั้น 1 (🟢 online)       │  │
│  │                                        │  │
│  │                                        │  │
│  │              📍 Pi ชั้น 2 (🟢 online)  │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  Online: 2 devices, 3 agents                 │
└─────────────────────────────────────────────┘
```

- หมุดแสดง: ชื่ออุปกรณ์ + สถานะ (🟢 online / ⚫ offline)
- กดที่หมุด → แสดง popup: ชื่อ, สถานะ, ปุ่ม "📞 โทร"
- กดโทร → initiate call ไปที่อุปกรณ์นั้น

### 3. เมื่ออุปกรณ์แจ้งเตือน (Emergency)

```
┌─────────────────────────────────────────────┐
│  🗺️ Project: อาคาร A    🔴 ALERT!          │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │                                        │  │
│  │    🔴💥 Pi ชั้น 1 — EMERGENCY!         │  │
│  │    ┌──────────────────────────┐        │  │
│  │    │ 🚨 แจ้งเตือนฉุกเฉิน!    │        │  │
│  │    │ Pi ชั้น 1 - อาคาร A     │        │  │
│  │    │ 18.89°N, 98.95°E        │        │  │
│  │    │                          │        │  │
│  │    │  [📞 รับสาย]  [❌ ปิด]   │        │  │
│  │    └──────────────────────────┘        │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  ⏱️ Ringing: 15s / 60s                      │
└─────────────────────────────────────────────┘
```

**เมื่อ Pi กดปุ่มแจ้งเตือน:**
1. Map **animate zoom** ไปตำแหน่งอุปกรณ์
2. หมุด **กระพริบแดง** (pulse animation)
3. ป้าย **ขยายใหญ่** แสดงข้อมูล + ปุ่มรับสาย
4. **เสียง ringtone** เล่น
5. กด "รับสาย" → เข้า call room (LiveKit audio)
6. ถ้าไม่มีใครรับ 60 วินาที → mark as missed

---

## API Design

### Project API

#### POST /projects
สร้าง project พร้อมแผนที่หลัก

```json
{
  "name": "อาคาร A",
  "slug": "building-a",
  "mapConfig": {
    "center": { "lat": 18.8906, "lng": 98.9520 },
    "zoom": 17,
    "mapType": "satellite"
  },
  "settings": {
    "escalationTimeout": 30,
    "autoMissTimeout": 60,
    "ringtone": "default"
  }
}
```

Response:
```json
{
  "id": "proj_xxx",
  "name": "อาคาร A",
  "slug": "building-a",
  "mapConfig": { "center": {...}, "zoom": 17 },
  "owner_id": "admin_user"
}
```

#### GET /projects/:id
รายละเอียด project + members + devices พร้อม GPS

```json
{
  "id": "proj_xxx",
  "name": "อาคาร A",
  "mapConfig": { "center": {...}, "zoom": 17 },
  "members": [
    { "user_id": "agent_1", "role": "admin" },
    { "user_id": "agent_2", "role": "member" }
  ],
  "devices": [
    {
      "id": "dev_xxx",
      "name": "Pi ชั้น 1",
      "identity": "pi_floor1",
      "status": "online",
      "location": { "lat": 18.8906, "lng": 98.9520, "description": "ชั้น 1 ห้องโถง" }
    },
    {
      "id": "dev_yyy",
      "name": "Pi ชั้น 2",
      "identity": "pi_floor2",
      "status": "offline",
      "location": { "lat": 18.8908, "lng": 98.9525, "description": "ชั้น 2 ทางเดิน" }
    }
  ]
}
```

#### PATCH /projects/:id
อัพเดท mapConfig, settings

```json
{
  "mapConfig": {
    "center": { "lat": 18.89, "lng": 98.95 },
    "zoom": 18
  }
}
```

### Device Registration (with GPS)

#### POST /devices/register

```json
{
  "name": "Pi ชั้น 1",
  "identity": "pi_floor1",
  "location": {
    "lat": 18.8906,
    "lng": 98.9520,
    "description": "ชั้น 1 ห้องโถง อาคาร A"
  }
}
```

#### PATCH /devices/:id

```json
{
  "location": {
    "lat": 18.8906,
    "lng": 98.9520,
    "description": "ย้ายไปห้องใหม่"
  }
}
```

### Call Flow (Intercom with escalation)

#### Device แจ้งเตือน (Pi กดปุ่ม)

```
POST /calls/initiate
{
  "type": "intercom",
  "projectId": "proj_xxx"
}
```

Server จะ:
1. สร้าง call record
2. Broadcast `incoming_call` ถึงทุก agent ใน project ผ่าน WebSocket
3. Start escalation (ring agent ที่ idle นานสุด → 30s → คนถัดไป)

#### WebSocket message ที่ agent ได้รับ

```json
{
  "type": "incoming_call",
  "callId": "call_xxx",
  "callerId": "dev_xxx",
  "callerName": "Pi ชั้น 1",
  "callType": "intercom",
  "roomName": "intercom-call_xxx",
  "projectId": "proj_xxx",
  "location": {
    "lat": 18.8906,
    "lng": 98.9520,
    "description": "ชั้น 1 ห้องโถง"
  },
  "timeout": 30,
  "agentIndex": 1,
  "totalAgents": 3
}
```

**สำคัญ:** ต้องส่ง `location` มาด้วยเพื่อให้ frontend รู้ว่าต้อง zoom ไปที่ไหน

#### Agent โทรหาอุปกรณ์ (กดที่หมุด)

```
POST /calls/initiate
{
  "calleeId": "dev_xxx",
  "type": "normal",
  "calleeType": "device"
}
```

---

## Database Schema Changes

### projects table (update)

```sql
-- เพิ่ม map_config column
ALTER TABLE projects ADD COLUMN map_config TEXT DEFAULT '{}';
-- JSON: { center: {lat, lng}, zoom: number, mapType: string }
```

### devices table (มีอยู่แล้ว)

location column มีอยู่แล้ว — ใช้เก็บ GPS:
```json
{ "lat": 18.8906, "lng": 98.9520, "description": "ชั้น 1 ห้องโถง" }
```

### calls table (update)

```sql
-- เพิ่ม project_id column
ALTER TABLE calls ADD COLUMN project_id TEXT;
```

---

## Frontend Components (community-link)

### 1. ProjectDashboard.tsx — หน้าหลัก

```
/intercom/[projectId]
```

- แสดง Map (Leaflet / Google Maps) ตาม `mapConfig`
- Plot หมุดทุกอุปกรณ์ใน project
- สี: 🟢 online, ⚫ offline, 🔴 alerting
- SSE/WS listener สำหรับ `incoming_call` events

### 2. DeviceMarker.tsx — หมุดบน Map

**State ปกติ:**
```
📍 Pi ชั้น 1
🟢 Online
```

**State แจ้งเตือน (pulse animation):**
```css
@keyframes pulse-alert {
  0%   { transform: scale(1); opacity: 1; }
  50%  { transform: scale(1.5); opacity: 0.7; box-shadow: 0 0 20px red; }
  100% { transform: scale(1); opacity: 1; }
}

.marker-alerting {
  animation: pulse-alert 1s infinite;
  z-index: 9999;
}
```

**Popup ปกติ (กดที่หมุด):**
```
┌─────────────────────────┐
│ Pi ชั้น 1               │
│ 🟢 Online               │
│ ชั้น 1 ห้องโถง อาคาร A  │
│ 18.89°N, 98.95°E        │
│                         │
│ [📞 โทร]  [⚙️ ตั้งค่า]  │
└─────────────────────────┘
```

**Popup แจ้งเตือน (ขยายใหญ่):**
```
┌──────────────────────────────────┐
│ 🚨 EMERGENCY ALERT!              │
│                                  │
│ Pi ชั้น 1                        │
│ ชั้น 1 ห้องโถง อาคาร A           │
│                                  │
│ ⏱️ Ringing: 15s / 60s            │
│                                  │
│  [ 📞 รับสาย ]   [ ❌ ปิด ]      │
└──────────────────────────────────┘
```

### 3. CallRoom.tsx — ห้องสนทนา

เมื่อกด "รับสาย" หรือ "โทร":
- เปิด LiveKit audio room
- แสดง: waveform, mute/unmute, volume, end call
- ข้อมูลอุปกรณ์ + GPS ด้านบน

### 4. DeviceManager.tsx — จัดการอุปกรณ์

- ฟอร์มลงทะเบียนอุปกรณ์ + เลือก GPS บน Map (click-to-place)
- แก้ไขตำแหน่ง (drag marker)
- ดูสถานะ / health ของอุปกรณ์

---

## WebSocket Event Flow

```
Pi กดปุ่ม
    │
    ▼
[call.stu-link.com]
    │
    ├─── WS: incoming_call (+ location) → Agent 1 browser
    ├─── WS: incoming_call (+ location) → Agent 2 browser
    └─── WS: incoming_call (+ location) → Agent 3 browser
    
Agent browser รับ incoming_call:
    │
    ├── 1. Map.flyTo(location.lat, location.lng, zoom: 19)
    ├── 2. Marker.startPulse() → กระพริบแดง
    ├── 3. Popup.expand() → แสดงป้ายใหญ่ + ปุ่มรับสาย
    ├── 4. Audio.play('ringtone')
    └── 5. Timer countdown (30s → timeout → next agent)

Agent กดรับสาย:
    │
    ├── POST /calls/respond { callId, action: "accept" }
    ├── Marker.stopPulse() → กลับเป็น 🟢
    ├── Popup.close()
    ├── CallRoom.open() → LiveKit audio
    └── WS: call_accepted → Other agents (popup หายไป)

Agent กดโทรจากหมุด (ปกติ):
    │
    ├── POST /calls/initiate { calleeId: deviceId, type: "normal", calleeType: "device" }
    ├── CallRoom.open() → LiveKit audio
    └── WS: incoming_call → Pi device
```

---

## Implementation Plan

### Backend (synkolab-emergency)

1. **อัพเดท projects table** — เพิ่ม `map_config` column
2. **อัพเดท calls table** — เพิ่ม `project_id` column
3. **อัพเดท PATCH /projects/:id** — รองรับ `mapConfig`
4. **อัพเดท POST /calls/initiate (intercom)** — ส่ง `location` ใน incoming_call WS message
5. **อัพเดท escalation** — ส่ง device location ใน ring message

### Frontend (community-link)

1. **สร้าง ProjectMapDashboard.tsx** — Map + device markers + alert handling
2. **สร้าง DeviceMarker.tsx** — marker component with pulse animation
3. **สร้าง AlertPopup.tsx** — popup สำหรับ incoming call
4. **สร้าง DeviceRegistrationMap.tsx** — click-to-place GPS
5. **แก้ intercom/[projectId]/page.tsx** — ใช้ ProjectMapDashboard
6. **เพิ่ม CSS animations** — pulse, glow, expand

### Map Library

แนะนำ **Leaflet + react-leaflet** (ฟรี, ไม่ต้อง API key):
```bash
npm install leaflet react-leaflet @types/leaflet
```

หรือ **Google Maps** (ต้อง API key):
```bash
npm install @react-google-maps/api
```

---

## Wireframe: Admin สร้าง Project

```
┌─────────────────────────────────────────────┐
│  สร้างโปรเจคใหม่                             │
│                                             │
│  ชื่อ: [อาคาร A                        ]    │
│  Slug: [building-a                     ]    │
│                                             │
│  📍 ตำแหน่งแผนที่หลัก:                       │
│  ┌────────────────────────────────────────┐  │
│  │         (คลิกบน Map เพื่อเลือก)        │  │
│  │                                        │  │
│  │              📍 ← คลิกตรงนี้           │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  Lat: [18.8906   ] Lng: [98.9520   ]        │
│  Zoom: [17  ]  Type: [satellite ▼]          │
│                                             │
│                          [ ยกเลิก ] [ สร้าง ] │
└─────────────────────────────────────────────┘
```

## Wireframe: เพิ่มอุปกรณ์

```
┌─────────────────────────────────────────────┐
│  เพิ่มอุปกรณ์ — โปรเจค: อาคาร A              │
│                                             │
│  ชื่อ: [Pi ชั้น 1                      ]    │
│  Identity: [pi_floor1                  ]    │
│  คำอธิบาย: [ชั้น 1 ห้องโถง             ]    │
│                                             │
│  📍 ตำแหน่ง (ลากหมุดหรือคลิก):              │
│  ┌────────────────────────────────────────┐  │
│  │              📍 Pi ชั้น 1              │  │
│  │      (ลากหมุดเพื่อปรับตำแหน่ง)         │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  Lat: [18.8906   ] Lng: [98.9520   ]        │
│                                             │
│                          [ ยกเลิก ] [ เพิ่ม ] │
└─────────────────────────────────────────────┘
```
