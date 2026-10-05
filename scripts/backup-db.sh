#!/usr/bin/env bash
# backup-db.sh — Safe online SQLite backup of the 9Router production DB
#
# Usage:
#   ./scripts/backup-db.sh [source_db] [backup_path]
#
#   source_db   Path to source SQLite DB (default: ~/.9router/db/data.sqlite)
#   backup_path Path to write the backup (default: ~/9router-backups/data.sqlite.<timestamp>)
#
# Uses better-sqlite3's online backup API — safe on a live DB (WAL mode aware).

set -euo pipefail

SOURCE="${1:-$HOME/.9router/db/data.sqlite}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${2:-$HOME/9router-backups/data.sqlite.$TIMESTAMP}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BETTER_SQLITE3="$REPO_ROOT/node_modules/better-sqlite3"

if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: source DB not found: $SOURCE"
  exit 1
fi

if [[ ! -d "$BETTER_SQLITE3" ]]; then
  echo "ERROR: better-sqlite3 not found at $BETTER_SQLITE3"
  exit 1
fi

# Create backup directory if needed
if [[ "$2" != "$HOME/9router-backups/data.sqlite."* ]]; then
  BACKUP_DIR="$2"
fi
BACKUP_DIR_PATH="$(dirname "$BACKUP_DIR")"
mkdir -p "$BACKUP_DIR_PATH"

echo "Backing up:  $SOURCE"
echo "Backup to:   $BACKUP_DIR"

node -e "
const Database = require('$BETTER_SQLITE3');
const src = new Database('$SOURCE', { readonly: true });
const dest = new Database('$BACKUP_DIR');
src.backup(dest, (err) => {
  if (err) { console.error('backup failed:', err.message); process.exit(1); }
  console.log('Online backup complete.');
  dest.close();
  src.close();
}).catch((e) => {
  console.error('backup failed:', e.message);
  process.exit(1);
});
setTimeout(() => {}, 5000);
"

SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | awk '{print $1}')
echo "Done. Size: $SIZE → $BACKUP_DIR"
