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

- **Three protocols** — A2A (JSON-RPC), MCP (Model Context Protocol), and REST — all calling the same surface engine
- **Declarative UI** — forms, approvals, and notifications rendered from a component schema (A2UI)
- **Real-time delivery** — SSE streaming + Web Push notifications
- **Four deployment modes** — `dev`, `personal`, `saas`, `corporate` — one image, no code change
- **Dual database** — SQLite for development, PostgreSQL for production
- **PWA** — installable, offline-capable, push notifications on mobile
- **Multi-tenant** — tenant isolation built in, corporate user-scoping supported

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/prometheanleap/ido.git && cd ido
cd proxy && npm install && cd ../ido-web && npm install && cd ..

# Configure
cp deploy.env.example .env
# Edit .env — set IDO_MODE, OIDC credentials, etc.
# (dev mode works out-of-the-box with no changes)

# Run
bash scripts/dev.sh
# Proxy: http://localhost:8645
# Web:   http://localhost:5173
```

Verify:

```bash
curl http://localhost:8645/api/v1/health
# {"status":"ok","mode":"dev","version":"..."}
```

That's it. In `dev` mode, you're auto-logged in as `dev`/`dev`. Start sending surfaces from any AI agent via A2A, MCP, or REST — they'll appear in your dashboard.

---

## Documentation

| Document | Covers |
|---|---|
| [Architecture](Docs/ARCHITECTURE.md) | Project structure, data flow, tech stack |
| [Configuration](Docs/CONFIGURATION.md) | Environment variables, deployment modes, OIDC setup |
| [API Reference](Docs/API.md) | A2A, MCP, and REST protocols; agent discovery; skills guide |
| [Deployment](Docs/DEPLOYMENT.md) | Docker, Google Cloud Run, deploy scripts |
| [Development](Docs/DEVELOPMENT.md) | Local setup, testing, database utilities |

---

## License

**Business Source License 1.1** (BUSL 1.1) — see [LICENSE](LICENSE).

- **Free** for development, testing, and personal use (`IDO_MODE=dev` or `personal`)
- **Commercial license required** for production SaaS or corporate deployment
- Converts to **MIT** on the Change Date (2030-07-03)

For commercial licensing, contact the Licensor.

---

<div align="center">

**[Quick Start](#quick-start) · [API Reference](Docs/API.md) · [Changelog](CHANGELOG.md)**

</div>
