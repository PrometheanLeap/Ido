import { v4 as uuid } from 'uuid';
import { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import * as queries from '../db/queries.js';
import { validateLayout, autoGenerateLayout, A2UIValidationError } from '../a2ui/renderer.js';
import type { A2UIComponent } from '../a2ui/schema.js';
import type { SurfaceType, Severity, A2UISurface, A2ATask } from '../types.js';
import { modePolicy, validateUserId } from '../auth/index.js';
import { dispatchCallback } from './dispatch.js';
import { config } from '../config.js';
import { sseManager } from '../sse/manager.js';
import { sendPushNotification } from '../push/index.js';
import { buildSurfaceUpdateEvent } from '../sse/events.js';

// ── Create Surface Params ───────────────────────────────────

export interface CreateSurfaceParams {
  surfaceType: SurfaceType;
  title: string;
  context?: string;
  inputsSchema?: Record<string, unknown>;
  a2uiLayout?: A2UIComponent[];
  initialDataModel?: Record<string, unknown>;
  userId?: string;
  severity?: Severity;
  expiresAt?: string;
  idempotencyKey?: string;
  callbackUrl?: string;
  callbackToken?: string;
  tenantId: string;
  source?: string;
  sourceIp?: string;
  actionValidation?: unknown;
}

export interface CreateSurfaceResult {
  taskId: string;
  surfaceId: string;
  task: A2ATask | undefined;
  surface: A2UISurface | undefined;
}

// ── broadcastSurfaceCreated ─────────────────────────────────
// Shared side-effect block used by all three protocol handlers
// (A2A, MCP, REST) after a surface is created. Pushes an SSE update
// to connected clients and sends a web push notification (fire-and-forget).

export async function broadcastSurfaceCreated(
  db: Kysely<DB>,
  tenantId: string,
  result: CreateSurfaceResult,
  userId: string | undefined,
  title: string,
  source?: string,
): Promise<void> {
  if (!result.surface) return;
  const s = result.surface;
  sseManager.pushSurfaceUpdate(tenantId, buildSurfaceUpdateEvent(s), s.user_id);
  sendPushNotification(db, tenantId, userId, {
    title: title || 'New request',
    body: '',
    surfaceId: result.surfaceId,
    source,
  }).catch(() => {});
}

// ── createSurface ───────────────────────────────────────────

export async function createSurface(
  db: Kysely<DB>,
  params: CreateSurfaceParams,
): Promise<CreateSurfaceResult> {
  // 1. Mode validation
  const userIdCheck = validateUserId(params.userId);
  if (!userIdCheck.valid) {
    throw new DomainError(userIdCheck.error!, 400);
  }

  // 1b. Corporate: mandatory user_id + domain validation + unknown-user check
  if (config.mode === 'corporate') {
    if (!params.userId) {
      throw new DomainError('user_id is required in corporate mode', 400);
    }
    // Domain whitelist
    if (config.corpAllowedDomains.length > 0) {
      const domain = params.userId.split('@')[1]?.toLowerCase();
      if (!domain || !config.corpAllowedDomains.some((d: string) => d.toLowerCase() === domain)) {
        throw new DomainError(`user_id domain not allowed. Accepted: ${config.corpAllowedDomains.join(', ')}`, 400);
      }
    }
    // Unknown user check — uses existing users table (populated by OIDC)
    if (!config.corpAllowUnknownUsers) {
      const existingUser = await queries.getUser(db, params.userId, params.tenantId);
      if (!existingUser) {
        throw new DomainError('Recipient has not logged in yet', 400);
      }
    }
  }

  // 2. Idempotency check
  if (params.idempotencyKey) {
    const existing = await queries.getTaskByIdempotencyKey(db, params.idempotencyKey);
    if (existing) {
      const surface = await queries.getSurface(db, existing.surface_id);
      return {
        taskId: existing.task_id,
        surfaceId: existing.surface_id,
        task: existing,
        surface,
      };
    }
  }

  // 3. Notification: require context
  if (params.surfaceType === 'notification' && !params.context) {
    throw new DomainError('Notification surfaces require context text', 422);
  }

  // 4. Notification: expiry not allowed
  if (params.surfaceType === 'notification' && params.expiresAt) {
    // Silently ignore expiry on notifications
    params.expiresAt = undefined;
  }

  // 5. Notification: severity defaults to info
  if (params.surfaceType === 'notification' && !params.severity) {
    params.severity = 'info';
  }

  // 6. Severity only on notifications
  if (params.surfaceType !== 'notification' && params.severity) {
    throw new DomainError('Severity is only valid on notification surfaces', 422);
  }

  // 7. Approval: validate inputs_schema (only 'reason' allowed)
  if (params.surfaceType === 'approval' && params.inputsSchema) {
    const properties = (params.inputsSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    const nonReasonProps = Object.keys(properties).filter((k) => k !== 'reason');
    if (nonReasonProps.length > 0) {
      throw new DomainError(
        `Approval surfaces only accept "reason" in inputs_schema. Found: ${nonReasonProps.join(', ')}`,
        422,
      );
    }
  }

  // 8. Resolve layout
  let layout = params.a2uiLayout;
  if (!layout || layout.length === 0) {
    const autoLayout = autoGenerateLayout(params.inputsSchema);
    if (autoLayout) layout = autoLayout;
  }

  // 9. Validate layout
  if (layout) {
    try {
      validateLayout(layout, params.surfaceType);
    } catch (err) {
      if (err instanceof A2UIValidationError) {
        throw new DomainError(err.message, 422, err.code);
      }
      throw err;
    }

    // 9b. Cross-reference: every bind must point at a declared inputs_schema property.
    // Approvals inject `reason` server-side, so it is always allowed there.
    const properties = (params.inputsSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    const declared = new Set(Object.keys(properties));
    if (params.surfaceType === 'approval') declared.add('reason');
    for (const comp of layout) {
      if (comp.bind && !declared.has(comp.bind)) {
        throw new DomainError(
          `Component "${comp.id}" binds to "${comp.bind}", which is not declared in inputs_schema.properties`,
          422,
          'UNRESOLVED_BIND',
        );
      }
    }

    // 9c. Reverse check: every required field must have a corresponding bind
    // in the layout. Without this, the user can never fill in the field and
    // submission will be permanently blocked.
    const requiredList = (params.inputsSchema as { required?: string[] })?.required ?? [];
    const boundKeys = new Set(layout.filter((c) => c.bind).map((c) => c.bind!));
    for (const field of requiredList) {
      if (!boundKeys.has(field)) {
        throw new DomainError(
          `Required field "${field}" has no corresponding input component in the layout (no bind matches). ` +
          `The user would never be able to submit this surface.`,
          422,
          'REQUIRED_FIELD_NO_BIND',
        );
      }
    }
  }

  // 10. Create surface + task in sequence
  const surfaceId = uuid();
  const taskId = uuid();

  // Create data model with initial values
  const dataModel: Record<string, unknown> = { ...params.initialDataModel };

  // Merge action_validation into schema for frontend consumption
  const schemaForStorage: Record<string, unknown> = { ...params.inputsSchema };
  if ((params as any).actionValidation) {
    schemaForStorage['action_validation'] = (params as any).actionValidation;
  }

  const surface = await queries.createSurface(db, {
    surfaceId,
    tenantId: params.tenantId,
    taskId,
    type: params.surfaceType,
    title: params.title,
    components: layout,
    schema: schemaForStorage,
    data: dataModel,
    context: params.context,
    userId: params.userId,
    severity: params.severity,
    expiresAt: params.expiresAt,
    source: params.source,
    sourceIp: params.sourceIp,
  });

  const task = await queries.createTask(db, {
    taskId,
    tenantId: params.tenantId,
    surfaceId,
    inputJson: params.inputsSchema,
    callbackUrl: params.callbackUrl,
    callbackToken: params.callbackToken,
    idempotencyKey: params.idempotencyKey,
  });

  // Notification: auto-complete task immediately — no human response needed
  if (params.surfaceType === 'notification') {
    await queries.updateTaskStatus(db, taskId, 'TASK_STATE_COMPLETED', { dismissed: false });
    if (task) task.status = 'TASK_STATE_COMPLETED';
  }

  // 11. Audit event
  await queries.createEvent(db, {
    surfaceId,
    tenantId: params.tenantId,
    eventType: 'created',
    actor: params.source ?? 'agent',
    detail: { type: params.surfaceType, title: params.title },
  });

  return { taskId, surfaceId, task, surface };
}

// ── Submit Surface ──────────────────────────────────────────

export interface SubmitSurfaceParams {
  surfaceId: string;
  tenantId: string;
  userId?: string;
  userInput: Record<string, unknown>;
  decision?: 'approved' | 'rejected';
  actor?: string;
}

export async function submitSurface(
  db: Kysely<DB>,
  params: SubmitSurfaceParams,
) {
  const surface = await queries.getSurface(db, params.surfaceId);
  if (!surface || surface.tenant_id !== params.tenantId) {
    throw new DomainError('Surface not found', 404);
  }
  // Corporate: users can only submit their own surfaces
  if (config.mode === 'corporate' && surface.user_id && surface.user_id !== params.userId) {
    throw new DomainError('Surface not found', 404);
  }

  if (surface.state !== 'INPUT_REQUIRED') {
    if (surface.state === 'EXPIRED') {
      throw new DomainError('This surface has expired', 410);
    }
    throw new DomainError(`Cannot submit surface in state: ${surface.state}`, 409);
  }

  // Double-check expiry timestamp
  if (surface.expires_at && new Date(surface.expires_at) < new Date()) {
    throw new DomainError('This surface has expired', 410);
  }

  // Validate required fields against schema (forms only — approvals/notifications have their own rules)
  if (surface.type === 'form') {
    let schema: { properties?: Record<string, unknown>; required?: string[] } = {};
    try {
      schema = JSON.parse(surface.schema_json || '{}');
    } catch { /* invalid JSON — skip validation */ }
    if (schema.required && Array.isArray(schema.required)) {
      const missing = schema.required.filter((key: string) => {
        const val = params.userInput[key];
        return val === '' || val === null || val === undefined;
      });
      if (missing.length > 0) {
        throw new DomainError(`Required fields missing: ${missing.join(', ')}`, 422);
      }
    }
  }

  const now = new Date().toISOString();
  let newState: 'COMPLETED' | 'REJECTED' = 'COMPLETED';
  let output: Record<string, unknown> = { ...params.userInput };

  if (surface.type === 'approval') {
    if (!params.decision) {
      throw new DomainError('Decision required for approval surfaces', 400);
    }
    newState = params.decision === 'approved' ? 'COMPLETED' : 'REJECTED';
    output = {
      decision: params.decision,
      reason: params.userInput.reason ?? null,
    };
  }

  // Update surface
  await queries.updateSurfaceState(db, params.surfaceId, newState);
  await queries.updateSurfaceData(db, params.surfaceId, params.userInput);

  // Update task
  const taskStatus = newState === 'COMPLETED'
    ? 'TASK_STATE_COMPLETED'
    : 'TASK_STATE_REJECTED';
  await queries.updateTaskStatus(db, surface.task_id, taskStatus, output);

  // Audit
  await queries.createEvent(db, {
    surfaceId: params.surfaceId,
    tenantId: params.tenantId,
    eventType: params.decision === 'approved' ? 'approved' : params.decision === 'rejected' ? 'rejected' : 'submitted',
    actor: params.actor ?? 'human',
    detail: output,
  });

  // Enqueue callback dispatch
  const task = await queries.getTask(db, surface.task_id);
  if (task?.callback_url) {
    await queries.updateTaskDispatchState(db, task.task_id, 'PENDING', 0);
    // Fire immediately — no 60s cron wait
    dispatchCallback(db, task.task_id).catch((err) => console.error('Dispatch error:', err));
  }

  return {
    surfaceId: params.surfaceId,
    taskId: surface.task_id,
    state: newState,
    userInput: params.userInput,
    decision: params.decision,
  };
}

// ── Cancel Surface ──────────────────────────────────────────

export async function cancelSurface(
  db: Kysely<DB>,
  surfaceId: string,
  tenantId: string,
  actor?: string,
  userId?: string,
) {
  const surface = await queries.getSurface(db, surfaceId);
  if (!surface || surface.tenant_id !== tenantId) {
    throw new DomainError('Surface not found', 404);
  }
  if (config.mode === 'corporate' && surface.user_id && surface.user_id !== userId) {
    throw new DomainError('Surface not found', 404);
  }

  if (['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISMISSED'].includes(surface.state)) {
    throw new DomainError(`Cannot cancel surface in state: ${surface.state}`, 409);
  }

  await queries.updateSurfaceState(db, surfaceId, 'CANCELLED');
  await queries.updateTaskStatus(db, surface.task_id, 'TASK_STATE_CANCELLED', undefined, 'CANCELLED');

  await queries.createEvent(db, {
    surfaceId,
    tenantId,
    eventType: 'cancelled',
    actor: actor ?? 'agent',
  });

  return { surfaceId, state: 'CANCELLED' };
}

// ── Dismiss Notification ────────────────────────────────────

export async function dismissNotification(
  db: Kysely<DB>,
  surfaceId: string,
  tenantId: string,
  userId?: string,
) {
  const surface = await queries.getSurface(db, surfaceId);
  if (!surface || surface.tenant_id !== tenantId) {
    throw new DomainError('Surface not found', 404);
  }
  if (config.mode === 'corporate' && surface.user_id && surface.user_id !== userId) {
    throw new DomainError('Surface not found', 404);
  }

  if (surface.type !== 'notification') {
    throw new DomainError('Only notifications can be dismissed', 400);
  }

  if (!['COMPLETED'].includes(surface.state)) {
    throw new DomainError(`Cannot dismiss notification in state: ${surface.state}`, 409);
  }

  await queries.updateSurfaceState(db, surfaceId, 'DISMISSED');

  await queries.createEvent(db, {
    surfaceId,
    tenantId,
    eventType: 'dismissed',
    actor: 'human',
  });

  return { surfaceId, state: 'DISMISSED' };
}

// ── Domain Error ────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

// ── handleDomainError ───────────────────────────────────────
// Shared error handler for route catch blocks. Returns a JSON
// response for DomainError / ValidationError, re-throws others.

import type { Context } from 'hono';
import type { AppVariables } from '../types.js';
import { ValidationError } from '../api/validation.js';

export function handleDomainError(
  c: Context<{ Variables: AppVariables }>,
  err: unknown,
): Response {
  if (err instanceof ValidationError) {
    return c.json({ error: (err as any).message, issues: (err as any).issues }, 400);
  }
  if (err instanceof DomainError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode as 400);
  }
  throw err;
}
