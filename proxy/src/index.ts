import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { Kysely } from 'kysely';
import type { DB } from './db/adapter.js';
import { getDb as getSqliteDb } from './db/sqlite.js';
import { config, modePolicy } from './config.js';
import { createAuthRouter } from './api/auth.js';
import { createSurfacesRouter } from './api/surfaces.js';
import { createOidcRouter } from './api/oidc.js';
import { createPushRouter } from './api/push.js';
import { createPreferencesRouter } from './api/preferences.js';
import { rateLimit } from './middleware/rateLimit.js';
import { dispatchJsonRpc, isJsonRpcRequest } from './api/a2a.js';
import { dispatchMcp, handleMcpSseConnect, getMcpSession, sendMcpResponse, removeMcpSession } from './api/mcp.js';
import { getSkillsGuide } from './a2a/skills-guide.js';
import { getComponentJsonSchema } from './a2ui/schema.js';
import { sseManager } from './sse/manager.js';
import { buildSurfaceUpdateEvent } from './sse/events.js';
import { sweepExpired } from './domain/expiry.js';
import { dispatchAllPending } from './domain/dispatch.js';
import { initWebPush } from './push/index.js';
import { seedTemplates } from './db/seeds.js';
import * as queries from './db/queries.js';
import { getVersion } from './version.js';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AppVariables } from './types.js';
import { extractAuth, requireTenant } from './middleware/auth.js';

let _db: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (!_db) {
    _db = getSqliteDb();
  }
  return _db;
}

export function setDb(db: Kysely<DB>): void {
  _db = db;
}

const app = new Hono<{ Variables: AppVariables }>();

// Security headers — safe defaults. CSP is relaxed enough for the SPA + inline
// styles Tailwind emits, while still blocking framing and MIME sniffing.
app.use('*', secureHeaders({
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  crossOriginResourcePolicy: 'same-origin',
  // HSTS only meaningful over HTTPS; harmless behind TLS-terminating proxies.
  strictTransportSecurity: config.mode === 'dev' ? false : 'max-age=31536000; includeSubDomains',
}));

app.use('*', cors({
  origin: config.mode === 'dev' ? '*' : config.corsOrigin,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Ido-Api-Key'],
}));

// Cap request bodies (1 MB) — protects against oversized layouts / schemas.
app.use('/api/*', bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large (max 1MB)' }, 413),
}));

// Rate limiting on the agent-facing protocol endpoints. These multiplex reads
// and writes, so we use the higher ceiling as a DoS guard (default 600/min).
app.use('/api/v1/a2a', rateLimit(config.rateLimitReads));
app.use('/api/v1/mcp', rateLimit(config.rateLimitReads));
app.use('/api/v1/surfaces/*', rateLimit(config.rateLimitReads));

// Stricter rate limiting on auth routes to prevent brute-force attacks
// on login, setup, and OIDC callbacks (default 20/min).
app.use('/api/v1/login', rateLimit(config.rateLimitAuth));
app.use('/api/v1/setup', rateLimit(config.rateLimitAuth));
app.use('/api/v1/oidc/*', rateLimit(config.rateLimitAuth));

app.get('/api/v1/health', (c) => c.json({
  status: 'ok', mode: config.mode, version: getVersion(),
  sseClients: sseManager.getClientCount(),
}));

app.get('/api/v1/whoami', extractAuth, async (c) => {
  let needsSetup = false;
  let hasKeys = true;
  let avatarUrl: string | null = null;
  let displayName: string | null = null;
  let email: string | null = null;
  let tenantDisplayName: string | null = null;
  if (modePolicy.allowLocalAuth && config.mode !== 'dev') {
    const tenantId = c.get('tenantId') || 'default';
    const userCount = await queries.getUserCount(getDb(), tenantId);
    needsSetup = userCount === 0;
  }
  const tid = c.get('tenantId');
  const uid = c.get('userId') as string | undefined;
  const authMethod = c.get('authMethod') as string | undefined;
  if (tid) {
    const keys = await queries.getApiKeysByTenant(getDb(), tid);
    hasKeys = keys.length > 0;
    // Read tenant display name for corporate/organization context
    const tenant = await queries.getTenant(getDb(), tid);
    tenantDisplayName = tenant?.display_name ?? null;
  }
  if (tid && uid) {
    const user = await queries.getUser(getDb(), uid, tid);
    avatarUrl = user?.avatar_url ?? null;
    displayName = user?.display_name ?? null;
  }
  // Email is userId for OIDC users; null for local-auth or dev
  if (authMethod === 'session' && uid?.includes('@')) email = uid;
  return c.json({
    mode: config.mode,
    tenantId: c.get('tenantId') || null,
    userId: c.get('userId') || null,
    role: c.get('role') || null,
    authMethod: c.get('authMethod') || null,
    source: c.get('source') || null,
    displayName,
    tenantDisplayName,
    email,
    avatarUrl,
    allowLocalAuth: modePolicy.allowLocalAuth,
    defaultTenantStrategy: modePolicy.defaultTenantStrategy,
    hasKeys,
    needsSetup,
    version: getVersion(),
  });
});

app.get('/api/v1/skills-guide', (c) => c.json(getSkillsGuide(config.mode)));

// A2A Agent Card — standard discovery endpoint per the A2A spec.
// Makes Ido auto-discoverable by agent frameworks. No auth required.
app.get('/.well-known/agent-card.json', (c) => c.json({
  name: 'Ido',
  description: 'AI-to-Human interaction gateway — send forms, approvals, and notifications to humans and receive typed responses.',
  version: getVersion(),
  capabilities: [
    { name: 'message/send', description: 'Create a surface (form, approval, or notification) for a human to respond to' },
    { name: 'tasks/get', description: 'Poll task status and result' },
    { name: 'tasks/list', description: 'List tasks for the tenant' },
    { name: 'tasks/cancel', description: 'Cancel a pending task' },
    { name: 'skills/guide', description: 'Returns the full component catalog and templates' },
  ],
  endpoints: {
    a2a: '/api/v1/a2a',
    mcp: '/api/v1/mcp',
    rest: '/api/v1/surfaces',
    skillsGuide: '/api/v1/skills-guide',
    schema: '/api/v1/schema',
  },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
}));

// Machine-readable A2UI component schema (JSON Schema, generated from the same
// Zod definitions used for validation). Public — enables agents to validate
// layouts client-side before sending.
app.get('/api/v1/schema', (c) => c.json(getComponentJsonSchema()));

app.get('/api/v1/templates', extractAuth, async (c) => {
  const tenantId = c.get('tenantId') as string | undefined;
  const templates = await queries.getTemplates(getDb(), tenantId);
  return c.json(templates);
});

app.post('/api/v1/a2a', extractAuth, async (c) => {
  const rawText = await c.req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch (err) {
    console.error('A2A JSON parse error. Raw body length:', rawText.length, 'Body:', rawText.substring(0, 300));
    return c.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  }
  if (!isJsonRpcRequest(body)) {
    return c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null });
  }
  // skills/guide and skills/list-templates are intentionally public (no auth required)
  const isPublicMethod = body.method === 'skills/guide' || body.method === 'skills/list-templates';
  const tenantId = c.get('tenantId') as string;
  if (!isPublicMethod && !tenantId) {
    return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Authentication required — provide a valid X-Ido-Api-Key header or session cookie' }, id: null });
  }
  const effectiveTenant = tenantId || 'public';
  if (!isPublicMethod) {
    await queries.ensureTenant(getDb(), effectiveTenant, 'Tenant ' + effectiveTenant, config.mode);
  }
  const result = await dispatchJsonRpc(getDb(), body, effectiveTenant,
    c.get('source') as string || 'a2a',
    c.req.header('x-forwarded-for') ?? '127.0.0.1');
  return c.json(result);
});

app.post('/api/v1/mcp', extractAuth, async (c) => {
  const body = await c.req.json();
  // initialize and ping are intentionally public (no auth required per MCP spec)
  // ido_get_skills_guide is also public
  const method = body.method || '';
  const toolName = body.params?.name || '';
  const isPublic = method === 'initialize' || method === 'ping' || method === 'tools/list'
    || (method === 'tools/call' && toolName === 'ido_get_skills_guide');
  const tenantId = c.get('tenantId') as string;
  if (!isPublic && !tenantId) {
    return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Authentication required — provide a valid X-Ido-Api-Key header' }, id: body.id ?? null });
  }
  const effectiveTenant = tenantId || 'public';
  if (!isPublic) {
    await queries.ensureTenant(getDb(), effectiveTenant, 'Tenant ' + effectiveTenant, config.mode);
  }
  const result = await dispatchMcp(getDb(), body, effectiveTenant,
    c.get('source') as string || 'mcp');
  return c.json(result);
});

// MCP SSE — persistent streaming connection
app.get('/api/v1/mcp/sse', extractAuth, requireTenant, async (c) => {
  const tenantId = c.get('tenantId') as string;
  const source = c.get('source') as string || 'mcp-sse';

  const stream = new ReadableStream({
    start(controller) {
      handleMcpSseConnect(tenantId, source, controller);
    },
    cancel() { /* session cleaned up on disconnect via keepalive timeout */ },
  });

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  return c.body(stream);
});

// MCP SSE — session-specific POST endpoint for sending requests
app.post('/api/v1/mcp/sse/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = getMcpSession(sessionId);
  if (!session) return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
  const body = await c.req.json();
  sendMcpResponse(getDb(), sessionId, body);
  return c.json({ accepted: true });
});

app.post('/api/v1/a2a/task', extractAuth, requireTenant, async (c) => {
  const tenantId = c.get('tenantId') as string;
  const body = await c.req.json();
  const result = await dispatchJsonRpc(getDb(), {
    jsonrpc: '2.0', method: 'message/send', params: body, id: uuid(),
  }, tenantId);
  return c.json(result);
});

const oidcRouter = createOidcRouter(() => getDb());
app.route('/api/v1/oidc', oidcRouter);

const authRouter = createAuthRouter(() => getDb());
app.route('/api/v1', authRouter);

const surfacesRouter = createSurfacesRouter(() => getDb());
app.use('/api/v1/surfaces/*', extractAuth, requireTenant);
app.route('/api/v1/surfaces', surfacesRouter);

const pushRouter = createPushRouter(() => getDb());
app.route('/api/v1/push', pushRouter);

const preferencesRouter = createPreferencesRouter(() => getDb());
app.route('/api/v1/preferences', preferencesRouter);

app.get('/sse', extractAuth, requireTenant, async (c) => {
  const tenantId = c.get('tenantId') as string;
  const userId = c.get('userId') as string | undefined;
  const surfaces = await queries.getSurfaceSummariesByTenant(getDb(), tenantId, undefined, config.mode === 'corporate' ? userId : undefined);
  let clientId: string | null = null;
  const stream = new ReadableStream({
    start(controller) {
      clientId = uuid();
      sseManager.addClient(clientId, tenantId, userId, controller);
      const encoder = new TextEncoder();
      for (const surface of surfaces) {
        controller.enqueue(encoder.encode('event: surface_update\ndata: ' + JSON.stringify(buildSurfaceUpdateEvent(surface)) + '\n\n'));
      }
    },
    cancel() { if (clientId) sseManager.removeClient(clientId); },
  });
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');
  return c.body(stream);
});

// Admin: force sweep (for testing)
app.post('/api/v1/admin/sweep', extractAuth, requireTenant, async (c) => {
  const n = await sweepExpired(getDb());
  return c.json({ swept: n });
});

// ── Static web files (production / Docker) ──────────────────
import { existsSync } from 'fs';
const webPath = path.resolve(import.meta.dirname, '../../ido-web/dist');
if (existsSync(webPath)) {
  // Serve static files (JS, CSS, images, etc.) — but ONLY for paths that are not
  // API routes or well-known discovery endpoints. Those must always hit their
  // registered route handlers to return JSON, not HTML.
  app.use('/*', async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith('/api/') || pathname.startsWith('/.well-known/')) {
      return next();
    }
    return serveStatic({ root: webPath })(c, next);
  });
  console.log('serveStatic: ' + webPath);
} else {
  console.log('serveStatic: skipped (web dist not found — use Vite dev server)');
}

// SPA fallback: only serve index.html for GET/HEAD requests that matched no route.
// Using notFound ensures API routes (/.well-known/*, /api/*) take priority over the
// catch-all, so the agent-card.json and skills-guide endpoints respond with JSON,
// not HTML.
app.notFound((c) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json({ error: 'Not found' }, 404);
  }
  const indexPath = path.join(webPath, 'index.html');
  if (!existsSync(indexPath)) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.html(fs.readFileSync(indexPath, 'utf-8'));
});

async function main() {
  console.log('Ido ' + getVersion() + ' starting in ' + config.mode + ' mode...');

  const requiresLicense = config.mode === 'saas' || config.mode === 'corporate';
  if (requiresLicense && !config.licenseKey) {
    console.error('ERROR: IDO_LICENSE_KEY is required for ' + config.mode + ' mode.');
    console.error('Set the IDO_LICENSE_KEY environment variable to a valid license key.');
    console.error('Dev and Personal modes do not require a license key.');
    process.exit(1);
  }
  if (requiresLicense) {
    console.log('License key present. Mode: ' + config.mode);
  }

  // Auto-generate JWT_SECRET on first boot if still default (Docker-friendly)
  if (config.jwtSecret === 'change-me-in-production') {
    const secretPath = path.join(path.dirname(config.sqlitePath), '.ido-secret');
    try {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) {
        config.jwtSecret = existing;
        console.log('JWT secret loaded from persisted file');
      }
    } catch {
      const generated = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(path.dirname(secretPath), { recursive: true });
      fs.writeFileSync(secretPath, generated);
      config.jwtSecret = generated;
      console.log('JWT secret auto-generated and saved to ' + secretPath);
    }
  }

  if (config.databaseUrl) {
    const { getDb: getPgDb } = await import('./db/pg.js');
    setDb(await getPgDb());
    console.log('PostgreSQL connected');
  } else {
    const { initDatabase } = await import('./db/sqlite.js');
    setDb(await initDatabase());
    console.log('SQLite connected: ' + config.sqlitePath);
  }
  const db = getDb();
  const defaultTenant = config.mode === 'dev' ? 'dev' : 'default';
  await queries.ensureTenant(db, defaultTenant, 'Ido ' + config.mode, config.mode);
  if (config.mode === 'dev') {
    const existing = await queries.getUser(db, 'dev', 'dev');
    if (!existing) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.default.hash('dev', 10);
      await queries.createUser(db, { username: 'dev', passwordHash: hash, tenantId: 'dev', role: 'admin' });
      console.log('Dev user created (dev/dev)');
    }
  }
  await seedTemplates(db);
  initWebPush();
  setInterval(async () => { try { const n = await sweepExpired(db); if (n > 0) console.log('Expired ' + n + ' surfaces'); } catch (e) { console.error('Expiry sweep error:', e); } }, config.expirySweepIntervalMs);
  setInterval(async () => { try { await dispatchAllPending(db); } catch (e) { console.error('Dispatch error:', e); } }, 60_000);
  setTimeout(async () => { await sweepExpired(db); await dispatchAllPending(db); }, 5000);
  console.log('Ido listening on http://' + config.host + ':' + config.port);
  console.log('Skills guide: http://localhost:' + config.port + '/api/v1/skills-guide');
  console.log('Health: http://localhost:' + config.port + '/api/v1/health');

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });

  // Graceful shutdown — close SSE streams and HTTP server on SIGTERM/SIGINT
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    sseManager.destroy();
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 5s if graceful shutdown stalls
    setTimeout(() => { console.error('Forcing exit'); process.exit(1); }, 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => { console.error('Failed to start:', err); process.exit(1); });

export default app;
