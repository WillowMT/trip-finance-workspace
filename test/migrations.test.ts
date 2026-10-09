import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const migrations = ['0001_core.sql', '0002_audit_triggers.sql', '0003_audit_lock.sql', '0004_split_commits.sql'];

function withDatabase(run: (query: (sql: string) => unknown[]) => void): void {
  const persistTo = mkdtempSync(join(tmpdir(), 'trip-finance-workspace-d1-'));
  const args = (extra: string[]) => ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', persistTo, '--json', ...extra];
  const execute = (extra: string[]) => JSON.parse(execFileSync('npx', args(extra), { cwd: root, encoding: 'utf8' }));
  const query = (sql: string): unknown[] => execute(['--command', sql])[0].results;

  try {
    for (const migration of migrations) execute(['--file', `migrations/${migration}`]);
    run(query);
  } finally {
    rmSync(persistTo, { recursive: true, force: true });
  }
}

test('migrations apply to a blank local D1 database', () => {
  withDatabase((query) => {
    const tables = query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name") as { name: string }[];
    assert.deepEqual(tables.map(({ name }) => name).filter((name) => !name.startsWith('_cf_')), [
      'audit_log', 'split_commits', 'transactions', 'workspace_currencies', 'workspace_people', 'workspace_settings', 'workspaces',
    ]);
  });
});

test('audit triggers snapshot all mutable entities and never include a workspace secret hash', () => {
  withDatabase((query) => {
    query("INSERT INTO workspaces (id, secret_hash, name) VALUES (1, 'never-audit-this-hash', 'Household')");
    query("INSERT INTO workspace_people (id, workspace_id, display_name) VALUES (10, 1, 'Ada')");
    query("INSERT INTO workspace_people (id, workspace_id, display_name) VALUES (11, 1, 'Lin')");
    query("INSERT INTO workspace_currencies (id, workspace_id, code, is_default) VALUES (20, 1, 'USD', 1)");
    query("INSERT INTO workspace_settings (workspace_id, categories_json, small_amount_guard_json) VALUES (1, '[\"Food\"]', '{\"USD\":10}')");
    query("INSERT INTO transactions (id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code) VALUES (30, 1, '2026-10-09', 'debt', 'Dinner', 'Food', 10, 11, 12345, 'USD')");
    query("UPDATE workspaces SET name = 'New household' WHERE id = 1");
    query("UPDATE workspace_people SET is_archived = 1 WHERE id = 10");
    query("UPDATE workspace_people SET is_archived = 0 WHERE id = 10");
    query("UPDATE workspace_currencies SET code = 'EUR', is_default = 0 WHERE id = 20");
    query("UPDATE workspace_settings SET categories_json = '[\"Food\",\"Travel\"]' WHERE workspace_id = 1");
    query("UPDATE transactions SET topic = 'Updated dinner' WHERE id = 30");
    query("UPDATE transactions SET is_deleted = 1 WHERE id = 30");
    query("UPDATE transactions SET is_deleted = 0 WHERE id = 30");
    query('DELETE FROM transactions WHERE id = 30');
    query('DELETE FROM workspace_settings WHERE workspace_id = 1');
    query('DELETE FROM workspace_currencies WHERE id = 20');
    query('DELETE FROM workspace_people WHERE id IN (10, 11)');

    const entries = query('SELECT entity_type, action, before_json, after_json FROM audit_log ORDER BY id') as { entity_type: string; action: string; before_json: string | null; after_json: string | null }[];
    assert.deepEqual(entries.map(({ entity_type, action }) => [entity_type, action]), [
      ['workspace', 'create'], ['person', 'create'], ['person', 'create'], ['currency', 'create'], ['workspace_settings', 'create'], ['transaction', 'create'],
      ['workspace', 'update'], ['person', 'archive'], ['person', 'restore'], ['currency', 'update'], ['workspace_settings', 'update'], ['transaction', 'update'], ['transaction', 'archive'], ['transaction', 'restore'], ['transaction', 'delete'], ['workspace_settings', 'delete'], ['currency', 'delete'], ['person', 'delete'], ['person', 'delete'],
    ]);
    const snapshotKeys: Record<string, string[]> = {
      workspace: ['created_at', 'id', 'is_active', 'name', 'updated_at'],
      person: ['created_at', 'display_name', 'id', 'is_archived', 'updated_at', 'workspace_id'],
      currency: ['code', 'created_at', 'id', 'is_archived', 'is_default', 'updated_at', 'workspace_id'],
      workspace_settings: ['categories_json', 'created_at', 'small_amount_guard_json', 'updated_at', 'workspace_id'],
      transaction: ['amount_minor', 'category', 'created_at', 'creditor_person_id', 'currency_code', 'debtor_person_id', 'entry_kind', 'id', 'import_group_id', 'is_deleted', 'notes', 'occurred_on', 'topic', 'updated_at', 'workspace_id'],
    };
    for (const entry of entries) {
      for (const snapshot of [entry.before_json, entry.after_json]) {
        if (!snapshot) continue;
        const parsed = JSON.parse(snapshot) as Record<string, unknown>;
        assert.equal(parsed.secret_hash, undefined);
        assert.deepEqual(Object.keys(parsed).sort(), snapshotKeys[entry.entity_type]);
      }
    }
    const archive = entries.find((entry) => entry.entity_type === 'transaction' && entry.action === 'archive');
    assert.equal(JSON.parse(archive!.before_json!).is_deleted, 0);
    assert.equal(JSON.parse(archive!.after_json!).is_deleted, 1);
  });
});

test('audit_log rejects direct updates and deletes', () => {
  withDatabase((query) => {
    query("INSERT INTO workspaces (id, secret_hash, name) VALUES (1, 'hash', 'Household')");
    for (const statement of ["UPDATE audit_log SET actor_label = 'forged' WHERE id = 1", 'DELETE FROM audit_log WHERE id = 1']) {
      assert.throws(
        () => query(statement),
        (error: unknown) => {
          const result = error as { stdout?: string };
          return String(error).includes('Command failed') && result.stdout?.includes('audit log is append-only') === true;
        },
      );
    }
  });
});
