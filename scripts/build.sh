#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Ido Build ────────────────────────────────────────────────
# Builds the Ido Docker image (proxy + web in one container).
# The same image runs with SQLite OR PostgreSQL — the database
# is chosen at runtime (SQLITE_PATH vs DATABASE_URL), not at build.
#
# Usage:
#   bash scripts/build.sh                          # build local image → ido:latest
#   bash scripts/build.sh --tag v2.0.0             # custom tag
#   bash scripts/build.sh --push --project my-gcp  # build + push to GCR
#   bash scripts/build.sh --platform linux/arm64   # build for a different arch

IMAGE_NAME="${IMAGE_NAME:-ido}"
TAG="${TAG:-latest}"
PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
PLATFORM="${PLATFORM:-linux/amd64}"   # Cloud Run requires amd64
PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --push) PUSH=true; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ "$PUSH" = true ] && [ -z "$PROJECT" ]; then
  echo "Error: --push requires --project (GCR target)."
  exit 1
fi

if [ "$PUSH" = true ]; then
  IMAGE="gcr.io/$PROJECT/$IMAGE_NAME:$TAG"
else
  IMAGE="$IMAGE_NAME:$TAG"
fi

echo ""
echo "═══ Ido Build ═══"
echo "  Image:    $IMAGE"
echo "  Platform: $PLATFORM"
echo "  Push:     $PUSH"
echo ""

docker build --platform "$PLATFORM" -t "$IMAGE" .

echo ""
echo "✅ Built: $IMAGE"

if [ "$PUSH" = true ]; then
  echo "Pushing to GCR..."
  docker push "$IMAGE"
  echo "✅ Pushed: $IMAGE"
  echo ""
  echo "Deploy it:  bash scripts/deploy.sh --image $IMAGE"
else
  echo ""
  echo "Run locally: bash scripts/docker-run.sh          # SQLite"
  echo "             bash scripts/docker-run.sh --pg      # PostgreSQL"
fi
