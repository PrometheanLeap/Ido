import { type DeploymentMode, type ModePolicy } from './types.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root (one level above proxy/, or current dir)
const envPaths = [
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

// ── Environment ─────────────────────────────────────────────

const env = (key: string, fallback?: string): string =>
  process.env[key] ?? fallback ?? '';

const envInt = (key: string, fallback: number): number =>
  parseInt(process.env[key] ?? String(fallback), 10);

// ── Config Object ───────────────────────────────────────────

export const config = {
  mode: (process.env.IDO_MODE || 'dev') as DeploymentMode,
  port: envInt('PORT', 8645),
  host: env('HOST', '0.0.0.0'),

  // Database
  databaseUrl: env('DATABASE_URL', ''),
  sqlitePath: env('SQLITE_PATH', './data/ido.db'),

  // Auth
  devToken: env('IDO_DEV_TOKEN', 'ido-dev-token'),
  jwtSecret: env('JWT_SECRET', 'change-me-in-production'),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '7d'),

  // Public URL (auto-detected from requests, override for reverse proxies)
  publicUrl: env('PUBLIC_URL', ''),

  // OIDC
  oidcGoogleClientId: env('OIDC_GOOGLE_CLIENT_ID', ''),
  oidcGoogleClientSecret: env('OIDC_GOOGLE_CLIENT_SECRET', ''),
  oidcMicrosoftClientId: env('OIDC_MICROSOFT_CLIENT_ID', ''),
  oidcMicrosoftClientSecret: env('OIDC_MICROSOFT_CLIENT_SECRET', ''),
  oidcMicrosoftTenant: env('OIDC_MICROSOFT_TENANT', 'common'),

  // License (required for corporate mode)
  licenseKey: env('IDO_LICENSE_KEY', ''),

  // Organization (corporate mode)
  orgSlug: env('IDO_ORG_SLUG', ''),
  adminEmails: env('IDO_ADMIN_EMAILS', '').split(',').map(e => e.trim()).filter(Boolean),
  corpAllowedDomains: env('IDO_CORP_ALLOWED_DOMAINS', '').split(',').map(e => e.trim()).filter(Boolean),
  corpAllowUnknownUsers: env('IDO_CORP_ALLOW_UNKNOWN_USERS', 'false') === 'true',

  // VAPID (Web Push)
  vapidSubject: env('VAPID_SUBJECT', 'mailto:admin@example.com'),
  vapidPublicKey: env('VAPID_PUBLIC_KEY', ''),
  vapidPrivateKey: env('VAPID_PRIVATE_KEY', ''),

  // CORS
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173'),

  // Rate limiting
  rateLimitSurfaceCreates: envInt('RATE_LIMIT_SURFACE_CREATES', 60),
  rateLimitReads: envInt('RATE_LIMIT_READS', 600),
  rateLimitAuth: envInt('RATE_LIMIT_AUTH', 20),

  // Callback retry
  callbackMaxRetries: envInt('CALLBACK_MAX_RETRIES', 12),

  // Expiry sweep interval (ms)
  expirySweepIntervalMs: envInt('EXPIRY_SWEEP_MS', 3600000), // 1 hour

  // SSE
  sseKeepaliveIntervalMs: envInt('SSE_KEEPALIVE_MS', 30000),

  // DB Pool (for PG)
  pgPoolMax: envInt('PG_POOL_MAX', 5),
  pgIdleTimeoutMs: envInt('PG_IDLE_TIMEOUT', 10000),
};

// ── Mode Policy ─────────────────────────────────────────────

export function getModePolicy(mode: DeploymentMode): ModePolicy {
  switch (mode) {
    case 'dev':
      return {
        requireUserId: false,
        validateUserIdMatchesKey: false,
        allowLocalAuth: true,
        defaultTenantStrategy: 'token',
      };
    case 'personal':
      return {
        requireUserId: false,
        validateUserIdMatchesKey: false,
        allowLocalAuth: true,
        defaultTenantStrategy: 'token',
      };
    case 'saas':
      return {
        requireUserId: false,
        validateUserIdMatchesKey: true,
        allowLocalAuth: false,
        defaultTenantStrategy: 'email',
      };
    case 'corporate':
      return {
        requireUserId: true,
        validateUserIdMatchesKey: false,
        allowLocalAuth: false,
        defaultTenantStrategy: 'org',
      };
    default:
      throw new Error(`Unknown deployment mode: ${mode}`);
  }
}

export const modePolicy: ModePolicy = getModePolicy(config.mode);
