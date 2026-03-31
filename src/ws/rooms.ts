import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../types/index.js';
import { config } from '../config.js';

interface Client {
  ws: WebSocket;
  id: string;
  type: 'user' | 'device';
  name?: string;
  role?: string;
  connectedAt: number;
  lastPing: number;
}

class SignalingRoom {
  private clients = new Map<string, Client>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.pingTimer = setInterval(() => this.pingAll(), config.ws.pingInterval);
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'server shutdown');
    }
    this.clients.clear();
  }

  addClient(id: string, ws: WebSocket, type: 'user' | 'device', name?: string, role?: string): void {
    // Close existing connection for same id
    const existing = this.clients.get(id);
    if (existing) {
      existing.ws.close(4000, 'replaced by new connection');
    }

    if (this.clients.size >= config.ws.maxConnections) {
      ws.close(4503, 'max connections reached');
      return;
    }

    this.clients.set(id, {
      ws,
      id,
      type,
      name,
      role,
      connectedAt: Date.now(),
      lastPing: Date.now(),
    });
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  sendTo(targetId: string, message: WsServerMessage | Record<string, unknown>): boolean {
    const client = this.clients.get(targetId);
    if (!client || client.ws.readyState !== 1) return false;
    client.ws.send(JSON.stringify(message));
    return true;
  }

  sendToMany(targetIds: string[], message: WsServerMessage | Record<string, unknown>): number {
    const data = JSON.stringify(message);
    let sent = 0;
    for (const id of targetIds) {
      const client = this.clients.get(id);
      if (client && client.ws.readyState === 1) {
        client.ws.send(data);
        sent++;
      }
    }
    return sent;
  }

  broadcast(message: WsServerMessage, excludeId?: string): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.id === excludeId) continue;
      if (client.ws.readyState === 1) {
        client.ws.send(data);
      }
    }
  }

  isOnline(id: string): boolean {
    const c = this.clients.get(id);
    return !!c && c.ws.readyState === 1;
  }

  getOnlineCounts(): { users: number; devices: number; total: number } {
    let users = 0;
    let devices = 0;
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1) continue;
      if (c.type === 'device') devices++;
      else users++;
    }
    return { users, devices, total: users + devices };
  }

  getOnlineIds(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, c]) => c.ws.readyState === 1)
      .map(([id]) => id);
  }

  getOnlineClients(): Array<{ id: string; type: string; name?: string }> {
    return Array.from(this.clients.values())
      .filter(c => c.ws.readyState === 1)
      .map(c => ({ id: c.id, type: c.type, name: c.name }));
  }

  private pingAll(): void {
    const now = Date.now();
    for (const [id, client] of this.clients) {
      if (client.ws.readyState !== 1) {
        this.clients.delete(id);
        continue;
      }
      // Disconnect if no pong for 2 intervals
      if (now - client.lastPing > config.ws.pingInterval * 2.5) {
        client.ws.close(4408, 'ping timeout');
        this.clients.delete(id);
        continue;
      }
      client.ws.ping();
    }
  }

  updatePing(id: string): void {
    const c = this.clients.get(id);
    if (c) c.lastPing = Date.now();
  }
}

// Singleton
let room: SignalingRoom;

export function getRoom(): SignalingRoom {
  if (!room) {
    room = new SignalingRoom();
    room.start();
  }
  return room;
}

export function shutdownRoom(): void {
  if (room) room.stop();
}
