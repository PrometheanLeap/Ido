import type { Surface } from '../stores/useStore';

// ── API Response Types ───────────────────────────────────────
// Shared between api.ts and all consumers. Eliminates `any` returns.

export interface WhoamiResponse {
  mode: string;
  tenantId: string | null;
  userId: string | null;
  role: string | null;
  authMethod: string | null;
  source: string | null;
  displayName: string | null;
  tenantDisplayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  allowLocalAuth: boolean;
  defaultTenantStrategy: string;
  hasKeys: boolean;
  needsSetup: boolean;
  version: string;
}

export interface LoginResponse {
  token: string;
  user: {
    username: string;
    tenant_id: string;
    role: string;
  };
}

export interface ApiKey {
  key_id: string;
  key_name: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
}

export interface CreateKeyResponse {
  api_key: string;
  key_id: string;
  key_name?: string;
}

export interface UpdateKeyResponse {
  key_id: string;
  key_name: string;
}

export interface SubmitSurfaceResponse {
  surface_id: string;
  state: string;
  task_id?: string;
}

export interface Preferences {
  id?: string;
  quiet_hours_enabled: number;
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_timezone: string | null;
  quiet_days: string | null;
  quiet_behaviour: string;
  push_enabled: number;
  push_forms: number;
  push_approvals: number;
  push_notifications: number;
  push_severity_min: string;
}

export interface HealthResponse {
  status: string;
}

export interface VapidKeyResponse {
  publicKey: string;
}
