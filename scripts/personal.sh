#!/usr/bin/env bash
set -e

# ── Ido Personal Mode ───────────────────────────────────────
# Starts Ido in personal mode (password auth, single-user).
# Requires: cp .env.example.personal .env (then edit passwords)
#
# For dev mode (auto-login, no config needed): bash scripts/dev.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill -TERM $PROXY_PID $VITE_PID 2>/dev/null
  sleep 1
  lsof -ti:8645 | xargs kill -9 2>/dev/null
  lsof -ti:5173 | xargs kill -9 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ido — starting proxy + frontend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Backend
cd "$ROOT/proxy"
echo "[proxy] Starting on :8645 ..."
npx tsx watch src/index.ts &
PROXY_PID=$!

# Frontend
cd "$ROOT/ido-web"
echo "[web]   Starting on :5173 ..."
npx vite --host 0.0.0.0 --port 5173 &
VITE_PID=$!

echo ""
echo "  Proxy : http://localhost:8645"
echo "  Web   : http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."
echo ""

wait
