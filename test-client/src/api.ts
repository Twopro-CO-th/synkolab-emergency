const API = 'http://localhost:4000';

let apiKey = '';

export function setApiKey(key: string) { apiKey = key; }
export function getApiKey() { return apiKey; }

async function req(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'X-API-Key': apiKey };
  if (body) headers['Content-Type'] = 'application/json';

  const userId = (document.getElementById('inp-user-id') as HTMLInputElement)?.value || 'test_user';
  headers['X-Request-User'] = userId;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Health
export const health = () => req('GET', '/health');

// Calls
export const callInitiate = (body: { calleeId?: string; type: string; calleeType?: string }) =>
  req('POST', '/calls/initiate', body);
export const callRespond = (body: { callId: string; action: string }) =>
  req('POST', '/calls/respond', body);
export const callEnd = (body: { callId: string }) =>
  req('POST', '/calls/end', body);
export const callHistory = (page = 1, limit = 20, type?: string) =>
  req('GET', `/calls/history?page=${page}&limit=${limit}${type ? `&type=${type}` : ''}`);
export const onlineCount = () => req('GET', '/calls/online-count');
export const onlineList = () => req('GET', '/calls/online');

// Devices
export const deviceRegister = (body: { name: string; identity: string }) =>
  req('POST', '/devices/register', body);
export const deviceList = () => req('GET', '/devices');
export const deviceHeartbeat = (deviceId: string) =>
  req('POST', '/devices/heartbeat', { deviceId });

// TURN
export const turnCredentials = () => req('GET', '/turn/credentials');

// Auth — issue JWT via API key
export const issueToken = (userId: string, role = 'admin', name?: string) =>
  req('POST', '/auth/token', { userId, role, name });

// LiveKit
export const livekitConfig = () => req('GET', '/livekit/config');
export const livekitToken = (roomName: string, canPublish = true) =>
  req('POST', '/livekit/token', { roomName, canPublish });
export const livekitRooms = () => req('GET', '/livekit/rooms');
export const livekitParticipants = (roomName: string) =>
  req('GET', `/livekit/rooms/${roomName}/participants`);
export const livekitDeleteRoom = (roomName: string) =>
  req('DELETE', `/livekit/rooms/${roomName}`);
