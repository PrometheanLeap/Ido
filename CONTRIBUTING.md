# Contributing to Ido

Thank you for your interest in contributing to Ido! This document covers the development setup, code style, and pull request process.

## Development setup

```bash
# Clone
git clone https://github.com/prometheanleap/ido.git && cd ido

# Install dependencies
cd proxy && npm install && cd ../ido-web && npm install && cd ..

# Configure
cp deploy.env.example .env
# Edit .env — set IDO_MODE=dev for local development

# Start dev servers (hot reload)
bash scripts/dev.sh
# Proxy: http://localhost:8645
# Web:   http://localhost:5173
```

## Project layout

- **`proxy/`** — Hono backend (TypeScript, ESM, NodeNext resolution)
- **`ido-web/`** — React PWA (Vite, Tailwind CSS v4, Zustand)
- **`scripts/`** — Build, deploy, test, and DB utility scripts
- **`tests/`** — Payload-based test suites (positive, negative, demo)

## Code style

### Backend (proxy/)

- **TypeScript strict mode** — no `any` types, no `as any` / `as never` casts
- **ESM with `.js` import specifiers** — `import { x } from './module.js'` (NodeNext)
- **Kysely builder** for all DB queries — no raw SQL template literals
- **Zod schemas** for all API validation — types derived from schemas
- **Single responsibility** — route handlers in `api/`, domain logic in `domain/`, DB access in `db/queries.ts`
- **Shared middleware** — `extractAuth` and `requireTenant` in `middleware/auth.ts`
- **Error handling** — use `handleDomainError(c, err)` for consistent DomainError → HTTP translation

### Frontend (ido-web/)

- **TypeScript strict** — all API responses typed via `services/types.ts`
- **Zustand** for global state — no prop drilling
- **Custom hooks** for reusable logic (`useSurfaceActions`, `useSurfaceFilters`, `useSSE`)
- **Shared components** in `components/shared/` — `StateBadge`, `Logo`
- **Tailwind CSS v4** with theme tokens — use `bg-surface`, `text-primary`, etc. (not hardcoded colors)
- **Border-radius scale**: `rounded-md` (inputs), `rounded-lg` (cards), `rounded-xl` (CTAs), `rounded-2xl` (sheets), `rounded-full` (pills)

### General

- **Commits**: use [Conventional Commits](https://www.conventionalcommits.org/) format
  - `feat: add corporate user-scoping`
  - `fix: quiet hours now honours timezone`
  - `refactor: extract broadcastSurfaceCreated helper`
  - `docs: update README with Cloud Run config`
- **Pull requests**: keep them focused — one feature or refactor per PR

## Testing

```bash
# Full test suite
bash scripts/ido-test.sh

# Demo payloads only
bash scripts/ido-test.sh --suite demo

# With a specific API key
IDO_API_KEY=ido_k_... bash scripts/ido-test.sh
```

All tests must pass before a PR can be merged.

## Pull request process

1. **Fork** the repository and create a feature branch from `main`
2. **Write tests** for any new functionality
3. **Ensure tests pass**: `bash scripts/ido-test.sh`
4. **Update docs** — README, Skills Guide, or REFACTOR_PLAN if applicable
5. **Open a PR** with a clear description of what changed and why

### PR title format

Use Conventional Commits prefixes:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring (no behaviour change)
- `docs:` — documentation only
- `chore:` — build, deps, tooling

## Reporting bugs

Open a [GitHub Issue](https://github.com/prometheanleap/ido/issues) with:
- Ido version (`curl http://localhost:8645/api/v1/health`)
- Deployment mode (`IDO_MODE`)
- Steps to reproduce
- Expected vs actual behaviour
- Relevant logs (redact secrets)

## License

By contributing, you agree that your contributions will be licensed under the [BUSL 1.1](LICENSE) license.
