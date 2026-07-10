# Ido v2 — TODO

*Last updated: 2026-07-05*

---

## ✅ Done

### Backend
- [x] Unified payload validation (A2A, MCP, REST)
- [x] Tenant-ownership checks on all mutations
- [x] ModePolicy + source identity from API keys
- [x] `GET /api/v1/whoami` — mode, role, hasKeys, needsSetup, version, avatarUrl, displayName, tenantDisplayName, email
- [x] Required-field validation on `submitSurface()`
- [x] DISMISSED state + dismiss endpoint for notifications
- [x] Decline/cancel with state guard
- [x] REST `POST /api/v1/surfaces` endpoint
- [x] MCP source passthrough
- [x] Password strength (≥8 chars) on setup
- [x] Setup auto-detect: `whoami.needsSetup`
- [x] BUSL 1.1 license + `IDO_LICENSE_KEY` check
- [x] Archive as flag
- [x] OIDC login: Google + Microsoft (SaaS + corporate modes)
- [x] Stateless OAuth state (JWT-signed PKCE verifier + return origin, survives restarts)
- [x] OIDC redirect returns to origin (Referer-based, no hardcoded port)
- [x] API key creation with tenant scoping
- [x] API key auto-increment naming ("Default 1", "Default 2", …)
- [x] `PATCH /api/v1/keys/:id` — rename API key
- [x] JWT session cookies (HttpOnly, SameSite=Lax)
- [x] JWT secret auto-generation (`data/.ido-secret`)
- [x] VAPID key auto-generation (`data/.vapid`)
- [x] Web push: subscribe/unsubscribe, VAPID, push on surface creation (all 3 protocols)
- [x] Push notification cleanup: on enter, card click, surface action
- [x] Callback dispatch with exponential backoff (12 attempts, ±25% jitter)
- [x] Notification preferences: push_enabled, push_forms/approvals/notifications, severity, quiet hours + days
- [x] PATCH /profile endpoint (editable display_name)
- [x] Version from VERSION file
- [x] PostgreSQL support (auto-detect DATABASE_URL) with consolidated migration

### Frontend
- [x] Dashboard card swipe left/right
- [x] Swipe-down only when scrolled to top
- [x] Settings via avatar, removed from footer nav
- [x] Focus ring: global 1px outline
- [x] API key UI hidden in dev mode
- [x] API key inline rename (edit icon on key name)
- [x] Personal onboarding auto-detect → SetupPage (3-step: account → API key → done)
- [x] LoginPage mode-aware: dev hidden, personal password, SaaS/corporate OIDC buttons
- [x] KeyPromptModal on first login (no keys → creates one)
- [x] sessionStorage guard: key prompt only once per session
- [x] OIDC session restore on page load
- [x] Auto-logout on 401
- [x] State badges on SurfaceView/SurfaceCard
- [x] Decline/confirm modal (viewport-fixed)
- [x] SurfaceView: fixed header + scrollable content + fixed footer
- [x] About section: logo, version, feature grid, how-it-works, mode/license/connection
- [x] Profile section: avatar image, display name (editable), email
- [x] Settings: all prefs auto-save (no save button)
- [x] Settings: scrollable content (pb-24 for logout button)
- [x] Quiet time UI: toggle, start/end, day chips, behaviour
- [x] Push Notifications toggle: preference + subscription (fire-and-forget)
- [x] First-name greeting on Dashboard
- [x] Corporate tenant badge in header
- [x] Visual polish: micro-bounce, card lift, deeper base, card-arrive pulse
- [x] Signature component: DPR-aware canvas
- [x] Fast Refresh fix: navigate moved to utils
- [x] TypeScript: vite-env.d.ts for CSS import types

### Infra
- [x] Docker multi-stage build (proxy + web)
- [x] Docker: Debian-based (node:22-slim) for better-sqlite3 compatibility
- [x] Docker: volume permissions fix (/app/data)
- [x] Docker: curl healthcheck (wget not in slim)
- [x] Docker: prod-stage npm ci --omit=dev (correct native binary)
- [x] PostgreSQL docker-compose (`docker-compose.pg.yml`)
- [x] Cloud Run deploy script (`deploy.sh`)
- [x] `.dockerignore`
- [x] PWA service worker denylist (/api, /sse — stops SW hijacking OIDC)
- [x] README with quick start, modes, API examples, config reference
- [x] Consolidated single-file DB migration
- [x] serveStatic serves from `ido-web/dist`, skips when absent in dev

### Scripts
- [x] `scripts/db-backup.sh`
- [x] `scripts/db-restore.sh`
- [x] `scripts/db-clean.sh`
- [x] `scripts/db-switch-mode.sh`

---

## 📋 Remaining

### Tests
- [x] Protocol validation: 11 shared payloads × 3 protocols = 33 tests
- [x] Full surface lifecycle: 35 tests (forms, approvals, notifications, archive, required fields, prefill, idempotency)
- [x] Inbox vs history mutation guards
- [x] Negative validation: 6 payloads × 3 protocols
- [x] Demo payloads: 15 rich UI showcases
- [x] Health, A2A, MCP, REST endpoint smoke tests
- [x] Expiry sweep
- [x] Auth failures: missing key, invalid key, bad format key → 401
- [x] Injection: SQL injection, XSS, null byte → all handled
- [x] Edge cases: overlong title, max title, deep nesting, emoji, empty body, non-JSON, whitespace title
- [ ] Tenant isolation: User A cannot see/mutate User B surfaces (needs 2 key pairs)
- [ ] Onboarding: setup flow, key creation (needs Playwright)
- [ ] Push notification end-to-end (needs Playwright)
- [ ] Preferences: GET/PUT round-trip, quiet hours enforcement
- [ ] API key: create, list, revoke, scope enforcement
- [ ] Bulk operations: batch archive

### Docs
- [ ] Agent connection guide (A2A/MCP setup snippets)
- [ ] API reference docs (beyond Skills Guide)

### UX Polish
- [ ] Empty dashboard state with "how to connect" steps
- [ ] Notification bundling (group similar → single card w/ count)
- [ ] Bulk actions (select → batch dismiss/archive)
- [ ] Card skeleton loading states
- [ ] Surface templates browser in dashboard
- [ ] Solid-background PWA icons — Android fills transparent icons with white; iOS shows black. Generate `icon-192.png`/`icon-512.png` with solid `#0F1117` background for the manifest while keeping transparent `favicon.svg` for browser tabs.

### Backend
- [ ] API key scopes enforcement (read vs write)
- [ ] Rate limiting — middleware exists (`middleware/rateLimit.ts`), just needs wiring to routes
- [x] MCP SSE streaming (GET /mcp/sse + POST /mcp/sse/:sessionId)
- [ ] Webhook URL validation — validate callback URLs are well-formed before storing
- [ ] **A2A agent discovery** — `GET /.well-known/agent-card.json` returning agent metadata (name, capabilities, skills, endpoint URLs). Standard A2A spec; makes Ido auto-discoverable by agent frameworks. Also `GET /.well-known/ido-skills-guide` serving the skills guide as a static resource.

### Corporate User-Scoping (user_id → recipient in corporate mode)
*Plan revised 2026-07-06.*

**Background:** In corporate mode, `user_id` is mandatory and scopes a surface to a specific recipient within the tenant. Today it's stored as metadata but never enforced — all surfaces are visible to the whole tenant, and `user_id` is optional.

**Config flags (deploy.env):**
- `IDO_CORP_ALLOWED_DOMAINS` — comma-separated list of allowed email domains (e.g. `corp.com,sub.corp.com`). Empty = allow all. Surfaces with `user_id` not matching any domain are rejected at creation.
- `IDO_CORP_ALLOW_UNKNOWN_USERS` — `true` = allow surfaces for recipients who haven't logged in yet (surface waits for them). `false` (default) = reject unless the user has previously authenticated via OIDC. Requires `corporate_users` table for lookups.

**Rules:**
- `user_id` is **required** in corporate mode — surfaces without it are rejected
- Domain validation: if `IDO_CORP_ALLOWED_DOMAINS` is set, `user_id` must match one of the listed domains
- Unknown user validation: if `IDO_CORP_ALLOW_UNKNOWN_USERS=false`, `user_id` must exist in `corporate_users`
- Users see only their own surfaces (`surface.user_id = their email`) + unassigned (`user_id IS NULL`)
- Admins (`IDO_ADMIN_EMAILS`) have **no special visibility** — they see only their own surfaces like everyone else
- Must be documented in skills guide (`corporate` mode note already exists, needs updating)

**Implementation order (7 steps):**

- [ ] **1. Add config flags** — `IDO_CORP_ALLOWED_DOMAINS` and `IDO_CORP_ALLOW_UNKNOWN_USERS` to `config.ts` and `.env.example`. Defaults: all domains allowed, unknown users rejected.
- [ ] **2. `corporate_users` table + OIDC enrollment** — Only needed if `IDO_CORP_ALLOW_UNKNOWN_USERS=false`. Table `corporate_users(tenant_id, email, first_seen_at, last_seen_at)`. On OIDC login, upsert the authenticated user. Records who has ever logged in.
- [ ] **3. Enforce validation in `createSurface`** — In corporate mode: (a) reject missing `user_id`, (b) reject non-matching domain if `IDO_CORP_ALLOWED_DOMAINS` is set, (c) if `IDO_CORP_ALLOW_UNKNOWN_USERS=false`, lookup `corporate_users` and reject unknown recipients.
- [ ] **4. Query scoping** — `getSurfacesByTenant` and `getSurfaceSummariesByTenant` accept an optional `userId` param. In corporate mode, filter: `WHERE (user_id = ? OR user_id IS NULL)`. Non-corporate modes pass no filter (current behavior).
- [ ] **5. SSE broadcast scoping** — `pushSurfaceUpdate` filters by the surface's `user_id`. `SSEClient` already has `userId` — only fan out to clients matching the surface's `user_id`. `user_id IS NULL` surfaces broadcast to the whole tenant.
- [ ] **6. Mutation guards** — `submitSurface`, `cancelSurface`, `dismissNotification`, `GET /:id`, `POST /:id/archive` check `surface.user_id` against `currentUserId` in corporate mode (mismatch → 404). Same pattern as existing tenant checks.
- [ ] **7. Update skills guide** — Corporate `modeNotes` must document: `user_id` is required, domain restrictions, and unknown-user behavior.

### Chat Client (PWA → external agents)
*Plan drafted 2026-07-05. See details below.*

**Background:** Ido PWA connects to external agent servers so users can chat with them. The primary protocol is **OpenAI-compatible `/v1/chat/completions`** — near-universal across the LLM ecosystem. For providers with native APIs (Anthropic, Gemini), the proxy layer or a thin protocol adapter handles translation.

**Provider coverage:**

| Provider | Path | Streaming |
|---|---|---|
| **OpenAI** | Native `/v1/chat/completions` | ✅ SSE |
| **DeepSeek** | OpenAI-compatible endpoint | ✅ SSE |
| **Ollama** (local: Hermes, Llama, Mistral, etc.) | Native `/v1/chat/completions` | ✅ SSE |
| **OpenRouter** (200+ models) | Native `/v1/chat/completions` | ✅ SSE |
| **Groq / Together / Fireworks / vLLM / LM Studio / LocalAI / LiteLLM** | Native `/v1/chat/completions` | ✅ SSE |
| **Anthropic (Claude)** | Native Messages API (different format) — or via OpenRouter/LiteLLM as an OpenAI-compatible proxy | ✅ via proxy |
| **Google Gemini** | Native Gemini API (different format) — or via OpenRouter/LiteLLM as an OpenAI-compatible proxy | ✅ via proxy |

**Strategy:** Implement OpenAI-compatible format as the primary protocol (covers ~90% of providers directly). Recommend LiteLLM or OpenRouter as a lightweight translation layer for Anthropic/Gemini users. If demand warrants it, add native Anthropic and Gemini protocol adapters as thin wrappers.

**Implementation plan:**

- [ ] **1. Agent profiles in Settings** — Users configure one or more agent connections: endpoint URL, API key, model name, display name. Stored in `localStorage` (no backend needed — the PWA talks directly to agent servers). Settings UI: list of profiles, add/edit/delete, test connection button.
- [ ] **2. Chat backend proxy** — A thin pass-through route on the Ido proxy (`POST /api/v1/chat`) that forwards to the configured agent endpoint. Needed for: (a) hiding API keys from the browser, (b) streaming SSE relay, (c) CORS bypass for local agents (Ollama, etc.). The proxy does not store messages — it's a transparent relay.
- [ ] **3. ChatPage component** — New tab in the PWA (alongside Dashboard). Chat UI: message list, input box, streaming text rendering, model selector dropdown, conversation history (stored in `localStorage`). Visual: dark/light theme consistent with the rest of Ido.
- [ ] **4. Streaming support** — Parse SSE `data: {"choices":[{"delta":{"content":"..."}}]}` chunks, render incrementally. Handle `[DONE]` termination, error codes, and reconnection.
- [ ] **5. Multiple conversations** — Sidebar with conversation list. Create/rename/delete conversations. Each conversation has its own message history sent as context.
- [ ] **6. (Future) Native Anthropic adapter** — If proxy-mode adoption is high, add native `POST /v1/messages` support for Claude models. Same chat UI, different backend translator.
- [ ] **7. (Future) Native Gemini adapter** — Same pattern for Google's `generateContent` API.

### Multi-Instance (v2+)
- [ ] SSE broadcast across instances (Redis pub/sub or Postgres LISTEN/NOTIFY)
- [ ] Leader election for cron sweeps
- [ ] Health check reports instance ID for load balancer
