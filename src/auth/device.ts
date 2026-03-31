import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';

export function generateDeviceToken(deviceId: string): string {
  return createHmac('sha256', config.deviceSecret)
    .update(deviceId)
    .digest('hex');
}

export function verifyDeviceToken(deviceId: string, token: string, ts?: number): boolean {
  // Check timestamp freshness (5 min window) if provided
  if (ts !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false;
  }

  const base = ts !== undefined ? `${deviceId}:${ts}` : deviceId;
  const expected = createHmac('sha256', config.deviceSecret)
    .update(base)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(token, 'hex')
    );
  } catch {
    return false;
  }
}

export function hashDeviceToken(token: string): string {
  return createHmac('sha256', config.deviceSecret)
    .update(token)
    .digest('hex');
}
