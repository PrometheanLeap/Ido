# Ido — Refactor Plan

*Drafted: 2026-07-06. Based on full codebase review (backend + frontend + infra).*

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical Bugs (Fix First)](#2-critical-bugs-fix-first)
3. [Backend Redundancy](#3-backend-redundancy)
4. [Frontend Redundancy](#4-frontend-redundancy)
5. [Type Safety](#5-type-safety)
6. [Dead Code Removal](#6-dead-code-removal)
7. [Visual Improvements](#7-visual-improvements)
8. [Compatibility & Usability](#8-compatibility--usability)
9. [Functionality Gaps](#9-functionality-gaps)
10. [Execution Order](#10-execution-order)
11. [Risk Register](#11-risk-register)

---

## 1. Executive Summary

The codebase is well-architected at the macro level — clean separation of protocol / domain / db layers, a single `ModePolicy` for mode divergence, and a thoughtful PWA frontend. However, several **concrete redundancies** and **two correctness bugs** have accumulated:

| Category | Count | Impact |
|---|---|---|
| Critical bugs | 2 | Broken API-key auth on key-mgmt routes; quiet-hours ignored |
| Triplicated logic | 1 block × 3 files | createSurface + SSE + push notification |
| Duplicated middleware | 1 (50 lines × 2) | `extractAuth` vs `authMiddleware` |
| God file | 1 (`index.ts`, ~540 lines) | 7 responsibilities in entry point |
| Migration drift | 4 inconsistencies | SQLite vs PG schema divergence |
| Dead code | 11 symbols + 3 tables | Unused exports, unused DB tables |
| Type-safety escapes | 8 `as any` / `as never` | Masked bugs, lost compiler help |
| Frontend duplication | 3 patterns | State badge, refetch-after-action, notification clearing |

**Estimated effort:** ~3–4 days for a thorough refactor covering Phases 1–4. Phases 5–7 (visual, compatibility, functionality) can proceed incrementally afterward.

---

## 2. Critical Bugs (Fix First)

### 2.1 Broken API-key auth on key-management routes — **HIGH**

**Location:** `proxy/src/api/auth.ts:256`

The `authMiddleware` in `api/auth.ts` retrieves the database via `c.get('db')`, but `'db'` is **never set** in the Hono context anywhere in the application. As a result, API-key authentication through the key-management routes (`/keys`, `/keys/:id/revoke`, `/keys/:id` PATCH, `/profile`) silently fails and falls through to 401.

**Fix:** Replace `c.get('db')` with the `getDb()` singleton (the same one `extractAuth` in `index.ts` uses), or pass the db provider into `createAuthRouter`. The cleanest fix is to delete `authMiddleware` entirely and reuse `extractAuth` (see §3.2).

### 2.2 Quiet-hours preferences are ignored — **HIGH**

**Location:** `proxy/src/push/index.ts:80–83`

The quiet-hours check hardcodes `hour >= 22 || hour < 7` and ignores the `quiet_start`, `quiet_end`, `quiet_timezone`, and `quiet_days` columns that users configure in Settings. Users who set custom quiet hours see no effect.

**Fix:** Read the preference row and honour `quiet_start` / `quiet_end` (parse as `HH:mm`), `quiet_timezone` (use `Intl.DateTimeFormat` with `timeZone`), and `quiet_days` (JSON array of weekday abbreviations). Also remove the reference to `(prefs as any)?.ignored_sources` at line 100 — that column does not exist.

---

## 3. Backend Redundancy

### 3.1 Triplicated "create surface + push SSE + push notification" block — **HIGH**

The same ~15-line block (call `createSurface` → push SSE update → send web push) is copied verbatim into three files:

| File | Function |
|---|---|
| `proxy/src/api/a2a.ts:45–60` | `handleMessageSend` |
| `proxy/src/api/mcp.ts:268–285` | `handleMcpSendTask` |
| `proxy/src/api/surfaces.ts:84–100` | `POST /` |

**Refactor:** Extract a single function:

```typescript
// domain/surfaces.ts (or a new domain/notify.ts)
export async function broadcastSurfaceCreated(
  db: Kysely<DB>,
  tenantId: string,
  result: CreateSurfaceResult,
  userId: string | undefined,
  source: string,
): Promise<void> {
  sseManager.pushSurfaceUpdate(tenantId, buildSurfaceUpdateEvent(result.surface));
  await sendPushNotification(db, tenantId, result.surface, source);
}
```

All three protocol handlers call this instead of inlining the side effects.

### 3.2 Duplicate auth middleware — **HIGH**

`extractAuth` (`proxy/src/index.ts:68–117`) and `authMiddleware` (`proxy/src/api/auth.ts:211–263`) are near-identical 50-line functions. The `api/auth.ts` version also carries the §2.1 bug.

**Refactor:**
1. Move `extractAuth` → new file `proxy/src/middleware/auth.ts`.
2. Accept a `getDb` provider (or use the module singleton).
3. Delete `authMiddleware` from `api/auth.ts`; import the shared middleware.
4. Type the signature properly: `(c: Context<{ Variables: AppVariables }>, next: Next)` instead of `(c: any, next: any)`.

### 3.3 `index.ts` god file — **HIGH**

`proxy/src/index.ts` (~540 lines) handles seven distinct responsibilities: type definitions, auth middleware, route mounting, inline route handlers (push, preferences, admin), template seeding, startup logic, and version loading.

**Refactor — extract to:**

| Responsibility | New location |
|---|---|
| `AppVariables` interface | `proxy/src/types.ts` |
| `extractAuth` | `proxy/src/middleware/auth.ts` |
| `seedTemplates()` + template data | `proxy/src/db/seeds.ts` |
| Push routes (subscribe/unsubscribe/vapid) | `proxy/src/api/push.ts` |
| Preferences routes (GET/PUT) | `proxy/src/api/preferences.ts` |
| Admin sweep route | `proxy/src/api/admin.ts` |
| `loadVersion()` / `getVersion()` | `proxy/src/version.ts` |
| JWT-secret bootstrap | `proxy/src/auth/bootstrap.ts` |

After extraction, `index.ts` should be ~120 lines: imports, router wiring, security middleware, `main()` startup.

### 3.4 Nine inline tenant guards — **MEDIUM**

`index.ts` contains nine copies of:
```typescript
const tenantId = c.get('tenantId') as string;
if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
```

**Refactor:** A single `requireTenant` middleware applied after `extractAuth`:
```typescript
const requireTenant = (c, next) => {
  if (!c.get('tenantId')) return c.json({ error: 'Authentication required' }, 401);
  return next();
};
```
Apply via `app.use('/api/v1/push/*', extractAuth, requireTenant)` etc.

### 3.5 Migration schema drift (SQLite vs PostgreSQL) — **HIGH**

Four concrete inconsistencies between `db/sqlite.ts` migrations and `db/pg.ts` migrations:

| Column | SQLite | PostgreSQL | Risk |
|---|---|---|---|
| `a2ui_surfaces.state` default | `'CREATED'` | `'ACTIVE'` | Different initial state |
| `sessions.status` default | `'active'` | `'ACTIVE'` | Case-sensitive comparison bugs |
| `a2a_tasks.idempotency_key` | `UNIQUE` constraint | No constraint | Idempotency only enforced on SQLite |
| Migration runner | `runMigrations()` abstraction | Inlined in `getDb()` | PG has no incremental path |

**Refactor:**
1. Create `proxy/src/db/schema.ts` as the single source-of-truth DDL.
2. Generate both SQLite and PG migrations from it, OR unify using Kysely's migration framework.
3. Fix the four drifts immediately — they will cause silent cross-backend bugs.
4. Move the PG migration runner out of `getDb()` into `migrate.ts` (or `db/migrate-pg.ts`).

### 3.6 `AppVariables` defined in entry point, imported backwards — **MEDIUM**

`AppVariables` is declared in `index.ts:35–42` and imported by `api/auth.ts`, `api/surfaces.ts`, and `api/oidc.ts` via `from '../index.js'`. This creates a dependency from leaf route modules back to the entry point — the wrong direction.

**Refactor:** Move `AppVariables` → `proxy/src/types.ts`. Update all imports.

### 3.7 Inline DB queries bypass the `queries` module — **MEDIUM**

Several places in `index.ts` call `getDb().selectFrom(...)` directly instead of going through `queries.ts`:

- `whoami` handler: `selectFrom('agent_keys')`, `selectFrom('tenants')` (lines 155–200)
- `push/subscribe`: `insertInto('push_subscriptions')` (line 330)

**Refactor:** Add `queries.getApiKeysByTenant(db, tenantId)`, `queries.getTenant(db, tenantId)`, `queries.createPushSubscription(db, ...)`. All DB access goes through `queries.ts`.

### 3.8 Repeated error-handling catch blocks — **MEDIUM**

`api/surfaces.ts` has four identical try/catch blocks (lines 119–148) that check for `DomainError` and translate to HTTP status. The same pattern appears in `a2a.ts` and `mcp.ts`.

**Refactor:** Extract a `handleDomainError(c, err)` helper, or use Hono's `app.onError` with a custom `DomainError` class hierarchy.

### 3.9 `push_queue` table and queries exist but are unused — **MEDIUM**

The `push_queue` table is defined in both migrations, has three query functions in `queries.ts` (`addToPushQueue`, `getPushQueue`, `removeFromPushQueue`), and is modeled in `adapter.ts` — but is never written to or read from. Push notifications are sent synchronously.

**Decision:** Either wire up the queue (for reliable delivery when scaled to zero — see REBUILD_SPEC §3.5) or remove the table + queries. Recommendation: **wire it up** as part of the Cloud Run scaling story, since the REBUILD_SPEC already calls for it.

### 3.10 Raw SQL in `createApiKey` and `createUser` — **LOW**

`queries.ts:357–391` uses `sql` template literals while every other query uses the Kysely builder API, losing type safety on column names.

**Refactor:** Convert to Kysely builder calls (`db.insertInto('agent_keys').values({...})`).

---

## 4. Frontend Redundancy

### 4.1 Duplicated `StateBadge` component — **MEDIUM**

The `STATES` record (state → label/color/icon) is defined **twice**:
- `SurfaceCard.tsx` (inline IIFE in the footer, ~40 lines)
- `SurfaceView.tsx` (`StateBadge` function component, ~50 lines)

Both define the same 6 states with the same colors and nearly identical SVG icons.

**Refactor:** Extract a single `StateBadge` component to `components/shared/StateBadge.tsx`. Export the `STATES` map alongside it. Import in both places.

### 4.2 Repeated "refetch all surfaces after action" pattern — **MEDIUM**

Every action handler in `Dashboard.tsx` follows the same pattern:
```typescript
const handleX = async (id: string) => {
  await api.someAction(id);
  const updated = await api.getSurfaces();
  setSurfaces(updated);
};
```

This appears in: `handleArchiveSelected`, `handleDismissAll`, `handleDismissNotif`, `handleApprove`, `handleReject`, `handleDeclineSurface`. The same pattern is in `SurfaceView.tsx` (`handleSubmit`, `handleDismiss`, `handleDecline`).

**Refactor:** Extract a `useSurfaceActions()` hook:
```typescript
function useSurfaceActions() {
  const setSurfaces = useStore(s => s.setSurfaces);
  const refresh = useCallback(async () => {
    const updated = await api.getSurfaces();
    setSurfaces(updated);
  }, [setSurfaces]);
  return {
    approve: (id) => api.submitSurface(id, {}, 'approved').then(refresh),
    reject: (id) => api.submitSurface(id, {}, 'rejected').then(refresh),
    dismiss: (id) => api.dismissSurface(id).then(refresh),
    decline: (id) => api.declineSurface(id).then(refresh),
    archive: (id) => api.archiveSurface(id).then(refresh),
    bulkArchive: (ids) => api.bulkArchive(ids).then(refresh),
  };
}
```

### 4.3 Duplicated notification-clearing logic — **LOW**

`clearSurfaceNotification` is defined inline in `SurfaceView.tsx` (lines 30–40) **and** exported from `utils/push.ts`. The inline copy should be removed in favour of the shared util.

### 4.4 Duplicated `relativeTime` / `expiresIn` helpers — **LOW**

`SurfaceCard.tsx` defines `relativeTime()` and `expiresIn()` locally. These are generic formatting utilities that belong in `utils/format.ts` for reuse and testing.

### 4.5 `Dashboard.tsx` is large (~400+ lines) — **MEDIUM**

The Dashboard component handles: tab state, surface filtering, sorting, search, bulk selection, key-prompt detection, install banner, empty state, and all action handlers.

**Refactor:** Extract:
- `useSurfaceFilters(surfaces, page, selectedType, searchQuery)` → hook
- `useSurfaceSorting(surfaces)` → hook
- `DashboardHeader` → component
- `DashboardTabs` → component (the form/approval/notification tab bar)
- `EmptyState` → component
- `BulkActionBar` → component

### 4.6 `api.ts` uses `any` for all response types — **LOW**

Every API method returns `any` or `any[]`, discarding the `Surface` interface that already exists in the store.

**Refactor:** Type all API methods with the existing `Surface` interface and a new `WhoamiResponse` / `Preferences` / `ApiKey` interface set in `services/types.ts`.

---

## 5. Type Safety

### 5.1 `CreateSurfaceResult` fields typed as `unknown`

`CreateSurfaceResult.task` and `.surface` are typed as `unknown`, forcing `as any` casts in all three protocol handlers (`a2a.ts:60`, `mcp.ts:285`, `surfaces.ts:85`).

**Fix:** Type them concretely:
```typescript
interface CreateSurfaceResult {
  surface: A2UISurface;
  task: A2ATask;
}
```

### 5.2 `as any` / `as never` escape hatch inventory

| Location | Cast | Fix |
|---|---|---|
| `index.ts:68` | `extractAuth(c: any, next: any)` | Type with `Context` + `Next` |
| `api/auth.ts:211` | `authMiddleware(c: any, next: any)` | Same — or delete (§3.2) |
| `domain/surfaces.ts:164` | `(params as any).actionValidation` | Add field to interface properly |
| `api/a2a.ts:60` | `(result.task as any).status` | Type `CreateSurfaceResult.task` |
| `api/mcp.ts:285` | `(result.task as any).status` | Same |
| `api/surfaces.ts:85` | `result.surface as any` | Type `CreateSurfaceResult.surface` |
| `api/surfaces.ts:25–26` | `state as never` | Validate query param as enum |
| `push/index.ts:39` | `(config as any).vapidPublicKey` | Make config field mutable or use separate state |
| `queries.ts:285, 300` | `updates as never` | Use proper Kysely partial update types |

---

## 6. Dead Code Removal

| Symbol | File | Action |
|---|---|---|
| `unarchiveSurface()` | `db/queries.ts:186` | Remove (or wire up if unarchive is desired) |
| `getTemplate()` (singular) | `db/queries.ts:423` | Remove |
| `addToPushQueue()` | `db/queries.ts:438` | Wire up (§3.9) or remove |
| `getPushQueue()` | `db/queries.ts:451` | Same |
| `removeFromPushQueue()` | `db/queries.ts:466` | Same |
| `writeRateLimit()` | `middleware/rateLimit.ts:65` | Remove |
| `readRateLimit()` | `middleware/rateLimit.ts:66` | Remove |
| `buildSurfaceResolvedEvent()` | `sse/events.ts:72` | Wire up in `sseManager.pushSurfaceResolved` or remove |
| `buildNotificationEvent()` | `sse/events.ts:83` | Remove |
| `SSEManager.destroy()` | `sse/manager.ts:122` | Wire to graceful shutdown or remove |
| `agent_connections` table | DB adapter + migrations | Remove (unused, no CRUD) |
| `sessions` table | DB adapter + migrations | Remove (unused, JWT is stateless) |
| `chat_history` table | DB adapter + migrations | Remove (chat client not yet built) |
| `(prefs as any)?.ignored_sources` | `push/index.ts:100` | Remove (column doesn't exist) |

---

## 7. Visual Improvements

### 7.1 Skeleton loading is only on initial load — **MEDIUM**

The dashboard shows skeletons only when `loading` is true (initial mount). Subsequent refetches (after actions, on tab focus) show stale data with no loading indicator.

**Fix:** Add a subtle `isRefreshing` state that shows a thin top progress bar or dims the list slightly during refetches.

### 7.2 Empty `catalog/` directory — **LOW**

`ido-web/src/components/catalog/` exists but is empty. Either populate it (surface template browser — already in TODO.md) or remove the directory.

### 7.3 Inconsistent button border-radius — **LOW**

Buttons use a mix of `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full` with no clear system. The CSS theme defines `--radius-md: 8px` and `--radius-lg: 12px` but components use arbitrary Tailwind radii.

**Fix:** Standardise on a radius scale: `rounded-md` for inputs/small buttons, `rounded-lg` for cards/medium buttons, `rounded-xl` for primary CTAs, `rounded-full` for pills/avatars. Document in the CSS theme.

### 7.4 Error states lack retry action — **MEDIUM**

The dashboard error state (`Dashboard.tsx`) shows the error message but offers no retry button. Users must manually reload.

**Fix:** Add a "Try again" button that calls `api.getSurfaces()` and clears the error.

### 7.5 SSE disconnection has no visible indicator — **MEDIUM**

`sseConnected` is in the store but not shown in the UI. If SSE drops, the user has no idea they're seeing stale data.

**Fix:** Show a subtle "Reconnecting…" banner or a connection-status dot in the header when `!sseConnected`.

### 7.6 `SurfaceView` backdrop click doesn't close during submit — **LOW**

When `submitting` is true, the backdrop `onClick` is set to `undefined` (via `closing ? undefined : onClose`), but there's no visual cue that the modal is locked. Users may click repeatedly.

**Fix:** Add `pointer-events-none` to the backdrop or a subtle opacity reduction when submitting.

### 7.7 Dark-mode error background uses Tailwind red — **LOW**

`SurfaceView.tsx` error box uses `bg-red-50 dark:bg-red-900/20` — hardcoded Tailwind colors instead of the theme's `--color-accent-error` token.

**Fix:** Use `bg-accent-error/10` for consistency with the rest of the theme.

### 7.8 PWA icons need solid backgrounds — **MEDIUM** (already in TODO.md)

Android fills transparent icons with white; iOS shows black. Generate `icon-192.png` / `icon-512.png` with solid `#0F1117` (dark) / `#E8ECF1` (light) backgrounds while keeping the transparent `favicon.svg` for browser tabs.

---

## 8. Compatibility & Usability

### 8.1 `min-h-dvh` — good, but verify Safari < 16.4 — **LOW**

The app uses `min-h-dvh` (dynamic viewport units). Safari 16.4+ supports `dvh`. Older Safari (15.x) does not. If supporting older iOS is required, add a `min-h-screen` fallback before `min-h-dvh`.

### 8.2 Touch action / passive listeners — **LOW**

`SurfaceCard.tsx` and `SurfaceView.tsx` attach `onTouchMove` handlers without `{ passive: false }`. React's synthetic touch events are passive by default in modern browsers, so `preventDefault()` won't work. The swipe handlers don't call `preventDefault()`, so this is currently fine — but if vertical scroll needs to be blocked during horizontal swipe, a native `addEventListener` with `{ passive: false }` will be needed.

### 8.3 Keyboard accessibility — **MEDIUM**

- The settings avatar button in the Dashboard header has no `aria-label` (it has `title="Settings"` but no `aria-label`).
- The SurfaceView close button has `aria-label="Close"` ✓.
- Tab buttons in the Dashboard have no `role="tab"` / `aria-selected`.
- The segmented control in Settings correctly uses `role="tablist"` / `role="tab"` / `aria-selected` ✓ — replicate this pattern in the Dashboard.

### 8.4 Focus management on modal open — **MEDIUM**

`SurfaceView` opens as a modal but doesn't trap focus or move focus into the modal. Keyboard users tab through the background behind the backdrop.

**Fix:** Add focus trapping (trap focus within the modal, return focus to the trigger on close). Use `role="dialog"` + `aria-modal="true"` (already present) plus a focus-trap utility.

### 8.5 `EventSource` doesn't send credentials in all browsers — **LOW**

`useSSE.ts` creates `new EventSource('/sse', { withCredentials: true })`. The `withCredentials` option is supported in modern browsers but not in older ones. Since auth is cookie-based, this is fine for the target audience — just document the browser support requirement.

### 8.6 No `lang` attribute verification — **LOW**

Ensure `index.html` has `<html lang="en">` for screen readers. (Quick check — likely already present.)

---

## 9. Functionality Gaps

### 9.1 Rate-limit middleware exists but is only partially wired — **MEDIUM**

`middleware/rateLimit.ts` is applied to `/api/v1/a2a`, `/api/v1/mcp`, and `/api/v1/surfaces/*` in `index.ts`. But auth routes (`/login`, `/setup`), push routes, and preferences routes have no rate limiting. Brute-force attacks on `/login` are unprotected.

**Fix:** Apply `rateLimit(config.rateLimitWrites)` to `/api/v1/login`, `/api/v1/setup`, `/api/v1/oidc/*`.

### 9.2 Webhook URL validation missing — **MEDIUM** (in TODO.md)

Callback URLs (`configuration.pushNotificationConfig.url`) are not validated before storing. Malformed URLs will cause dispatch failures.

**Fix:** Validate with `z.string().url()` in the validation schema.

### 9.3 A2A agent discovery endpoint missing — **LOW** (in TODO.md)

`GET /.well-known/agent-card.json` is standard A2A spec and makes Ido auto-discoverable.

### 9.4 MCP SSE session map has no cleanup — **MEDIUM**

`mcpSseSessions` in `api/mcp.ts` is a module-level `Map` with no TTL or cleanup. If clients disconnect without a formal session close, entries accumulate indefinitely.

**Fix:** Add a TTL (e.g. 5 minutes) with a sweep interval, or clean up on stream `cancel`.

### 9.5 `JSON.parse` without try-catch in MCP task retrieval — **MEDIUM**

`api/mcp.ts:339–341` parses `components_json`, `schema_json`, `data_json` with no error handling. A corrupted DB row causes a 500.

**Fix:** Wrap in try-catch, return a structured error or skip the field.

### 9.6 Corporate user-scoping not enforced — **HIGH** (detailed plan in TODO.md)

`user_id` is stored but never enforced — all surfaces are visible to the whole tenant. This is a significant multi-tenant security gap for corporate mode. The TODO.md already has a 7-step implementation plan; it should be prioritised.

### 9.7 No graceful shutdown — **LOW**

The server has no `SIGTERM` / `SIGINT` handler. On deploy, in-flight requests and SSE connections are dropped abruptly.

**Fix:**
```typescript
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host });
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
```
Also call `sseManager.destroy()` to close all SSE streams cleanly.

---

## 10. Execution Order

### Phase 1 — Critical Bugs (Day 1 morning)
- [x] **2.1** Fix `authMiddleware` `c.get('db')` bug (or replace with shared `extractAuth`)
- [x] **2.2** Fix quiet-hours to honour stored preferences
- [x] **9.5** Add try-catch around `JSON.parse` in MCP task retrieval

### Phase 2 — Backend Deduplication (Day 1 afternoon – Day 2)
- [x] **3.1** Extract `broadcastSurfaceCreated()` — eliminate triplicated block
- [x] **3.2** Move `extractAuth` → `middleware/auth.ts`, delete `authMiddleware`
- [x] **3.6** Move `AppVariables` → `types.ts`
- [x] **3.3** Extract `seedTemplates` → `db/seeds.ts`, push routes → `api/push.ts`, preferences → `api/preferences.ts`, admin → `api/admin.ts`, version → `version.ts`
- [x] **3.4** Add `requireTenant` middleware, remove 9 inline guards
- [x] **3.7** Move inline DB queries to `queries.ts`
- [x] **3.8** Extract `handleDomainError` helper
- [x] **3.10** Convert `createApiKey` / `createUser` to Kysely builder

### Phase 3 — Migration & DB (Day 2)
- [x] **3.5** Fix 4 migration drifts (state default, sessions status, idempotency unique, PG runner)
- [x] **3.9** Wire up `push_queue` or remove it
- [x] **6** Remove dead code (11 symbols + 3 tables)

### Phase 4 — Frontend Deduplication (Day 3)
- [x] **4.1** Extract shared `StateBadge` component
- [x] **4.2** Extract `useSurfaceActions()` hook
- [x] **4.3** Remove inline `clearSurfaceNotification` in SurfaceView
- [x] **4.4** Move `relativeTime` / `expiresIn` → `utils/format.ts`
- [x] **4.5** Split `Dashboard.tsx` into sub-components
- [x] **4.6** Type all API methods

### Phase 5 — Type Safety (Day 3)
- [x] **5.1** Type `CreateSurfaceResult` concretely
- [x] **5.2** Eliminate all `as any` / `as never` casts

### Phase 6 — Visual & UX (Day 4, incremental)
- [x] **7.1** Add `isRefreshing` indicator
- [x] **7.4** Add retry button to error state
- [x] **7.5** Show SSE connection status
- [x] **7.3** Standardise border-radius scale
- [x] **7.6** Lock SurfaceView backdrop during submit
- [x] **7.7** Use theme tokens for error background
- [x] **7.8** Generate solid-background PWA icons
- [x] **8.3** Add ARIA roles to Dashboard tabs
- [x] **8.4** Add focus trapping to SurfaceView

### Phase 7 — Functionality (Ongoing)
- [x] **9.1** Rate-limit auth routes
- [x] **9.2** Validate webhook URLs
- [x] **9.4** Add TTL to MCP SSE sessions
- [x] **9.7** Add graceful shutdown
- [x] **9.6** Corporate user-scoping (follow TODO.md 7-step plan)
- [x] **9.3** A2A agent discovery endpoint

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration drift fix requires data migration on existing PG deployments | Medium | High | Write a migration that `UPDATE`s existing rows to the canonical values before applying schema changes |
| Extracting `extractAuth` breaks route ordering | Low | Medium | Test all auth paths (cookie, bearer, dev token, API key) after extraction |
| Removing `sessions` / `chat_history` tables breaks future features | Low | Low | Keep them if the chat client (TODO.md) is imminent; otherwise remove and re-add later |
| `push_queue` wiring changes push delivery timing | Medium | Medium | Feature-flag it; keep synchronous push as default until queue is proven |
| Frontend component extraction introduces regressions | Medium | Medium | Extract one component at a time; run the existing test suite (`scripts/ido-test.sh`) after each |
| Corporate user-scoping changes query semantics | High | High | Implement behind `IDO_MODE=corporate` only; add tenant-isolation tests (already in TODO.md) |

---

*This plan is a living document. Update the checkboxes as work progresses.*
