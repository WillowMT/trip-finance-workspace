-- The workspace_settings audit snapshots must carry the time zone, otherwise a change
-- to it would be invisible in the immutable audit trail.
DROP TRIGGER audit_settings_insert;
DROP TRIGGER audit_settings_update;
DROP TRIGGER audit_settings_delete;

CREATE TRIGGER audit_settings_insert AFTER INSERT ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'workspace_settings', CAST(NEW.workspace_id AS TEXT), 'create', NULL,
   json_object('workspace_id', NEW.workspace_id, 'categories_json', NEW.categories_json, 'small_amount_guard_json', NEW.small_amount_guard_json, 'timezone', NEW.timezone, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_settings_update AFTER UPDATE ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'workspace_settings', CAST(NEW.workspace_id AS TEXT), 'update',
   json_object('workspace_id', OLD.workspace_id, 'categories_json', OLD.categories_json, 'small_amount_guard_json', OLD.small_amount_guard_json, 'timezone', OLD.timezone, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('workspace_id', NEW.workspace_id, 'categories_json', NEW.categories_json, 'small_amount_guard_json', NEW.small_amount_guard_json, 'timezone', NEW.timezone, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_settings_delete AFTER DELETE ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'workspace_settings', CAST(OLD.workspace_id AS TEXT), 'delete',
   json_object('workspace_id', OLD.workspace_id, 'categories_json', OLD.categories_json, 'small_amount_guard_json', OLD.small_amount_guard_json, 'timezone', OLD.timezone, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;
