import { modePolicy, config } from '../config.js';

export { modePolicy };
export type { ModePolicy } from '../types.js';

// ── Auth Result ─────────────────────────────────────────────

export interface AuthResult {
  authenticated: boolean;
  tenantId: string;
  userId?: string;
  role: string;
  authMethod: 'session' | 'api_key' | 'dev' | 'oidc';
  scopes: string[];
  error?: string;
  errorCode?: number;
}

// ── Derive Tenant from Mode ─────────────────────────────────

export function deriveTenantId(identifier: string): string {
  switch (modePolicy.defaultTenantStrategy) {
    case 'token':
      return identifier; // dev mode: token is tenant
    case 'email':
      return Buffer.from(identifier).toString('base64').substring(0, 32); // saas: hash email
    case 'org':
      return identifier; // corporate: org id
    default:
      return identifier;
  }
}

// ── Validate User ID for Mode ───────────────────────────────

export function validateUserId(userId: string | undefined): { valid: boolean; error?: string } {
  if (modePolicy.requireUserId && !userId) {
    return { valid: false, error: 'user_id is required in this deployment mode' };
  }

  if (userId && modePolicy.requireUserId && !userId.includes('@')) {
    return { valid: false, error: 'user_id must be a valid email address in corporate mode' };
  }

  return { valid: true };
}
