/**
 * LiveKit Integration Test — ทดสอบทีละ step หาจุดที่พัง
 *
 * Step 1: API Health
 * Step 2: LiveKit Config endpoint
 * Step 3: Generate LiveKit Token
 * Step 4: LiveKit HTTP reachable
 * Step 5: LiveKit WebSocket handshake
 * Step 6: LiveKit Room connect (rtc-node)
 * Step 7: Publish audio track
 * Step 8: Second participant joins + receives audio
 * Step 9: Full call flow (API initiate → token → join)
 */

import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { Room, RoomEvent, TrackSource } from '@livekit/rtc-node';
import WebSocket from 'ws';

const API = 'http://localhost:4000';
const LK_WS = 'ws://localhost:7880';
const LK_HTTP = 'http://localhost:7880';
const API_KEY = 'sk_live_change-me-to-random-string';
const LK_API_KEY = 'devkey';
const LK_API_SECRET = 'secret123456789abcdef123456789abcdef';

let passed = 0;
let failed = 0;
let skipped = 0;

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function ok(msg) { passed++; log('✅', msg); }
function fail(msg) { failed++; log('❌', msg); }
function skip(msg) { skipped++; log('⏭️', msg); }
function info(msg) { log('  ', `  → ${msg}`); }

async function apiReq(method, path, body) {
  const headers = { 'X-API-Key': API_KEY };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function makeToken(identity, roomName, canPublish = true) {
  const token = new AccessToken(LK_API_KEY, LK_API_SECRET, {
    identity,
    ttl: 300,
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });
  return await token.toJwt();
}

// ============================================================
// STEP 1: API Health
// ============================================================
async function step1() {
  console.log('\n🔹 Step 1: API Health Check');
  try {
    const res = await apiReq('GET', '/health');
    if (res.status === 'ok') ok('API healthy');
    else fail(`API unhealthy: ${JSON.stringify(res)}`);
    return true;
  } catch (e) {
    fail(`API unreachable: ${e.message}`);
    return false;
  }
}

// ============================================================
// STEP 2: LiveKit Config Endpoint
// ============================================================
async function step2() {
  console.log('\n🔹 Step 2: LiveKit Config from API');
  try {
    const res = await apiReq('GET', '/livekit/config');
    if (res.enabled === true) {
      ok(`LiveKit enabled, URL: ${res.url}`);
      info(`TURN servers: ${JSON.stringify(res.turnServers)}`);
      return res;
    } else {
      fail(`LiveKit disabled: ${JSON.stringify(res)}`);
      return null;
    }
  } catch (e) {
    fail(`Config endpoint error: ${e.message}`);
    return null;
  }
}

// ============================================================
// STEP 3: Generate Token via API
// ============================================================
async function step3() {
  console.log('\n🔹 Step 3: Generate LiveKit Token via API');
  try {
    const res = await apiReq('POST', '/livekit/token', { roomName: 'test-step3' });
    if (res.token) {
      ok(`Token generated (${res.token.length} chars)`);
      info(`Room: ${res.roomName}, URL: ${res.url}`);
      return res;
    } else {
      fail(`Token error: ${JSON.stringify(res)}`);
      return null;
    }
  } catch (e) {
    fail(`Token endpoint error: ${e.message}`);
    return null;
  }
}

// ============================================================
// STEP 4: LiveKit HTTP Reachable
// ============================================================
async function step4() {
  console.log('\n🔹 Step 4: LiveKit HTTP Reachable');
  try {
    const res = await fetch(LK_HTTP);
    ok(`LiveKit HTTP status: ${res.status}`);
    return true;
  } catch (e) {
    fail(`LiveKit HTTP unreachable: ${e.message}`);
    return false;
  }
}

// ============================================================
// STEP 5: LiveKit WebSocket Handshake
// ============================================================
async function step5() {
  console.log('\n🔹 Step 5: LiveKit WebSocket Handshake');

  const token = await makeToken('ws_test_user', 'test-step5');

  return new Promise((resolve) => {
    const url = `${LK_WS}/rtc?access_token=${token}&auto_subscribe=1&protocol=16`;
    info(`Connecting: ${LK_WS}/rtc?access_token=<token>`);

    const ws = new WebSocket(url);
    let resolved = false;

    ws.on('open', () => {
      ok('WebSocket connection opened');
      resolved = true;
      ws.close();
      resolve(true);
    });

    ws.on('message', (data) => {
      info(`Received message: ${data.length} bytes`);
    });

    ws.on('error', (e) => {
      if (!resolved) { fail(`WebSocket error: ${e.message}`); resolved = true; resolve(false); }
    });

    ws.on('close', (code, reason) => {
      info(`WebSocket closed: ${code} ${reason}`);
      if (!resolved) { fail(`WebSocket closed before open: ${code}`); resolved = true; resolve(false); }
    });

    setTimeout(() => {
      if (!resolved) { fail('WebSocket timeout (5s)'); resolved = true; ws.close(); resolve(false); }
    }, 5000);
  });
}

// ============================================================
// STEP 6: LiveKit Room Connect (rtc-node)
// ============================================================
async function step6() {
  console.log('\n🔹 Step 6: LiveKit Room Connect (rtc-node SDK)');

  const roomName = `test-step6-${Date.now()}`;
  const token = await makeToken('node_test_user', roomName);

  const room = new Room();
  let connected = false;

  try {
    info(`Connecting to room: ${roomName}`);

    // Set timeout
    const timeout = setTimeout(() => {
      if (!connected) {
        info('Connection timed out after 15s');
        room.disconnect();
      }
    }, 15000);

    await room.connect(LK_WS, token, { autoSubscribe: true });
    connected = true;
    clearTimeout(timeout);

    ok(`Connected to room: ${room.name}`);
    info(`Local participant: ${room.localParticipant?.identity}`);
    info(`SID: ${room.localParticipant?.sid}`);

    await room.disconnect();
    ok('Disconnected cleanly');
    return true;
  } catch (e) {
    fail(`Room connect failed: ${e.message}`);
    info(`Error type: ${e.constructor.name}`);
    try { room.disconnect(); } catch {}
    return false;
  }
}

// ============================================================
// STEP 7: Publish Audio Track
// ============================================================
async function step7() {
  console.log('\n🔹 Step 7: Publish Audio Track');

  const roomName = `test-step7-${Date.now()}`;
  const token = await makeToken('audio_publisher', roomName);

  const room = new Room();

  try {
    await room.connect(LK_WS, token, { autoSubscribe: true });
    ok('Connected to room');

    // Create a fake audio source
    const { AudioSource, LocalAudioTrack } = await import('@livekit/rtc-node');

    const source = new AudioSource(48000, 1);
    const track = LocalAudioTrack.createAudioTrack('test-mic', source);

    const pub = await room.localParticipant.publishTrack(track, {
      source: TrackSource.SOURCE_MICROPHONE,
    });
    ok(`Audio track published: ${pub.sid}`);
    info(`Track name: test-mic, source: microphone`);

    // Send a few frames of silence
    const { AudioFrame } = await import('@livekit/rtc-node');
    for (let i = 0; i < 5; i++) {
      const frame = new AudioFrame(new Int16Array(480), 48000, 1, 480);
      await source.captureFrame(frame);
    }
    ok('Audio frames sent (5x 10ms silence)');

    await room.disconnect();
    ok('Disconnected cleanly');
    return true;
  } catch (e) {
    fail(`Publish audio failed: ${e.message}`);
    info(`Stack: ${e.stack?.split('\n')[1]?.trim()}`);
    try { room.disconnect(); } catch {}
    return false;
  }
}

// ============================================================
// STEP 8: Two Participants — Audio Relay
// ============================================================
async function step8() {
  console.log('\n🔹 Step 8: Two Participants — Audio Relay');

  const roomName = `test-step8-${Date.now()}`;
  const token1 = await makeToken('sender', roomName);
  const token2 = await makeToken('receiver', roomName);

  const room1 = new Room();
  const room2 = new Room();

  try {
    // Connect sender
    await room1.connect(LK_WS, token1);
    ok('Sender connected');

    // Publish audio from sender
    const { AudioSource, LocalAudioTrack } = await import('@livekit/rtc-node');
    const source = new AudioSource(48000, 1);
    const track = LocalAudioTrack.createAudioTrack('sender-mic', source);
    await room1.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE });
    ok('Sender published audio');

    // Connect receiver
    let trackReceived = false;
    const trackPromise = new Promise((resolve) => {
      room2.on(RoomEvent.TrackSubscribed, (remoteTrack, pub, participant) => {
        trackReceived = true;
        info(`Receiver got track from: ${participant.identity}, kind: ${remoteTrack.kind}`);
        resolve(true);
      });
      setTimeout(() => resolve(false), 10000);
    });

    await room2.connect(LK_WS, token2);
    ok('Receiver connected');
    info(`Participants in room: sender + receiver`);

    // Send audio frames
    const { AudioFrame } = await import('@livekit/rtc-node');
    for (let i = 0; i < 10; i++) {
      const frame = new AudioFrame(new Int16Array(480), 48000, 1, 480);
      await source.captureFrame(frame);
    }

    const received = await trackPromise;
    if (received) {
      ok('Receiver received audio track from sender');
    } else {
      fail('Receiver did not receive audio track within 10s');
    }

    await room1.disconnect();
    await room2.disconnect();
    ok('Both disconnected cleanly');
    return received;
  } catch (e) {
    fail(`Two-participant test failed: ${e.message}`);
    try { room1.disconnect(); } catch {}
    try { room2.disconnect(); } catch {}
    return false;
  }
}

// ============================================================
// STEP 9: Full Call Flow (API → Token → Join)
// ============================================================
async function step9() {
  console.log('\n🔹 Step 9: Full Call Flow (API initiate → accept → join LiveKit)');

  try {
    // Initiate emergency call via API
    const initRes = await apiReq('POST', '/calls/initiate', { type: 'emergency' });
    if (!initRes.callId) { fail(`Call initiate failed: ${JSON.stringify(initRes)}`); return false; }
    ok(`Call initiated: ${initRes.callId}`);
    info(`Room: ${initRes.roomName}, mode: ${initRes.mediaMode}`);

    if (initRes.mediaMode !== 'sfu') {
      skip('Not SFU mode — skip LiveKit join');
      return true;
    }

    // Use the LiveKit token from API response
    const lkToken = initRes.livekit?.token;
    const lkUrl = initRes.livekit?.url;
    if (!lkToken) { fail('No LiveKit token in API response'); return false; }
    ok(`LiveKit token received, URL: ${lkUrl}`);

    // Connect to LiveKit room using the token
    const room = new Room();
    await room.connect(lkUrl, lkToken);
    ok(`Joined LiveKit room: ${room.name}`);
    info(`Participant: ${room.localParticipant?.identity}`);

    // Publish audio
    const { AudioSource, LocalAudioTrack } = await import('@livekit/rtc-node');
    const source = new AudioSource(48000, 1);
    const track = LocalAudioTrack.createAudioTrack('sos-mic', source);
    await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE });
    ok('Audio published in emergency room');

    // End call
    const endRes = await apiReq('POST', '/calls/end', { callId: initRes.callId });
    ok(`Call ended: ${JSON.stringify(endRes)}`);

    await room.disconnect();
    ok('Disconnected from LiveKit');

    return true;
  } catch (e) {
    fail(`Full flow failed: ${e.message}`);
    return false;
  }
}

// ============================================================
// STEP 10: Room Service API (list rooms)
// ============================================================
async function step10() {
  console.log('\n🔹 Step 10: LiveKit Room Service API');

  try {
    const httpUrl = LK_WS.replace('ws://', 'http://');
    const svc = new RoomServiceClient(httpUrl, LK_API_KEY, LK_API_SECRET);

    const rooms = await svc.listRooms();
    ok(`Room service works — ${rooms.length} active rooms`);

    return true;
  } catch (e) {
    fail(`Room service error: ${e.message}`);
    return false;
  }
}

// ============================================================
// RUN ALL
// ============================================================
console.log('🧪 LiveKit Integration Test Suite');
console.log('='.repeat(50));

const s1 = await step1();
if (!s1) { console.log('\n⛔ API down — aborting'); process.exit(1); }

const s2 = await step2();
const s3 = await step3();
const s4 = await step4();
if (!s4) { console.log('\n⛔ LiveKit unreachable — aborting'); process.exit(1); }

const s5 = await step5();
const s10 = await step10();

const s6 = await step6();
if (!s6) {
  console.log('\n⛔ Room connect failed — skipping audio tests');
  skip('Step 7: Publish audio');
  skip('Step 8: Two participants');
  skip('Step 9: Full call flow');
} else {
  await step7();
  await step8();
  await step9();
}

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

if (failed > 0) {
  console.log('\n💡 ถ้า Step 5 ผ่านแต่ Step 6 พัง = rtc-node ICE/network issue');
  console.log('   ถ้า Step 5 พังด้วย = LiveKit WS signaling issue');
  console.log('   ถ้า Step 6 ผ่านแต่ Step 7 พัง = audio track/codec issue');
  console.log('   ถ้า Step 8 พัง = SFU forwarding issue');
}

process.exit(failed > 0 ? 1 : 0);
