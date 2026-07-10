import { Kysely } from 'kysely';
import type { DB } from './adapter.js';
import { v4 as uuid } from 'uuid';
import type { SurfaceType, SurfaceState, TaskState, DispatchState, Severity, SurfaceEventType } from '../types.js';
import type { A2UIComponent } from '../a2ui/schema.js';

// ── Tenant ──────────────────────────────────────────────────

export async function ensureTenant(
  db: Kysely<DB>,
  tenantId: string,
  displayName: string,
  mode: string = 'dev',
) {
  const existing = await db.selectFrom('tenants')
    .where('tenant_id', '=', tenantId)
    .selectAll()
    .executeTakeFirst();

  if (!existing) {
    await db.insertInto('tenants').values({
      tenant_id: tenantId,
      display_name: displayName,
      mode,
      created_at: new Date().toISOString(),
    }).execute();
  }
}

// ── Surfaces ────────────────────────────────────────────────

export async function createSurface(
  db: Kysely<DB>,
  params: {
    surfaceId: string;
    tenantId: string;
    taskId: string;
    type: SurfaceType;
    title: string;
    components?: A2UIComponent[];
    schema?: Record<string, unknown>;
    data?: Record<string, unknown>;
    context?: string;
    userId?: string;
    sessionId?: string;
    source?: string;
    sourceIp?: string;
    severity?: Severity;
    expiresAt?: string;
  },
) {
  const now = new Date().toISOString();
  await db.insertInto('a2ui_surfaces').values({
    surface_id: params.surfaceId,
    tenant_id: params.tenantId,
    task_id: params.taskId,
    type: params.type,
    state: params.type === 'notification' ? 'COMPLETED' : 'INPUT_REQUIRED',
    title: params.title,
    components_json: JSON.stringify(params.components ?? []),
    schema_json: JSON.stringify(params.schema ?? {}),
    data_json: JSON.stringify(params.data ?? {}),
    context: params.context ?? null,
    user_id: params.userId ?? null,
    session_id: params.sessionId ?? null,
    source: params.source ?? null,
    source_ip: params.sourceIp ?? null,
    severity: params.severity ?? null,
    expires_at: params.expiresAt ?? null,
    archived: 0,
    created_at: now,
    updated_at: now,
  }).execute();

  return getSurface(db, params.surfaceId);
}

export async function getSurface(db: Kysely<DB>, surfaceId: string) {
  return db.selectFrom('a2ui_surfaces')
    .where('surface_id', '=', surfaceId)
    .selectAll()
    .executeTakeFirst();
}

export async function getSurfacesByTenant(
  db: Kysely<DB>,
  tenantId: string,
  state?: SurfaceState,
  userId?: string,
) {
  let query = db.selectFrom('a2ui_surfaces')
    .where('tenant_id', '=', tenantId);

  if (state) {
    query = query.where('state', '=', state);
  }

  // Corporate mode: scope to the user's own surfaces + unassigned
  if (userId) {
    query = query.where((eb) => eb.or([
      eb('user_id', '=', userId),
      eb('user_id', 'is', null),
    ]));
  }

  return query.orderBy('created_at', 'desc').selectAll().execute();
}

// Lightweight list — only the columns the card list view needs.
// Excludes the heavy JSON blobs (components_json, schema_json, data_json)
// which are fetched on-demand when a surface is opened.
export async function getSurfaceSummariesByTenant(
  db: Kysely<DB>,
  tenantId: string,
  state?: SurfaceState,
  userId?: string,
) {
  let query = db.selectFrom('a2ui_surfaces')
    .where('tenant_id', '=', tenantId);

  if (state) {
    query = query.where('state', '=', state);
  }

  // Corporate mode: scope to the user's own surfaces + unassigned
  if (userId) {
    query = query.where((eb) => eb.or([
      eb('user_id', '=', userId),
      eb('user_id', 'is', null),
    ]));
  }

  return query.orderBy('created_at', 'desc').select([
    'surface_id',
    'tenant_id',
    'task_id',
    'type',
    'state',
    'archived',
    'title',
    'context',
    'user_id',
    'source',
    'severity',
    'expires_at',
    'viewed_at',
    'created_at',
    'updated_at',
  ]).execute();
}

export async function updateSurfaceState(
  db: Kysely<DB>,
  surfaceId: string,
  state: SurfaceState,
) {
  return db.updateTable('a2ui_surfaces')
    .set({ state, updated_at: new Date().toISOString() })
    .where('surface_id', '=', surfaceId)
    .execute();
}

/** Set surface state without bumping updated_at — for background processes
 *  (expiry sweep, dispatch) that should not affect History sort order. */
export async function setSurfaceStateBackground(
  db: Kysely<DB>,
  surfaceId: string,
  state: SurfaceState,
) {
  return db.updateTable('a2ui_surfaces')
    .set({ state })
    .where('surface_id', '=', surfaceId)
    .execute();
}

export async function archiveSurface(
  db: Kysely<DB>,
  surfaceId: string,
) {
  return db.updateTable('a2ui_surfaces')
    .set({ archived: 1, updated_at: new Date().toISOString() })
    .where('surface_id', '=', surfaceId)
    .execute();
}

export async function updateSurfaceData(
  db: Kysely<DB>,
  surfaceId: string,
  data: Record<string, unknown>,
) {
  return db.updateTable('a2ui_surfaces')
    .set({
      data_json: JSON.stringify(data),
      updated_at: new Date().toISOString(),
    })
    .where('surface_id', '=', surfaceId)
    .execute();
}

export async function markSurfaceViewed(
  db: Kysely<DB>,
  surfaceId: string,
) {
  return db.updateTable('a2ui_surfaces')
    .set({ viewed_at: new Date().toISOString() })
    .where('surface_id', '=', surfaceId)
    .where('viewed_at', 'is', null)
    .execute();
}

// ── Tasks ───────────────────────────────────────────────────

export async function createTask(
  db: Kysely<DB>,
  params: {
    taskId: string;
    tenantId: string;
    surfaceId: string;
    inputJson?: unknown;
    callbackUrl?: string;
    callbackToken?: string;
    idempotencyKey?: string;
  },
) {
  const now = new Date().toISOString();
  await db.insertInto('a2a_tasks').values({
    task_id: params.taskId,
    tenant_id: params.tenantId,
    surface_id: params.surfaceId,
    status: 'TASK_STATE_INPUT_REQUIRED',
    input_json: JSON.stringify(params.inputJson ?? {}),
    output_json: '{}',
    callback_url: params.callbackUrl ?? null,
    callback_token: params.callbackToken ?? null,
    dispatch_state: (params.callbackUrl ? 'PENDING' : 'NONE') as string,
    retry_count: 0,
    idempotency_key: params.idempotencyKey ?? null,
    created_at: now,
  }).execute();

  return getTask(db, params.taskId);
}

export async function getTask(db: Kysely<DB>, taskId: string) {
  return db.selectFrom('a2a_tasks')
    .where('task_id', '=', taskId)
    .selectAll()
    .executeTakeFirst();
}

export async function getTaskByIdempotencyKey(db: Kysely<DB>, key: string) {
  return db.selectFrom('a2a_tasks')
    .where('idempotency_key', '=', key)
    .selectAll()
    .executeTakeFirst();
}

export async function updateTaskStatus(
  db: Kysely<DB>,
  taskId: string,
  status: TaskState,
  outputJson?: unknown,
  reason?: string,
) {
  const updates: Record<string, unknown> = {
    status,
    completed_at: ['TASK_STATE_COMPLETED', 'TASK_STATE_REJECTED', 'TASK_STATE_CANCELLED', 'TASK_STATE_FAILED'].includes(status)
      ? new Date().toISOString()
      : null,
  };
  if (outputJson !== undefined) updates.output_json = JSON.stringify(outputJson);
  if (reason) updates.reason = reason;

  return db.updateTable('a2a_tasks')
    .set(updates as never)
    .where('task_id', '=', taskId)
    .execute();
}

export async function updateTaskDispatchState(
  db: Kysely<DB>,
  taskId: string,
  dispatchState: DispatchState,
  retryCount?: number,
) {
  const updates: Record<string, unknown> = { dispatch_state: dispatchState };
  if (retryCount !== undefined) updates.retry_count = retryCount;

  return db.updateTable('a2a_tasks')
    .set(updates as never)
    .where('task_id', '=', taskId)
    .execute();
}

export async function getTasksForTenant(db: Kysely<DB>, tenantId: string) {
  return db.selectFrom('a2a_tasks')
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .selectAll()
    .execute();
}

export async function getExpiredTasks(db: Kysely<DB>) {
  const now = new Date().toISOString();
  return db.selectFrom('a2a_tasks')
    .innerJoin('a2ui_surfaces', 'a2a_tasks.surface_id', 'a2ui_surfaces.surface_id')
    .where('a2ui_surfaces.expires_at', '<', now)
    .where('a2a_tasks.status', '=', 'TASK_STATE_INPUT_REQUIRED')
    .selectAll('a2a_tasks')
    .execute();
}

// ── Events ──────────────────────────────────────────────────

export async function createEvent(
  db: Kysely<DB>,
  params: {
    surfaceId: string;
    tenantId: string;
    eventType: SurfaceEventType;
    actor?: string;
    detail?: Record<string, unknown>;
  },
) {
  await db.insertInto('surface_events').values({
    id: uuid(),
    surface_id: params.surfaceId,
    tenant_id: params.tenantId,
    event_type: params.eventType,
    actor: params.actor ?? null,
    detail_json: JSON.stringify(params.detail ?? {}),
    created_at: new Date().toISOString(),
  }).execute();
}

// ── API Keys ────────────────────────────────────────────────

export async function getApiKeyByHash(db: Kysely<DB>, keyHash: string) {
  return db.selectFrom('agent_keys')
    .where('key_hash', '=', keyHash)
    .where('revoked_at', 'is', null)
    .selectAll()
    .executeTakeFirst();
}

export async function getApiKeysByTenant(db: Kysely<DB>, tenantId: string) {
  return db.selectFrom('agent_keys')
    .where('tenant_id', '=', tenantId)
    .where('revoked_at', 'is', null)
    .selectAll()
    .execute();
}

export async function createApiKey(
  db: Kysely<DB>,
  params: {
    keyId: string;
    tenantId: string;
    userId?: string;
    keyHash: string;
    keyName: string;
    scopes?: string;
  },
) {
  await db.insertInto('agent_keys').values({
    key_id: params.keyId,
    tenant_id: params.tenantId,
    user_id: params.userId ?? null,
    key_hash: params.keyHash,
    key_name: params.keyName,
    scopes: params.scopes ?? '["surfaces:write","surfaces:read","tasks:read"]',
    created_at: new Date().toISOString(),
  }).execute();
}

// ── Users ───────────────────────────────────────────────────

export async function getUser(db: Kysely<DB>, username: string, tenantId: string) {
  return db.selectFrom('users')
    .where('username', '=', username)
    .where('tenant_id', '=', tenantId)
    .selectAll()
    .executeTakeFirst();
}

export async function getTenant(db: Kysely<DB>, tenantId: string) {
  return db.selectFrom('tenants')
    .where('tenant_id', '=', tenantId)
    .selectAll()
    .executeTakeFirst();
}

export async function createUser(
  db: Kysely<DB>,
  params: {
    username: string;
    passwordHash: string;
    tenantId: string;
    role?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  },
) {
  await db.insertInto('users').values({
    username: params.username,
    password_hash: params.passwordHash,
    tenant_id: params.tenantId,
    role: params.role ?? 'user',
    display_name: params.displayName ?? null,
    avatar_url: params.avatarUrl ?? null,
    created_at: new Date().toISOString(),
  }).execute();
}

export async function getUserCount(db: Kysely<DB>, tenantId: string): Promise<number> {
  const result = await db.selectFrom('users')
    .where('tenant_id', '=', tenantId)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return result?.count ?? 0;
}

// ── Templates ───────────────────────────────────────────────

export async function getTemplates(db: Kysely<DB>, tenantId?: string) {
  let query = db.selectFrom('surface_templates')
    .selectAll();

  // Return global templates + tenant-specific
  return query
    .where((eb) => eb.or([
      eb('tenant_id', 'is', null),
      ...(tenantId ? [eb('tenant_id', '=', tenantId)] : []),
    ]))
    .execute();
}

// ── Notification Preferences ────────────────────────────────

export async function getNotificationPrefs(
  db: Kysely<DB>,
  tenantId: string,
  userId?: string,
) {
  // User prefs override tenant defaults
  if (userId) {
    const userPrefs = await db.selectFrom('notification_preferences')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst();

    if (userPrefs) return userPrefs;
  }

  return db.selectFrom('notification_preferences')
    .where('tenant_id', '=', tenantId)
    .where('user_id', 'is', null)
    .selectAll()
    .executeTakeFirst();
}
