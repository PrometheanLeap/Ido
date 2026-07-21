import type { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import type { A2UIComponent } from '../a2ui/schema.js';
import { createSurface, submitSurface, cancelSurface, broadcastSurfaceCreated, DomainError } from '../domain/surfaces.js';
import { getTask, listTasks } from '../domain/tasks.js';
import { getSkillsGuide } from '../a2a/skills-guide.js';
import * as queries from '../db/queries.js';
import { config } from '../config.js';
import { sseManager } from '../sse/manager.js';
import { parseCreateSurfacePayload, ValidationError } from './validation.js';

// ── MCP Protocol Types ──────────────────────────────────────

interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number | null;
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ── MCP Tool Definitions ────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'ido_get_skills_guide',
    description: 'Returns the full Ido skills guide — decision tree, component catalog, templates, and validation rules. Call this BEFORE sending any task.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ido_send_task',
    description: 'Create a surface (form/approval/notification) for a human to act on.',
    inputSchema: {
      type: 'object',
      properties: {
        surface_type: { type: 'string', enum: ['form', 'approval', 'notification'] },
        surface_title: { type: 'string' },
        context: { type: 'string' },
        user_id: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'success', 'warning', 'error', 'critical'] },
        inputs_schema: { type: 'object' },
        a2ui_layout: { type: 'array' },
        initial_data_model: { type: 'object' },
        configuration: { type: 'object' },
        expires_at: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['surface_type', 'surface_title'],
    },
  },
  {
    name: 'ido_check_task',
    description: 'Poll task status and result.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'ido_list_tasks',
    description: 'List tasks for this API key.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ido_read_task',
    description: 'Read full surface details including components and schema.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'ido_answer_task',
    description: 'Submit a response to a pending surface (agent-as-human pattern). For approvals, include decision. For forms, include user_input matching the expected schema.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        user_input: { type: 'object' },
        decision: { type: 'string', enum: ['approved', 'rejected'] },
      },
      required: ['task_id', 'user_input'],
    },
  },
  {
    name: 'ido_cancel_task',
    description: 'Cancel a pending task. Works on any surface type (form, approval, notification). No user_input or decision required — this withdraws the task, not submits it. The surface transitions to CANCELLED and the human can no longer respond.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
];

// ── MCP Dispatcher ──────────────────────────────────────────

export async function dispatchMcp(
  db: Kysely<DB>,
  request: McpRequest,
  tenantId: string,
  source?: string,
): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'Ido', version: '2.0.0' },
        },
        id: request.id,
      };

    case 'ping':
      return {
        jsonrpc: '2.0',
        result: {},
        id: request.id,
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        result: { tools: MCP_TOOLS },
        id: request.id,
      };

    case 'tools/call':
      return handleToolCall(db, request, tenantId, source);

    default:
      return {
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${request.method}` },
        id: request.id,
      };
  }
}

async function handleToolCall(
  db: Kysely<DB>,
  request: McpRequest,
  tenantId: string,
  source?: string,
) {
  const params = request.params as { name?: string; arguments?: unknown } | undefined;
  const toolName = params?.name;
  let toolArgs: Record<string, unknown> = {};
  // Some MCP clients (n8n and other LLM agents) send `arguments` as a JSON
  // string rather than an object. Parse it so downstream validation sees a
  // structured payload instead of failing on the string.
  const rawArgs = params?.arguments;
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === 'object') toolArgs = parsed as Record<string, unknown>;
    } catch {
      /* leave empty — validation will report the missing fields */
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    toolArgs = rawArgs as Record<string, unknown>;
  }

  if (!toolName) {
    return {
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing tool name' },
      id: request.id,
    };
  }

  try {
    let result: McpToolResult;

    switch (toolName) {
      case 'ido_get_skills_guide':
        result = {
          content: [{ type: 'text', text: JSON.stringify(getSkillsGuide(config.mode), null, 2) }],
        };
        break;

      case 'ido_send_task':
        result = await handleMcpSendTask(db, toolArgs, tenantId, source);
        break;

      case 'ido_check_task':
        result = await handleMcpCheckTask(db, toolArgs, tenantId);
        break;

      case 'ido_list_tasks':
        result = await handleMcpListTasks(db, tenantId);
        break;

      case 'ido_read_task':
        result = await handleMcpReadTask(db, toolArgs, tenantId);
        break;

      case 'ido_answer_task':
        result = await handleMcpAnswerTask(db, toolArgs, tenantId);
        break;

      case 'ido_cancel_task':
        result = await handleMcpCancelTask(db, toolArgs, tenantId);
        break;

      default:
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
          id: request.id,
        };
    }

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        jsonrpc: '2.0',
        error: { code: -32602, message: `Invalid params: ${err.message}`, data: { message: err.message, issues: err.issues } },
        id: request.id,
      };
    }
    if (err instanceof DomainError) {
      return {
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: `Error: ${err.message} (${err.code ?? err.statusCode})` }],
          isError: true,
        },
        id: request.id,
      };
    }
    console.error('MCP tool error:', err);
    return {
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text', text: 'Internal error' }],
        isError: true,
      },
      id: request.id,
    };
  }
}

// ── Individual Tool Handlers ────────────────────────────────

async function handleMcpSendTask(
  db: Kysely<DB>,
  args: Record<string, unknown>,
  tenantId: string,
  source?: string,
): Promise<McpToolResult> {
  const parsed = parseCreateSurfacePayload(args);
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
    sourceIp: 'mcp',
  });

  // Push SSE update + web push notification (shared helper)
  await broadcastSurfaceCreated(db, tenantId, result, parsed.user_id, parsed.surface_title, source);

  return {
    content: [{ type: 'text', text: JSON.stringify({ task_id: result.taskId, surface_id: result.surfaceId, status: result.task?.status }) }],
  };
}

async function handleMcpCheckTask(
  db: Kysely<DB>,
  args: Record<string, unknown>,
  tenantId: string,
): Promise<McpToolResult> {
  const taskId = args.task_id as string;
  const task = await getTask(db, taskId, tenantId);

  return {
    content: [{ type: 'text', text: JSON.stringify({
      task_id: task.task_id,
      status: task.status,
      reason: task.reason,
      completed_at: task.completed_at,
    }) }],
  };
}

async function handleMcpListTasks(
  db: Kysely<DB>,
  tenantId: string,
): Promise<McpToolResult> {
  const tasks = await listTasks(db, tenantId);
  return {
    content: [{ type: 'text', text: JSON.stringify(tasks.map((t) => ({
      task_id: t.task_id,
      status: t.status,
      created_at: t.created_at,
    }))) }],
  };
}

async function handleMcpReadTask(
  db: Kysely<DB>,
  args: Record<string, unknown>,
  tenantId: string,
): Promise<McpToolResult> {
  const taskId = args.task_id as string;
  const task = await getTask(db, taskId, tenantId);
  const surface = await queries.getSurface(db, task.surface_id);

  // Safely parse JSON blobs — a corrupted DB row should not cause a 500
  const safeParse = (json: string | null | undefined, fallback: unknown) => {
    try { return JSON.parse(json || 'null'); } catch { return fallback; }
  };

  return {
    content: [{ type: 'text', text: JSON.stringify({
      task_id: task.task_id,
      surface_id: task.surface_id,
      status: task.status,
      surface: surface ? {
        type: surface.type,
        title: surface.title,
        context: surface.context,
        components_json: safeParse(surface.components_json, []),
        schema_json: safeParse(surface.schema_json, {}),
        data_json: safeParse(surface.data_json, {}),
      } : null,
    }) }],
  };
}

async function handleMcpAnswerTask(
  db: Kysely<DB>,
  args: Record<string, unknown>,
  tenantId: string,
): Promise<McpToolResult> {
  const taskId = args.task_id as string;
  const userInput = (args.user_input ?? {}) as Record<string, unknown>;
  const decision = args.decision as 'approved' | 'rejected' | undefined;

  const task = await getTask(db, taskId, tenantId);
  const result = await submitSurface(db, {
    surfaceId: task.surface_id,
    tenantId,
    userInput,
    decision,
    actor: 'agent',
  });

  sseManager.pushSurfaceResolved(tenantId, task.surface_id, result.state);

  return {
    content: [{ type: 'text', text: JSON.stringify({ status: result.state, surface_id: result.surfaceId }) }],
  };
}

async function handleMcpCancelTask(
  db: Kysely<DB>,
  args: Record<string, unknown>,
  tenantId: string,
): Promise<McpToolResult> {
  const taskId = args.task_id as string;

  const task = await getTask(db, taskId, tenantId);
  const result = await cancelSurface(db, task.surface_id, tenantId, 'agent');

  sseManager.pushSurfaceResolved(tenantId, task.surface_id, 'CANCELLED');

  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'CANCELLED', surface_id: result.surfaceId }) }],
  };
}

// ── MCP SSE Streaming ───────────────────────────────────────

const MCP_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

const mcpSseSessions = new Map<string, {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  tenantId: string;
  source?: string;
  lastActivity: number;
}>();

// Sweep stale sessions every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of mcpSseSessions) {
    if (now - session.lastActivity > MCP_SESSION_TTL_MS) {
      try { session.controller.close(); } catch { /* already closed */ }
      mcpSseSessions.delete(id);
    }
  }
}, 60_000);

export function handleMcpSseConnect(
  tenantId: string,
  source: string | undefined,
  controller: ReadableStreamDefaultController,
): void {
  const sessionId = crypto.randomUUID();
  const encoder = new TextEncoder();

  mcpSseSessions.set(sessionId, { controller, encoder, tenantId, source, lastActivity: Date.now() });

  // Send the endpoint event so the client knows where to POST
  const endpointUrl = `/api/v1/mcp/sse/${sessionId}`;
  controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));
}

export function getMcpSession(
  sessionId: string,
): { tenantId: string; source?: string } | undefined {
  const session = mcpSseSessions.get(sessionId);
  if (!session) return undefined;
  session.lastActivity = Date.now();
  return { tenantId: session.tenantId, source: session.source };
}

export function sendMcpResponse(
  db: Kysely<DB>,
  sessionId: string,
  request: { method: string; params?: unknown; id: number | string },
): void {
  const session = mcpSseSessions.get(sessionId);
  if (!session) return;
  session.lastActivity = Date.now();

  dispatchMcp(db, request as any, session.tenantId, session.source)
    .then((result) => {
      try {
        const envelope = JSON.stringify({ jsonrpc: '2.0', ...(result as any) });
        session.controller.enqueue(session.encoder.encode(`event: message\ndata: ${envelope}\n\n`));
      } catch { /* client disconnected */ }
    })
    .catch(() => {});
}

export function removeMcpSession(sessionId: string): void {
  mcpSseSessions.delete(sessionId);
}
