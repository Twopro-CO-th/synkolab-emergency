import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { getDb } from '../db/index.js';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Create project
  app.post('/projects', { preHandler: requireAdmin }, async (request) => {
    const { name, slug, settings } = request.body as any;
    if (!name || !slug) return { error: 'name and slug are required' };

    const db = getDb();
    const id = nanoid();
    const ownerId = request.auth.id;

    try {
      db.prepare(
        `INSERT INTO projects (id, name, slug, owner_id, settings) VALUES (?, ?, ?, ?, ?)`
      ).run(id, name, slug, ownerId, JSON.stringify(settings || {}));

      // Owner is auto-added as admin member
      db.prepare(
        `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'admin')`
      ).run(id, ownerId);

      return { id, name, slug, owner_id: ownerId };
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return { error: 'Project slug already exists' };
      }
      throw err;
    }
  });

  // List projects (for current user)
  app.get('/projects', { preHandler: authenticate }, async (request) => {
    const db = getDb();
    const userId = request.auth.id;

    const projects = db.prepare(`
      SELECT p.* FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id
      WHERE p.owner_id = ? OR pm.user_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all(userId, userId);

    return { projects };
  });

  // Get project by ID
  app.get('/projects/:id', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as any;
    const db = getDb();

    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    if (!project) return { error: 'Project not found' };

    const members = db.prepare(`
      SELECT user_id, role, created_at FROM project_members WHERE project_id = ?
    `).all(id);

    const devices = db.prepare(`
      SELECT d.* FROM devices d
      JOIN project_devices pd ON pd.device_id = d.id
      WHERE pd.project_id = ?
    `).all(id);

    return { ...(project as any), members, devices };
  });

  // Add member to project
  app.post('/projects/:id/members', { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as any;
    const { userId, role = 'member' } = request.body as any;
    if (!userId) return { error: 'userId is required' };

    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)`
      ).run(id, userId, role);
      return { ok: true };
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) return { error: 'Already a member' };
      throw err;
    }
  });

  // Remove member
  app.delete('/projects/:id/members/:userId', { preHandler: requireAdmin }, async (request) => {
    const { id, userId } = request.params as any;
    const db = getDb();
    db.prepare(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`).run(id, userId);
    return { ok: true };
  });

  // Add device to project
  app.post('/projects/:id/devices', { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as any;
    const { deviceId } = request.body as any;
    if (!deviceId) return { error: 'deviceId is required' };

    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO project_devices (project_id, device_id) VALUES (?, ?)`
      ).run(id, deviceId);
      return { ok: true };
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) return { error: 'Device already in project' };
      throw err;
    }
  });

  // Remove device from project
  app.delete('/projects/:id/devices/:deviceId', { preHandler: requireAdmin }, async (request) => {
    const { id, deviceId } = request.params as any;
    const db = getDb();
    db.prepare(`DELETE FROM project_devices WHERE project_id = ? AND device_id = ?`).run(id, deviceId);
    return { ok: true };
  });

  // Get online agents for a project
  app.get('/projects/:id/agents', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as any;
    const { getAvailableAgents } = await import('../ws/escalation.js');
    const agents = getAvailableAgents(id);
    return { projectId: id, agents, count: agents.length };
  });
}
