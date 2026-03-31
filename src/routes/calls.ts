import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { authenticate } from '../auth/middleware.js';
import { getRoom } from '../ws/rooms.js';
import { config } from '../config.js';
import { createToken } from '../services/livekit.js';
import { startEscalation, cancelEscalation, setAgentBusy, freeAgent, broadcastToProjectAgents } from '../ws/escalation.js';
import type { CallType } from '../types/index.js';

export async function callRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // Initiate a call
  app.post('/calls/initiate', { preHandler: authenticate }, async (request, reply) => {
    const { calleeId, type = 'normal', calleeType = 'user', targetIds } = request.body as {
      calleeId?: string;
      type?: CallType;
      calleeType?: 'user' | 'device';
      targetIds?: string[];  // specific devices/users for broadcast
    };

    if (type === 'normal' && !calleeId) {
      reply.code(400);
      return { error: 'calleeId required for normal calls' };
    }

    const callId = nanoid();
    const roomName = type === 'normal'
      ? `call-${callId}`
      : `emergency-${callId}`;

    const callerType = request.auth.type === 'device' ? 'device' : 'user';

    db.prepare(`
      INSERT INTO calls (id, caller_id, caller_type, callee_id, callee_type, room_name, type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ringing')
    `).run(callId, request.auth.id, callerType, calleeId || null, calleeId ? calleeType : null, roomName, type);

    // Notify via WebSocket
    const room = getRoom();
    const callerName = request.auth.name || request.auth.id;

    if (type === 'emergency') {
      // Broadcast to all online users
      room.broadcast({
        type: 'incoming_call',
        callId,
        callerId: request.auth.id,
        callerName,
        callType: type,
        roomName,
      }, request.auth.id);
    } else if (type === 'broadcast') {
      const broadcastMsg = {
        type: 'broadcast_start',
        callId,
        roomName,
        from: callerName,
        mediaMode: config.livekit.enabled ? 'sfu' : 'p2p',
        livekitUrl: config.livekit.enabled ? config.livekit.publicUrl : undefined,
      } as any;

      let notified = 0;
      if (targetIds && targetIds.length > 0) {
        // Targeted broadcast — send to specific devices/users only
        notified = room.sendToMany(targetIds, broadcastMsg);
      } else {
        // Global broadcast — send to all online
        room.broadcast(broadcastMsg, request.auth.id);
        notified = room.getOnlineCounts().total;
      }

      // Store targets in DB for reference
      if (targetIds && targetIds.length > 0) {
        const insertParticipant = db.prepare(
          'INSERT INTO call_participants (call_id, user_id, user_type) VALUES (?, ?, ?)'
        );
        for (const tid of targetIds) {
          insertParticipant.run(callId, tid, 'device');
        }
      }

      // Return how many were notified
      Object.assign(request, { _broadcastNotified: notified });
    } else if (type === 'intercom') {
      // Intercom call — Pi device → project agents with escalation
      const { projectId } = request.body as any;
      if (projectId) {
        // Broadcast to all project agents first
        broadcastToProjectAgents(projectId, {
          type: 'incoming_call',
          callId,
          callerId: request.auth.id,
          callerName,
          callType: 'intercom',
          roomName,
          projectId,
          timeout: 60,
        });

        // Start escalation (ring agents one by one)
        startEscalation(callId, projectId, roomName, callerName, 30, () => {
          // All agents missed
          db.prepare(`UPDATE calls SET status = 'missed', ended_at = datetime('now') WHERE id = ?`).run(callId);
          room.sendTo(request.auth.id, { type: 'call_missed', callId });
          broadcastToProjectAgents(projectId, { type: 'call_missed', callId });
        });
      }
    } else if (calleeId) {
      // Send to specific user/device
      room.sendTo(calleeId, {
        type: 'incoming_call',
        callId,
        callerId: request.auth.id,
        callerName,
        callType: type,
        roomName,
      });
    }

    // Auto-generate LiveKit token for caller if LiveKit is enabled
    let livekitToken: string | undefined;
    if (config.livekit.enabled) {
      livekitToken = await createToken({
        identity: request.auth.id,
        name: request.auth.name || request.auth.id,
        roomName,
        canPublish: true,
        canSubscribe: true,
      });
    }

    return {
      callId,
      roomName,
      type,
      mediaMode: config.livekit.enabled ? 'sfu' : 'p2p',
      targetIds: targetIds || null,
      livekit: livekitToken ? {
        token: livekitToken,
        url: config.livekit.publicUrl,
      } : undefined,
    };
  });

  // Respond to a call (accept/reject)
  app.post('/calls/respond', { preHandler: authenticate }, async (request, reply) => {
    const { callId, action } = request.body as {
      callId: string;
      action: 'accept' | 'reject';
    };

    const call = db.prepare('SELECT * FROM calls WHERE id = ? AND status = ?').get(callId, 'ringing') as any;
    if (!call) {
      reply.code(404);
      return { error: 'Call not found or no longer ringing' };
    }

    const room = getRoom();

    if (action === 'accept') {
      // Cancel escalation if intercom call
      cancelEscalation(callId);

      db.prepare(`
        UPDATE calls SET status = 'active', callee_id = ?, callee_type = 'user', answered_at = datetime('now')
        WHERE id = ?
      `).run(request.auth.id, callId);

      // Add participant
      db.prepare(`
        INSERT INTO call_participants (call_id, user_id, user_type)
        VALUES (?, ?, ?)
      `).run(callId, request.auth.id, 'user');

      // Mark agent as busy for intercom calls
      if (call.type === 'intercom') {
        setAgentBusy(request.auth.id, callId);
      }

      room.sendTo(call.caller_id, {
        type: 'call_accepted',
        callId,
        answererId: request.auth.id,
      });

      // Generate LiveKit token for callee
      let livekitToken: string | undefined;
      if (config.livekit.enabled) {
        livekitToken = await createToken({
          identity: request.auth.id,
          name: request.auth.name || request.auth.id,
          roomName: call.room_name,
          canPublish: true,
          canSubscribe: true,
        });
      }

      return {
        ok: true,
        roomName: call.room_name,
        mediaMode: config.livekit.enabled ? 'sfu' : 'p2p',
        livekit: livekitToken ? {
          token: livekitToken,
          url: config.livekit.publicUrl,
        } : undefined,
      };
    } else {
      db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('rejected', callId);

      room.sendTo(call.caller_id, {
        type: 'call_rejected',
        callId,
      });

      return { ok: true };
    }
  });

  // End a call
  app.post('/calls/end', { preHandler: authenticate }, async (request) => {
    const { callId } = request.body as { callId: string };

    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId) as any;
    if (!call) return { ok: false, error: 'Call not found' };

    // Cancel escalation if still running
    cancelEscalation(callId);

    const answeredAt = call.answered_at ? new Date(call.answered_at).getTime() : null;
    const duration = answeredAt ? Math.floor((Date.now() - answeredAt) / 1000) : null;

    const newStatus = call.status === 'ringing' ? 'missed' : 'completed';

    // Free agents involved in this call
    if (call.type === 'intercom' && call.callee_id) {
      freeAgent(call.callee_id);
    }

    db.prepare(`
      UPDATE calls SET status = ?, ended_at = datetime('now'), duration = ?
      WHERE id = ?
    `).run(newStatus, duration, callId);

    // Update participants
    db.prepare(`
      UPDATE call_participants SET left_at = datetime('now')
      WHERE call_id = ? AND left_at IS NULL
    `).run(callId);

    // Notify all parties
    const room = getRoom();
    room.sendTo(call.caller_id, { type: 'call_ended', callId, reason: 'ended' });
    if (call.callee_id) {
      room.sendTo(call.callee_id, { type: 'call_ended', callId, reason: 'ended' });
    }
    // For emergency/broadcast, notify all
    if (call.type !== 'normal') {
      room.broadcast({ type: 'call_ended', callId, reason: 'ended' });
    }

    return { ok: true, duration };
  });

  // Call history
  app.get('/calls/history', { preHandler: authenticate }, async (request) => {
    const { page = '1', limit = '20', type } = request.query as {
      page?: string;
      limit?: string;
      type?: string;
    };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    // Non-admin users only see their own calls
    if (request.auth.role !== 'admin') {
      where += ' AND (caller_id = ? OR callee_id = ?)';
      params.push(request.auth.id, request.auth.id);
    }

    if (type) {
      where += ' AND type = ?';
      params.push(type);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM calls ${where}`).get(...params) as any;
    const calls = db.prepare(`
      SELECT * FROM calls ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    return {
      calls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total.count,
        pages: Math.ceil(total.count / limitNum),
      },
    };
  });

  // Online count
  app.get('/calls/online-count', { preHandler: authenticate }, async () => {
    const room = getRoom();
    const counts = room.getOnlineCounts();
    return counts;
  });

  // List all targets for broadcast (online users + all registered devices)
  app.get('/calls/online', { preHandler: authenticate }, async () => {
    const room = getRoom();
    const onlineClients = room.getOnlineClients();
    const onlineIds = new Set(onlineClients.map(c => c.id));

    // Online users
    const users = onlineClients
      .filter(c => c.type === 'user')
      .map(c => ({ id: c.id, type: 'user' as const, name: c.name || c.id, online: true }));

    // All registered devices (with online status)
    const devices = db.prepare('SELECT id, name, identity, status, location FROM devices ORDER BY name').all() as any[];
    const deviceList = devices.map((d: any) => ({
      id: d.id,
      type: 'device' as const,
      name: d.name,
      identity: d.identity,
      online: onlineIds.has(d.id) || onlineIds.has(d.identity),
      location: d.location ? JSON.parse(d.location) : null,
    }));

    return { users, devices: deviceList };
  });
}
