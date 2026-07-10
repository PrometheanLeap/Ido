import { Kysely, sql } from 'kysely';

// ── Database Schema ─────────────────────────────────────────

export interface DB {
  tenants: TenantTable;
  users: UserTable;
  agent_keys: AgentKeyTable;
  settings: SettingTable;
  a2ui_surfaces: A2UISurfaceTable;
  a2a_tasks: A2ATaskTable;
  surface_events: SurfaceEventTable;
  push_subscriptions: PushSubscriptionTable;
  surface_templates: SurfaceTemplateTable;
  notification_preferences: NotificationPreferenceTable;
  schema_migrations: SchemaMigrationTable;
}

interface TenantTable {
  tenant_id: string;
  display_name: string;
  mode: string;
  created_at: string;
}

interface UserTable {
  username: string;
  password_hash: string | null;
  tenant_id: string;
  role: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface AgentKeyTable {
  key_id: string;
  tenant_id: string | null;
  user_id: string | null;
  key_hash: string;
  key_name: string;
  scopes: string; // JSON array
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface SettingTable {
  key: string;
  value: string;
  updated_at: string;
}

interface A2UISurfaceTable {
  surface_id: string;
  tenant_id: string;
  task_id: string;
  type: string;
  state: string;
  archived: number;
  title: string;
  components_json: string;
  schema_json: string;
  data_json: string;
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

interface A2ATaskTable {
  task_id: string;
  tenant_id: string;
  surface_id: string;
  status: string;
  input_json: string;
  output_json: string;
  callback_url: string | null;
  callback_token: string | null;
  dispatch_state: string;
  retry_count: number;
  idempotency_key: string | null;
  reason: string | null;
  created_at: string;
  completed_at: string | null;
}

interface SurfaceEventTable {
  id: string;
  surface_id: string;
  tenant_id: string;
  event_type: string;
  actor: string | null;
  detail_json: string;
  created_at: string;
}

interface PushSubscriptionTable {
  id: string;
  tenant_id: string;
  user_id: string | null;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  created_at: string;
}

interface SurfaceTemplateTable {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string;
  surface_type: string;
  inputs_schema_json: string;
  a2ui_layout_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface NotificationPreferenceTable {
  id: string;
  tenant_id: string;
  user_id: string | null;
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
  created_at: string;
  updated_at: string;
}

interface SchemaMigrationTable {
  name: string;
  applied_at: string;
}
