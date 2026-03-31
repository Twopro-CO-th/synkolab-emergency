/**
 * Intercom & Project Test — ทดสอบ escalation, projects, agent queue
 *
 * Usage: node test/intercom-test.mjs
 * Env vars: API_URL, JWT_SECRET, API_KEY, DEVICE_SECRET
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import 'dotenv/config';
import { SignJWT } from 'jose';
import WebSocket from 'ws';
import { createHmac } from 'crypto';

const API = process.env.API_URL || process.env.PUBLIC_URL || 'https://call.stu-link.com';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const DEVICE_SECRET = process.env.DEVICE_SECRET || 'change-me';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS || '').split(',')[0] || 'sk_test';

let passed = 0;
let failed = 0;

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function ok(msg) { passed++; log('✅', msg); }
function fail(msg) { failed++; log('❌', msg); }

async function makeJwt(userId, role = 'admin', name = 'Test') {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ sub: userId, role, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('community-link')
    .setAudience('synkolab-emergency')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

function makeDeviceToken(deviceId) {
  return createHmac('sha256', DEVICE_SECRET).update(deviceId).digest('hex');
}

async function apiReq(method, path, body, userId) {
  const headers = { 'X-API-Key': API_KEY };
  if (body) headers['Content-Type'] = 'application/json';
  if (userId) headers['X-Request-User'] = userId;
  const res = await fetch(`${API}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function connectWs(token) {
  const wsUrl = API.replace(/^http/, 'ws') + '/ws';
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_ok') resolve(ws);
      if (msg.type === 'auth_error') reject(new Error(msg.reason));
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 5000);
  });
}

function waitMsg(ws, type, timeout = 10000) {
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

// ============================================================
// TESTS
// ============================================================

console.log('🏗️  Intercom & Project Test Suite');
console.log('='.repeat(50));

// ---- Test 1: Create Project ----
console.log('\n🔹 Test 1: Create Project');
let projectId;
try {
  const slug = `test-${Date.now()}`;
  const res = await apiReq('POST', '/projects', { name: 'Test Project', slug }, 'admin_user');
  if (res.id) {
    projectId = res.id;
    ok(`Project created: ${res.id} (${res.slug})`);
  } else {
    fail(`Create project: ${JSON.stringify(res)}`);
  }
} catch (e) {
  fail(`Create project: ${e.message}`);
}

// ---- Test 2: List Projects ----
console.log('\n🔹 Test 2: List Projects');
try {
  const res = await apiReq('GET', '/projects', null, 'admin_user');
  if (res.projects && res.projects.length > 0) {
    ok(`Listed ${res.projects.length} projects`);
  } else {
    fail(`List projects: ${JSON.stringify(res)}`);
  }
} catch (e) {
  fail(`List projects: ${e.message}`);
}

// ---- Test 3: Add Member ----
console.log('\n🔹 Test 3: Add Member to Project');
try {
  const res = await apiReq('POST', `/projects/${projectId}/members`, { userId: 'agent_1', role: 'member' }, 'admin_user');
  if (res.ok) ok('Member agent_1 added');
  else fail(`Add member: ${JSON.stringify(res)}`);

  const res2 = await apiReq('POST', `/projects/${projectId}/members`, { userId: 'agent_2', role: 'member' }, 'admin_user');
  if (res2.ok) ok('Member agent_2 added');
  else fail(`Add member: ${JSON.stringify(res2)}`);
} catch (e) {
  fail(`Add member: ${e.message}`);
}

// ---- Test 4: Get Project Detail ----
console.log('\n🔹 Test 4: Get Project Detail');
try {
  const res = await apiReq('GET', `/projects/${projectId}`, null, 'admin_user');
  if (res.members && res.members.length >= 2) {
    ok(`Project has ${res.members.length} members`);
  } else {
    fail(`Project detail: ${JSON.stringify(res)}`);
  }
} catch (e) {
  fail(`Project detail: ${e.message}`);
}

// ---- Test 5: Register Agent via WS ----
console.log('\n🔹 Test 5: Agent Registration via WebSocket');
let wsAgent1, wsAgent2;
try {
  const token1 = await makeJwt('agent_1', 'user', 'Agent One');
  const token2 = await makeJwt('agent_2', 'user', 'Agent Two');

  wsAgent1 = await connectWs(token1);
  wsAgent2 = await connectWs(token2);

  // Register as agents for this project
  const p1 = waitMsg(wsAgent1, 'agent_registered');
  wsAgent1.send(JSON.stringify({ type: 'register_agent', projectIds: [projectId] }));
  const reg1 = await p1;
  ok(`Agent 1 registered for ${reg1.projectIds.length} projects`);

  const p2 = waitMsg(wsAgent2, 'agent_registered');
  wsAgent2.send(JSON.stringify({ type: 'register_agent', projectIds: [projectId] }));
  const reg2 = await p2;
  ok(`Agent 2 registered for ${reg2.projectIds.length} projects`);
} catch (e) {
  fail(`Agent registration: ${e.message}`);
}

// ---- Test 6: Online Agents ----
console.log('\n🔹 Test 6: Online Agents for Project');
try {
  const res = await apiReq('GET', `/projects/${projectId}/agents`, null, 'admin_user');
  if (res.agents && res.agents.length >= 2) {
    ok(`${res.count} agents available: ${res.agents.join(', ')}`);
  } else {
    fail(`Online agents: ${JSON.stringify(res)}`);
  }
} catch (e) {
  fail(`Online agents: ${e.message}`);
}

// ---- Test 7: Intercom Call with Escalation ----
console.log('\n🔹 Test 7: Intercom Call (device → agents)');
try {
  // Register a device
  const devRes = await apiReq('POST', '/devices/register', {
    name: 'Test Intercom',
    identity: `intercom_test_${Date.now()}`,
  }, 'admin_user');
  ok(`Device registered: ${devRes.id}`);

  // Add device to project
  await apiReq('POST', `/projects/${projectId}/devices`, { deviceId: devRes.id }, 'admin_user');
  ok('Device added to project');

  // Connect device via WS
  const wsDevice = new WebSocket(API.replace(/^http/, 'ws') + '/ws', { rejectUnauthorized: false });
  await new Promise((resolve, reject) => {
    wsDevice.on('open', () => {
      wsDevice.send(JSON.stringify({
        type: 'auth',
        clientType: 'device',
        deviceId: devRes.id,
        token: devRes.token,
      }));
    });
    wsDevice.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_ok') resolve();
      if (msg.type === 'auth_error') reject(new Error(msg.reason));
    });
    wsDevice.on('error', reject);
    setTimeout(() => reject(new Error('Device WS timeout')), 5000);
  });
  ok('Device connected via WS');

  // Initiate intercom call from device
  const agent1IncomingP = waitMsg(wsAgent1, 'incoming_call');

  const callRes = await apiReq('POST', '/calls/initiate', {
    type: 'intercom',
    projectId,
  }, devRes.id);

  if (callRes.callId) {
    ok(`Intercom call initiated: ${callRes.callId}`);
  } else {
    fail(`Initiate intercom: ${JSON.stringify(callRes)}`);
  }

  // Agent 1 should receive incoming_call
  const incoming = await agent1IncomingP;
  if (incoming.callType === 'intercom') {
    ok(`Agent 1 received intercom call from ${incoming.callerName}`);
  } else {
    fail(`Wrong call type: ${incoming.callType}`);
  }

  // Agent 1 accepts
  const acceptRes = await apiReq('POST', '/calls/respond', {
    callId: callRes.callId,
    action: 'accept',
  }, 'agent_1');

  if (acceptRes.ok) {
    ok('Agent 1 accepted intercom call');
  } else {
    fail(`Accept: ${JSON.stringify(acceptRes)}`);
  }

  // End call
  const endRes = await apiReq('POST', '/calls/end', { callId: callRes.callId }, 'agent_1');
  if (endRes.ok) {
    ok(`Call ended, duration: ${endRes.duration}s`);
  } else {
    fail(`End: ${JSON.stringify(endRes)}`);
  }

  wsDevice.close();
} catch (e) {
  fail(`Intercom call: ${e.message}`);
}

// ---- Test 8: Call History includes intercom ----
console.log('\n🔹 Test 8: Call History (intercom type)');
try {
  const res = await apiReq('GET', '/calls/history?type=intercom&limit=5', null, 'admin_user');
  if (res.calls && res.calls.length > 0) {
    ok(`Found ${res.calls.length} intercom calls in history`);
    const last = res.calls[0];
    if (last.type === 'intercom') ok(`Latest call type: ${last.type}, status: ${last.status}`);
    else fail(`Wrong type: ${last.type}`);
  } else {
    fail(`History: ${JSON.stringify(res)}`);
  }
} catch (e) {
  fail(`History: ${e.message}`);
}

// ---- Cleanup ----
if (wsAgent1) wsAgent1.close();
if (wsAgent2) wsAgent2.close();

// ---- Results ----
console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? '🎉 All tests passed!' : '⚠️  Some tests failed');
process.exit(failed > 0 ? 1 : 0);
