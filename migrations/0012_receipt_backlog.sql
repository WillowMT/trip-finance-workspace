-- Receipt backlog: the user's own checklist of receipt images and what each one was for.
-- The Added / Not added state is manual by design - this table never writes ledger transactions.
-- Photos live in R2 (private bucket); the row only keeps the storage key, type, and size.
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  link TEXT NOT NULL DEFAULT '' CHECK (length(link) <= 1000),
  image_key TEXT NOT NULL DEFAULT '',
  image_type TEXT NOT NULL DEFAULT '',
  image_bytes INTEGER NOT NULL DEFAULT 0,
  is_added INTEGER NOT NULL DEFAULT 0 CHECK (is_added IN (0, 1)),
  added_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX receipts_workspace_state ON receipts(workspace_id, is_added, id DESC);

CREATE TRIGGER audit_receipts_insert AFTER INSERT ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt', CAST(NEW.id AS TEXT), 'create', NULL,
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'title', NEW.title, 'note', NEW.note, 'link', NEW.link, 'image_key', NEW.image_key, 'image_type', NEW.image_type, 'image_bytes', NEW.image_bytes, 'is_added', NEW.is_added, 'added_at', NEW.added_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_receipts_update AFTER UPDATE ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt', CAST(NEW.id AS TEXT), 'update',
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'title', OLD.title, 'note', OLD.note, 'link', OLD.link, 'image_key', OLD.image_key, 'image_type', OLD.image_type, 'image_bytes', OLD.image_bytes, 'is_added', OLD.is_added, 'added_at', OLD.added_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'title', NEW.title, 'note', NEW.note, 'link', NEW.link, 'image_key', NEW.image_key, 'image_type', NEW.image_type, 'image_bytes', NEW.image_bytes, 'is_added', NEW.is_added, 'added_at', NEW.added_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_receipts_delete AFTER DELETE ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'receipt', CAST(OLD.id AS TEXT), 'delete',
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'title', OLD.title, 'note', OLD.note, 'link', OLD.link, 'image_key', OLD.image_key, 'image_type', OLD.image_type, 'image_bytes', OLD.image_bytes, 'is_added', OLD.is_added, 'added_at', OLD.added_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;
