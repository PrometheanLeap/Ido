#!/usr/bin/env bash
set -euo pipefail

# ── Ido DB Clean (Fresh Start) ──────────────────────────────
# Deletes the SQLite database and WAL/SHM files.
# Requires confirmation. Automatically backs up first.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${SQLITE_PATH:-$PROJECT_DIR/proxy/data/ido.db}"
DB_DIR="$(dirname "$DB_PATH")"

FORCE="${1:-}"

if [ ! -f "$DB_PATH" ]; then
  echo "ℹ️  No database found at: $DB_PATH"
  echo "   Nothing to clean."
  exit 0
fi

if [ "$FORCE" != "--force" ]; then
  echo "⚠️  This will DELETE the database and all data."
  echo "   Path: $DB_PATH"
  echo ""
  read -rp "Are you sure? Type 'delete' to confirm: " confirm
  if [ "$confirm" != "delete" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Auto-backup before cleaning
bash "$SCRIPT_DIR/db-backup.sh"

# Remove DB and WAL/SHM files
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
echo "✅ Database deleted."
echo "   Run 'cd proxy && npx tsx src/index.ts' to start fresh."
