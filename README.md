<div align="center">

# Ido

### AI-to-Human Interaction Gateway

Any AI agent, any protocol, can request a human decision and get a typed, validated response back — on any device, in any deployment model.

[![License: BUSL 1.1](https://img.shields.io/badge/License-BUSL%201.1-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Hono](https://img.shields.io/badge/Hono-v4-E36002)](https://hono.dev)

</div>

---

## What is Ido?

Ido is the **human-in-the-loop terminal** that sits between any AI system and any human. It is not a chat platform. It is not an agent builder. It lets AI agents send structured requests — forms, approvals, notifications — and reliably receive typed, validated responses.

### Core promise

> Any AI agent, any protocol, can request a human decision and get a typed, validated response back — on any device, in any deployment model.

### Key features

- **Three protocols**: A2A (JSON-RPC), MCP (Model Context Protocol), and REST
- **Surface engine**: Forms, approvals, and notifications with a declarative component system (A2UI)
- **Real-time delivery**: SSE streaming + Web Push notifications
- **Four deployment modes**: `dev`, `personal`, `saas`, `corporate`
- **Dual database**: SQLite for development, PostgreSQL for production — same image
- **PWA**: Installable, offline-capable, push notifications on mobile
- **Multi-tenant**: Tenant isolation built-in, corporate user-scoping supported
- **Callback dispatch**: Exponential backoff with jitter, reliable agent callbacks
- **Agent discovery**: Standard `/.well-known/agent-card.json` endpoint

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/prometheanleap/ido.git && cd ido
cd proxy && npm install && cd ../ido-web && npm install && cd ..

# Configure
cp deploy.env.example .env
# Edit .env — set IDO_MODE, OIDC credentials, etc.

# Run (dev mode)
bash scripts/dev.sh
# Proxy: http://localhost:8645
# Web:   http://localhost:5173
```

Verify it's running:

```bash
curl http://localhost:8645/api/v1/health
# {"status":"ok","mode":"dev","version":"..."}
```

---

## Deployment Modes

One binary, one env var (`IDO_MODE`), four behaviours:

| Mode | Auth | Tenancy | API Keys | Typical use |
|---|---|---|---|---|
| `dev` | Auto-login (`dev`/`dev`) | Single `dev` tenant | Default tenant | Local development |
| `personal` | Username+password or OIDC | One tenant per user | User-scoped | Self-hosted solo |
| `saas` | OIDC (Google / Microsoft) | One tenant per email | Key-scoped to tenant | Multi-tenant cloud |
| `corporate` | OIDC (Google / Microsoft) | Org = tenant, users scoped | Org-scoped, `user_id` required | Enterprise |

All four modes are first-class. Behaviour divergence is controlled by a single `ModePolicy` object derived at startup — not scattered if/else checks.

### Corporate mode

In corporate mode, `user_id` is **required** on every surface — it scopes the surface to a specific recipient within the tenant. Users see only their own surfaces plus unassigned ones. Domain validation and unknown-user rejection are configurable:

| Variable | Default | Description |
|---|---|---|
| `IDO_CORP_ALLOWED_DOMAINS` | *(empty = all)* | Comma-separated allowed email domains |
| `IDO_CORP_ALLOW_UNKNOWN_USERS` | `false` | Allow surfaces for recipients who haven't logged in yet |

---

## Architecture

```
AI Agents (A2A / MCP / REST)
        │
        ▼
┌─────────────────────┐
│   Ido Proxy (Hono)  │  Node.js 22, TypeScript, SQLite/PostgreSQL
│  • Protocol routing │
│  • Auth + sessions  │
│  • Surface engine   │
│  • SSE + Web Push   │
│  • Callback dispatch│
└────────┬────────────┘
         │ SSE · Web Push
         ▼
┌─────────────────────┐
│   Ido Web (React)   │  React 19, Vite 6, Tailwind CSS v4
│  • Dashboard        │
│  • Surface viewer   │
│  • Settings / API   │
│  • PWA + push       │
└─────────────────────┘
```

### Project structure

```
Ido/
├── proxy/              # Backend — Hono API server
│   └── src/
│       ├── api/        # Route handlers (a2a, mcp, surfaces, auth, oidc, push, preferences)
│       ├── auth/       # Session tokens, API keys, OIDC, mode policy
│       ├── a2a/        # Skills guide (agent-facing API docs)
│       ├── a2ui/       # A2UI component schema + renderer
│       ├── db/         # Kysely adapter, queries, migrations, seeds
│       ├── domain/     # Surface lifecycle, dispatch, expiry
│       ├── middleware/ # Auth extraction, rate limiting
│       ├── push/       # Web Push (VAPID) + quiet hours
│       ├── sse/        # Server-Sent Events manager
│       └── config.ts   # Mode policy, env parsing
├── ido-web/            # Frontend — React PWA
│   └── src/
│       ├── components/ # Dashboard, surface, settings, shared
│       ├── hooks/      # useSSE, useSurfaceActions, useSurfaceFilters, useInstallPrompt
│       ├── services/   # API client + typed response interfaces
│       ├── stores/     # Zustand state
│       ├── styles/     # Tailwind CSS v4 theme
│       └── utils/      # Format, navigation, push
├── scripts/            # Build, deploy, dev, test, DB utilities
├── tests/              # Payload-based test suites
├── Dockerfile          # Multi-stage: proxy + web → single image
└── docker-compose.yml  # SQLite single-container
```

---

## API Protocols

All three protocols call a single shared `createSurface()` function — no duplicate logic.

### A2A (Agent-to-Agent JSON-RPC)

```bash
curl -X POST http://localhost:8645/api/v1/a2a \
  -H "Content-Type: application/json" \
  -H "X-Ido-Api-Key: ido_k_..." \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "surface_type": "approval",
      "surface_title": "Approve deployment to production?",
      "context": "PR #142 ready to merge",
      "configuration": {
        "pushNotificationConfig": {
          "url": "https://my-agent.example.com/callback"
        }
      }
    },
    "id": 1
  }'
```

### MCP (Model Context Protocol)

Available tools (call `tools/list` for the full schema):

| Tool | Description |
|---|---|
| `ido_get_skills_guide` | Full component catalog, templates, and validation rules |
| `ido_send_task` | Create a surface (form/approval/notification) |
| `ido_check_task` | Poll task status and result |
| `ido_list_tasks` | List tasks for this API key |
| `ido_read_task` | Read full surface details |
| `ido_answer_task` | Submit a response (agent-as-human) |
| `ido_cancel_task` | Cancel a pending task — works on any surface type, no fields required |

```bash
curl -X POST http://localhost:8645/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "X-Ido-Api-Key: ido_k_..." \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "ido_send_task",
      "arguments": { ... }
    },
    "id": 1
  }'
```

### REST

```bash
curl -X POST http://localhost:8645/api/v1/surfaces \
  -H "Content-Type: application/json" \
  -H "X-Ido-Api-Key: ido_k_..." \
  -d '{"surface_type":"form","surface_title":"Approval Request",...}'
```

### Agent discovery

```bash
curl http://localhost:8645/.well-known/agent-card.json
```

### Skills Guide

The full API reference — component catalog, templates, validation rules — is served at runtime:

```
GET /api/v1/skills-guide    # Human-readable guide for agents
GET /api/v1/schema          # Machine-readable JSON Schema
GET /api/v1/templates       # Available surface templates
```

Point your AI agent at the Skills Guide before sending its first task — it describes every component, template, and rule the system enforces.

---

## Configuration

Copy `deploy.env.example` to `.env`:

| Variable | Required | Description |
|---|---|---|
| `IDO_MODE` | Yes | `dev`, `personal`, `saas`, or `corporate` |
| `IDO_JWT_SECRET` | Production | Session signing key (auto-generated in dev) |
| `DATABASE_URL` | PostgreSQL | PG connection string (omit for SQLite) |
| `SQLITE_PATH` | SQLite | Path to SQLite file (default: `data/ido.db`) |
| `OIDC_GOOGLE_CLIENT_ID` | SaaS/Corporate | Google OAuth client ID |
| `OIDC_GOOGLE_CLIENT_SECRET` | SaaS/Corporate | Google OAuth secret |
| `OIDC_MICROSOFT_CLIENT_ID` | SaaS/Corporate | Microsoft Entra ID client |
| `OIDC_MICROSOFT_CLIENT_SECRET` | SaaS/Corporate | Microsoft Entra ID secret |
| `OIDC_MICROSOFT_TENANT` | SaaS/Corporate | Microsoft tenant ID (`common` for multi-tenant) |
| `PUBLIC_URL` | Production | Public URL for OIDC callbacks |
| `IDO_ORG_SLUG` | Corporate | Organization tenant identifier |
| `IDO_ADMIN_EMAILS` | Corporate | Comma-separated admin emails |
| `IDO_CORP_ALLOWED_DOMAINS` | Corporate | Comma-separated allowed email domains (empty = all) |
| `IDO_CORP_ALLOW_UNKNOWN_USERS` | Corporate | `true` = allow surfaces for unauthenticated recipients |
| `VAPID_SUBJECT` | Production | `mailto:` URL for web push |
| `IDO_LICENSE_KEY` | SaaS/Corporate | License key (required for production SaaS/corporate) |
| `RATE_LIMIT_AUTH` | Optional | Auth route rate limit (default: 20/min) |
| `RATE_LIMIT_READS` | Optional | Protocol endpoint rate limit (default: 600/min) |

### Setting up OIDC (SaaS / Corporate mode)

#### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized redirect URI: `https://yourdomain.com/api/v1/oidc/callback`
5. Copy the **Client ID** and **Client Secret**

#### Microsoft Entra ID

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. **New registration** → choose accounts (multi-tenant = `common`)
3. Redirect URI: Web → `https://yourdomain.com/api/v1/oidc/callback`
4. **Certificates & secrets → New client secret**
5. Copy the **Application (client) ID** and **Secret Value**

For local development, use `PUBLIC_URL=http://localhost:8645` and set the redirect URI accordingly.

---

## Docker

The same image runs with **SQLite or PostgreSQL** — the database is chosen at runtime.

### Build

```bash
bash scripts/build.sh                          # local build → ido:latest
bash scripts/build.sh --tag v2.0.0             # custom tag
bash scripts/build.sh --push --project my-gcp  # build + push to GCR
```

### Run locally

```bash
# SQLite (default) — single container
bash scripts/docker-run.sh

# PostgreSQL — app + postgres containers
bash scripts/docker-run.sh --pg

# Custom mode
bash scripts/docker-run.sh --mode saas

# Stop
bash scripts/docker-run.sh --down
```

Web + API on a single port: `http://localhost:8645`

---

## Google Cloud Run

```bash
# One-time setup
cp deploy.env.example deploy.env
# Edit deploy.env: PROJECT, DATABASE_URL, PUBLIC_URL, OIDC secrets, license key

# Deploy
bash scripts/deploy.sh

# Deploy a prebuilt image
bash scripts/deploy.sh --image gcr.io/my-project/ido:v2.0.0

# Build with Cloud Build
bash scripts/deploy.sh --cloud-build
```

Key `deploy.env` settings:

| Variable | Description |
|---|---|
| `PROJECT` | GCP project ID |
| `REGION` | Cloud Run region (e.g. `us-west1`) |
| `DATABASE_URL` | PostgreSQL / Cloud SQL connection string |
| `PUBLIC_URL` | Public URL for OIDC callbacks (must be `https`) |
| `JWT_SECRET` | Session signing key (`openssl rand -hex 32`) |
| `IDO_LICENSE_KEY` | License key (required for `saas` / `corporate`) |
| `MIN_INSTANCES` | Min Cloud Run instances (default: 1 — prevents cold starts) |
| `MAX_INSTANCES` | Max instances (default: 10) |

> **Cloud SQL note:** register `{PUBLIC_URL}/api/v1/oidc/callback` as the OAuth redirect URI. If the database is a private IP in a different project, set `VPC_CONNECTOR` in `deploy.env`.

---

## Testing

```bash
bash scripts/ido-test.sh                 # full suite
bash scripts/ido-test.sh --suite demo    # demo payloads
IDO_API_KEY=ido_k_... bash scripts/ido-test.sh demo
```

Test suites include:
- **Protocol validation**: 11 shared payloads × 3 protocols = 33 tests
- **Surface lifecycle**: 35 tests (forms, approvals, notifications, archive, required fields, prefill, idempotency)
- **Negative validation**: 6 payloads × 3 protocols
- **Demo payloads**: 15 rich UI showcases
- **Security**: SQL injection, XSS, null byte, auth failures

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Proxy** | Node.js 22, Hono v4, Kysely, openid-client, web-push |
| **Web** | React 19, Vite 6, Tailwind CSS v4, Zustand |
| **Database** | SQLite (better-sqlite3) / PostgreSQL (pg) |
| **Infra** | Docker, Google Cloud Run |
| **Validation** | Zod (schema-first, types derived) |
| **Auth** | JWT (HS256 sessions) + OIDC (RS256, Google/Microsoft) |

---

## Development

```bash
# Start both servers in dev mode (hot reload)
bash scripts/dev.sh

# Proxy runs on :8645, Web on :5173
# The Vite dev server proxies /api and /sse to the proxy

# Run tests
bash scripts/ido-test.sh

# Database utilities
bash scripts/db-backup.sh
bash scripts/db-restore.sh
bash scripts/db-clean.sh
bash scripts/db-switch-mode.sh
```

The codebase has two main packages:
- **`proxy/`** — the Hono backend (API server, surface engine, auth, push, SSE)
- **`ido-web/`** — the React PWA (dashboard, surface viewer, settings)

Both are TypeScript strict mode. The proxy uses ESM with `.js` import specifiers (NodeNext resolution).

---

## License

**Business Source License 1.1** (BUSL 1.1) — see [LICENSE](LICENSE).

- **Free** for development, testing, and personal use (`IDO_MODE=dev` or `personal`)
- **Commercial license required** for production SaaS or corporate deployment
- Converts to **MIT** on the Change Date (2030-07-03)

For commercial licensing, contact the Licensor.

---

<div align="center">

**[Quick Start](#quick-start) · [Skills Guide](http://localhost:8645/api/v1/skills-guide) · [Changelog](CHANGELOG.md)**

</div>
