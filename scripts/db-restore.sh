#!/usr/bin/env bash
set -euo pipefail

# ── Ido DB Restore ──────────────────────────────────────────
# Restores a backup into the active database location.
# Usage: bash scripts/db-restore.sh [backup-name]
#   without args: lists available backups
#   with name: restores that backup

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${SQLITE_PATH:-$PROJECT_DIR/proxy/data/ido.db}"
BACKUP_DIR="$SCRIPT_DIR/backups"

if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
  echo "❌ No backups found in: $BACKUP_DIR"
  echo "   Run: bash scripts/db-backup.sh"
  exit 1
fi

BACKUP_NAME="${1:-}"

if [ -z "$BACKUP_NAME" ]; then
  echo "📁 Available backups:"
  echo ""
  ls -1t "$BACKUP_DIR" | while read -r f; do
    SIZE=$(du -h "$BACKUP_DIR/$f" | cut -f1)
    echo "  $f  ($SIZE)"
  done
  echo ""
  echo "Usage: bash scripts/db-restore.sh <backup-filename>"
  exit 0
fi

BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
if [ ! -f "$BACKUP_PATH" ]; then
  echo "❌ Backup not found: $BACKUP_NAME"
  exit 1
fi

echo "⚠️  This will overwrite the current database."
echo "   Current DB: $DB_PATH"
echo "   Restore from: $BACKUP_PATH"
echo ""
read -rp "Are you sure? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Cancelled."
  exit 0
fi

# Remove any stale WAL/SHM files so better-sqlite3 doesn't see a mismatched journal
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
cp "$BACKUP_PATH" "$DB_PATH"
# Checkpoint the restored DB so it starts clean (no pending WAL from the backup source)
sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
echo "✅ Restored: $BACKUP_NAME → $DB_PATH"
