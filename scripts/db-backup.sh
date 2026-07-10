#!/usr/bin/env bash
set -euo pipefail

# ── Ido DB Backup ────────────────────────────────────────────
# Copies the SQLite database to scripts/backups/ with a timestamp.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${SQLITE_PATH:-$PROJECT_DIR/proxy/data/ido.db}"
BACKUP_DIR="$SCRIPT_DIR/backups"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ Database not found at: $DB_PATH"
  echo "   Set SQLITE_PATH env var or run: cd proxy && npx tsx src/index.ts"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="ido-${TIMESTAMP}.db"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# Use sqlite3 .backup for a consistent WAL-mode snapshot instead of raw cp.
# Raw cp can produce a corrupt backup if uncheckpointed data is in the WAL file.
sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"

echo "✅ Backed up to: $BACKUP_PATH"
echo "   Size: $(du -h "$BACKUP_PATH" | cut -f1)"
