-- Each person can carry an emoji, so a ledger row reads at a glance.
ALTER TABLE workspace_people ADD COLUMN emoji TEXT NOT NULL DEFAULT '';

-- Audit snapshots use explicit key lists, so the new column only reaches the trail
-- once the person triggers are recreated with it.
DROP TRIGGER audit_people_insert;
DROP TRIGGER audit_people_update;
DROP TRIGGER audit_people_delete;

CREATE TRIGGER audit_people_insert AFTER INSERT ON workspace_people FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'person', CAST(NEW.id AS TEXT), 'create', NULL,
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'display_name', NEW.display_name, 'emoji', NEW.emoji, 'is_archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_people_update AFTER UPDATE ON workspace_people FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'person', CAST(NEW.id AS TEXT), CASE WHEN OLD.is_archived = 0 AND NEW.is_archived = 1 THEN 'archive' WHEN OLD.is_archived = 1 AND NEW.is_archived = 0 THEN 'restore' ELSE 'update' END,
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'display_name', OLD.display_name, 'emoji', OLD.emoji, 'is_archived', OLD.is_archived, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'display_name', NEW.display_name, 'emoji', NEW.emoji, 'is_archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_people_delete AFTER DELETE ON workspace_people FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'person', CAST(OLD.id AS TEXT), 'delete',
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'display_name', OLD.display_name, 'emoji', OLD.emoji, 'is_archived', OLD.is_archived, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;
