-- A receipt can record which ledger row it became, so the board shows what is still unlogged.
-- The board stays a manual tracker: nothing links itself, and this column is only written when
-- the user asks for it (POST /receipts/:id/link).
ALTER TABLE receipts ADD COLUMN transaction_id INTEGER REFERENCES transactions(id);

-- Audit snapshots use explicit json_object(...) key lists, so the new column is invisible in the
-- immutable trail until the receipt triggers are recreated with it.
DROP TRIGGER audit_receipts_insert;
DROP TRIGGER audit_receipts_update;
DROP TRIGGER audit_receipts_delete;

CREATE TRIGGER audit_receipts_insert AFTER INSERT ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt', CAST(NEW.id AS TEXT), 'create', NULL, json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'title', NEW.title, 'note', NEW.note, 'link', NEW.link, 'transaction_id', NEW.transaction_id, 'is_added', NEW.is_added, 'added_at', NEW.added_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_receipts_update AFTER UPDATE ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'receipt', CAST(NEW.id AS TEXT), 'update', json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'title', OLD.title, 'note', OLD.note, 'link', OLD.link, 'transaction_id', OLD.transaction_id, 'is_added', OLD.is_added, 'added_at', OLD.added_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'title', NEW.title, 'note', NEW.note, 'link', NEW.link, 'transaction_id', NEW.transaction_id, 'is_added', NEW.is_added, 'added_at', NEW.added_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_receipts_delete AFTER DELETE ON receipts FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'receipt', CAST(OLD.id AS TEXT), 'delete', json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'title', OLD.title, 'note', OLD.note, 'link', OLD.link, 'transaction_id', OLD.transaction_id, 'is_added', OLD.is_added, 'added_at', OLD.added_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;
