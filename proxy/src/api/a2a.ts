import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { A2UIComponent } from '../a2ui/schema.js';
import { createSurface, broadcastSurfaceCreated, DomainError } from '../domain/surfaces.js';
import { getTask, listTasks } from '../domain/tasks.js';
import { cancelSurface } from '../domain/surfaces.js';
import { getSkillsGuide } from '../a2a/skills-guide.js';
import * as queries from '../db/queries.js';
import { sseManager } from '../sse/manager.js';
import { dispatchCallback } from '../domain/dispatch.js';
import { config } from '../config.js';
import { parseCreateSurfacePayload, ValidationError } from './validation.js';

// ── JSON-RPC Method Handlers ────────────────────────────────

export async function handleMessageSend(
  db: Kysely<DB>,
  params: unknown,
  tenantId: string,
  source?: string,
  sourceIp?: string,
) {
  const parsed = parseCreateSurfacePayload(params);
  const result = await createSurface(db, {
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
  await broadcastSurfaceCreated(db, tenantId, result, parsed.user_id, parsed.surface_title, source);

  return {
    task: {
      id: result.taskId,
      surface_id: result.surfaceId,
      status: result.task?.status,
    },
  };
}

export async function handleGetTask(
  db: Kysely<DB>,
  params: unknown,
  tenantId: string,
) {
  const { task_id } = params as { task_id: string };
  const task = await getTask(db, task_id, tenantId);

  const surface = await queries.getSurface(db, task.surface_id);

  return {
    id: task.task_id,
    surface_id: task.surface_id,
    status: task.status,
    artifacts: task.status === 'TASK_STATE_COMPLETED'
      ? JSON.parse(String(task.output_json))
      : undefined,
    reason: task.reason,
    created_at: task.created_at,
    completed_at: task.completed_at,
    surface: surface ? {
      id: surface.surface_id,
      type: surface.type,
      title: surface.title,
      state: surface.state,
      context: surface.context,
      expires_at: surface.expires_at,
    } : undefined,
  };
}

export async function handleListTasks(
  db: Kysely<DB>,
  _params: unknown,
  tenantId: string,
) {
  const tasks = await listTasks(db, tenantId);
  return tasks.map((t) => ({
    id: t.task_id,
    surface_id: t.surface_id,
    status: t.status,
    created_at: t.created_at,
    completed_at: t.completed_at,
    reason: t.reason,
  }));
}

export async function handleCancelTask(
  db: Kysely<DB>,
  params: unknown,
  tenantId: string,
) {
  const { task_id } = params as { task_id: string };
  const task = await getTask(db, task_id, tenantId);
  const result = await cancelSurface(db, task.surface_id, tenantId);

  sseManager.pushSurfaceResolved(tenantId, task.surface_id, 'CANCELLED');

  return result;
}

export async function handleSkillsGuide() {
  return getSkillsGuide(config.mode);
}

export async function handleListTemplates(db: Kysely<DB>, tenantId?: string) {
  const templates = await queries.getTemplates(db, tenantId);
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    surface_type: t.surface_type,
  }));
}

// ── JSON-RPC Dispatcher ─────────────────────────────────────

const METHOD_MAP: Record<string, { handler: string; aliases: string[] }> = {
  'message/send': { handler: 'message/send', aliases: ['SendMessage'] },
  'tasks/get': { handler: 'tasks/get', aliases: ['GetTask'] },
  'tasks/list': { handler: 'tasks/list', aliases: ['ListTasks'] },
  'tasks/cancel': { handler: 'tasks/cancel', aliases: ['CancelTask'] },
  'skills/guide': { handler: 'skills/guide', aliases: [] },
  'skills/list-templates': { handler: 'skills/list-templates', aliases: [] },
};

function resolveMethod(method: string): string | null {
  for (const [key, { handler, aliases }] of Object.entries(METHOD_MAP)) {
    if (method === key || aliases.includes(method)) return handler;
  }
  return null;
}

export interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params?: unknown;
  id: string | number | null;
}

export function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b.jsonrpc === '2.0' && typeof b.method === 'string' && 'id' in b;
}

export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0',
    error: { code, message, data },
    id,
  };
}

export function jsonRpcResult(id: string | number | null, result: unknown) {
  return {
    jsonrpc: '2.0',
    result,
    id,
  };
}

export async function dispatchJsonRpc(
  db: Kysely<DB>,
  request: JsonRpcRequest,
  tenantId: string,
  source?: string,
  sourceIp?: string,
) {
  const method = resolveMethod(request.method);
  if (!method) {
    return jsonRpcError(request.id, -32601, `Method not found: ${request.method}`);
  }

  try {
    let result: unknown;

    switch (method) {
      case 'message/send':
        result = await handleMessageSend(db, request.params, tenantId, source, sourceIp);
        break;
      case 'tasks/get':
        result = await handleGetTask(db, request.params, tenantId);
        break;
      case 'tasks/list':
        result = await handleListTasks(db, request.params, tenantId);
        break;
      case 'tasks/cancel':
        result = await handleCancelTask(db, request.params, tenantId);
        break;
      case 'skills/guide':
        result = await handleSkillsGuide();
        break;
      case 'skills/list-templates':
        result = await handleListTemplates(db, tenantId);
        break;
      default:
        return jsonRpcError(request.id, -32601, `Unhandled method: ${method}`);
    }

    return jsonRpcResult(request.id, result);
  } catch (err) {
    if (err instanceof DomainError) {
      return jsonRpcError(request.id, -32000, err.message, { code: err.code, statusCode: err.statusCode });
    }
    if (err instanceof ValidationError) {
      return jsonRpcError(request.id, -32602, 'Invalid params', { message: err.message, issues: err.issues });
    }
    console.error('JSON-RPC error:', err);
    return jsonRpcError(request.id, -32603, 'Internal error');
  }
}
