import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { AppVariables } from '../types.js';
import type { A2UIComponent } from '../a2ui/schema.js';
import * as queries from '../db/queries.js';
import { createSurface, submitSurface, cancelSurface, dismissNotification, broadcastSurfaceCreated, handleDomainError } from '../domain/surfaces.js';
import { sseManager } from '../sse/manager.js';
import { parseCreateSurfacePayload } from './validation.js';
import { config } from '../config.js';
import { SurfaceStateEnum } from '../types.js';

// Valid surface states for query-param validation
const VALID_STATES = new Set<string>(SurfaceStateEnum.options);

export function createSurfacesRouter(getDb: () => Kysely<DB>): Hono<{ Variables: AppVariables }> {
  const db = getDb
  const router = new Hono<{ Variables: AppVariables }>();

  // GET /api/v1/surfaces — lightweight summaries for the card list.
  // Heavy JSON blobs are fetched on demand via GET /:id when a surface opens.
  // ?exclude_expired=true filters out surfaces whose expires_at is in the past.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId') as string | undefined;
    const stateRaw = c.req.query('state');
    const state = stateRaw && VALID_STATES.has(stateRaw) ? stateRaw as typeof SurfaceStateEnum._type : undefined;
    const full = c.req.query('full') === 'true';
    const excludeExpired = c.req.query('exclude_expired') === 'true';
    const surfaces = full
      ? await queries.getSurfacesByTenant(getDb(), tenantId, state, config.mode === 'corporate' ? userId : undefined, excludeExpired)
      : await queries.getSurfaceSummariesByTenant(getDb(), tenantId, state, config.mode === 'corporate' ? userId : undefined, excludeExpired);
    return c.json(surfaces);
  });

  // GET /api/v1/surfaces/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const surface = await queries.getSurface(getDb(), c.req.param('id'));
    if (!surface || surface.tenant_id !== tenantId) {
      return c.json({ error: 'Not found' }, 404);
    }
    // Corporate: users can only access their own surfaces + unassigned
    if (config.mode === 'corporate') {
      const currentUserId = c.get('userId') as string | undefined;
      if (surface.user_id && surface.user_id !== currentUserId) {
        return c.json({ error: 'Not found' }, 404);
      }
    }

    // Mark as viewed
    await queries.markSurfaceViewed(getDb(), surface.surface_id);
    await queries.createEvent(getDb(), {
      surfaceId: surface.surface_id,
      tenantId,
      eventType: 'viewed',
    });

    return c.json(surface);
  });

  // POST /api/v1/surfaces — create a new surface via REST
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const source = c.get('source') as string || 'rest';
    const sourceIp = c.req.header('x-forwarded-for') ?? '127.0.0.1';

    try {
      const body = await c.req.json();
      const parsed = parseCreateSurfacePayload(body);
      const result = await createSurface(getDb(), {
        surfaceType: parsed.surface_type,
        title: parsed.surface_title,
        context: parsed.context,
        inputsSchema: parsed.inputs_schema,
        a2uiLayout: parsed.a2ui_layout as A2UIComponent[] | undefined,
        initialDataModel: parsed.initial_data_model,
        userId: parsed.user_id,
        severity: parsed.severity,
        expiresAt: parsed.expires_at,
        idempotencyKey: parsed.idempotency_key,
        callbackUrl: parsed.configuration?.pushNotificationConfig?.url,
        callbackToken: parsed.configuration?.pushNotificationConfig?.token,
        actionValidation: parsed.action_validation,
        tenantId,
        source,
        sourceIp,
      });

      // Push SSE update + web push notification (shared helper)
      await broadcastSurfaceCreated(getDb(), tenantId, result, parsed.user_id, parsed.surface_title, source);

      return c.json({ task_id: result.taskId, surface_id: result.surfaceId, task: result.task, surface: result.surface }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // POST /api/v1/surfaces/:id/submit
  router.post('/:id/submit', async (c) => {
    const tenantId = c.get('tenantId');
    const surfaceId = c.req.param('id');

    try {
      const body = await c.req.json();
      const result = await submitSurface(getDb(), {
        surfaceId,
        tenantId,
        userId: c.get('userId') as string | undefined,
        userInput: body.user_input ?? {},
        decision: body.decision,
        actor: 'human',
      });

      sseManager.pushSurfaceResolved(tenantId, surfaceId, result.state,
        config.mode === 'corporate' ? (c.get('userId') as string) : undefined);

      return c.json(result);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // POST /api/v1/surfaces/:id/archive
  router.post('/:id/archive', async (c) => {
    const tenantId = c.get('tenantId');
    const surfaceId = c.req.param('id');

    const surface = await queries.getSurface(getDb(), surfaceId);
    if (!surface || surface.tenant_id !== tenantId) {
      return c.json({ error: 'Not found' }, 404);
    }
    // Corporate: users can only act on their own surfaces
    if (config.mode === 'corporate') {
      const currentUserId = c.get('userId') as string | undefined;
      if (surface.user_id && surface.user_id !== currentUserId) {
        return c.json({ error: 'Not found' }, 404);
      }
    }

    await queries.archiveSurface(getDb(), surfaceId);

    // Push SSE — scope to target user in corporate mode
    sseManager.pushSurfaceResolved(tenantId, surfaceId, 'ARCHIVED',
      config.mode === 'corporate' ? surface.user_id : undefined);

    return c.json({ surfaceId, archived: true, state: surface.state });
  });

  // POST /api/v1/surfaces/:id/dismiss
  router.post('/:id/dismiss', async (c) => {
    const tenantId = c.get('tenantId');
    const surfaceId = c.req.param('id');

    try {
      const result = await dismissNotification(getDb(), surfaceId, tenantId, c.get('userId') as string | undefined);

      sseManager.pushSurfaceResolved(tenantId, surfaceId, 'DISMISSED',
        config.mode === 'corporate' ? (c.get('userId') as string | undefined) : undefined);

      return c.json(result);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // POST /api/v1/surfaces/:id/decline
  router.post('/:id/decline', async (c) => {
    const tenantId = c.get('tenantId');
    const surfaceId = c.req.param('id');

    try {
      const result = await cancelSurface(getDb(), surfaceId, tenantId, 'human', c.get('userId') as string | undefined);

      // Push SSE to connected clients
      sseManager.pushSurfaceResolved(tenantId, surfaceId, 'CANCELLED',
        config.mode === 'corporate' ? (c.get('userId') as string | undefined) : undefined);

      return c.json(result);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // POST /api/v1/surfaces/bulk-archive
  router.post('/bulk-archive', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const ids = body.surface_ids as string[];

    for (const id of ids) {
      const surface = await queries.getSurface(getDb(), id);
      if (surface && surface.tenant_id === tenantId) {
        await queries.archiveSurface(getDb(), id);
        // Push SSE to all connected clients
        sseManager.pushSurfaceResolved(tenantId, id, 'ARCHIVED',
          config.mode === 'corporate' ? surface.user_id : undefined);
      }
    }

    return c.json({ archived: ids.length });
  });

  return router;
}
