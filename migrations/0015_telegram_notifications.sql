-- Telegram notifications: chat links, single-use pairing tokens and a durable delivery outbox.
--
-- None of these tables is audited on purpose. They hold no money and no identity, and connecting or
-- disconnecting a chat must never enter the immutable ledger trail (the audited entity list is closed).
-- Telegram can never change a record either: the only writer of `transactions` stays the app itself.

CREATE TABLE IF NOT EXISTS telegram_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  -- Telegram chat ids are 64-bit signed integers, so they are kept as text and never rounded.
  chat_id TEXT NOT NULL,
  chat_title TEXT NOT NULL DEFAULT '',
  chat_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Watermark into audit_log: a chat only ever hears about events newer than this, so linking a
  -- chat (or re-linking one) never replays the trip's history into it.
  last_audit_id INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, chat_id)
);
CREATE INDEX IF NOT EXISTS telegram_connections_workspace ON telegram_connections (workspace_id, enabled);
CREATE INDEX IF NOT EXISTS telegram_connections_chat ON telegram_connections (chat_id);

CREATE TABLE IF NOT EXISTS telegram_pairing_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  -- Only the hash is stored: a leaked database row cannot be turned back into a working link.
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_chat_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS telegram_pairing_tokens_workspace ON telegram_pairing_tokens (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS telegram_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  connection_id INTEGER NOT NULL REFERENCES telegram_connections(id),
  -- '<first audit id>-<last audit id>' of the events the message covers. Unique per chat, so a
  -- retried dispatch can never send the same activity twice, however often it is retried.
  event_key TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (connection_id, event_key)
);
CREATE INDEX IF NOT EXISTS telegram_notifications_pending ON telegram_notifications (status, id);
CREATE INDEX IF NOT EXISTS telegram_notifications_workspace ON telegram_notifications (workspace_id, id);
