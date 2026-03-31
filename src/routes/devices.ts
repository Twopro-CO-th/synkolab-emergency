import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { generateDeviceToken, hashDeviceToken } from '../auth/device.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // Register new device (admin only)
  app.post('/devices/register', { preHandler: requireAdmin }, async (request, reply) => {
    const { name, identity, location, config: deviceConfig } = request.body as {
      name: string;
      identity: string;
      location?: { lat: number; lng: number; description?: string };
      config?: Record<string, unknown>;
    };

    if (!name || !identity) {
      reply.code(400);
      return { error: 'name and identity are required' };
    }

    // Check duplicate
    const existing = db.prepare('SELECT id FROM devices WHERE identity = ?').get(identity);
    if (existing) {
      reply.code(409);
      return { error: 'Device identity already exists' };
    }

    const id = nanoid();
    const rawToken = generateDeviceToken(id);
    const tokenHash = hashDeviceToken(rawToken);

    db.prepare(`
      INSERT INTO devices (id, name, identity, token_hash, location, config, registered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      identity,
      tokenHash,
      location ? JSON.stringify(location) : null,
      deviceConfig ? JSON.stringify(deviceConfig) : null,
      request.auth.id
    );

    reply.code(201);
    return {
      id,
      name,
      identity,
      token: rawToken, // Only returned once at registration
    };
  });

  // List devices
  app.get('/devices', { preHandler: authenticate }, async (request) => {
    const devices = db.prepare(`
      SELECT id, name, identity, status, last_seen, location, config, created_at
      FROM devices ORDER BY created_at DESC
    `).all();

    return devices.map((d: any) => ({
      ...d,
      location: d.location ? JSON.parse(d.location) : null,
      config: d.config ? JSON.parse(d.config) : null,
    }));
  });

  // Update device status
  app.patch('/devices/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Record<string, unknown>;

    const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(id);
    if (!device) {
      reply.code(404);
      return { error: 'Device not found' };
    }

    const allowed = ['name', 'location', 'config', 'status'];
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const key of allowed) {
      if (key in updates) {
        const col = key === 'config' ? 'config' : key;
        sets.push(`${col} = ?`);
        const val = updates[key];
        values.push(typeof val === 'object' ? JSON.stringify(val) : val);
      }
    }

    if (sets.length === 0) {
      reply.code(400);
      return { error: 'No valid fields to update' };
    }

    sets.push('updated_at = datetime("now")');
    values.push(id);

    db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return { ok: true };
  });

  // Device heartbeat (called by Pi)
  app.post('/devices/heartbeat', { preHandler: authenticate }, async (request) => {
    const { deviceId, health } = request.body as {
      deviceId: string;
      health?: Record<string, unknown>;
    };

    db.prepare(`
      UPDATE devices SET status = 'online', last_seen = datetime('now'), updated_at = datetime('now')
      WHERE id = ? OR identity = ?
    `).run(deviceId, deviceId);

    return { ok: true };
  });
}
