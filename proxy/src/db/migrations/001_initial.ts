// Migration 001 — Complete Schema (consolidated)

export const migration001 = `
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'dev',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT NOT NULL,
  password_hash TEXT,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  role TEXT NOT NULL DEFAULT 'user',
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (username, tenant_id)
);

CREATE TABLE IF NOT EXISTS agent_keys (
  key_id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(tenant_id),
  user_id TEXT,
  key_hash TEXT NOT NULL,
  key_name TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["surfaces:write","surfaces:read","tasks:read"]',
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS a2ui_surfaces (
  surface_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  task_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('form', 'approval', 'notification')),
  state TEXT NOT NULL DEFAULT 'CREATED',
  archived INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  components_json TEXT NOT NULL DEFAULT '[]',
  schema_json TEXT NOT NULL DEFAULT '{}',
  data_json TEXT NOT NULL DEFAULT '{}',
  context TEXT,
  user_id TEXT,
  session_id TEXT,
  source TEXT,
  source_ip TEXT,
  severity TEXT,
  expires_at TEXT,
  viewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS a2a_tasks (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  surface_id TEXT NOT NULL REFERENCES a2ui_surfaces(surface_id),
  status TEXT NOT NULL DEFAULT 'TASK_STATE_INPUT_REQUIRED',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  callback_url TEXT,
  callback_token TEXT,
  dispatch_state TEXT NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS surface_events (
  id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL REFERENCES a2ui_surfaces(surface_id),
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  event_type TEXT NOT NULL,
  actor TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  user_id TEXT,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS surface_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(tenant_id),
  name TEXT NOT NULL,
  description TEXT,
  surface_type TEXT NOT NULL,
  inputs_schema_json TEXT NOT NULL DEFAULT '{}',
  a2ui_layout_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  user_id TEXT,
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
  quiet_start TEXT,
  quiet_end TEXT,
  quiet_timezone TEXT,
  quiet_days TEXT DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
  quiet_behaviour TEXT NOT NULL DEFAULT 'suppress',
  push_enabled INTEGER NOT NULL DEFAULT 0,
  push_forms INTEGER NOT NULL DEFAULT 1,
  push_approvals INTEGER NOT NULL DEFAULT 1,
  push_notifications INTEGER NOT NULL DEFAULT 1,
  push_severity_min TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_surfaces_tenant ON a2ui_surfaces(tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_surfaces_user ON a2ui_surfaces(tenant_id, user_id);
`;
