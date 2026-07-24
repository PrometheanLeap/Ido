# Development

## Local Setup

```bash
# Clone and install
git clone https://github.com/prometheanleap/ido.git && cd ido
cd proxy && npm install && cd ../ido-web && npm install && cd ..

# Start dev servers (hot reload)
bash scripts/dev.sh
```

This starts:
- **Proxy** on `http://localhost:8645` — Hono API server with file-watching
- **Web** on `http://localhost:5173` — Vite dev server, proxies `/api` and `/sse` to the proxy

In `dev` mode, you're auto-logged in as `dev`/`dev` — no configuration needed.

---

## Codebase

The project has two packages:

### `proxy/` — Backend (Hono)

- Node.js 22, TypeScript strict mode
- ESM with `.js` import specifiers (NodeNext module resolution)
- Kysely ORM with dual SQLite/PostgreSQL adapter
- Entry: `proxy/src/index.ts`

### `ido-web/` — Frontend (React)

- React 19, Vite 6, Tailwind CSS v4
- Zustand for state management
- Entry: `ido-web/src/main.tsx`

---

## Testing

```bash
# Full test suite
bash scripts/ido-test.sh

# Demo payloads only
bash scripts/ido-test.sh --suite demo

# With a specific API key
IDO_API_KEY=ido_k_... bash scripts/ido-test.sh demo
```

### Test Suites

| Suite | Contents |
|---|---|
| Protocol validation | 11 shared payloads × 3 protocols = 33 tests |
| Surface lifecycle | 35 tests — forms, approvals, notifications, archive, required fields, prefill, idempotency |
| Negative validation | 6 payloads × 3 protocols — invalid/malicious inputs |
| Demo payloads | 15 rich UI showcases |
| Security | SQL injection, XSS, null byte, auth failures |

Test payloads live in `tests/payloads/`:
- `positive/` — valid surface payloads
- `negative/` — invalid/malicious payloads
- `demo/` — rich UI showcase payloads

---

## Database Utilities

```bash
# Backup SQLite database
bash scripts/db-backup.sh

# Restore from backup
bash scripts/db-restore.sh

# Wipe database and reseed
bash scripts/db-clean.sh

# Switch deployment mode (dev ↔ personal ↔ saas ↔ corporate)
bash scripts/db-switch-mode.sh

# Switch database backend (SQLite ↔ PostgreSQL)
bash scripts/db-switch-mode.sh --pg
```

Backups are stored in `scripts/backups/`.

---

## Project Conventions

- **TypeScript strict mode** — both packages
- **ESM** — proxy uses `.js` import specifiers with NodeNext resolution
- **Zod** — schema-first validation with types derived from schemas
- **No scattered conditionals** — deployment mode behaviour via `ModePolicy` object
- **Single surface engine** — all three protocols call the same `createSurface()` function
- **SSE for real-time** — server pushes `surface_update` and `surface_resolved` events
- **A2UI for UI** — surfaces carry declarative component definitions, not hardcoded layouts
