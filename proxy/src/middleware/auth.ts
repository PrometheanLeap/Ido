import type { Context, Next } from 'hono';
import type { AppVariables } from '../types.js';
import { config } from '../config.js';
import { isValidApiKeyFormat, hashApiKey, isValidDevToken, verifySessionToken } from '../auth/index.js';
import * as queries from '../db/queries.js';
import { getDb } from '../index.js';

/**
 * Extract authentication context from the request.
 *
 * Checks (in order):
 * 1. `ido_session` cookie (JWT session)
 * 2. `Authorization: Bearer <token>` header (session JWT or dev token)
 * 3. `X-Ido-Api-Key` header or `?api_key=` query param
 *
 * On success, sets `tenantId`, `userId`, `role`, `authMethod`, `scopes`, and
 * `source` on the Hono context. Does **not** reject unauthenticated requests —
 * it simply calls `next()` without setting variables. Route-level guards
 * (e.g. `requireTenant`) enforce presence where needed.
 */
export async function extractAuth(
  c: Context<{ Variables: AppVariables }>,
  next: Next,
): Promise<Response | void> {
  // 1. Session cookie
  const cookie = c.req.header('cookie') ?? '';
  const sessionMatch = cookie.match(/ido_session=([^;]+)/);
  if (sessionMatch?.[1]) {
    const payload = verifySessionToken(sessionMatch[1]);
    if (payload) {
      c.set('tenantId', payload.tenant_id);
      c.set('userId', payload.sub);
      c.set('role', payload.role);
      c.set('authMethod', 'session');
      return next();
    }
  }

  // 2. Bearer token (session JWT or dev token)
  const authHeader = c.req.header('authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const sessionPayload = verifySessionToken(token);
    if (sessionPayload) {
      c.set('tenantId', sessionPayload.tenant_id);
      c.set('userId', sessionPayload.sub);
      c.set('role', sessionPayload.role);
      c.set('authMethod', 'session');
      return next();
    }
    if (config.mode === 'dev' && isValidDevToken(token)) {
      c.set('tenantId', 'dev');
      c.set('userId', 'dev');
      c.set('role', 'admin');
      c.set('authMethod', 'dev');
      return next();
    }
  }

  // 3. API key (header or query param)
  const apiKey = c.req.header('x-ido-api-key') || c.req.query('api_key');
  if (apiKey) {
    if (!isValidApiKeyFormat(apiKey)) {
      return c.json(
        { error: 'Malformed API key — expected format ido_k_...', code: 'INVALID_KEY_FORMAT' },
        401,
      );
    }
    const keyHash = hashApiKey(apiKey);
    const key = await queries.getApiKeyByHash(getDb(), keyHash);
    if (key) {
      const tId = key.tenant_id ?? 'default';
      c.set('tenantId', tId);
      c.set('userId', key.user_id ?? '');
      c.set('role', 'agent');
      c.set('authMethod', 'api_key');
      c.set('scopes', JSON.parse(key.scopes));
      c.set('source', key.key_name ?? 'api');
      return next();
    }
    // Key was provided but doesn't match any stored key
    return c.json(
      { error: 'Invalid API key — not found or revoked', code: 'INVALID_API_KEY' },
      401,
    );
  }

  return next();
}

/**
 * Require an authenticated tenant. Apply after `extractAuth` on routes that
 * must reject unauthenticated requests with 401.
 */
export async function requireTenant(
  c: Context<{ Variables: AppVariables }>,
  next: Next,
): Promise<Response | void> {
  if (!c.get('tenantId')) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  return next();
}
