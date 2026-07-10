import { createHash, randomBytes } from 'crypto';
import { config } from '../config.js';

// ── API Key Format ──────────────────────────────────────────
// ido_k_<48 hex chars>
// The 48 hex chars are 24 random bytes. We never store the full key,
// only a SHA-256 hash of it.

export function generateApiKey(): { fullKey: string; keyId: string; keyHash: string } {
  const bytes = randomBytes(24);
  const hex = bytes.toString('hex'); // 48 chars
  const fullKey = `ido_k_${hex}`;
  const keyId = createHash('sha256').update(fullKey).digest('hex').substring(0, 16);
  const keyHash = createHash('sha256').update(fullKey).digest('hex');
  return { fullKey, keyId, keyHash };
}

export function hashApiKey(fullKey: string): string {
  return createHash('sha256').update(fullKey).digest('hex');
}

export function isValidApiKeyFormat(key: string): boolean {
  return /^ido_k_[a-f0-9]{48}$/.test(key);
}

// ── Dev Token ───────────────────────────────────────────────

export function isValidDevToken(token: string): boolean {
  return config.mode === 'dev' && token === config.devToken;
}
