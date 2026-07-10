#!/usr/bin/env bash
set -euo pipefail

# ── Ido Docker Runner ────────────────────────────────────────
# Usage:
#   bash scripts/docker-run.sh              # SQLite, personal mode
#   bash scripts/docker-run.sh --pg         # PostgreSQL, personal mode
#   bash scripts/docker-run.sh --mode saas  # SaaS mode
#   bash scripts/docker-run.sh --pg --mode corporate  # PG + corporate

COMPOSE_FILE="docker-compose.yml"
MODE="${IDO_MODE:-personal}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pg)    COMPOSE_FILE="docker-compose.pg.yml"; shift ;;
    --mode)  MODE="$2"; shift 2 ;;
    --down)  docker compose -f "$COMPOSE_FILE" down; exit 0 ;;
    --build) BUILD="--build"; shift ;;
    *)       echo "Unknown: $1"; exit 1 ;;
  esac
done

echo ""
echo "═══ Ido Docker Runner ═══"
echo "  Compose: $COMPOSE_FILE"
echo "  Mode:    $MODE"
echo ""

IDO_MODE="$MODE" docker compose -f "$COMPOSE_FILE" up -d ${BUILD:-}

echo ""
echo "  Web:   http://localhost:8645"
echo "  API:   http://localhost:8645/api/v1/health"
echo ""
echo "  To stop: bash scripts/docker-run.sh --down"
