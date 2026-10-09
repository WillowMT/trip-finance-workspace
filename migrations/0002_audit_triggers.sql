-- Every snapshot names all stored row columns except workspaces.secret_hash.

CREATE TRIGGER audit_workspaces_insert AFTER INSERT ON workspaces FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.id, 'workspace', CAST(NEW.id AS TEXT), 'create', NULL,
   json_object('id', NEW.id, 'name', NEW.name, 'is_active', NEW.is_active, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_workspaces_update AFTER UPDATE ON workspaces FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.id, 'workspace', CAST(NEW.id AS TEXT), 'update',
   json_object('id', OLD.id, 'name', OLD.name, 'is_active', OLD.is_active, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('id', NEW.id, 'name', NEW.name, 'is_active', NEW.is_active, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_workspaces_delete AFTER DELETE ON workspaces FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.id, 'workspace', CAST(OLD.id AS TEXT), 'delete',
   json_object('id', OLD.id, 'name', OLD.name, 'is_active', OLD.is_active, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;

CREATE TRIGGER audit_people_insert AFTER INSERT ON workspace_people FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'person', CAST(NEW.id AS TEXT), 'create', NULL,
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'display_name', NEW.display_name, 'is_archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_people_update AFTER UPDATE ON workspace_people FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'person', CAST(NEW.id AS TEXT), CASE WHEN OLD.is_archived = 0 AND NEW.is_archived = 1 THEN 'archive' WHEN OLD.is_archived = 1 AND NEW.is_archived = 0 THEN 'restore' ELSE 'update' END,
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'display_name', OLD.display_name, 'is_archived', OLD.is_archived, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'display_name', NEW.display_name, 'is_archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_people_delete AFTER DELETE ON workspace_people FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'person', CAST(OLD.id AS TEXT), 'delete',
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'display_name', OLD.display_name, 'is_archived', OLD.is_archived, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;

CREATE TRIGGER audit_currencies_insert AFTER INSERT ON workspace_currencies FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'currency', CAST(NEW.id AS TEXT), 'create', NULL,
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'code', NEW.code, 'is_default', NEW.is_default, 'is_archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_currencies_update AFTER UPDATE ON workspace_currencies FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'currency', CAST(NEW.id AS TEXT), CASE WHEN OLD.is_archived = 0 AND NEW.is_archived = 1 THEN 'archive' WHEN OLD.is_archived = 1 AND NEW.is_archived = 0 THEN 'restore' ELSE 'update' END,
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'code', OLD.code, 'is_default', OLD.is_default, 'is_archived', OLD.is_archived, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'code', NEW.code, 'is_default', NEW.is_default, 'is_archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_currencies_delete AFTER DELETE ON workspace_currencies FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'currency', CAST(OLD.id AS TEXT), 'delete',
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'code', OLD.code, 'is_default', OLD.is_default, 'is_archived', OLD.is_archived, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;

CREATE TRIGGER audit_settings_insert AFTER INSERT ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'workspace_settings', CAST(NEW.workspace_id AS TEXT), 'create', NULL,
   json_object('workspace_id', NEW.workspace_id, 'categories_json', NEW.categories_json, 'small_amount_guard_json', NEW.small_amount_guard_json, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_settings_update AFTER UPDATE ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'workspace_settings', CAST(NEW.workspace_id AS TEXT), 'update',
   json_object('workspace_id', OLD.workspace_id, 'categories_json', OLD.categories_json, 'small_amount_guard_json', OLD.small_amount_guard_json, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('workspace_id', NEW.workspace_id, 'categories_json', NEW.categories_json, 'small_amount_guard_json', NEW.small_amount_guard_json, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_settings_delete AFTER DELETE ON workspace_settings FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'workspace_settings', CAST(OLD.workspace_id AS TEXT), 'delete',
   json_object('workspace_id', OLD.workspace_id, 'categories_json', OLD.categories_json, 'small_amount_guard_json', OLD.small_amount_guard_json, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;

CREATE TRIGGER audit_transactions_insert AFTER INSERT ON transactions FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'transaction', CAST(NEW.id AS TEXT), 'create', NULL,
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'occurred_on', NEW.occurred_on, 'entry_kind', NEW.entry_kind, 'topic', NEW.topic, 'category', NEW.category, 'creditor_person_id', NEW.creditor_person_id, 'debtor_person_id', NEW.debtor_person_id, 'amount_minor', NEW.amount_minor, 'currency_code', NEW.currency_code, 'notes', NEW.notes, 'import_group_id', NEW.import_group_id, 'is_deleted', NEW.is_deleted, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_transactions_update AFTER UPDATE ON transactions FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (NEW.workspace_id, 'transaction', CAST(NEW.id AS TEXT), CASE WHEN OLD.is_deleted = 0 AND NEW.is_deleted = 1 THEN 'archive' WHEN OLD.is_deleted = 1 AND NEW.is_deleted = 0 THEN 'restore' ELSE 'update' END,
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'occurred_on', OLD.occurred_on, 'entry_kind', OLD.entry_kind, 'topic', OLD.topic, 'category', OLD.category, 'creditor_person_id', OLD.creditor_person_id, 'debtor_person_id', OLD.debtor_person_id, 'amount_minor', OLD.amount_minor, 'currency_code', OLD.currency_code, 'notes', OLD.notes, 'import_group_id', OLD.import_group_id, 'is_deleted', OLD.is_deleted, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at),
   json_object('id', NEW.id, 'workspace_id', NEW.workspace_id, 'occurred_on', NEW.occurred_on, 'entry_kind', NEW.entry_kind, 'topic', NEW.topic, 'category', NEW.category, 'creditor_person_id', NEW.creditor_person_id, 'debtor_person_id', NEW.debtor_person_id, 'amount_minor', NEW.amount_minor, 'currency_code', NEW.currency_code, 'notes', NEW.notes, 'import_group_id', NEW.import_group_id, 'is_deleted', NEW.is_deleted, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;
CREATE TRIGGER audit_transactions_delete AFTER DELETE ON transactions FOR EACH ROW BEGIN
  INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES
  (OLD.workspace_id, 'transaction', CAST(OLD.id AS TEXT), 'delete',
   json_object('id', OLD.id, 'workspace_id', OLD.workspace_id, 'occurred_on', OLD.occurred_on, 'entry_kind', OLD.entry_kind, 'topic', OLD.topic, 'category', OLD.category, 'creditor_person_id', OLD.creditor_person_id, 'debtor_person_id', OLD.debtor_person_id, 'amount_minor', OLD.amount_minor, 'currency_code', OLD.currency_code, 'notes', OLD.notes, 'import_group_id', OLD.import_group_id, 'is_deleted', OLD.is_deleted, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at), NULL);
END;
