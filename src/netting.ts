import { offsetTransactions, reciprocalBalance } from './workflows';

/** A row a request is about to commit, used to predict the balance inside the same batch. */
export type PendingRow = {
  creditor_person_id: number;
  debtor_person_id: number;
  amount_minor: number;
  currency_code: string;
  occurred_on: string;
};

const insertTransaction =
  'INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * Automatic bilateral netting.
 *
 * Every write path hands over the rows it is about to commit. For each pair of people and currency
 * this predicts the post-write reciprocal balance (the stored balance plus the pending amounts) and,
 * when both directions are positive, appends exactly the offset pair the manual Settle-up flow
 * creates - so the overlap disappears in the same atomic batch as the transaction that caused it.
 *
 * Netting removes precisely the overlap, so recomputing it for the same rows is a no-op: a retried
 * request or a second pass can never net the same amounts twice.
 *
 * Returns no statements when the workspace switched automatic netting off (`auto_offset = 0`).
 */
export async function autoNettingStatements(db: D1Database, workspaceId: number, pending: PendingRow[]): Promise<D1PreparedStatement[]> {
  if (!pending.length) return [];
  const settings = await db.prepare('SELECT auto_offset FROM workspace_settings WHERE workspace_id = ?').bind(workspaceId).first<{ auto_offset: number | null }>();
  if (settings && Number(settings.auto_offset) === 0) return [];

  const groups = new Map<string, { first: number; second: number; currency: string; occurred_on: string }>();
  for (const row of pending) {
    if (!Number.isSafeInteger(row.creditor_person_id) || !Number.isSafeInteger(row.debtor_person_id)) continue;
    if (row.creditor_person_id === row.debtor_person_id) continue;
    if (typeof row.currency_code !== 'string' || !row.currency_code) continue;
    const first = Math.min(row.creditor_person_id, row.debtor_person_id);
    const second = Math.max(row.creditor_person_id, row.debtor_person_id);
    const key = `${first}:${second}:${row.currency_code}`;
    const group = groups.get(key) ?? { first, second, currency: row.currency_code, occurred_on: row.occurred_on };
    if (row.occurred_on > group.occurred_on) group.occurred_on = row.occurred_on;
    groups.set(key, group);
  }

  const statements: D1PreparedStatement[] = [];
  for (const group of groups.values()) {
    const balance = await reciprocalBalance(db, workspaceId, group.first, group.second, group.currency);
    let firstOwesSecond = Math.max(balance.first_owes_second_minor, 0);
    let secondOwesFirst = Math.max(balance.second_owes_first_minor, 0);
    for (const row of pending) {
      if (row.currency_code !== group.currency) continue;
      const amount = Number(row.amount_minor) || 0;
      if (row.debtor_person_id === group.first && row.creditor_person_id === group.second) firstOwesSecond += amount;
      else if (row.debtor_person_id === group.second && row.creditor_person_id === group.first) secondOwesFirst += amount;
    }
    const amount = Math.min(Math.max(firstOwesSecond, 0), Math.max(secondOwesFirst, 0));
    if (amount <= 0) continue;
    const draft = { occurred_on: group.occurred_on, topic: 'Offset', category: 'Offset', notes: 'Automatic bilateral netting' };
    const nettingGroup = `auto-offset:${group.currency}:${group.first}-${group.second}`;
    for (const transaction of offsetTransactions(workspaceId, draft, group.first, group.second, amount, group.currency)) {
      statements.push(db.prepare(insertTransaction).bind(transaction.workspace_id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, nettingGroup));
    }
  }
  return statements;
}
