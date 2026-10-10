-- Automatic backups: once a workspace has written N ledger rows since its last snapshot
-- (default 100), the worker exports the whole workspace to R2. The watermark lives in
-- backup_state, so the check is a pure comparison and can never double-fire or drift.
ALTER TABLE workspace_settings ADD COLUMN backup_every INTEGER NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS backup_state (
  workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id),
  rows_at_last_backup INTEGER NOT NULL DEFAULT 0,
  last_backup_at TEXT,
  last_backup_seq INTEGER NOT NULL DEFAULT 0,
  last_backup_key TEXT,
  last_backup_rows INTEGER,
  last_backup_bytes INTEGER,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS backup_log (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  sequence INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  rows_count INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, sequence)
);

-- Audit snapshots use explicit key lists, so the new column stays invisible in the trail
-- until the settings triggers are recreated (same pattern as 0008 and 0009).
DROP TRIGGER audit_settings_insert;
DROP TRIGGER audit_settings_update;
DROP TRIGGER audit_settings_delete;

CREATE TRIGGER audit_settings_insert AFTER INSERT ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'workspace_settings', CAST(NEW.workspace_id AS TEXT), 'create', NULL,
   json_object('workspace_id', NEW.workspace_id, 'categories_json', NEW.categories_json, 'small_amount_guard_json', NEW.small_amount_guard_json, 'timezone', NEW.timezone, 'auto_offset', NEW.auto_offset, 'backup_every', NEW.backup_every, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_settings_update AFTER UPDATE ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'workspace_settings', CAST(NEW.workspace_id AS TEXT), 'update',
   json_object('workspace_id', OLD.workspace_id, 'categories_json', OLD.categories_json, 'small_amount_guard_json', OLD.small_amount_guard_json, 'timezone', OLD.timezone, 'auto_offset', OLD.auto_offset, 'backup_every', OLD.backup_every, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('workspace_id', NEW.workspace_id, 'categories_json', NEW.categories_json, 'small_amount_guard_json', NEW.small_amount_guard_json, 'timezone', NEW.timezone, 'auto_offset', NEW.auto_offset, 'backup_every', NEW.backup_every, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_settings_delete AFTER DELETE ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'workspace_settings', CAST(OLD.workspace_id AS TEXT), 'delete',
   json_object('workspace_id', OLD.workspace_id, 'categories_json', OLD.categories_json, 'small_amount_guard_json', OLD.small_amount_guard_json, 'timezone', OLD.timezone, 'auto_offset', OLD.auto_offset, 'backup_every', OLD.backup_every, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;
