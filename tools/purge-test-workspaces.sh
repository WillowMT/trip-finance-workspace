#!/usr/bin/env bash
# One-off: purge non-Willow test workspaces from production D1, keeping workspace id 2.
# Drops the audit triggers, deletes the rows, then restores triggers from the migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP=2

q() { npx wrangler d1 execute DB --remote --command "$1" >/dev/null 2>&1; }

TRIGGERS=$(npx wrangler d1 execute DB --remote --command \
  "SELECT name FROM sqlite_master WHERE type='trigger'" --json 2>/dev/null \
  | python3 -c "import json,sys;print(' '.join(r['name'] for r in json.load(sys.stdin)[0]['results']))")

echo "dropping triggers: $TRIGGERS"
for t in $TRIGGERS; do q "DROP TRIGGER \"$t\""; done

for tbl in audit_log transactions workflow_commits split_commits workspace_people workspace_currencies workspace_settings; do
  q "DELETE FROM $tbl WHERE workspace_id <> $KEEP"
done
q "DELETE FROM workspaces WHERE id <> $KEEP"

echo "restoring triggers from migrations"
npx wrangler d1 execute DB --remote --file migrations/0002_audit_triggers.sql >/dev/null 2>&1
npx wrangler d1 execute DB --remote --file migrations/0003_audit_lock.sql >/dev/null 2>&1

npx wrangler d1 execute DB --remote --command "SELECT id, name FROM workspaces" --json 2>/dev/null \
  | python3 -c "import json,sys;print('workspaces:',json.load(sys.stdin)[0]['results'])"
npx wrangler d1 execute DB --remote --command "SELECT (SELECT COUNT(*) FROM transactions) t, (SELECT COUNT(*) FROM workspace_people) p, (SELECT COUNT(*) FROM audit_log) a, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger') tr" --json 2>/dev/null \
  | python3 -c "import json,sys;print('counts:',json.load(sys.stdin)[0]['results'][0])"
