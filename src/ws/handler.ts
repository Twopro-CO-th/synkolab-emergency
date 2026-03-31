import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { verifyJwt } from '../auth/jwt.js';
import { verifyDeviceToken } from '../auth/device.js';
import { getRoom } from './rooms.js';
import { config } from '../config.js';
import type { WsClientMessage, AuthContext } from '../types/index.js';

export async function wsHandler(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    let auth: AuthContext | null = null;
    let messageCount = 0;
    let messageResetTimer: ReturnType<typeof setInterval>;

    // Rate limit: reset counter every second
    messageResetTimer = setInterval(() => { messageCount = 0; }, 1000);

    // Auth timeout
    const authTimer = setTimeout(() => {
      if (!auth) {
        socket.send(JSON.stringify({ type: 'auth_error', reason: 'auth timeout' }));
        socket.close(4401, 'auth timeout');
      }
    }, config.ws.authTimeout);

    // Pong handler
    socket.on('pong', () => {
      if (auth) getRoom().updatePing(auth.id);
    });

    socket.on('message', async (raw: Buffer) => {
      // Max payload check
      if (raw.length > config.ws.maxPayload) {
        socket.send(JSON.stringify({ type: 'error', message: 'payload too large' }));
        return;
      }

      // Rate limit
      messageCount++;
      if (messageCount > 30) {
        socket.send(JSON.stringify({ type: 'error', message: 'rate limited' }));
        return;
      }

      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
        return;
      }

      // --- Auth message ---
      if (msg.type === 'auth') {
        try {
          if (msg.clientType === 'device' && msg.deviceId) {
            const valid = verifyDeviceToken(msg.deviceId, msg.token, msg.ts);
            if (!valid) throw new Error('invalid device token');
            auth = { type: 'device', id: msg.deviceId };
          } else {
            const payload = await verifyJwt(msg.token);
            auth = { type: 'user', id: payload.sub, role: payload.role, name: payload.name };
          }

          clearTimeout(authTimer);
          getRoom().addClient(auth.id, socket, auth.type as 'user' | 'device', auth.name, auth.role);
          socket.send(JSON.stringify({ type: 'auth_ok', id: auth.id }));
          app.log.info({ clientId: auth.id, clientType: auth.type }, 'ws authenticated');
        } catch (err) {
          socket.send(JSON.stringify({ type: 'auth_error', reason: 'invalid credentials' }));
          socket.close(4401, 'auth failed');
        }
        return;
      }

      // All other messages require auth
      if (!auth) {
        socket.send(JSON.stringify({ type: 'auth_error', reason: 'not authenticated' }));
        return;
      }

      const room = getRoom();

      switch (msg.type) {
        // --- WebRTC signaling relay ---
        case 'offer':
          room.sendTo(msg.targetId, { type: 'offer', fromId: auth.id, sdp: msg.sdp });
          break;

        case 'answer':
          room.sendTo(msg.targetId, { type: 'answer', fromId: auth.id, sdp: msg.sdp });
          break;

        case 'ice-candidate':
          room.sendTo(msg.targetId, { type: 'ice-candidate', fromId: auth.id, candidate: msg.candidate });
          break;

        // --- Heartbeat ---
        case 'heartbeat':
        case 'ping':
          room.updatePing(auth.id);
          socket.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          socket.send(JSON.stringify({ type: 'error', message: `unknown type: ${(msg as any).type}` }));
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(messageResetTimer);
      if (auth) {
        getRoom().removeClient(auth.id);
        app.log.info({ clientId: auth.id }, 'ws disconnected');
      }
    });

    socket.on('error', (err: Error) => {
      app.log.error({ err, clientId: auth?.id }, 'ws error');
    });
  });
}
