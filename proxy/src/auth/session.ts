import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface SessionPayload {
  sub: string;       // username or "dev"
  tenant_id: string;
  role: string;
  mode: string;
  type: 'session' | 'api_key';
}

export function issueSessionToken(payload: Omit<SessionPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'session' } as object,
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn as string & { __brand: never },
    } as jwt.SignOptions,
  );
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const payload = decoded as SessionPayload;
    if (payload.type !== 'session') return null;
    return payload;
  } catch {
    return null;
  }
}
