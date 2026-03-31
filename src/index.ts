import { readFileSync } from 'fs';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyHelmet from '@fastify/helmet';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { shutdownRoom } from './ws/rooms.js';

// Routes
import { healthRoutes } from './routes/health.js';
import { callRoutes } from './routes/calls.js';
import { deviceRoutes } from './routes/devices.js';
import { turnRoutes } from './routes/turn.js';
import { livekitRoutes } from './routes/livekit.js';
import { projectRoutes } from './routes/projects.js';
import { wsHandler } from './ws/handler.js';

// Build SSL options if enabled
const httpsOptions = config.ssl.enabled
  ? {
      cert: readFileSync(config.ssl.certPath),
      key: readFileSync(config.ssl.keyPath),
    }
  : undefined;

const app = Fastify({
  logger: {
    level: config.logLevel,
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  },
  ...(httpsOptions ? { https: httpsOptions } : {}),
  maxParamLength: 200,
  trustProxy: true,
});

// --- Plugins ---
await app.register(fastifyHelmet, {
  contentSecurityPolicy: false, // API only, no HTML
});

await app.register(fastifyCors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin) return cb(null, true);
    if (config.allowedOrigins.includes(origin)) return cb(null, true);
    // Dev mode: allow all localhost
    if (config.env === 'development' || origin.startsWith('http://localhost')) return cb(null, true);
    cb(new Error('CORS not allowed'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(fastifyRateLimit, {
  max: config.rateLimit.max,
  timeWindow: config.rateLimit.windowMs,
});

await app.register(fastifyWebsocket, {
  options: {
    maxPayload: config.ws.maxPayload,
  },
});

// --- Init DB ---
getDb();
app.log.info('Database initialized');

// --- Routes ---
await app.register(healthRoutes);
await app.register(callRoutes);
await app.register(deviceRoutes);
await app.register(turnRoutes);
await app.register(livekitRoutes);
await app.register(projectRoutes);
await app.register(wsHandler);

// --- Graceful shutdown ---
const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down...`);
  shutdownRoom();
  closeDb();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Start ---
try {
  const address = await app.listen({ port: config.port, host: config.host });
  app.log.info(`Emergency API running at ${address}`);
  app.log.info(`WebSocket signaling at ${config.ssl.enabled ? 'wss' : 'ws'}://${config.host}:${config.port}/ws`);
  app.log.info(`Environment: ${config.env}`);
  if (config.ssl.enabled) {
    app.log.info('SSL: enabled (direct TLS termination)');
  }
  app.log.info(`LiveKit: ${config.livekit.enabled ? 'enabled' : 'disabled (P2P mode)'}`);
  app.log.info(`Media mode: ${config.livekit.enabled ? 'SFU (LiveKit)' : 'P2P (WebRTC direct)'}`);

} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
