import 'dotenv/config';
import { existsSync } from 'fs';

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

function envBool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v === 'true' || v === '1';
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

export const config = {
  env: env('NODE_ENV', 'development'),
  host: env('HOST', '0.0.0.0'),
  port: envInt('PORT', 4000),

  ssl: {
    enabled: envBool('SSL_ENABLED'),
    certPath: env('SSL_CERT_PATH', '/app/certs/fullchain.pem'),
    keyPath: env('SSL_KEY_PATH', '/app/certs/privkey.pem'),
  },

  publicUrl: env('PUBLIC_URL', 'http://localhost:4000'),
  allowedOrigins: env('ALLOWED_ORIGINS', 'http://localhost:3000').split(',').map(s => s.trim()),

  jwt: {
    secret: env('JWT_SECRET', 'dev-secret-change-me-in-production'),
    issuer: env('JWT_ISSUER', 'community-link'),
    audience: env('JWT_AUDIENCE', 'synkolab-emergency'),
    expiresIn: env('JWT_EXPIRES_IN', '2h'),
  },

  apiKeys: env('API_KEYS', 'sk_dev_test').split(',').map(s => s.trim()),
  deviceSecret: env('DEVICE_SECRET', 'dev-device-secret'),

  turn: {
    secret: env('TURN_SECRET', 'commlink-turn-secret-2026'),
    servers: env('TURN_SERVERS', 'turn:localhost:3478').split(',').map(s => s.trim()),
    ttl: envInt('TURN_TTL', 86400),
  },

  db: {
    path: env('DB_PATH', './data/emergency.db'),
  },

  redis: {
    enabled: envBool('REDIS_ENABLED'),
    url: env('REDIS_URL', 'redis://localhost:6379'),
  },

  rateLimit: {
    max: envInt('RATE_LIMIT_MAX', 100),
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000),
  },

  ws: {
    pingInterval: envInt('WS_PING_INTERVAL', 30000),
    authTimeout: envInt('WS_AUTH_TIMEOUT', 5000),
    maxPayload: envInt('WS_MAX_PAYLOAD', 4096),
    maxConnections: envInt('WS_MAX_CONNECTIONS', 500),
  },

  call: {
    ringTimeout: envInt('CALL_RING_TIMEOUT', 30000),
    maxDuration: envInt('CALL_MAX_DURATION', 3600000),
  },

  livekit: {
    enabled: envBool('LIVEKIT_ENABLED'),
    url: env('LIVEKIT_URL', 'ws://localhost:7880'),
    publicUrl: env('LIVEKIT_PUBLIC_URL', 'wss://localhost:7880'),
    apiKey: env('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: env('LIVEKIT_API_SECRET', 'secret123456789abcdef123456789abcdef'),
    tokenTtl: envInt('LIVEKIT_TOKEN_TTL', 3600),         // 1 hour
    deviceTokenTtl: envInt('LIVEKIT_DEVICE_TOKEN_TTL', 86400), // 24 hours (Pi)
  },

  logLevel: env('LOG_LEVEL', 'info'),
} as const;

// Validate SSL paths exist if enabled
if (config.ssl.enabled) {
  if (!existsSync(config.ssl.certPath)) {
    throw new Error(`SSL cert not found: ${config.ssl.certPath}`);
  }
  if (!existsSync(config.ssl.keyPath)) {
    throw new Error(`SSL key not found: ${config.ssl.keyPath}`);
  }
}
