import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { AppVariables } from '../types.js';
import { issueSessionToken, generateApiKey } from '../auth/index.js';
import { extractAuth } from '../middleware/auth.js';
import * as queries from '../db/queries.js';
import { config, modePolicy } from '../config.js';

export function createAuthRouter(getDb: () => Kysely<DB>): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  const db = () => getDb();

  // POST /api/v1/login
  router.post('/login', async (c) => {
    if (!modePolicy.allowLocalAuth) {
      return c.json({ error: 'Local auth not available in this mode' }, 400);
    }

    const { username, password } = await c.req.json();

    // Determine tenant
    const tenantId = username; // personal mode: username = tenant

    // Ensure tenant exists
    await queries.ensureTenant(getDb(), tenantId, username, config.mode);

    const user = await queries.getUser(getDb(), username, tenantId);
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const valid = await bcrypt.compare(password, user.password_hash ?? '');
    if (!valid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = issueSessionToken({
      sub: username,
      tenant_id: tenantId,
      role: user.role,
      mode: config.mode,
    });

    // Set HttpOnly cookie
    c.header('Set-Cookie', `ido_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);

    return c.json({ token, user: { username, tenant_id: tenantId, role: user.role } });
  });

  // POST /api/v1/setup — first-time user creation (personal mode)
  router.post('/setup', async (c) => {
    if (config.mode === 'dev') {
      return c.json({ error: 'Setup not available in dev mode. The dev user (dev/dev) is auto-created.' }, 400);
    }
    if (!modePolicy.allowLocalAuth) {
      return c.json({ error: 'Setup not available in this mode' }, 400);
    }

    const { username, password } = await c.req.json();

    // Validate username
    if (!username || typeof username !== 'string' || username.length < 3) {
      return c.json({ error: 'Username must be at least 3 characters' }, 400);
    }

    // Validate password strength
    if (!password || typeof password !== 'string' || password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const tenantId = username;

    // Prevent duplicate setup — only one user per tenant
    const existingCount = await queries.getUserCount(getDb(), tenantId);
    if (existingCount > 0) {
      return c.json({ error: 'An account already exists. Please sign in.' }, 409);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await queries.ensureTenant(getDb(), tenantId, username, config.mode);
    await queries.createUser(getDb(), { username, passwordHash, tenantId, role: 'admin' });

    const token = issueSessionToken({
      sub: username,
      tenant_id: tenantId,
      role: 'admin',
      mode: config.mode,
    });

    c.header('Set-Cookie', `ido_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);

    return c.json({ token, user: { username, tenant_id: tenantId, role: 'admin' } });
  });

  // POST /api/v1/keys — create API key
  router.post('/keys', extractAuth, async (c) => {
    const tenantId = c.get('tenantId');
    const { key_name } = await c.req.json();

    // Auto-increment name: count existing non-revoked keys for this tenant
    const existing = await getDb()
      .selectFrom('agent_keys')
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null)
      .selectAll()
      .execute();
    const count = existing.length;
    const finalName = key_name || `Default ${count + 1}`;

    const { fullKey, keyId, keyHash } = generateApiKey();

    await queries.createApiKey(getDb(), {
      keyId,
      tenantId,
      keyHash,
      keyName: finalName,
    });

    return c.json({ key_id: keyId, api_key: fullKey, key_name: finalName });
  });

  // GET /api/v1/keys — list API keys (masked)
  router.get('/keys', extractAuth, async (c) => {
    const tenantId = c.get('tenantId');
    const keys = await getDb()
      .selectFrom('agent_keys')
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null)
      .selectAll()
      .execute();

    return c.json(keys.map((k) => ({
      key_id: k.key_id,
      key_name: k.key_name,
      scopes: JSON.parse(k.scopes),
      created_at: k.created_at,
      expires_at: k.expires_at,
    })));
  });

  // POST /api/v1/keys/:id/revoke
  router.post('/keys/:id/revoke', extractAuth, async (c) => {
    const tenantId = c.get('tenantId');
    const keyId = c.req.param('id')!;

    await getDb()
      .updateTable('agent_keys')
      .set({ revoked_at: new Date().toISOString() })
      .where('key_id', '=', keyId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return c.json({ revoked: true });
  });

  // PATCH /api/v1/keys/:id — update key name
  router.patch('/keys/:id', extractAuth, async (c) => {
    const tenantId = c.get('tenantId');
    const keyId = c.req.param('id')!;
    const { key_name } = await c.req.json();
    if (typeof key_name !== 'string' || !key_name.trim()) {
      return c.json({ error: 'key_name is required' }, 400);
    }
    const trimmed = key_name.trim().slice(0, 128);

    const result = await getDb()
      .updateTable('agent_keys')
      .set({ key_name: trimmed })
      .where('key_id', '=', keyId)
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null)
      .returning('key_id')
      .executeTakeFirst();

    if (!result) return c.json({ error: 'Key not found' }, 404);

    return c.json({ key_id: result.key_id, key_name: trimmed });
  });

  // PATCH /api/v1/profile — update display name
  router.patch('/profile', extractAuth, async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    if (!tenantId || !userId) return c.json({ error: 'Unauthorized' }, 401);
    const { display_name } = await c.req.json();
    if (typeof display_name !== 'string' || !display_name.trim()) {
      return c.json({ error: 'display_name is required' }, 400);
    }
    const trimmed = display_name.trim().slice(0, 128);
    await getDb().updateTable('users')
      .set({ display_name: trimmed })
      .where('username', '=', userId)
      .where('tenant_id', '=', tenantId)
      .execute();
    return c.json({ display_name: trimmed });
  });

  // POST /api/v1/logout
  router.post('/logout', async (c) => {
    c.header('Set-Cookie', 'ido_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return c.json({ logged_out: true });
  });

  return router;
}
