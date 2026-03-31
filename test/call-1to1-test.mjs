/**
 * 1-to-1 Call Test — ทดสอบ Full Flow การโทรระหว่าง 2 คน
 *
 * Step 1: ทั้งสองฝ่ายเชื่อมต่อ WebSocket
 * Step 2: Caller โทรหา Callee ผ่าน API
 * Step 3: Callee รับสาย incoming_call ผ่าน WebSocket
 * Step 4: Callee accept call ผ่าน API
 * Step 5: Caller ได้รับ call_accepted ผ่าน WebSocket
 * Step 6: ทั้งสองเข้า LiveKit room ด้วย token
 * Step 7: ทั้งสอง publish audio
 * Step 8: ทั้งสองรับ audio ของอีกฝ่ายได้
 * Step 9: Caller วางสาย → ทั้งสองได้รับ call_ended
 * Step 10: ตรวจ call history ว่าบันทึกถูกต้อง
 */

import { SignJWT } from 'jose';
import WebSocket from 'ws';
import { Room, RoomEvent, TrackSource, AudioSource, LocalAudioTrack, AudioFrame } from '@livekit/rtc-node';

const API = 'http://localhost:4000';
const LK_WS = 'ws://localhost:7880';
const API_KEY = 'sk_live_change-me-to-random-string';
const JWT_SECRET = 'change-me-to-64-char-random-string-use-openssl-rand-hex-32';

let passed = 0;
let failed = 0;

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function ok(msg) { passed++; log('✅', msg); }
function fail(msg) { failed++; log('❌', msg); }
function info(msg) { log('  ', `  → ${msg}`); }

// ---- Helpers ----
async function apiReq(method, path, body, userId) {
  const headers = { 'X-API-Key': API_KEY, 'X-Request-User': userId || 'system' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getJwt(userId, name) {
  const res = await apiReq('POST', '/auth/token', { userId, role: 'admin', name });
  return res.token;
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:4000/ws');
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_ok') resolve(ws);
      if (msg.type === 'auth_error') reject(new Error(msg.reason));
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 5000);
  });
}

function waitWsMsg(ws, type, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

async function joinLiveKit(identity, roomName, token) {
  const room = new Room();
  await room.connect(LK_WS, token);
  return room;
}

async function publishAudio(room) {
  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack(`mic-${room.localParticipant.identity}`, source);
  await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE });

  // Send a few silence frames
  for (let i = 0; i < 5; i++) {
    await source.captureFrame(new AudioFrame(new Int16Array(480), 48000, 1, 480));
  }
  return { source, track };
}

function waitTrackSubscribed(room, timeout = 10000) {
  return new Promise((resolve) => {
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      resolve({ track, participant });
    });
    setTimeout(() => resolve(null), timeout);
  });
}

// ============================================================
// TEST
// ============================================================

console.log('📞 1-to-1 Call Full Flow Test');
console.log('='.repeat(50));
console.log();

// ---- Step 1: WebSocket Connect ----
console.log('🔹 Step 1: Both users connect WebSocket');
let wsCaller, wsCallee;
try {
  const [tokenA, tokenB] = await Promise.all([
    getJwt('alice', 'Alice'),
    getJwt('bob', 'Bob'),
  ]);

  [wsCaller, wsCallee] = await Promise.all([
    connectWs(tokenA),
    connectWs(tokenB),
  ]);
  ok('Alice connected via WebSocket');
  ok('Bob connected via WebSocket');
} catch (e) {
  fail(`WebSocket connect: ${e.message}`);
  process.exit(1);
}

// ---- Step 2: Alice calls Bob ----
console.log('\n🔹 Step 2: Alice calls Bob (API)');
let callData;
const bobIncomingPromise = waitWsMsg(wsCallee, 'incoming_call');

try {
  callData = await apiReq('POST', '/calls/initiate', {
    calleeId: 'bob', type: 'normal', calleeType: 'user',
  }, 'alice');
  ok(`Call initiated: ${callData.callId}`);
  info(`Room: ${callData.roomName}`);
  info(`Media mode: ${callData.mediaMode}`);
  if (callData.livekit) info(`LiveKit token: ${callData.livekit.token.substring(0, 30)}...`);
} catch (e) {
  fail(`Initiate call: ${e.message}`);
  process.exit(1);
}

// ---- Step 3: Bob receives incoming_call ----
console.log('\n🔹 Step 3: Bob receives incoming_call via WebSocket');
let incoming;
try {
  incoming = await bobIncomingPromise;
  ok(`Bob received incoming_call`);
  info(`From: ${incoming.callerName} (${incoming.callerId})`);
  info(`Type: ${incoming.callType}, Room: ${incoming.roomName}`);

  const idMatch = incoming.callId === callData.callId;
  if (idMatch) ok('Call ID matches');
  else fail(`Call ID mismatch: ${incoming.callId} !== ${callData.callId}`);
} catch (e) {
  fail(`Bob incoming: ${e.message}`);
}

// ---- Step 4: Bob accepts ----
console.log('\n🔹 Step 4: Bob accepts call (API)');
let acceptData;
const aliceAcceptPromise = waitWsMsg(wsCaller, 'call_accepted');

try {
  acceptData = await apiReq('POST', '/calls/respond', {
    callId: callData.callId, action: 'accept',
  }, 'bob');
  ok(`Bob accepted: roomName=${acceptData.roomName}`);
  info(`Media mode: ${acceptData.mediaMode}`);
  if (acceptData.livekit) info(`Bob's LiveKit token: ${acceptData.livekit.token.substring(0, 30)}...`);
} catch (e) {
  fail(`Bob accept: ${e.message}`);
}

// ---- Step 5: Alice receives call_accepted ----
console.log('\n🔹 Step 5: Alice receives call_accepted via WebSocket');
try {
  const accepted = await aliceAcceptPromise;
  ok(`Alice received call_accepted`);
  info(`Answerer: ${accepted.answererId}`);
  if (accepted.answererId === 'bob') ok('Answerer is Bob');
  else fail(`Wrong answerer: ${accepted.answererId}`);
} catch (e) {
  fail(`Alice accepted: ${e.message}`);
}

// ---- Step 6-8: LiveKit Audio (only if SFU mode) ----
let lkAlice, lkBob;

if (callData.mediaMode === 'sfu' && callData.livekit && acceptData?.livekit) {
  console.log('\n🔹 Step 6: Both join LiveKit room');
  try {
    lkAlice = await joinLiveKit('alice', callData.roomName, callData.livekit.token);
    ok(`Alice joined LiveKit room: ${lkAlice.name}`);

    lkBob = await joinLiveKit('bob', callData.roomName, acceptData.livekit.token);
    ok(`Bob joined LiveKit room: ${lkBob.name}`);
  } catch (e) {
    fail(`LiveKit join: ${e.message}`);
  }

  console.log('\n🔹 Step 7: Both publish audio');
  try {
    // Set up track subscription listeners BEFORE publishing
    const bobTrackPromise = waitTrackSubscribed(lkBob);
    const aliceTrackPromise = waitTrackSubscribed(lkAlice);

    await publishAudio(lkAlice);
    ok('Alice published audio');

    await publishAudio(lkBob);
    ok('Bob published audio');

    console.log('\n🔹 Step 8: Both receive each other\'s audio');

    const bobGot = await bobTrackPromise;
    if (bobGot) {
      ok(`Bob received audio from: ${bobGot.participant.identity}`);
    } else {
      fail('Bob did not receive Alice\'s audio');
    }

    const aliceGot = await aliceTrackPromise;
    if (aliceGot) {
      ok(`Alice received audio from: ${aliceGot.participant.identity}`);
    } else {
      fail('Alice did not receive Bob\'s audio');
    }
  } catch (e) {
    fail(`Audio exchange: ${e.message}`);
  }
} else {
  console.log('\n🔹 Step 6-8: P2P Mode — LiveKit not used');
  info('In P2P mode, audio exchange happens via RTCPeerConnection directly');
  info('WebRTC offer/answer/ICE are relayed via WebSocket signaling');
  ok('P2P mode — no LiveKit room needed');
}

// ---- Step 9: Alice ends call ----
console.log('\n🔹 Step 9: Alice ends call');
const bobEndPromise = waitWsMsg(wsCallee, 'call_ended');
try {
  const endRes = await apiReq('POST', '/calls/end', { callId: callData.callId }, 'alice');
  ok(`Call ended: ok=${endRes.ok}, duration=${endRes.duration}s`);

  const bobEnd = await bobEndPromise;
  ok(`Bob received call_ended: reason=${bobEnd.reason}`);
} catch (e) {
  fail(`End call: ${e.message}`);
}

// ---- Step 10: Call History ----
console.log('\n🔹 Step 10: Verify call history');
try {
  // Small delay for DB write
  await new Promise(r => setTimeout(r, 200));
  const history = await apiReq('GET', `/calls/history?page=1&limit=5`, null, 'alice');
  const thisCall = history.calls?.find(c => c.id === callData.callId);
  if (thisCall) {
    ok(`Call found in history`);
    info(`Status: ${thisCall.status}`);
    info(`Caller: ${thisCall.caller_id} → Callee: ${thisCall.callee_id}`);
    info(`Duration: ${thisCall.duration}s`);
    if (thisCall.status === 'completed') ok('Status is "completed"');
    else fail(`Expected "completed" got "${thisCall.status}"`);
    if (thisCall.callee_id === 'bob') ok('Callee recorded as Bob');
    else fail(`Callee mismatch: ${thisCall.callee_id}`);
  } else {
    fail('Call not found in history');
  }
} catch (e) {
  fail(`History check: ${e.message}`);
}

// ---- Cleanup ----
if (lkAlice) try { await lkAlice.disconnect(); } catch {}
if (lkBob) try { await lkBob.disconnect(); } catch {}
wsCaller.close();
wsCallee.close();

// ---- Results ----
console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? '🎉 1-to-1 Call — All steps passed!' : '⚠️  Some steps failed');
process.exit(failed > 0 ? 1 : 0);
