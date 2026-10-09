PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE workspace_people (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  display_name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(workspace_id, display_name)
);

CREATE TABLE workspace_currencies (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  code TEXT NOT NULL CHECK (code GLOB '[A-Z][A-Z][A-Z]'),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(workspace_id, code)
);

CREATE UNIQUE INDEX one_default_currency_per_workspace
ON workspace_currencies(workspace_id)
WHERE is_default = 1 AND is_archived = 0;

CREATE TABLE workspace_settings (
  workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id),
  categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json)),
  small_amount_guard_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(small_amount_guard_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) IS NOT NULL),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('debt', 'payment', 'split', 'offset', 'import')),
  topic TEXT NOT NULL CHECK (length(trim(topic)) BETWEEN 1 AND 200),
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  creditor_person_id INTEGER NOT NULL REFERENCES workspace_people(id),
  debtor_person_id INTEGER NOT NULL REFERENCES workspace_people(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency_code TEXT NOT NULL CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
  notes TEXT,
  import_group_id TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (creditor_person_id <> debtor_person_id)
);

CREATE INDEX transactions_workspace_date_idx
ON transactions(workspace_id, occurred_on DESC, id DESC);
CREATE INDEX transactions_workspace_pair_idx
ON transactions(workspace_id, debtor_person_id, creditor_person_id, currency_code)
WHERE is_deleted = 0;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'archive', 'restore', 'delete')),
  actor_label TEXT NOT NULL DEFAULT 'shared workspace editor',
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX audit_log_workspace_recent_idx
ON audit_log(workspace_id, occurred_at DESC, id DESC);
CREATE INDEX audit_log_workspace_entity_idx
ON audit_log(workspace_id, entity_type, entity_id, id DESC);
