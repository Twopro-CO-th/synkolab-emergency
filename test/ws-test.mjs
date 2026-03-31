/**
 * WebSocket Integration Test
 * ทดสอบ: Auth, Signaling, Call Flow, Rate Limit, Error Handling
 *
 * Usage: node test/ws-test.mjs
 */

import { SignJWT } from 'jose';
import WebSocket from 'ws';
import { createHmac } from 'crypto';

// ---- Config ----
const API_URL = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000/ws';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-to-64-char-random-string-use-openssl-rand-hex-32';
const DEVICE_SECRET = process.env.DEVICE_SECRET || 'change-me-device-secret-use-openssl-rand-hex-32';
const API_KEY = process.env.API_KEY || 'sk_live_change-me-to-random-string';

let passed = 0;
let failed = 0;

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function assert(condition, testName) {
  if (condition) {
    passed++;
    log('✅', testName);
  } else {
    failed++;
    log('❌', `FAIL: ${testName}`);
  }
}

// ---- Helper: Sign JWT ----
async function makeJwt(userId, role = 'user', name = 'Test User') {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ sub: userId, role, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('community-link')
    .setAudience('synkolab-emergency')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

// ---- Helper: Device HMAC token ----
function makeDeviceToken(deviceId) {
  return createHmac('sha256', DEVICE_SECRET).update(deviceId).digest('hex');
}

// ---- Helper: Connect WS and return Promise ----
function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
}

// ---- Helper: Send and wait for response ----
function sendAndWait(ws, msg, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Response timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

// ---- Helper: Wait for specific message type ----
function waitForMessage(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

// ---- Helper: Collect messages ----
function collectMessages(ws, durationMs = 1000) {
  return new Promise((resolve) => {
    const msgs = [];
    const handler = (data) => msgs.push(JSON.parse(data.toString()));
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(msgs);
    }, durationMs);
  });
}

// ============================================================
// TESTS
// ============================================================

async function testUserAuth() {
  console.log('\n📡 Test 1: User JWT Authentication');
  const ws = await connectWs();
  const token = await makeJwt('user_alice', 'user', 'Alice');

  const res = await sendAndWait(ws, { type: 'auth', token });
  assert(res.type === 'auth_ok', 'auth_ok received');
  assert(res.id === 'user_alice', 'correct user id returned');

  ws.close();
}

async function testAdminAuth() {
  console.log('\n👑 Test 2: Admin JWT Authentication');
  const ws = await connectWs();
  const token = await makeJwt('admin_bob', 'admin', 'Bob Admin');

  const res = await sendAndWait(ws, { type: 'auth', token });
  assert(res.type === 'auth_ok', 'admin auth_ok received');
  assert(res.id === 'admin_bob', 'correct admin id returned');

  ws.close();
}

async function testDeviceAuth() {
  console.log('\n🔧 Test 3: Device HMAC Authentication');

  // Register device first via API
  const regRes = await fetch(`${API_URL}/devices/register`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Pi', identity: `pi_test_${Date.now()}` }),
  });
  const device = await regRes.json();
  assert(regRes.ok, `device registered: ${device.id}`);

  // Connect WS with device token
  const ws = await connectWs();
  const res = await sendAndWait(ws, {
    type: 'auth',
    clientType: 'device',
    deviceId: device.id,
    token: device.token,
  });
  assert(res.type === 'auth_ok', 'device auth_ok received');
  assert(res.id === device.id, 'correct device id returned');

  ws.close();
}

async function testInvalidAuth() {
  console.log('\n🚫 Test 4: Invalid Authentication');

  // Invalid JWT
  const ws1 = await connectWs();
  const res1 = await sendAndWait(ws1, { type: 'auth', token: 'invalid.jwt.token' });
  assert(res1.type === 'auth_error', 'invalid JWT rejected');

  // Expired JWT
  const ws2 = await connectWs();
  const secret = new TextEncoder().encode(JWT_SECRET);
  const expiredToken = await new SignJWT({ sub: 'test', role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('community-link')
    .setAudience('synkolab-emergency')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(secret);
  const res2 = await sendAndWait(ws2, { type: 'auth', token: expiredToken });
  assert(res2.type === 'auth_error', 'expired JWT rejected');

  // Invalid device token
  const ws3 = await connectWs();
  const res3 = await sendAndWait(ws3, {
    type: 'auth',
    clientType: 'device',
    deviceId: 'fake_device',
    token: 'fakefakefake',
  });
  assert(res3.type === 'auth_error', 'invalid device token rejected');
}

async function testAuthTimeout() {
  console.log('\n⏰ Test 5: Auth Timeout (5s)');
  const ws = await connectWs();

  const closePromise = new Promise((resolve) => {
    ws.on('close', (code) => resolve(code));
  });

  // Don't send auth, wait for timeout
  const code = await closePromise;
  assert(code === 4401, `connection closed with code 4401 (got ${code})`);
}

async function testPingPong() {
  console.log('\n🏓 Test 6: Ping/Pong');
  const ws = await connectWs();
  const token = await makeJwt('user_ping');
  await sendAndWait(ws, { type: 'auth', token });

  const res = await sendAndWait(ws, { type: 'ping' });
  assert(res.type === 'pong', 'pong received for ping');

  const res2 = await sendAndWait(ws, { type: 'heartbeat' });
  assert(res2.type === 'pong', 'pong received for heartbeat');

  ws.close();
}

async function testMessageBeforeAuth() {
  console.log('\n🔒 Test 7: Message Before Auth');
  const ws = await connectWs();

  const res = await sendAndWait(ws, { type: 'ping' });
  assert(res.type === 'auth_error', 'rejected message before auth');
  assert(res.reason === 'not authenticated', 'correct rejection reason');

  ws.close();
}

async function testWebRTCSignaling() {
  console.log('\n📞 Test 8: WebRTC Signaling (Offer/Answer/ICE)');

  // Connect two users
  const wsAlice = await connectWs();
  const wsBob = await connectWs();

  const tokenAlice = await makeJwt('alice_rtc', 'user', 'Alice');
  const tokenBob = await makeJwt('bob_rtc', 'user', 'Bob');

  await sendAndWait(wsAlice, { type: 'auth', token: tokenAlice });
  await sendAndWait(wsBob, { type: 'auth', token: tokenBob });

  // Alice sends offer to Bob
  const bobOfferPromise = waitForMessage(wsBob, 'offer');
  wsAlice.send(JSON.stringify({
    type: 'offer',
    targetId: 'bob_rtc',
    sdp: 'v=0\r\no=- 123 1 IN IP4 127.0.0.1\r\ns=test\r\n',
  }));
  const offer = await bobOfferPromise;
  assert(offer.type === 'offer', 'Bob received offer');
  assert(offer.fromId === 'alice_rtc', 'offer fromId is Alice');
  assert(offer.sdp.includes('v=0'), 'SDP content forwarded');

  // Bob sends answer to Alice
  const aliceAnswerPromise = waitForMessage(wsAlice, 'answer');
  wsBob.send(JSON.stringify({
    type: 'answer',
    targetId: 'alice_rtc',
    sdp: 'v=0\r\no=- 456 1 IN IP4 127.0.0.1\r\ns=answer\r\n',
  }));
  const answer = await aliceAnswerPromise;
  assert(answer.type === 'answer', 'Alice received answer');
  assert(answer.fromId === 'bob_rtc', 'answer fromId is Bob');

  // ICE candidate relay
  const bobIcePromise = waitForMessage(wsBob, 'ice-candidate');
  wsAlice.send(JSON.stringify({
    type: 'ice-candidate',
    targetId: 'bob_rtc',
    candidate: '{"candidate":"candidate:1 1 UDP 2122252543 192.168.1.1 50000 typ host","sdpMid":"0"}',
  }));
  const ice = await bobIcePromise;
  assert(ice.type === 'ice-candidate', 'Bob received ICE candidate');
  assert(ice.fromId === 'alice_rtc', 'ICE fromId is Alice');

  wsAlice.close();
  wsBob.close();
}

async function testCallFlowViaAPI() {
  console.log('\n📲 Test 9: Full Call Flow (API + WebSocket)');

  // Connect caller and callee via WS
  const wsCaller = await connectWs();
  const wsCallee = await connectWs();

  const tokenCaller = await makeJwt('caller_01', 'user', 'Caller');
  const tokenCallee = await makeJwt('callee_01', 'user', 'Callee');

  await sendAndWait(wsCaller, { type: 'auth', token: tokenCaller });
  await sendAndWait(wsCallee, { type: 'auth', token: tokenCallee });

  // Initiate call via API
  const calleeIncomingPromise = waitForMessage(wsCallee, 'incoming_call');
  const initRes = await fetch(`${API_URL}/calls/initiate`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'X-Request-User': 'caller_01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ calleeId: 'callee_01', type: 'normal' }),
  });
  const initData = await initRes.json();
  assert(initRes.ok, `call initiated: ${initData.callId}`);

  // Callee should receive incoming_call via WS
  const incoming = await calleeIncomingPromise;
  assert(incoming.type === 'incoming_call', 'callee received incoming_call');
  assert(incoming.callId === initData.callId, 'correct callId in notification');
  assert(incoming.callerId === 'caller_01', 'correct callerId');

  // Callee accepts call via API
  const callerAcceptPromise = waitForMessage(wsCaller, 'call_accepted');
  const acceptRes = await fetch(`${API_URL}/calls/respond`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'X-Request-User': 'callee_01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId: initData.callId, action: 'accept' }),
  });
  const acceptData = await acceptRes.json();
  assert(acceptRes.ok, 'call accepted');
  assert(acceptData.roomName === initData.roomName, 'roomName matches');

  // Caller should receive call_accepted
  const accepted = await callerAcceptPromise;
  assert(accepted.type === 'call_accepted', 'caller received call_accepted');
  assert(accepted.answererId === 'callee_01', 'correct answerer id');

  // End call
  const endRes = await fetch(`${API_URL}/calls/end`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'X-Request-User': 'caller_01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId: initData.callId }),
  });
  const endData = await endRes.json();
  assert(endRes.ok && endData.ok, 'call ended successfully');

  wsCaller.close();
  wsCallee.close();
}

async function testEmergencyBroadcast() {
  console.log('\n🚨 Test 10: Emergency Broadcast');

  // Connect 3 users
  const ws1 = await connectWs();
  const ws2 = await connectWs();
  const ws3 = await connectWs();

  await sendAndWait(ws1, { type: 'auth', token: await makeJwt('bcast_1') });
  await sendAndWait(ws2, { type: 'auth', token: await makeJwt('bcast_2') });
  await sendAndWait(ws3, { type: 'auth', token: await makeJwt('bcast_3') });

  // User 1 triggers emergency → should notify user 2 and 3
  const p2 = waitForMessage(ws2, 'incoming_call');
  const p3 = waitForMessage(ws3, 'incoming_call');

  await fetch(`${API_URL}/calls/initiate`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'X-Request-User': 'bcast_1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'emergency' }),
  });

  const msg2 = await p2;
  const msg3 = await p3;
  assert(msg2.type === 'incoming_call' && msg2.callType === 'emergency', 'user 2 received emergency');
  assert(msg3.type === 'incoming_call' && msg3.callType === 'emergency', 'user 3 received emergency');

  ws1.close();
  ws2.close();
  ws3.close();
}

async function testOnlineCount() {
  console.log('\n👥 Test 11: Online Count');

  const ws1 = await connectWs();
  const ws2 = await connectWs();
  await sendAndWait(ws1, { type: 'auth', token: await makeJwt('online_1') });
  await sendAndWait(ws2, { type: 'auth', token: await makeJwt('online_2') });

  const res = await fetch(`${API_URL}/calls/online-count`, {
    headers: { 'X-API-Key': API_KEY },
  });
  const data = await res.json();
  assert(data.users >= 2, `online users >= 2 (got ${data.users})`);
  assert(data.total >= 2, `total online >= 2 (got ${data.total})`);

  ws1.close();
  ws2.close();
}

async function testConnectionReplace() {
  console.log('\n🔄 Test 12: Connection Replace (same user)');

  const ws1 = await connectWs();
  const token = await makeJwt('replace_user');
  await sendAndWait(ws1, { type: 'auth', token });

  const closePromise = new Promise((resolve) => {
    ws1.on('close', (code) => resolve(code));
  });

  // Connect same user again
  const ws2 = await connectWs();
  await sendAndWait(ws2, { type: 'auth', token });

  // First connection should be closed
  const code = await closePromise;
  assert(code === 4000, `old connection closed with code 4000 (got ${code})`);

  // New connection should work
  const res = await sendAndWait(ws2, { type: 'ping' });
  assert(res.type === 'pong', 'new connection works');

  ws2.close();
}

async function testInvalidJson() {
  console.log('\n💥 Test 13: Invalid JSON & Unknown Type');

  const ws = await connectWs();
  const token = await makeJwt('err_user');
  await sendAndWait(ws, { type: 'auth', token });

  // Invalid JSON
  ws.send('not json at all {{{');
  const msgs1 = await collectMessages(ws, 500);
  const errMsg = msgs1.find(m => m.type === 'error');
  assert(errMsg?.message === 'invalid JSON', 'invalid JSON error received');

  // Unknown type
  const res = await sendAndWait(ws, { type: 'unknown_command' });
  assert(res.type === 'error', 'unknown type error received');

  ws.close();
}

// ============================================================
// RUN ALL
// ============================================================
console.log('🧪 synkolab-emergency WebSocket Test Suite');
console.log('==========================================');

const tests = [
  testUserAuth,
  testAdminAuth,
  testDeviceAuth,
  testInvalidAuth,
  testAuthTimeout,
  testPingPong,
  testMessageBeforeAuth,
  testWebRTCSignaling,
  testCallFlowViaAPI,
  testEmergencyBroadcast,
  testOnlineCount,
  testConnectionReplace,
  testInvalidJson,
];

for (const test of tests) {
  try {
    await test();
  } catch (err) {
    failed++;
    log('💀', `${test.name} CRASHED: ${err.message}`);
  }
}

console.log('\n==========================================');
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(failed === 0 ? '🎉 All tests passed!' : '⚠️  Some tests failed');
process.exit(failed > 0 ? 1 : 0);
