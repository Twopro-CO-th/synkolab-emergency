// ---- Auth ----
export interface JwtPayload {
  sub: string;        // userId
  role: 'user' | 'admin';
  name?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export interface DeviceAuth {
  deviceId: string;
  identity: string;
}

export interface AuthContext {
  type: 'user' | 'device' | 'service';
  id: string;
  role?: string;
  name?: string;
}

// ---- Calls ----
export type CallType = 'normal' | 'emergency' | 'broadcast' | 'intercom';
export type CallStatus = 'ringing' | 'waiting' | 'active' | 'completed' | 'missed' | 'rejected';

export interface CallRecord {
  id: string;
  callerId: string;
  callerType: 'user' | 'device';
  calleeId: string | null;
  calleeType: 'user' | 'device' | null;
  roomName: string;
  type: CallType;
  status: CallStatus;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  duration: number | null;
  createdAt: string;
}

// ---- Devices ----
export type DeviceStatus = 'online' | 'offline' | 'error';

export interface DeviceRecord {
  id: string;
  name: string;
  identity: string;
  tokenHash: string;
  location: string | null;  // JSON string { lat, lng, description }
  status: DeviceStatus;
  lastSeen: string | null;
  config: string | null;    // JSON string
  registeredBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---- WebSocket Messages ----
export type WsClientMessage =
  | { type: 'auth'; token: string; clientType?: 'user' | 'device'; deviceId?: string; ts?: number }
  | { type: 'offer'; targetId: string; sdp: string }
  | { type: 'answer'; targetId: string; sdp: string }
  | { type: 'ice-candidate'; targetId: string; candidate: string }
  | { type: 'call_start'; calleeId?: string; callType: CallType }
  | { type: 'call_accept'; callId: string }
  | { type: 'call_reject'; callId: string }
  | { type: 'call_end'; callId: string }
  | { type: 'register_agent'; projectIds: string[] }
  | { type: 'heartbeat' }
  | { type: 'ping' };

export type WsServerMessage =
  | { type: 'auth_ok'; id: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'incoming_call'; callId: string; callerId: string; callerName: string; callType: CallType; roomName: string; [key: string]: unknown }
  | { type: 'call_accepted'; callId: string; answererId: string }
  | { type: 'call_rejected'; callId: string }
  | { type: 'call_waiting'; callId: string; roomName: string; callerName: string; callType: CallType; callerId: string }
  | { type: 'call_ended'; callId: string; reason: string }
  | { type: 'call_missed'; callId: string }
  | { type: 'call_timeout'; callId: string }
  | { type: 'agent_registered'; projectIds: string[] }
  | { type: 'offer'; fromId: string; sdp: string }
  | { type: 'answer'; fromId: string; sdp: string }
  | { type: 'ice-candidate'; fromId: string; candidate: string }
  | { type: 'broadcast_start'; callId: string; roomName: string; from: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };

// ---- TURN ----
export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
}
