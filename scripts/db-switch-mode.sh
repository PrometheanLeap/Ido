#!/usr/bin/env bash
set -euo pipefail

# ── Ido Mode Switcher ───────────────────────────────────────
# Backs up current DB, then cleans it.
# Set IDO_MODE before restarting the proxy.
#
# Usage: bash scripts/db-switch-mode.sh personal
#        IDO_MODE=personal npm run dev

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TARGET_MODE="${1:-}"

if [ -z "$TARGET_MODE" ]; then
  echo "Usage: bash scripts/db-switch-mode.sh <mode>"
  echo "Modes: dev, personal, saas, corporate"
  exit 1
fi

case "$TARGET_MODE" in
  dev|personal|saas|corporate) ;;
  *) echo "❌ Invalid mode: $TARGET_MODE. Must be: dev, personal, saas, corporate"; exit 1 ;;
esac

echo "🔄 Switching to $TARGET_MODE mode..."
echo ""

# Backup + clean
bash "$SCRIPT_DIR/db-backup.sh"
bash "$SCRIPT_DIR/db-clean.sh" --force

echo ""
echo "✅ Database reset for $TARGET_MODE mode."
echo "   Start the proxy with: IDO_MODE=$TARGET_MODE npm run dev"
