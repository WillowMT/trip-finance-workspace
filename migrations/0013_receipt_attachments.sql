-- Receipt backlog v2: a card carries several attachments, so the single-photo columns on
-- receipts give way to a child table. Nothing here writes ledger transactions.
DROP TRIGGER audit_receipts_insert;
DROP TRIGGER audit_receipts_update;
DROP TRIGGER audit_receipts_delete;

ALTER TABLE receipts DROP COLUMN image_key;
ALTER TABLE receipts DROP COLUMN image_type;
ALTER TABLE receipts DROP COLUMN image_bytes;

CREATE TABLE receipt_attachments (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 120),
  image_key TEXT NOT NULL CHECK (length(image_key) BETWEEN 1 AND 200),
  image_type TEXT NOT NULL CHECK (length(image_type) BETWEEN 1 AND 100),
  image_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX receipt_attachments_card ON receipt_attachments(workspace_id, receipt_id, id);

CREATE TRIGGER audit_receipts_insert AFTER INSERT ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt', CAST(NEW.id AS TEXT), 'create', NULL, json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'title', NEW.title, 'note', NEW.note, 'link', NEW.link, 'is_added', NEW.is_added, 'added_at', NEW.added_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_receipts_update AFTER UPDATE ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt', CAST(NEW.id AS TEXT), 'update', json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'title', OLD.title, 'note', OLD.note, 'link', OLD.link, 'is_added', OLD.is_added, 'added_at', OLD.added_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'title', NEW.title, 'note', NEW.note, 'link', NEW.link, 'is_added', NEW.is_added, 'added_at', NEW.added_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_receipts_delete AFTER DELETE ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'receipt', CAST(OLD.id AS TEXT), 'delete', json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'title', OLD.title, 'note', OLD.note, 'link', OLD.link, 'is_added', OLD.is_added, 'added_at', OLD.added_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;

CREATE TRIGGER audit_receipt_attachments_insert AFTER INSERT ON receipt_attachments FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt_attachment', CAST(NEW.id AS TEXT), 'create', NULL, json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'receipt_id', NEW.receipt_id, 'label', NEW.label, 'image_key', NEW.image_key, 'image_type', NEW.image_type, 'image_bytes', NEW.image_bytes, 'created_at', NEW.created_at));
END;
CREATE TRIGGER audit_receipt_attachments_update AFTER UPDATE ON receipt_attachments FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt_attachment', CAST(NEW.id AS TEXT), 'update', json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'receipt_id', OLD.receipt_id, 'label', OLD.label, 'image_key', OLD.image_key, 'image_type', OLD.image_type, 'image_bytes', OLD.image_bytes, 'created_at', OLD.created_at), json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'receipt_id', NEW.receipt_id, 'label', NEW.label, 'image_key', NEW.image_key, 'image_type', NEW.image_type, 'image_bytes', NEW.image_bytes, 'created_at', NEW.created_at));
END;
CREATE TRIGGER audit_receipt_attachments_delete AFTER DELETE ON receipt_attachments FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'receipt_attachment', CAST(OLD.id AS TEXT), 'delete', json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'receipt_id', OLD.receipt_id, 'label', OLD.label, 'image_key', OLD.image_key, 'image_type', OLD.image_type, 'image_bytes', OLD.image_bytes, 'created_at', OLD.created_at), NULL);
END;
