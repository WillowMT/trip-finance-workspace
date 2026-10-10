#!/usr/bin/env bash
# Retire throwaway workspaces by DEACTIVATING them — never delete.
#
# Why not delete: the raw capability secret is never stored (only its SHA-256), so a deleted
# workspace's link can never be re-issued. An earlier version of this script hardcoded
# "KEEP=2" and deleted every other workspace, which destroyed a workspace Willow was using.
# Deactivation is reversible (is_active = 1) and keeps the rows for recovery.
#
# Usage: tools/purge-test-workspaces.sh <workspace-id> [<workspace-id> ...]
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <workspace-id> [<workspace-id> ...]" >&2
  echo "tip: list ids first with: npx wrangler d1 execute DB --remote --command 'SELECT id, name, is_active FROM workspaces' --json" >&2
  exit 2
fi

for id in "$@"; do
  case "$id" in
    ''|*[!0-9]*) echo "not a numeric workspace id: $id" >&2; exit 2;;
  esac
done

for id in "$@"; do
  echo "deactivating workspace $id (rows kept for recovery)"
  npx wrangler d1 execute DB --remote \
    --command "UPDATE workspaces SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = $id" >/dev/null
done

echo "remaining workspaces:"
npx wrangler d1 execute DB --remote \
  --command "SELECT id, name, is_active FROM workspaces ORDER BY id" --json 2>/dev/null \
  | python3 -c "import json,sys;[print(' ', r) for r in json.load(sys.stdin)[0]['results']]"
