# Configuration

## Environment Variables

Copy `deploy.env.example` to `.env` (local) or `deploy.env` (Cloud Run).

### Core

| Variable | Required | Description |
|---|---|---|
| `IDO_MODE` | Yes | `dev`, `personal`, `saas`, or `corporate` |
| `IDO_JWT_SECRET` | Production | Session signing key. Auto-generated in `dev` mode. Generate with `openssl rand -hex 32`. |
| `PUBLIC_URL` | Production | Public URL for OIDC callbacks (e.g. `https://ido.example.com`) |

### Database

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | PG connection string. Omit for SQLite. |
| `SQLITE_PATH` | SQLite | Path to SQLite file. Default: `data/ido.db`. |

The same Docker image works with either — the database is chosen at runtime. If `DATABASE_URL` is set, PostgreSQL is used. Otherwise, SQLite.

### OIDC (SaaS / Corporate mode)

| Variable | Required | Description |
|---|---|---|
| `OIDC_GOOGLE_CLIENT_ID` | SaaS/Corporate | Google OAuth client ID |
| `OIDC_GOOGLE_CLIENT_SECRET` | SaaS/Corporate | Google OAuth client secret |
| `OIDC_MICROSOFT_CLIENT_ID` | SaaS/Corporate | Microsoft Entra ID application (client) ID |
| `OIDC_MICROSOFT_CLIENT_SECRET` | SaaS/Corporate | Microsoft Entra ID client secret |
| `OIDC_MICROSOFT_TENANT` | SaaS/Corporate | Microsoft tenant ID. Use `common` for multi-tenant. |

### Corporate mode

| Variable | Default | Description |
|---|---|---|
| `IDO_ORG_SLUG` | *(required)* | Organization tenant identifier |
| `IDO_ADMIN_EMAILS` | *(required)* | Comma-separated admin emails |
| `IDO_CORP_ALLOWED_DOMAINS` | *(empty = all)* | Comma-separated allowed email domains |
| `IDO_CORP_ALLOW_UNKNOWN_USERS` | `false` | `true` = allow surfaces for recipients who haven't logged in yet |

### Web Push

| Variable | Required | Description |
|---|---|---|
| `VAPID_SUBJECT` | Production | `mailto:` URL (e.g. `mailto:admin@example.com`) |

### Rate Limiting

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_AUTH` | `20` | Auth route rate limit (per minute) |
| `RATE_LIMIT_READS` | `600` | Protocol endpoint rate limit (per minute) |

### License

| Variable | Required | Description |
|---|---|---|
| `IDO_LICENSE_KEY` | SaaS/Corporate | License key for production SaaS or corporate deployment |

### Expiry Sweep

| Variable | Default | Description |
|---|---|---|
| `EXPIRY_SWEEP_MS` | `3600000` (1 hour) | Interval between expired surface sweeps |

---

## Deployment Modes

One image, one env var (`IDO_MODE`), four behaviours. Mode policy is derived at startup — no scattered conditionals.

| Mode | Auth | Tenancy | API Keys | Typical Use |
|---|---|---|---|---|
| `dev` | Auto-login (`dev`/`dev`) | Single `dev` tenant | Default tenant key | Local development |
| `personal` | Username+password or OIDC | One tenant per user | User-scoped | Self-hosted solo |
| `saas` | OIDC (Google / Microsoft) | One tenant per email | Key-scoped to tenant | Multi-tenant cloud |
| `corporate` | OIDC (Google / Microsoft) | Org = tenant, users scoped | Org-scoped, `user_id` required | Enterprise |

### Corporate mode details

In corporate mode:
- `user_id` is **required** on every surface — scopes to a specific recipient
- Users see only their own surfaces plus unassigned ones
- Domain validation via `IDO_CORP_ALLOWED_DOMAINS`
- Unknown users can be allowed or rejected via `IDO_CORP_ALLOW_UNKNOWN_USERS`

---

## Setting Up OIDC

### Google

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized redirect URI: `https://yourdomain.com/api/v1/oidc/callback`
5. Copy the **Client ID** and **Client Secret** to your `.env`

### Microsoft Entra ID

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. **New registration** → choose accounts (multi-tenant = `common`)
3. Redirect URI: Web → `https://yourdomain.com/api/v1/oidc/callback`
4. **Certificates & secrets → New client secret**
5. Copy the **Application (client) ID** and **Secret Value** to your `.env`

For local development, use `PUBLIC_URL=http://localhost:8645` and set the redirect URI accordingly.

---

## Switching Modes

To switch between SQLite and PostgreSQL, or between deployment modes:

```bash
# Switch mode (dev ↔ personal ↔ saas ↔ corporate)
bash scripts/db-switch-mode.sh

# Switch database (SQLite ↔ PostgreSQL)
bash scripts/db-switch-mode.sh --pg
```

This backs up your current data and seeds the new database with the appropriate defaults.
