import { z } from 'zod';
import { ConfigurationSchema, SeverityEnum } from '../types.js';

// ── Message Send Schema (canonical — used by ALL channels) ──

export const MessageSendSchema = z.object({
  surface_type: z.enum(['form', 'approval', 'notification']),
  surface_title: z.string().min(1).max(200).refine((s) => s.trim().length > 0 && !s.includes('\x00'), 'Title must not be blank or contain null bytes'),
  context: z.string().max(2000).refine((s) => !s.includes('\x00'), 'Context must not contain null bytes').optional(),
  // Format is not enforced here — validateUserId() applies the mode-specific
  // rule (corporate mode requires an email; other modes accept any identifier).
  user_id: z.string().min(1).max(320).refine((s) => !s.includes('\x00'), 'user_id must not contain null bytes').optional(),
  severity: SeverityEnum.optional(),
  inputs_schema: z.object({
    type: z.literal('object').optional(),
    properties: z.record(z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }).optional(),
  a2ui_layout: z.array(z.record(z.unknown())).optional(),
  initial_data_model: z.record(z.unknown()).optional(),
  expires_at: z.string().datetime().optional(),
  idempotency_key: z.string().max(128).optional(),
  configuration: ConfigurationSchema.optional(),
  action_validation: z.object({
    approve: z.record(z.unknown()).optional(),
    reject: z.object({
      required_fields: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type MessageSendPayload = z.infer<typeof MessageSendSchema>;

// ── Shared parse function (called by all three channels) ────

export class ValidationError extends Error {
  constructor(message: string, public issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Fields that carry nested objects/arrays. LLM/agent MCP clients (n8n, etc.)
// frequently serialise these as JSON strings inside the tool arguments. Coerce
// them back to structured values before validation so a stringified layout
// doesn't fail with a confusing "Expected array, received string".
const JSON_FIELDS = ['inputs_schema', 'a2ui_layout', 'initial_data_model', 'configuration', 'action_validation'];

function coerceStringifiedJson(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const obj = { ...(body as Record<string, unknown>) };
  for (const key of JSON_FIELDS) {
    const val = obj[key];
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          obj[key] = JSON.parse(trimmed);
        } catch {
          /* leave as-is — the schema will report the real problem */
        }
      }
    }
  }
  return obj;
}

export function parseCreateSurfacePayload(body: unknown): MessageSendPayload {
  let input: unknown = body;
  // Some clients double-encode the entire arguments object as a JSON string.
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try {
        input = JSON.parse(trimmed);
      } catch {
        /* fall through to a normal validation error */
      }
    }
  }
  input = coerceStringifiedJson(input);
  const result = MessageSendSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(message, result.error.issues);
  }
  return result.data;
}
