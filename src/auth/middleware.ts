import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { verifyJwt } from './jwt.js';
import { config } from '../config.js';
import type { AuthContext } from '../types/index.js';

// Extend Fastify request
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Authenticate any of: API key, JWT Bearer, or device token */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // 1. Check API key (service-to-service)
  const apiKey = request.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    const valid = config.apiKeys.some(k => safeCompare(k, apiKey));
    if (!valid) {
      reply.code(401).send({ error: 'Invalid API key' });
      return;
    }
    // Service calls can specify which user they act on behalf of
    const userId = request.headers['x-request-user'] as string | undefined;
    const userName = request.headers['x-request-user-name'] as string | undefined;
    request.auth = {
      type: 'service',
      id: userId || 'service',
      role: 'admin',
      name: userName ? decodeURIComponent(userName) : undefined,
    };
    return;
  }

  // 2. Check Bearer JWT (web users)
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = await verifyJwt(token);
      request.auth = {
        type: 'user',
        id: payload.sub,
        role: payload.role,
        name: payload.name,
      };
      return;
    } catch {
      reply.code(401).send({ error: 'Invalid or expired token' });
      return;
    }
  }

  reply.code(401).send({ error: 'Authentication required' });
}

/** Require admin role */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (request.auth.role !== 'admin') {
    reply.code(403).send({ error: 'Admin access required' });
  }
}
