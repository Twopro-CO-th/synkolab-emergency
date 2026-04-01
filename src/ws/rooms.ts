import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../types/index.js';
import { config } from '../config.js';

interface Client {
  ws: WebSocket;
  connId: string; // unique per connection
  id: string;     // user/device id (can have multiple connections)
  type: 'user' | 'device';
  name?: string;
  role?: string;
  connectedAt: number;
  lastPing: number;
}

let connCounter = 0;

class SignalingRoom {
  private clients = new Map<string, Client>(); // key = connId
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

  addClient(id: string, ws: WebSocket, type: 'user' | 'device', name?: string, role?: string): string {
    if (this.clients.size >= config.ws.maxConnections) {
      ws.close(4503, 'max connections reached');
      return '';
    }

    const connId = `${id}:${++connCounter}`;

    this.clients.set(connId, {
      ws,
      connId,
      id,
      type,
      name,
      role,
      connectedAt: Date.now(),
      lastPing: Date.now(),
    });

    return connId;
  }

  removeClient(connId: string): void {
    this.clients.delete(connId);
  }

  // Remove by connId OR by userId (backward compat)
  removeByUserId(id: string): void {
    for (const [connId, client] of this.clients) {
      if (client.id === id) {
        this.clients.delete(connId);
      }
    }
  }

  sendTo(targetId: string, message: WsServerMessage | Record<string, unknown>): boolean {
    const data = JSON.stringify(message);
    let sent = false;
    // Send to ALL connections for this user/device id
    for (const client of this.clients.values()) {
      if (client.id === targetId && client.ws.readyState === 1) {
        client.ws.send(data);
        sent = true;
      }
    }
    return sent;
  }

  sendToMany(targetIds: string[], message: WsServerMessage | Record<string, unknown>): number {
    const targetSet = new Set(targetIds);
    const data = JSON.stringify(message);
    let sent = 0;
    for (const client of this.clients.values()) {
      if (targetSet.has(client.id) && client.ws.readyState === 1) {
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
    for (const client of this.clients.values()) {
      if (client.id === id && client.ws.readyState === 1) return true;
    }
    return false;
  }

  getOnlineCounts(): { users: number; devices: number; total: number } {
    const seen = new Set<string>();
    let users = 0;
    let devices = 0;
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1 || seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.type === 'device') devices++;
      else users++;
    }
    return { users, devices, total: users + devices };
  }

  getOnlineIds(): string[] {
    const ids = new Set<string>();
    for (const c of this.clients.values()) {
      if (c.ws.readyState === 1) ids.add(c.id);
    }
    return Array.from(ids);
  }

  getOnlineClients(): Array<{ id: string; type: string; name?: string }> {
    const seen = new Set<string>();
    const result: Array<{ id: string; type: string; name?: string }> = [];
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1 || seen.has(c.id)) continue;
      seen.add(c.id);
      result.push({ id: c.id, type: c.type, name: c.name });
    }
    return result;
  }

  private pingAll(): void {
    const now = Date.now();
    for (const [connId, client] of this.clients) {
      if (client.ws.readyState !== 1) {
        this.clients.delete(connId);
        continue;
      }
      if (now - client.lastPing > config.ws.pingInterval * 2.5) {
        client.ws.close(4408, 'ping timeout');
        this.clients.delete(connId);
        continue;
      }
      client.ws.ping();
    }
  }

  updatePing(connId: string): void {
    const c = this.clients.get(connId);
    if (c) c.lastPing = Date.now();
  }

  // Also update by userId for backward compat
  updatePingByUserId(id: string): void {
    for (const c of this.clients.values()) {
      if (c.id === id) c.lastPing = Date.now();
    }
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
