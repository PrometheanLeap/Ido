import { z } from 'zod';

// ── Hono Context Variables ──────────────────────────────────

export interface AppVariables {
  tenantId: string;
  userId: string;
  role: string;
  authMethod: string;
  scopes: string[];
  source: string;
}

// ── Surface Types ───────────────────────────────────────────

export const SurfaceTypeEnum = z.enum(['form', 'approval', 'notification']);
export type SurfaceType = z.infer<typeof SurfaceTypeEnum>;

export const SurfaceStateEnum = z.enum([
  'CREATED',
  'INPUT_REQUIRED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'DISMISSED',
  'ARCHIVED',
]);
export type SurfaceState = z.infer<typeof SurfaceStateEnum>;

export const TaskStateEnum = z.enum([
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_CANCELLED',
  'TASK_STATE_FAILED',
]);
export type TaskState = z.infer<typeof TaskStateEnum>;

export const DispatchStateEnum = z.enum([
  'NONE',
  'PENDING',
  'DISPATCHING',
  'DELIVERED',
  'DISPATCH_FAILED',
]);
export type DispatchState = z.infer<typeof DispatchStateEnum>;

// ── Severity ────────────────────────────────────────────────

export const SeverityEnum = z.enum([
  'info',
  'success',
  'warning',
  'error',
  'critical',
]);
export type Severity = z.infer<typeof SeverityEnum>;

// ── Deployment Mode ─────────────────────────────────────────

export const DeploymentModeEnum = z.enum([
  'dev',
  'personal',
  'saas',
  'corporate',
]);
export type DeploymentMode = z.infer<typeof DeploymentModeEnum>;

// ── API Key Scopes ──────────────────────────────────────────

export const ApiKeyScopeEnum = z.enum([
  'surfaces:write',
  'surfaces:read',
  'tasks:read',
  'admin',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeEnum>;

// ── Event Types ─────────────────────────────────────────────

export const SurfaceEventTypeEnum = z.enum([
  'created',
  'viewed',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
  'dismissed',
  'expired',
  'callback_delivered',
  'callback_failed',
]);
export type SurfaceEventType = z.infer<typeof SurfaceEventTypeEnum>;

// ── Push Preferences ────────────────────────────────────────

export const QuietBehaviourEnum = z.enum(['queue', 'suppress']);
export type QuietBehaviour = z.infer<typeof QuietBehaviourEnum>;

// ── Surface ─────────────────────────────────────────────────

export interface A2UISurface {
  surface_id: string;
  tenant_id: string;
  task_id: string;
  type: string;
  state: string;
  archived: number;
  title: string;
  components_json: unknown;
  schema_json: unknown;
  data_json: unknown;
  context: string | null;
  user_id: string | null;
  session_id: string | null;
  source: string | null;
  source_ip: string | null;
  severity: string | null;
  expires_at: string | null;
  viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Task ────────────────────────────────────────────────────

export interface A2ATask {
  task_id: string;
  tenant_id: string;
  surface_id: string;
  status: string;
  input_json: unknown;
  output_json: unknown;
  callback_url: string | null;
  callback_token: string | null;
  dispatch_state: string;
  retry_count: number;
  idempotency_key: string | null;
  created_at: string;
  completed_at: string | null;
  reason: string | null;
}

// ── User ────────────────────────────────────────────────────

export interface User {
  username: string;
  password_hash?: string;
  tenant_id: string;
  role: 'admin' | 'user';
}

// ── Agent Key ───────────────────────────────────────────────

export interface AgentKey {
  key_id: string;
  tenant_id?: string;
  user_id?: string;
  key_hash: string;
  key_name: string;
  scopes: ApiKeyScope[];
  expires_at?: string;
  revoked_at?: string;
}

// ── Tenant ──────────────────────────────────────────────────

export interface Tenant {
  tenant_id: string;
  display_name: string;
  mode: DeploymentMode;
  created_at: string;
}

// ── Mode Policy ─────────────────────────────────────────────

export interface ModePolicy {
  requireUserId: boolean;
  validateUserIdMatchesKey: boolean;
  allowLocalAuth: boolean;
  defaultTenantStrategy: 'token' | 'email' | 'org';
}

// ── Callback Config ─────────────────────────────────────────

export const PushNotificationConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().optional(),
});

export const ConfigurationSchema = z.object({
  pushNotificationConfig: PushNotificationConfigSchema.optional(),
});

// ── Message Send ────────────────────────────────────────────
