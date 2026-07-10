import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { AppVariables } from '../types.js';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { extractAuth, requireTenant } from '../middleware/auth.js';

export function createPushRouter(getDb: () => Kysely<DB>): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();

  // POST /api/v1/push/subscribe
  router.post('/subscribe', extractAuth, requireTenant, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const body = await c.req.json();
    const userId = c.get('userId') as string | undefined;
    await getDb()
      .insertInto('push_subscriptions')
      .values({
        id: uuid(),
        tenant_id: tenantId,
        user_id: userId ?? null,
        endpoint: body.endpoint,
        p256dh_key: body.keys.p256dh,
        auth_key: body.keys.auth,
        created_at: new Date().toISOString(),
      })
      .execute();
    return c.json({ subscribed: true });
  });

  // POST /api/v1/push/unsubscribe
  router.post('/unsubscribe', extractAuth, requireTenant, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const body = await c.req.json();
    await getDb()
      .deleteFrom('push_subscriptions')
      .where('tenant_id', '=', tenantId)
      .where('endpoint', '=', body.endpoint)
      .execute();
    return c.json({ unsubscribed: true });
  });

  // GET /api/v1/push/vapid-public-key
  router.get('/vapid-public-key', (c) =>
    c.json({ publicKey: config.vapidPublicKey }),
  );

  return router;
}
