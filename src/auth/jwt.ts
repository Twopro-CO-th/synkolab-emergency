import * as jose from 'jose';
import { config } from '../config.js';
import type { JwtPayload } from '../types/index.js';

const secret = new TextEncoder().encode(config.jwt.secret);

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jose.jwtVerify(token, secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  return payload as unknown as JwtPayload;
}

export async function signJwt(payload: {
  sub: string;
  role: 'user' | 'admin';
  name?: string;
}): Promise<string> {
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setIssuedAt()
    .setExpirationTime(config.jwt.expiresIn)
    .sign(secret);
}
