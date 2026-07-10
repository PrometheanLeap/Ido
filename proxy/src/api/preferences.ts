import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { AppVariables } from '../types.js';
import { v4 as uuid } from 'uuid';
import * as queries from '../db/queries.js';
import { extractAuth, requireTenant } from '../middleware/auth.js';

export function createPreferencesRouter(getDb: () => Kysely<DB>): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();

  // GET /api/v1/preferences
  router.get('/', extractAuth, requireTenant, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const userId = c.get('userId') as string | undefined;
    const prefs = await queries.getNotificationPrefs(getDb(), tenantId, userId);
    return c.json(
      prefs ?? {
        quiet_hours_enabled: 0,
        push_enabled: 0,
        push_forms: 1,
        push_approvals: 1,
        push_notifications: 1,
        push_severity_min: 'info',
        quiet_behaviour: 'suppress',
      },
    );
  });

  // PUT /api/v1/preferences
  router.put('/', extractAuth, requireTenant, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const body = await c.req.json();
    const userId = c.get('userId') as string | undefined;
    const existing = await queries.getNotificationPrefs(getDb(), tenantId, userId);

    if (existing) {
      await getDb()
        .updateTable('notification_preferences')
        .set({
          quiet_hours_enabled: body.quiet_hours_enabled ?? existing.quiet_hours_enabled,
          quiet_start: body.quiet_start ?? existing.quiet_start,
          quiet_end: body.quiet_end ?? existing.quiet_end,
          quiet_timezone: body.quiet_timezone ?? existing.quiet_timezone,
          quiet_days: body.quiet_days ?? existing.quiet_days,
          quiet_behaviour: body.quiet_behaviour ?? existing.quiet_behaviour,
          push_enabled: body.push_enabled ?? existing.push_enabled,
          push_forms: body.push_forms ?? existing.push_forms,
          push_approvals: body.push_approvals ?? existing.push_approvals,
          push_notifications: body.push_notifications ?? existing.push_notifications,
          push_severity_min: body.push_severity_min ?? existing.push_severity_min,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await getDb()
        .insertInto('notification_preferences')
        .values({
          id: uuid(),
          tenant_id: tenantId,
          user_id: userId ?? null,
          push_enabled: body.push_enabled ?? 0,
          quiet_hours_enabled: body.quiet_hours_enabled ?? 0,
          quiet_start: body.quiet_start ?? null,
          quiet_end: body.quiet_end ?? null,
          quiet_timezone: body.quiet_timezone ?? null,
          quiet_days: body.quiet_days ?? '["Mon","Tue","Wed","Thu","Fri"]',
          quiet_behaviour: body.quiet_behaviour ?? 'suppress',
          push_forms: body.push_forms ?? 1,
          push_approvals: body.push_approvals ?? 1,
          push_notifications: body.push_notifications ?? 1,
          push_severity_min: body.push_severity_min ?? 'info',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
    }
    return c.json({ saved: true });
  });

  return router;
}
