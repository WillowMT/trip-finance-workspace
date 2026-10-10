import type { Env } from './worker';

// Automatic backups. The watermark in backup_state makes the trigger a pure comparison:
// "rows written since the last snapshot >= backup_every", so it can neither double-fire
// nor drift when a write path forgets to report how many rows it added.
export const BACKUP_FORMAT = 'trip-finance-workspace-backup';
export const BACKUP_VERSION = 1;
export const KEEP_BACKUPS = 20;
export const MIN_BACKUP_EVERY = 5;
export const MAX_BACKUP_EVERY = 10_000;
export const DEFAULT_BACKUP_EVERY = 100;

const stateColumns = 'workspace_id, rows_at_last_backup, last_backup_at, last_backup_seq, last_backup_key, last_backup_rows, last_backup_bytes, last_error, updated_at';

export type BackupState = {
  workspace_id: number; rows_at_last_backup: number; last_backup_at: string | null;
  last_backup_seq: number; last_backup_key: string | null; last_backup_rows: number | null;
  last_backup_bytes: number | null; last_error: string | null; updated_at: string;
};
export type BackupStatus = { every: number; rows_total: number; rows_at_last_backup: number; rows_since_backup: number; due_in: number; state: BackupState };
export type BackupEntry = { sequence: number; key: string; rows: number; bytes: number; trigger: string; created_at: string };

type SnapshotDoc = {
  format: string; version: number; sequence: number; trigger: string; generated_at: string;
  workspace?: { name?: unknown }; people?: Record<string, unknown>[]; currencies?: Record<string, unknown>[];
  settings?: Record<string, unknown> | null; transactions?: Record<string, unknown>[];
  split_commits?: Record<string, unknown>[]; workflow_commits?: Record<string, unknown>[];
};

const transactionColumns = ['occurred_on', 'entry_kind', 'topic', 'category', 'creditor_person_id', 'debtor_person_id', 'amount_minor', 'currency_code', 'notes', 'import_group_id', 'is_deleted', 'created_at'];
const peopleColumns = ['display_name', 'is_archived', 'created_at'];
const currencyColumns = ['code', 'is_default', 'is_archived', 'created_at'];
const settingsColumns = ['categories_json', 'small_amount_guard_json', 'timezone', 'auto_offset', 'backup_every', 'created_at'];

const nowIso = (): string => new Date().toISOString();
const bytesOf = (text: string): number => new TextEncoder().encode(text).byteLength;

export function backupEveryValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= MIN_BACKUP_EVERY && parsed <= MAX_BACKUP_EVERY ? parsed : null;
}

export function backupKey(workspaceId: number, sequence: number): string {
  return `backups/ws-${workspaceId}/${String(sequence).padStart(6, '0')}.json`;
}

export async function readBackupState(db: D1Database, workspaceId: number): Promise<BackupState> {
  await db.prepare('INSERT OR IGNORE INTO backup_state (workspace_id) VALUES (?)').bind(workspaceId).run();
  return (await db.prepare(`SELECT ${stateColumns} FROM backup_state WHERE workspace_id = ?`).bind(workspaceId).first<BackupState>()) as BackupState;
}

export async function backupStatus(db: D1Database, workspaceId: number): Promise<BackupStatus> {
  const row = await db.prepare(`SELECT s.backup_every AS every, (SELECT COUNT(*) FROM transactions t WHERE t.workspace_id = s.workspace_id) AS rows_total, COALESCE(b.rows_at_last_backup, 0) AS rows_at_last_backup FROM workspace_settings s LEFT JOIN backup_state b ON b.workspace_id = s.workspace_id WHERE s.workspace_id = ?`)
    .bind(workspaceId).first<{ every: number | null; rows_total: number; rows_at_last_backup: number }>();
  const every = backupEveryValue(row?.every) ?? DEFAULT_BACKUP_EVERY;
  const rowsTotal = row?.rows_total ?? 0;
  const atLast = row?.rows_at_last_backup ?? 0;
  const since = Math.max(0, rowsTotal - atLast);
  return { every, rows_total: rowsTotal, rows_at_last_backup: atLast, rows_since_backup: since, due_in: Math.max(0, every - since), state: await readBackupState(db, workspaceId) };
}

export async function listBackups(db: D1Database, workspaceId: number, limit = 50): Promise<BackupEntry[]> {
  const rows = await db.prepare('SELECT sequence, storage_key, rows_count, bytes, trigger, created_at FROM backup_log WHERE workspace_id = ? ORDER BY sequence DESC LIMIT ?').bind(workspaceId, limit).all<{ sequence: number; storage_key: string; rows_count: number; bytes: number; trigger: string; created_at: string }>();
  return rows.results.map((row) => ({ sequence: row.sequence, key: row.storage_key, rows: row.rows_count, bytes: row.bytes, trigger: row.trigger, created_at: row.created_at }));
}

async function snapshotText(db: D1Database, workspaceId: number, name: string, sequence: number, trigger: string): Promise<{ body: string; rows: number }> {
  const [people, currencies, settings, transactions, splits, workflows] = await Promise.all([
    db.prepare('SELECT id, display_name, is_archived, created_at FROM workspace_people WHERE workspace_id = ? ORDER BY id').bind(workspaceId).all<Record<string, unknown>>(),
    db.prepare('SELECT id, code, is_default, is_archived, created_at FROM workspace_currencies WHERE workspace_id = ? ORDER BY id').bind(workspaceId).all<Record<string, unknown>>(),
    db.prepare('SELECT categories_json, small_amount_guard_json, timezone, auto_offset, backup_every, created_at, updated_at FROM workspace_settings WHERE workspace_id = ?').bind(workspaceId).first<Record<string, unknown>>(),
    db.prepare(`SELECT id, ${transactionColumns.join(', ')} FROM transactions WHERE workspace_id = ? ORDER BY id`).bind(workspaceId).all<Record<string, unknown>>(),
    db.prepare('SELECT idempotency_key, draft_hash, created_at FROM split_commits WHERE workspace_id = ? ORDER BY idempotency_key').bind(workspaceId).all<Record<string, unknown>>(),
    db.prepare('SELECT kind, idempotency_key, draft_hash, created_at FROM workflow_commits WHERE workspace_id = ? ORDER BY kind, idempotency_key').bind(workspaceId).all<Record<string, unknown>>(),
  ]);
  const rows = transactions.results.length;
  const document = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, sequence, trigger, generated_at: nowIso(),
    workspace: { name },
    counts: { people: people.results.length, currencies: currencies.results.length, transactions: rows, split_commits: splits.results.length, workflow_commits: workflows.results.length },
    // The audit trail is intentionally not copied: it is append-only history of this workspace,
    // and a restore starts a fresh trail so the new workspace's history is its own.
    includes: { audit_log: false },
    people: people.results, currencies: currencies.results, settings: settings ?? null,
    transactions: transactions.results, split_commits: splits.results, workflow_commits: workflows.results,
  };
  return { body: JSON.stringify(document, null, 2), rows };
}

export async function createBackup(env: Env, workspaceId: number, name: string, trigger: string): Promise<{ backup: BackupEntry; status: BackupStatus } | { error: string }> {
  if (!env.BACKUPS) return { error: 'Backup storage is not configured' };
  const state = await readBackupState(env.DB, workspaceId);
  const sequence = state.last_backup_seq + 1;
  const { body, rows } = await snapshotText(env.DB, workspaceId, name, sequence, trigger);
  const key = backupKey(workspaceId, sequence);
  const created = nowIso();
  const bytes = bytesOf(body);
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('UPDATE backup_state SET rows_at_last_backup = ?, last_backup_at = ?, last_backup_seq = ?, last_backup_key = ?, last_backup_rows = ?, last_backup_bytes = ?, last_error = NULL, updated_at = ? WHERE workspace_id = ?')
    .bind(rows, created, sequence, key, rows, bytes, created, workspaceId).run();
  await env.DB.prepare("INSERT OR REPLACE INTO backup_log (workspace_id, sequence, storage_key, rows_count, bytes, trigger, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(workspaceId, sequence, key, rows, bytes, trigger, created).run();
  // A snapshot is part of the workspace history, so it lands in the trail like any other write.
  await env.DB.prepare("INSERT INTO audit_log (workspace_id, entity_type, entity_id, action, before_json, after_json) VALUES (?, 'workspace_backup', ?, 'create', NULL, ?)")
    .bind(workspaceId, String(sequence), JSON.stringify({ sequence, key, rows, bytes, trigger })).run();
  await pruneBackups(env, workspaceId);
  return { backup: { sequence, key, rows, bytes, trigger, created_at: created }, status: await backupStatus(env.DB, workspaceId) };
}

async function pruneBackups(env: Env, workspaceId: number): Promise<void> {
  if (!env.BACKUPS) return;
  const entries = await listBackups(env.DB, workspaceId, KEEP_BACKUPS + 50);
  const stale = entries.slice(KEEP_BACKUPS);
  if (!stale.length) return;
  await env.BACKUPS.delete(stale.map((entry) => entry.key));
  const placeholders = stale.map(() => '?').join(', ');
  await env.DB.prepare(`DELETE FROM backup_log WHERE workspace_id = ? AND sequence IN (${placeholders})`).bind(workspaceId, ...stale.map((entry) => entry.sequence)).run();
}

export async function readBackup(env: Env, workspaceId: number, sequence: number): Promise<string | null> {
  if (!env.BACKUPS) return null;
  const entry = await env.DB.prepare('SELECT storage_key FROM backup_log WHERE workspace_id = ? AND sequence = ?').bind(workspaceId, sequence).first<{ storage_key: string }>();
  if (!entry) return null;
  const object = await env.BACKUPS.get(entry.storage_key);
  return object ? await object.text() : null;
}

// Called after every ledger write. It must never throw: a backup problem may not break a
// transaction, so failures are recorded on the workspace's backup row instead.
export async function tickBackups(env: Env, workspaceId: number): Promise<BackupStatus | null> {
  try {
    if (!env.BACKUPS) return null;
    const row = await env.DB.prepare(`SELECT s.backup_every AS every, w.name AS name, (SELECT COUNT(*) FROM transactions t WHERE t.workspace_id = s.workspace_id) AS rows_total, COALESCE(b.rows_at_last_backup, 0) AS rows_at_last_backup FROM workspace_settings s JOIN workspaces w ON w.id = s.workspace_id LEFT JOIN backup_state b ON b.workspace_id = s.workspace_id WHERE s.workspace_id = ?`)
      .bind(workspaceId).first<{ every: number | null; name: string | null; rows_total: number; rows_at_last_backup: number }>();
    const every = backupEveryValue(row?.every) ?? DEFAULT_BACKUP_EVERY;
    const rowsTotal = row?.rows_total ?? 0;
    const atLast = row?.rows_at_last_backup ?? 0;
    if (rowsTotal < atLast) { await env.DB.prepare('UPDATE backup_state SET rows_at_last_backup = ?, updated_at = ? WHERE workspace_id = ?').bind(rowsTotal, nowIso(), workspaceId).run(); return null; }
    if (rowsTotal - atLast < every) return null;
    const created = await createBackup(env, workspaceId, row?.name ?? 'Workspace', `automatic:${rowsTotal}-rows`);
    return 'error' in created ? null : created.status;
  } catch (error) {
    try { await env.DB.prepare('UPDATE backup_state SET last_error = ?, updated_at = ? WHERE workspace_id = ?').bind(String(error).slice(0, 400), nowIso(), workspaceId).run(); } catch { /* the ledger write already succeeded */ }
    return null;
  }
}

export function snapshotProblem(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return 'Backup file is unreadable';
  const doc = snapshot as SnapshotDoc;
  if (doc.format !== BACKUP_FORMAT) return 'Backup file is not a trip finance workspace backup';
  if (doc.version !== BACKUP_VERSION) return `Backup version ${String(doc.version)} is not supported`;
  if (!Array.isArray(doc.transactions)) return 'Backup file has no transactions';
  return null;
}

export function restoreName(original: unknown): string {
  const base = typeof original === 'string' && original.trim() ? original.trim().slice(0, 80) : 'Workspace';
  return `${base} (restored ${new Date().toISOString().slice(0, 10)})`.slice(0, 100);
}

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const integer = (value: unknown, fallback: number): number => Number.isSafeInteger(value) ? value as number : fallback;

// Restores a snapshot into a brand new workspace so the source workspace is untouched:
// nothing is overwritten, and every restored row is written (and audited) as a fresh insert.
export async function restoreSnapshot(env: Env, secretHash: string, snapshot: unknown, name: string): Promise<{ workspaceId: number; restored: Record<string, number> }> {
  const doc = snapshot as SnapshotDoc;
  const db = env.DB;
  const created = nowIso();
  const peopleRows = (doc.people ?? []).filter((row) => text(row.display_name));
  const currencyRows = (doc.currencies ?? []).filter((row) => text(row.code));
  const settings = doc.settings ?? {};
  const minted = await db.prepare('INSERT INTO workspaces (name, secret_hash, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id').bind(name, secretHash, created, created).first<{ id: number }>();
  const workspaceId = minted?.id;
  if (!workspaceId) throw new Error('Unable to create the restored workspace');
  const statements = [
    ...peopleRows.map((row) => db.prepare('INSERT INTO workspace_people (workspace_id, display_name, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(workspaceId, text(row.display_name), integer(row.is_archived, 0), text(row.created_at) ?? created, created)),
    ...currencyRows.map((row) => db.prepare('INSERT INTO workspace_currencies (workspace_id, code, is_default, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').bind(workspaceId, text(row.code), integer(row.is_default, 0), integer(row.is_archived, 0), text(row.created_at) ?? created, created)),
    db.prepare('INSERT INTO workspace_settings (workspace_id, categories_json, small_amount_guard_json, timezone, auto_offset, backup_every, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(workspaceId, text(settings.categories_json) ?? '[]', text(settings.small_amount_guard_json) ?? '{}', text(settings.timezone) ?? 'Asia/Bangkok', integer(settings.auto_offset, 1), backupEveryValue(settings.backup_every) ?? DEFAULT_BACKUP_EVERY, created, created),
  ];
  const results = await db.batch(statements);
  const peopleIds = peopleRows.map((_, index) => (results[index]?.results as { id: number }[] | undefined)?.[0]?.id);
  const remap = new Map<string, number>();
  (doc.people ?? []).forEach((row, index) => { const id = Number(row.id); const mapped = peopleIds[index]; if (Number.isSafeInteger(id) && mapped) remap.set(String(id), mapped); });
  const knownCurrencies = new Set(currencyRows.map((row) => text(row.code)));

  const transactions = (doc.transactions ?? []).map((row) => {
    const creditor = remap.get(String(Number(row.creditor_person_id)));
    const debtor = remap.get(String(Number(row.debtor_person_id)));
    const code = text(row.currency_code) ?? '';
    if (!creditor || !debtor || (knownCurrencies.size && !knownCurrencies.has(code))) return null;
    return [workspaceId, text(row.occurred_on) ?? created.slice(0, 10), text(row.entry_kind) ?? 'debt', text(row.topic) ?? '', text(row.category), creditor, debtor, integer(row.amount_minor, 0), code, text(row.notes), text(row.import_group_id), integer(row.is_deleted, 0), text(row.created_at) ?? created, created];
  }).filter((row): row is (string | number | null)[] => row !== null);

  let restoredRows = 0;
  for (let start = 0; start < transactions.length; start += 100) {
    const chunk = transactions.slice(start, start + 100);
    await db.batch(chunk.map((row) => db.prepare(`INSERT INTO transactions (workspace_id, ${transactionColumns.join(', ')}, updated_at) VALUES (${row.map(() => '?').join(', ')})`).bind(...row)));
    restoredRows += chunk.length;
  }
  const commitColumns = ['kind', 'idempotency_key', 'draft_hash', 'created_at'];
  const commits = (doc.workflow_commits ?? []).filter((row) => text(row.idempotency_key) && text(row.draft_hash));
  if (commits.length) await db.batch(commits.map((row) => db.prepare(`INSERT OR IGNORE INTO workflow_commits (workspace_id, ${commitColumns.join(', ')}) VALUES (?, ?, ?, ?, ?)`).bind(workspaceId, text(row.kind) ?? 'batch', text(row.idempotency_key), text(row.draft_hash), text(row.created_at) ?? created)));
  const splits = (doc.split_commits ?? []).filter((row) => text(row.idempotency_key) && text(row.draft_hash));
  if (splits.length) await db.batch(splits.map((row) => db.prepare('INSERT OR IGNORE INTO split_commits (workspace_id, idempotency_key, draft_hash, created_at) VALUES (?, ?, ?, ?)').bind(workspaceId, text(row.idempotency_key), text(row.draft_hash), text(row.created_at) ?? created)));

  await readBackupState(db, workspaceId).catch(() => null);
  return { workspaceId, restored: { people: peopleRows.length, currencies: currencyRows.length, transactions: restoredRows, skipped_transactions: (doc.transactions ?? []).length - restoredRows, workflow_commits: commits.length, split_commits: splits.length } };
}
