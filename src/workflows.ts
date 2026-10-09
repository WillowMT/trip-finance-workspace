export type Json = Record<string, unknown>;

type Person = { id: number; workspace_id: number; display_name: string; is_archived: number };
type Currency = { workspace_id: number; code: string; is_archived: number };

export const workflowKinds = ['offset', 'batch', 'import'] as const;
export type WorkflowKind = (typeof workflowKinds)[number];

export const maxWorkflowRows = 200;

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validIdempotencyKey(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashJson(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

export type WorkflowTransaction = {
  workspace_id: number;
  occurred_on: string;
  entry_kind: string;
  topic: string;
  category: string;
  creditor_person_id: number;
  debtor_person_id: number;
  amount_minor: number;
  currency_code: string;
  notes: string | null;
  import_group_id: string | null;
};

/** Shared validation of one ordinary debt/payment row. Returns the cleaned row or an error string. */
export async function validateWorkflowRow(
  db: D1Database,
  workspaceId: number,
  input: Json,
): Promise<{ row?: Omit<WorkflowTransaction, 'workspace_id' | 'import_group_id'>; problem?: string }> {
  const occurred_on = input.occurred_on;
  const entry_kind = input.entry_kind;
  const topic = cleanText(input.topic, 200);
  const category = cleanText(input.category, 80);
  const amount_minor = input.amount_minor;
  const currency_code = input.currency_code;
  const notes = input.notes === undefined || input.notes === null ? null : typeof input.notes === 'string' && input.notes.length <= 4_000 ? input.notes : undefined;
  const creditor_person_id = input.creditor_person_id;
  const debtor_person_id = input.debtor_person_id;
  if (
    !validDate(occurred_on) || (entry_kind !== 'debt' && entry_kind !== 'payment') || !topic || !category ||
    !Number.isSafeInteger(amount_minor) || amount_minor === 0 ||
    typeof currency_code !== 'string' || !/^[A-Z]{3}$/.test(currency_code) || notes === undefined ||
    !Number.isSafeInteger(creditor_person_id) || !Number.isSafeInteger(debtor_person_id) ||
    creditor_person_id === debtor_person_id
  ) return { problem: 'Invalid transaction row' };

  const people = await db.prepare(
    `SELECT id, workspace_id, is_archived FROM workspace_people WHERE workspace_id = ? AND is_archived = 0 AND id IN (?, ?)`,
  ).bind(workspaceId, creditor_person_id, debtor_person_id).all<Person>();
  if (people.results.length !== 2) return { problem: 'Transaction people must belong to this workspace and be active' };
  const currency = await db.prepare('SELECT workspace_id, code, is_archived FROM workspace_currencies WHERE workspace_id = ? AND code = ? AND is_archived = 0')
    .bind(workspaceId, currency_code).first<Currency>();
  if (!currency) return { problem: 'Transaction currency must belong to this workspace and be active' };

  return {
    row: {
      occurred_on, entry_kind, topic, category,
      creditor_person_id: creditor_person_id as number,
      debtor_person_id: debtor_person_id as number,
      amount_minor: amount_minor as number,
      currency_code, notes: notes as string | null,
    },
  };
}

/** Reciprocal balances between two people in one currency, computed from non-deleted rows. */
export async function reciprocalBalance(db: D1Database, workspaceId: number, firstId: number, secondId: number, currencyCode: string): Promise<{ first_owes_second_minor: number; second_owes_first_minor: number }> {
  const row = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN debtor_person_id = ? AND creditor_person_id = ? THEN amount_minor ELSE 0 END), 0) AS first_owes_second_minor,
       COALESCE(SUM(CASE WHEN debtor_person_id = ? AND creditor_person_id = ? THEN amount_minor ELSE 0 END), 0) AS second_owes_first_minor
     FROM transactions
     WHERE workspace_id = ? AND is_deleted = 0 AND currency_code = ?
       AND ((debtor_person_id = ? AND creditor_person_id = ?) OR (debtor_person_id = ? AND creditor_person_id = ?))`,
  ).bind(firstId, secondId, secondId, firstId, workspaceId, currencyCode, firstId, secondId, secondId, firstId)
    .first<{ first_owes_second_minor: number; second_owes_first_minor: number }>();
  return { first_owes_second_minor: Number(row?.first_owes_second_minor ?? 0), second_owes_first_minor: Number(row?.second_owes_first_minor ?? 0) };
}

export function offsetTransactions(workspaceId: number, draft: { occurred_on: string; topic: string; category: string; notes: string | null }, firstId: number, secondId: number, amountMinor: number, currencyCode: string): WorkflowTransaction[] {
  // Both entries are negative on the existing debt directions: the owed side is reduced on both directions.
  return [
    { workspace_id: workspaceId, occurred_on: draft.occurred_on, entry_kind: 'offset', topic: draft.topic, category: draft.category, creditor_person_id: firstId, debtor_person_id: secondId, amount_minor: -amountMinor, currency_code: currencyCode, notes: draft.notes, import_group_id: null },
    { workspace_id: workspaceId, occurred_on: draft.occurred_on, entry_kind: 'offset', topic: draft.topic, category: draft.category, creditor_person_id: secondId, debtor_person_id: firstId, amount_minor: -amountMinor, currency_code: currencyCode, notes: draft.notes, import_group_id: null },
  ];
}

/** Minimal RFC-4180-style CSV parser (quotes, embedded commas/newlines, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else inQuotes = false;
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ''));
}

export type ImportPlanRow = { occurred_on: string; entry_kind: string; topic: string; category: string; creditor_person_id: number; debtor_person_id: number; amount_minor: number; currency_code: string; notes: string | null };

export function parseImportCsv(
  raw: string,
  peopleByName: Map<string, { id: number; is_archived: number }>,
  currencies: Set<string>,
): { rows: ImportPlanRow[]; errors: string[] } {
  const parsed = parseCsv(raw);
  if (parsed.length < 2) return { rows: [], errors: ['CSV must include a header row and at least one data row'] };
  const header = parsed[0].map((column) => column.trim().toLowerCase());
  const required = ['occurred_on', 'entry_kind', 'topic', 'category', 'creditor', 'debtor', 'amount', 'currency'];
  if (required.some((column) => !header.includes(column))) return { rows: [], errors: [`CSV header must include: ${required.join(', ')}`] };
  const column = (name: string) => header.indexOf(name);
  const notesIndex = column('notes');
  const rows: ImportPlanRow[] = [];
  const errors: string[] = [];
  for (let line = 1; line < parsed.length; line += 1) {
    const cells = parsed[line];
    const value = (name: string) => { const index = column(name); return index >= 0 && index < cells.length ? cells[index].trim() : ''; };
    const problems: string[] = [];
    const occurred_on = value('occurred_on');
    if (!validDate(occurred_on)) problems.push('invalid occurred_on');
    const entry_kind = value('entry_kind');
    if (entry_kind !== 'debt' && entry_kind !== 'payment') problems.push('entry_kind must be debt or payment');
    const topic = cleanText(value('topic'), 200);
    if (!topic) problems.push('invalid topic');
    const category = cleanText(value('category'), 80);
    if (!category) problems.push('invalid category');
    const creditorName = value('creditor').toLowerCase();
    const debtorName = value('debtor').toLowerCase();
    const creditor = peopleByName.get(creditorName);
    const debtor = peopleByName.get(debtorName);
    if (!creditor || creditor.is_archived) problems.push('unknown or archived creditor');
    if (!debtor || debtor.is_archived) problems.push('unknown or archived debtor');
    if (creditor && debtor && creditor.id === debtor.id) problems.push('creditor and debtor must differ');
    const amountText = value('amount');
    const amount = /^-?\d+(\.\d+)?$/.test(amountText) ? Math.round(Number(amountText) * 100) : NaN;
    if (!Number.isSafeInteger(amount) || amount === 0) problems.push('invalid amount');
    const currency_code = value('currency').toUpperCase();
    if (!currencies.has(currency_code)) problems.push('unknown or archived currency');
    const notes = notesIndex >= 0 && notesIndex < cells.length && cells[notesIndex].trim() !== '' ? cells[notesIndex].trim().slice(0, 4_000) : null;
    if (problems.length) { errors.push(`Row ${line + 1}: ${problems.join('; ')}`); continue; }
    rows.push({
      occurred_on, entry_kind, topic: topic!, category: category!,
      creditor_person_id: creditor!.id, debtor_person_id: debtor!.id,
      amount_minor: entry_kind === 'debt' ? amount : -Math.abs(amount),
      currency_code, notes,
    });
  }
  return { rows, errors };
}

export function importAmountToMinor(amountText: string): number {
  return Math.round(Number(amountText) * 100);
}
