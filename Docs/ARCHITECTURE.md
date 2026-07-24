# Architecture

## High-Level Flow

```
AI Agents (A2A / MCP / REST)
        │
        ▼
┌──────────────────────────────────────┐
│          Ido Proxy (Hono)            │
│  Node.js 22 · TypeScript             │
│                                      │
│  • Protocol routing (A2A/MCP/REST)   │
│  • Auth — JWT sessions + API keys    │
│  • Surface engine — create, submit,  │
│    cancel, dismiss, expiry sweep     │
│  • SSE manager — real-time push to   │
│    connected web clients             │
│  • Web Push — VAPID-based, quiet     │
│    hours, subscription tracking      │
│  • Callback dispatch — exponential   │
│    backoff with jitter to agents     │
└──────────────┬───────────────────────┘
               │ SSE · Web Push
               ▼
┌──────────────────────────────────────┐
│          Ido Web (React)             │
│  React 19 · Vite 6 · Tailwind CSS v4 │
│                                      │
│  • Dashboard — inbox + history tabs  │
│  • SurfaceView — forms, approvals,   │
│    notifications with A2UI renderer  │
│  • Settings — API keys, theme,       │
│    profile, push prefs               │
│  • PWA — service worker, install     │
│    prompt, offline support           │
└──────────────────────────────────────┘
```

## Data Flow

1. **Agent sends a surface** via A2A, MCP, or REST → all call `createSurface()` in `domain/surfaces.ts`
2. **Surface stored** in SQLite/PostgreSQL with state `INPUT_REQUIRED` (or `COMPLETED` for notifications)
3. **SSE event broadcast** — `surface_update` pushed to all connected clients for the tenant
4. **Web Push sent** — if the target user is offline and has a push subscription, a browser notification is delivered
5. **User opens surface** — full record fetched on demand (`GET /surfaces/:id`), A2UI components rendered
6. **User submits** → `submitSurface()` → state transitions to `COMPLETED`/`REJECTED` → SSE `surface_resolved` broadcast → callback dispatched to agent

## Project Structure

```
Ido/
├── proxy/                  # Backend — Hono API server
│   └── src/
│       ├── api/            # Route handlers
│       │   ├── a2a.ts      #   Agent-to-Agent JSON-RPC
│       │   ├── mcp.ts      #   Model Context Protocol
│       │   ├── surfaces.ts #   CRUD, submit, dismiss, decline
│       │   ├── auth.ts     #   Login, logout, whoami
│       │   ├── oidc.ts     #   OIDC flow (Google/Microsoft)
│       │   ├── push.ts     #   Web Push subscription management
│       │   ├── preferences.ts
│       │   └── validation.ts
│       ├── auth/           # Auth primitives
│       │   ├── session.ts  #   JWT session tokens (HS256)
│       │   ├── keys.ts     #   API key management
│       │   ├── oidc.ts     #   OIDC client setup
│       │   └── policy.ts   #   ModePolicy (dev/personal/saas/corporate)
│       ├── a2a/            # Agent-facing docs
│       │   └── skills-guide.ts
│       ├── a2ui/           # A2UI component system
│       │   ├── schema.ts   #   Component type definitions
│       │   ├── renderer.ts #   Server-side renderer
│       │   └── auto.ts     #   Auto-form generation
│       ├── db/             # Database layer (Kysely ORM)
│       │   ├── adapter.ts  #   SQLite + PostgreSQL adapters
│       │   ├── queries.ts  #   All DB queries
│       │   ├── migrate.ts  #   Migration runner
│       │   ├── pg-migrations.ts
│       │   ├── pg.ts       #   PostgreSQL-specific setup
│       │   ├── sqlite.ts   #   SQLite-specific setup
│       │   ├── seeds.ts    #   Dev seed data
│       │   └── migrations/ #   SQL migration files
│       ├── domain/         # Business logic
│       │   ├── surfaces.ts #   Create, submit, cancel, dismiss
│       │   ├── dispatch.ts #   Callback dispatch to agents
│       │   ├── expiry.ts   #   Expired surface sweep
│       │   └── tasks.ts    #   Task lifecycle
│       ├── middleware/      # Hono middleware
│       │   ├── auth.ts     #   Session + API key extraction
│       │   └── rateLimit.ts
│       ├── push/           # Web Push
│       │   └── index.ts    #   VAPID, subscriptions, quiet hours
│       ├── sse/            # Server-Sent Events
│       │   ├── manager.ts  #   SSE connection manager
│       │   └── events.ts   #   Event builders
│       ├── config.ts       # Env parsing, mode policy
│       ├── types.ts        # Shared TypeScript types
│       └── index.ts        # App entry point
├── ido-web/                # Frontend — React PWA
│   └── src/
│       ├── components/
│       │   ├── dashboard/  #   Dashboard, inbox, history, cards
│       │   ├── surface/    #   SurfaceView (forms, approvals, notifications)
│       │   ├── settings/   #   API keys, theme, profile, push
│       │   ├── setup/      #   Initial setup wizard
│       │   ├── shared/     #   StateBadge, modals, etc.
│       │   └── catalog/    #   Component showcase
│       ├── hooks/          # React hooks
│       │   ├── useSSE.ts           # SSE event handling
│       │   ├── useSurfaceActions.ts # Swipe/action handlers
│       │   ├── useSurfaceFilters.ts # Inbox/history partitioning
│       │   └── useInstallPrompt.ts  # PWA install
│       ├── services/
│       │   ├── api.ts       # API client
│       │   └── types.ts     # Response type definitions
│       ├── stores/
│       │   └── useStore.ts  # Zustand global state
│       ├── styles/
│       │   └── index.css    # Tailwind CSS v4
│       └── utils/
│           ├── format.ts    # Duration, date formatting
│           ├── navigation.ts
│           └── push.ts      # Push notification helpers
├── scripts/                # Shell utilities
│   ├── dev.sh              # Start dev servers
│   ├── build.sh            # Docker build
│   ├── deploy.sh           # Cloud Run deploy
│   ├── docker-run.sh       # Local Docker run
│   ├── ido-test.sh         # Test runner
│   ├── db-backup.sh        # SQLite backup
│   ├── db-restore.sh       # SQLite restore
│   ├── db-clean.sh         # DB wipe
│   └── db-switch-mode.sh   # Switch deployment mode
├── tests/                  # Test payloads
│   └── payloads/
│       ├── positive/       # Valid surface payloads
│       ├── negative/       # Invalid/malicious payloads
│       └── demo/           # Rich UI showcase payloads
├── shared/                 # Shared constants/types
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # SQLite single-container
└── docker-compose.pg.yml   # PostgreSQL + app
```

## Tech Stack

| Layer | Technology |
|---|---|
| **Proxy** | Node.js 22, Hono v4, Kysely ORM, openid-client, web-push |
| **Web** | React 19, Vite 6, Tailwind CSS v4, Zustand |
| **Database** | SQLite (better-sqlite3) / PostgreSQL (pg) — dual adapter |
| **Validation** | Zod (schema-first, types derived) |
| **Auth** | JWT HS256 (sessions) + RS256 (OIDC from Google/Microsoft) |
| **Infra** | Docker, Google Cloud Run |

## Key Design Decisions

### Single surface engine

All three protocols (A2A, MCP, REST) call the same `createSurface()` function in `domain/surfaces.ts`. Protocol-specific logic is limited to request parsing in the route handlers — the surface lifecycle is unified.

### Mode policy, not if/else

Deployment mode behaviour is controlled by a single `ModePolicy` object derived at startup from `IDO_MODE`. Auth, tenancy, and API key scoping are policy-driven rather than scattered conditionals.

### Dual database adapter

The Kysely query builder is database-agnostic. `db/adapter.ts` selects between SQLite and PostgreSQL based on `DATABASE_URL`. All queries are written once against the Kysely interface.

### SSE + Web Push

Surfaces are delivered to the web client via SSE when the user is connected. If the user is offline, a Web Push notification (VAPID) is sent. On click, the PWA opens and fetches the surface.

### A2UI declarative components

Surfaces carry a `components_json` array and `schema_json` that describe the UI declaratively. The React `SurfaceView` renders components dynamically — no hardcoded form layouts. This lets agents describe any UI shape without the proxy or web client knowing about it in advance.
