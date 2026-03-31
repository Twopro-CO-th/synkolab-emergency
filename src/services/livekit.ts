import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config.js';

const { apiKey, apiSecret, url } = config.livekit;

// ---- Room Service (manage rooms) ----
let roomService: RoomServiceClient | null = null;

function getRoomService(): RoomServiceClient {
  if (!roomService) {
    // RoomServiceClient needs HTTP URL
    const httpUrl = url.replace('ws://', 'http://').replace('wss://', 'https://');
    roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  }
  return roomService;
}

// ---- Token Generation ----
export interface TokenOptions {
  identity: string;
  name?: string;
  roomName: string;
  canPublish?: boolean;     // true = สามารถส่งเสียง/วิดีโอ
  canSubscribe?: boolean;   // true = สามารถรับเสียง/วิดีโอ
  ttl?: number;             // seconds
}

export async function createToken(opts: TokenOptions): Promise<string> {
  const token = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name || opts.identity,
    ttl: opts.ttl || config.livekit.tokenTtl,
  });

  token.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: opts.canPublish !== false,
    canSubscribe: opts.canSubscribe !== false,
    canPublishData: true,
  });

  return await token.toJwt();
}

// ---- Room Management ----
export async function listRooms(): Promise<Array<{ name: string; numParticipants: number; createdAt: number }>> {
  if (!config.livekit.enabled) return [];
  try {
    const rooms = await getRoomService().listRooms();
    return rooms.map(r => ({
      name: r.name,
      numParticipants: r.numParticipants,
      createdAt: Number(r.creationTime),
    }));
  } catch {
    return [];
  }
}

export async function listParticipants(roomName: string) {
  if (!config.livekit.enabled) return [];
  try {
    const participants = await getRoomService().listParticipants(roomName);
    return participants.map(p => ({
      identity: p.identity,
      name: p.name,
      state: p.state,
      joinedAt: Number(p.joinedAt),
    }));
  } catch {
    return [];
  }
}

export async function removeParticipant(roomName: string, identity: string): Promise<boolean> {
  if (!config.livekit.enabled) return false;
  try {
    await getRoomService().removeParticipant(roomName, identity);
    return true;
  } catch {
    return false;
  }
}

export async function deleteRoom(roomName: string): Promise<boolean> {
  if (!config.livekit.enabled) return false;
  try {
    await getRoomService().deleteRoom(roomName);
    return true;
  } catch {
    return false;
  }
}

export async function muteParticipant(roomName: string, identity: string, muted: boolean): Promise<boolean> {
  if (!config.livekit.enabled) return false;
  try {
    await getRoomService().mutePublishedTrack(roomName, identity, 'audio', muted);
    return true;
  } catch {
    return false;
  }
}
