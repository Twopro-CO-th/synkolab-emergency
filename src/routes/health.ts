import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { authenticate } from '../auth/middleware.js';
import { signJwt } from '../auth/jwt.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (err) {
      reply.code(503);
      return { status: 'error', message: 'Database unavailable' };
    }
  });

  // Issue JWT for a user (service-to-service via API key)
  app.post('/auth/token', { preHandler: authenticate }, async (request, reply) => {
    if (request.auth.type !== 'service') {
      reply.code(403);
      return { error: 'Only service calls (API key) can issue tokens' };
    }

    const { userId, role = 'user', name } = request.body as {
      userId: string;
      role?: 'user' | 'admin';
      name?: string;
    };

    if (!userId) {
      reply.code(400);
      return { error: 'userId is required' };
    }

    const token = await signJwt({ sub: userId, role, name });
    return { token, userId, role };
  });
}
