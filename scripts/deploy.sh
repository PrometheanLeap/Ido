#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Ido Cloud Run Deploy ─────────────────────────────────────
# Deploys Ido to Google Cloud Run. Reads config from deploy.env.
#
# Setup (once):
#   cp deploy.env.example deploy.env
#   # edit deploy.env with your project, database, secrets
#
# Deploy:
#   bash scripts/deploy.sh                    # build + deploy using deploy.env
#   bash scripts/deploy.sh --image IMG        # deploy a prebuilt image (skip build)
#   bash scripts/deploy.sh --cloud-build      # build with Cloud Build instead of local Docker
#   bash scripts/deploy.sh --env-file staging.env   # use a different config file
#
# By default this builds the image LOCALLY (docker) and pushes to GCR,
# then deploys. Use --cloud-build to build server-side instead.

ENV_FILE="deploy.env"
IMAGE=""
BUILD_MODE="local"   # local | cloud | none

# ── Parse flags (override env file) ──────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --image) IMAGE="$2"; BUILD_MODE="none"; shift 2 ;;
    --cloud-build) BUILD_MODE="cloud"; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Load config ──────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found."
  echo "Create it:  cp deploy.env.example deploy.env"
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

# Defaults
REGION="${REGION:-us-west1}"
SERVICE_NAME="${SERVICE_NAME:-ido}"
IDO_MODE="${IDO_MODE:-saas}"
MEMORY="${MEMORY:-512Mi}"
CPU="${CPU:-1}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"

# ── Validate ─────────────────────────────────────────────────
[ -z "${PROJECT:-}" ] && { echo "Error: PROJECT not set in $ENV_FILE"; exit 1; }
[ -z "${DATABASE_URL:-}" ] && { echo "Error: DATABASE_URL not set in $ENV_FILE"; exit 1; }

if [ -z "${JWT_SECRET:-}" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  echo "⚠  JWT_SECRET blank — auto-generated (sessions reset on next deploy)."
fi

[ -z "$IMAGE" ] && IMAGE="gcr.io/$PROJECT/$SERVICE_NAME:$IMAGE_TAG"

echo ""
echo "═══ Ido Cloud Run Deploy ═══"
echo "  Project:   $PROJECT"
echo "  Region:    $REGION"
echo "  Service:   $SERVICE_NAME"
echo "  Mode:      $IDO_MODE"
echo "  Image:     $IMAGE"
echo "  Build:     $BUILD_MODE"
echo "  Database:  ${DATABASE_URL%%@*}@***"
echo ""

# ── Build ────────────────────────────────────────────────────
case "$BUILD_MODE" in
  local)
    echo "Building image locally (linux/amd64)..."
    docker build --platform linux/amd64 -t "$IMAGE" .
    echo "Pushing to GCR..."
    docker push "$IMAGE"
    ;;
  cloud)
    echo "Building via Cloud Build..."
    gcloud builds submit --tag "$IMAGE" --project "$PROJECT" .
    ;;
  none)
    echo "Using prebuilt image (no build)."
    ;;
esac

# ── Assemble env vars ────────────────────────────────────────
ENV_VARS="IDO_MODE=$IDO_MODE,NODE_ENV=production,DATABASE_URL=$DATABASE_URL,JWT_SECRET=$JWT_SECRET,PG_POOL_MAX=5,PG_IDLE_TIMEOUT=10000"

add_env() { [ -n "${2:-}" ] && ENV_VARS="$ENV_VARS,$1=$2"; return 0; }
add_env PUBLIC_URL                   "${PUBLIC_URL:-}"
add_env CORS_ORIGIN                  "${CORS_ORIGIN:-}"
add_env IDO_LICENSE_KEY              "${IDO_LICENSE_KEY:-}"
add_env IDO_ORG_SLUG                 "${IDO_ORG_SLUG:-}"
add_env IDO_ADMIN_EMAILS             "${IDO_ADMIN_EMAILS:-}"
add_env OIDC_GOOGLE_CLIENT_ID        "${OIDC_GOOGLE_CLIENT_ID:-}"
add_env OIDC_GOOGLE_CLIENT_SECRET    "${OIDC_GOOGLE_CLIENT_SECRET:-}"
add_env OIDC_MICROSOFT_CLIENT_ID     "${OIDC_MICROSOFT_CLIENT_ID:-}"
add_env OIDC_MICROSOFT_CLIENT_SECRET "${OIDC_MICROSOFT_CLIENT_SECRET:-}"
add_env OIDC_MICROSOFT_TENANT        "${OIDC_MICROSOFT_TENANT:-}"

# ── Deploy ───────────────────────────────────────────────────
echo ""
echo "Deploying to Cloud Run..."

DEPLOY_ARGS=(
  --image "$IMAGE"
  --platform managed
  --region "$REGION"
  --project "$PROJECT"
  --memory "$MEMORY"
  --cpu "$CPU"
  --min-instances "$MIN_INSTANCES"
  --max-instances "$MAX_INSTANCES"
  --allow-unauthenticated
  --port 8645
  --set-env-vars "$ENV_VARS"
)

[ -n "${CLOUD_SQL_INSTANCE:-}" ] && DEPLOY_ARGS+=(--add-cloudsql-instances "$CLOUD_SQL_INSTANCE")
if [ -n "${VPC_CONNECTOR:-}" ]; then
  DEPLOY_ARGS+=(--vpc-connector "$VPC_CONNECTOR")
  DEPLOY_ARGS+=(--vpc-egress "${VPC_EGRESS:-private-ranges-only}")
fi

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_ARGS[@]}"

# ── Done ─────────────────────────────────────────────────────
URL=$(gcloud run services describe "$SERVICE_NAME" --platform managed --region "$REGION" --project "$PROJECT" --format 'value(status.url)')
echo ""
echo "✅ Deployed: $URL"
echo "   Health:   $URL/api/v1/health"
echo ""
echo "Checklist:"
echo "  ☐ OIDC redirect URI registered: ${PUBLIC_URL:-$URL}/api/v1/oidc/callback"
[ -n "${PUBLIC_URL:-}" ] && echo "  ☐ Domain mapped: gcloud beta run domain-mappings create --service $SERVICE_NAME --domain ${PUBLIC_URL#https://} --region $REGION --project $PROJECT"
