# Changelog

All notable changes to Ido are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- A2A agent discovery endpoint (`GET /.well-known/agent-card.json`)
- Rate limiting on auth routes (`/login`, `/setup`, `/oidc/*`)
- MCP SSE session TTL (5-minute timeout with sweep)
- Graceful shutdown (SIGTERM/SIGINT handlers)
- `isRefreshing` indicator on the dashboard
- SSE connection status indicator in the header
- Retry button on dashboard error state
- Focus trapping in SurfaceView modal
- ARIA roles on Dashboard type-filter tabs
- Solid-background PWA icons (`#0F1117`)
- Border-radius scale documented in CSS theme

### Fixed
- **Critical**: API-key auth on key-management routes was silently broken (`c.get('db')` never set)
- **Critical**: Quiet hours now honours `quiet_start`, `quiet_end`, `quiet_timezone`, and `quiet_days` preferences
- MCP task retrieval no longer 500s on corrupted JSON blobs (try-catch added)
- Migration drift between SQLite and PostgreSQL fixed (state default, sessions status, idempotency UNIQUE)
- SurfaceView backdrop locked during submit (no more accidental close on click)

### Changed
- `CreateSurfaceResult.task` and `.surface` typed concretely (`A2ATask`, `A2UISurface`) — eliminates `as any` casts
- All API methods in `api.ts` now return typed responses instead of `any`
- `extractAuth` and `requireTenant` extracted to `middleware/auth.ts` — single shared middleware
- `broadcastSurfaceCreated()` extracted to `domain/surfaces.ts` — eliminates triplicated SSE+push block
- `seedTemplates()` extracted to `db/seeds.ts`
- Push routes extracted to `api/push.ts`
- Preferences routes extracted to `api/preferences.ts`
- Version loading extracted to `version.ts`
- `AppVariables` moved to `types.ts` (was imported backwards from `index.ts`)
- `handleDomainError()` helper extracted — replaces 4 identical catch blocks
- `createApiKey` and `createUser` converted from raw SQL to Kysely builder
- Dashboard split into sub-components: `DashboardHeader`, `DashboardTabs`, `EmptyState`, `BottomNav`, `SearchBar`, `DismissAllModal`
- `useSurfaceFilters` hook extracted from Dashboard
- `useSurfaceActions` hook centralises the "API call → refetch" pattern
- Shared `StateBadge` component replaces two duplicate definitions
- `relativeTime`, `expiresIn`, `formatDuration` moved to `utils/format.ts`
- `index.ts` reduced from ~540 to ~290 lines

### Removed
- Dead code: `unarchiveSurface`, `getTemplate`, `addToPushQueue`, `getPushQueue`, `removeFromPushQueue`
- Dead code: `buildSurfaceResolvedEvent`, `buildNotificationEvent`, `writeRateLimit`, `readRateLimit`
- Unused DB tables: `agent_connections`, `sessions`, `chat_history`, `push_queue`
- Duplicate `authMiddleware` in `api/auth.ts` (replaced by shared `extractAuth`)
- Inline `clearSurfaceNotification` in SurfaceView (uses shared util from `utils/push.ts`)
- `(prefs as any)?.ignored_sources` reference (column never existed)
