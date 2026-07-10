import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { AppVariables } from '../types.js';
import * as queries from '../db/queries.js';
import { config } from '../config.js';
import { issueSessionToken } from '../auth/session.js';
import { getAuthorizationUrl, handleCallback, getEnabledProviderNames } from '../auth/oidc.js';
import { deriveTenantId } from '../auth/policy.js';

export function createOidcRouter(getDb: () => Kysely<DB>): Hono<{ Variables: AppVariables }> {
  const db = getDb;
  const router = new Hono<{ Variables: AppVariables }>();

  router.get('/providers', (c) => c.json({ providers: getEnabledProviderNames() }));

  router.get('/login', async (c) => {
    const provider = c.req.query('provider') || '';
    // redirect_uri must match the Google/Microsoft console entry: always the proxy's own URL.
    const baseUrl = config.publicUrl || `${c.req.header('x-forwarded-proto') || 'http'}://${c.req.header('host')}`;
    const redirectUri = `${baseUrl}/api/v1/oidc/callback`;
    // returnTo is where the user came from (5173 in dev, 8645 in Docker) — read from Referer.
    const referer = c.req.header('referer');
    let returnTo = config.publicUrl || baseUrl;
    if (referer) {
      try { returnTo = new URL(referer).origin; } catch { /* keep default */ }
    }
    try {
      const url = await getAuthorizationUrl(provider, redirectUri, returnTo);
      return c.redirect(url);
    } catch (err: any) { return c.json({ error: err.message }, 400); }
  });

  router.get('/callback', async (c) => {
    try {
      const user = await handleCallback(c.req.url);

      // Corporate mode: enforce domain restrictions at login time
      if (config.mode === 'corporate' && config.corpAllowedDomains.length > 0) {
        const domain = user.email.split('@')[1]?.toLowerCase();
        if (!domain || !config.corpAllowedDomains.includes(domain)) {
          return c.json({ error: `Email domain not allowed. Accepted: ${config.corpAllowedDomains.join(', ')}` }, 403);
        }
      }

      let tenantId: string;
      if (config.mode === 'corporate') {
        if (!config.orgSlug) return c.json({ error: 'IDO_ORG_SLUG not configured' }, 500);
        tenantId = config.orgSlug;
      } else {
        tenantId = deriveTenantId(user.email);
      }
      let role = 'user';
      if (config.mode === 'personal' || config.mode === 'saas') role = 'admin';
      else if (config.mode === 'corporate' && config.adminEmails.includes(user.email)) role = 'admin';

      await queries.ensureTenant(getDb(), tenantId, user.name, config.mode);
      const existingUser = await queries.getUser(getDb(), user.email, tenantId);
      if (!existingUser) {
        await queries.createUser(getDb(), { username: user.email, passwordHash: '', tenantId, role, displayName: user.name, avatarUrl: user.picture });
      } else {
        // Backfill display_name and avatar on re-login if not already set
        if (user.name && !existingUser.display_name) {
          await getDb().updateTable('users').set({ display_name: user.name }).where('username', '=', user.email).where('tenant_id', '=', tenantId).execute();
        }
        if (user.picture && !existingUser.avatar_url) {
          await getDb().updateTable('users').set({ avatar_url: user.picture }).where('username', '=', user.email).where('tenant_id', '=', tenantId).execute();
        }
      }

      const token = issueSessionToken({ sub: user.email, tenant_id: tenantId, role, mode: config.mode });
      c.header('Set-Cookie', `ido_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
      // Return the user to the origin they started from (carried in the signed state).
      return c.redirect(user.returnTo);
    } catch (err: any) { console.error('OIDC error:', err); return c.json({ error: 'OIDC authentication failed' }, 500); }
  });

  return router;
}
