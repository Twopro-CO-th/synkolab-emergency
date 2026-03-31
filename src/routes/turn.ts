import type { FastifyInstance } from 'fastify';
import { createHmac } from 'crypto';
import { authenticate } from '../auth/middleware.js';
import { config } from '../config.js';
import type { TurnCredentials } from '../types/index.js';

export async function turnRoutes(app: FastifyInstance): Promise<void> {
  app.get('/turn/credentials', { preHandler: authenticate }, async (request) => {
    const userId = request.auth.id;
    const ttl = config.turn.ttl;
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:${userId}`;

    const credential = createHmac('sha1', config.turn.secret)
      .update(username)
      .digest('base64');

    const credentials: TurnCredentials = {
      urls: config.turn.servers,
      username,
      credential,
      ttl,
    };

    return credentials;
  });
}
