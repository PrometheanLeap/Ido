# Deployment

## Docker

The same image runs with SQLite or PostgreSQL — the database is chosen at runtime based on whether `DATABASE_URL` is set.

### Build

```bash
bash scripts/build.sh                          # local build → ido:latest
bash scripts/build.sh --tag v2.0.0             # custom tag
bash scripts/build.sh --push --project my-gcp  # build + push to GCR
```

The Dockerfile is multi-stage:
1. Build the proxy (TypeScript → JavaScript)
2. Build the web app (Vite production build)
3. Copy both into a production Node.js image

Result: a single container serving both API and static assets on port 8645.

### Run Locally

```bash
# SQLite (default) — single container, no external DB needed
bash scripts/docker-run.sh

# PostgreSQL — app + postgres containers
bash scripts/docker-run.sh --pg

# Custom mode
bash scripts/docker-run.sh --mode saas

# Stop
bash scripts/docker-run.sh --down
```

Web + API on a single port: `http://localhost:8645`

### Docker Compose

- `docker-compose.yml` — SQLite, single container
- `docker-compose.pg.yml` — PostgreSQL + app, two containers

---

## Google Cloud Run

### Prerequisites

- A GCP project with Cloud Run and Cloud Build enabled
- A PostgreSQL instance (Cloud SQL or equivalent)
- `gcloud` CLI authenticated

### Setup

```bash
cp deploy.env.example deploy.env
```

Edit `deploy.env` with your settings:

| Variable | Description |
|---|---|
| `PROJECT` | GCP project ID |
| `REGION` | Cloud Run region (e.g. `us-west1`) |
| `DATABASE_URL` | PostgreSQL / Cloud SQL connection string |
| `PUBLIC_URL` | Public URL for OIDC callbacks (must be `https`) |
| `IDO_JWT_SECRET` | Session signing key (`openssl rand -hex 32`) |
| `IDO_MODE` | `saas` or `corporate` |
| `IDO_LICENSE_KEY` | License key |
| `OIDC_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `OIDC_GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `MIN_INSTANCES` | Min instances (default: 1 — prevents cold starts) |
| `MAX_INSTANCES` | Max instances (default: 10) |

### Deploy

```bash
# Build + deploy
bash scripts/deploy.sh

# Deploy a prebuilt image
bash scripts/deploy.sh --image gcr.io/my-project/ido:v2.0.0

# Build with Cloud Build (no local Docker)
bash scripts/deploy.sh --cloud-build
```

### Cloud SQL Note

- Register `{PUBLIC_URL}/api/v1/oidc/callback` as the OAuth redirect URI
- If the database uses a private IP in a different project, set `VPC_CONNECTOR` in `deploy.env`
- The Cloud Run service account needs the Cloud SQL Client role

---

## Environment-Specific Notes

### Production Checklist

- [ ] `IDO_JWT_SECRET` set to a strong random value
- [ ] `PUBLIC_URL` set to `https://...`
- [ ] OIDC providers configured with the correct redirect URI
- [ ] `VAPID_SUBJECT` set to a `mailto:` URL
- [ ] `IDO_LICENSE_KEY` set (required for `saas`/`corporate`)
- [ ] Database backups configured
- [ ] Rate limits tuned for expected traffic

### Cold Starts

Cloud Run scales to zero by default. Set `MIN_INSTANCES=1` in `deploy.env` to keep one instance warm and avoid cold start latency.

### Scaling

The proxy is stateless (sessions are JWT, SSE connections are per-instance). Horizontal scaling works without sticky sessions for most operations. SSE connections are tied to a specific instance — if a user reconnects to a different instance, they'll get a fresh SSE stream and a full surface refetch on connect.
