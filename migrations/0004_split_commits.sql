CREATE TABLE split_commits (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  draft_hash TEXT NOT NULL CHECK (length(draft_hash) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, idempotency_key)
);
