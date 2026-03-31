import type { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { config } from '../config.js';
import {
  createToken,
  listRooms,
  listParticipants,
  removeParticipant,
  deleteRoom,
  muteParticipant,
} from '../services/livekit.js';

export async function livekitRoutes(app: FastifyInstance): Promise<void> {

  // ---- Generate LiveKit Token ----
  // เรียกจาก web client หรือ community-link เพื่อเข้า room
  app.post('/livekit/token', { preHandler: authenticate }, async (request, reply) => {
    if (!config.livekit.enabled) {
      reply.code(503);
      return { error: 'LiveKit is not enabled' };
    }

    const { roomName, canPublish, canSubscribe } = request.body as {
      roomName: string;
      canPublish?: boolean;
      canSubscribe?: boolean;
    };

    if (!roomName) {
      reply.code(400);
      return { error: 'roomName is required' };
    }

    const isDevice = request.auth.type === 'device';
    const token = await createToken({
      identity: request.auth.id,
      name: request.auth.name || request.auth.id,
      roomName,
      canPublish: canPublish !== false,
      canSubscribe: canSubscribe !== false,
      ttl: isDevice ? config.livekit.deviceTokenTtl : config.livekit.tokenTtl,
    });

    return {
      token,
      url: config.livekit.publicUrl,
      roomName,
    };
  });

  // ---- LiveKit Config (public info for clients) ----
  app.get('/livekit/config', { preHandler: authenticate }, async (_req, reply) => {
    if (!config.livekit.enabled) {
      reply.code(503);
      return { error: 'LiveKit is not enabled', enabled: false };
    }

    return {
      enabled: true,
      url: config.livekit.publicUrl,
      turnServers: config.turn.servers,
    };
  });

  // ---- List Active Rooms (admin) ----
  app.get('/livekit/rooms', { preHandler: requireAdmin }, async () => {
    const rooms = await listRooms();
    return { rooms };
  });

  // ---- List Participants in Room (admin) ----
  app.get('/livekit/rooms/:roomName/participants', { preHandler: requireAdmin }, async (request) => {
    const { roomName } = request.params as { roomName: string };
    const participants = await listParticipants(roomName);
    return { roomName, participants };
  });

  // ---- Kick Participant (admin) ----
  app.delete('/livekit/rooms/:roomName/participants/:identity', { preHandler: requireAdmin }, async (request) => {
    const { roomName, identity } = request.params as { roomName: string; identity: string };
    const ok = await removeParticipant(roomName, identity);
    return { ok };
  });

  // ---- Delete Room (admin) ----
  app.delete('/livekit/rooms/:roomName', { preHandler: requireAdmin }, async (request) => {
    const { roomName } = request.params as { roomName: string };
    const ok = await deleteRoom(roomName);
    return { ok };
  });

  // ---- Mute/Unmute Participant (admin) ----
  app.post('/livekit/rooms/:roomName/mute', { preHandler: requireAdmin }, async (request) => {
    const { roomName } = request.params as { roomName: string };
    const { identity, muted } = request.body as { identity: string; muted: boolean };
    const ok = await muteParticipant(roomName, identity, muted);
    return { ok };
  });
}
