export type Json = Record<string, unknown>;

type Person = { id: number; workspace_id: number; is_archived: number };
type Currency = { workspace_id: number; code: string; is_archived: number };
export type SplitTransaction = {
  id?: number;
  workspace_id: number;
  occurred_on: string;
  entry_kind: 'split';
  topic: string;
  category: string;
  creditor_person_id: number;
  debtor_person_id: number;
  amount_minor: number;
  currency_code: string;
  notes: string | null;
  import_group_id: string | null;
  is_deleted?: number;
  created_at?: string;
  updated_at?: string;
};

type SplitDraft = {
  occurred_on: string;
  payer_person_id: number;
  participant_person_ids: number[];
  amount_minor: number;
  topic: string;
  category: string;
  currency_code: string;
  notes: string | null;
};

export type SplitPlan = {
  draft: SplitDraft;
  transactions: SplitTransaction[];
  participant_allocations: { person_id: number; amount_minor: number }[];
  total_amount_minor: number;
  debt_amount_minor: number;
};

const currencyPattern = /^[A-Z]{3}$/;
const maxNotesLength = 4_000;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function notes(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && value.length <= maxNotesLength ? value : undefined;
}

export async function planSplit(db: D1Database, workspaceId: number, input: Json): Promise<{ plan?: SplitPlan; problem?: string }> {
  const occurred_on = input.occurred_on;
  const payer_person_id = input.payer_person_id;
  const participant_person_ids = input.participant_person_ids;
  const amount_minor = input.amount_minor;
  const topic = cleanText(input.topic, 200);
  const category = cleanText(input.category, 80);
  const currency_code = input.currency_code;
  const cleanedNotes = notes(input.notes);
  if (!validDate(occurred_on) || typeof payer_person_id !== 'number' || !Number.isSafeInteger(payer_person_id) || !Array.isArray(participant_person_ids) || participant_person_ids.length < 1 || participant_person_ids.length > 200 || !participant_person_ids.every((id) => typeof id === 'number' && Number.isSafeInteger(id)) || new Set(participant_person_ids).size !== participant_person_ids.length || typeof amount_minor !== 'number' || !Number.isSafeInteger(amount_minor) || amount_minor <= 0 || !topic || !category || typeof currency_code !== 'string' || !currencyPattern.test(currency_code) || cleanedNotes === undefined) return { problem: 'Invalid split draft' };

  const payer = payer_person_id as number;
  const totalAmount = amount_minor as number;
  const participantIds = participant_person_ids as number[];
  const people = await db.prepare(`SELECT id, workspace_id, is_archived FROM workspace_people WHERE workspace_id = ? AND is_archived = 0 AND id IN (${participantIds.map(() => '?').join(', ')}, ?)`)
    .bind(workspaceId, ...participantIds, payer).all<Person>();
  const activePeople = new Set(people.results.map((person) => person.id));
  if (!activePeople.has(payer) || participantIds.some((id) => !activePeople.has(id))) return { problem: 'Split people must belong to this workspace and be active' };
  const currency = await db.prepare('SELECT workspace_id, code, is_archived FROM workspace_currencies WHERE workspace_id = ? AND code = ? AND is_archived = 0').bind(workspaceId, currency_code).first<Currency>();
  if (!currency) return { problem: 'Split currency must belong to this workspace and be active' };

  const participants = [...participantIds].sort((left, right) => left - right);
  const base = Math.floor(totalAmount / participants.length);
  const remainder = totalAmount % participants.length;
  const participant_allocations = participants.map((person_id, index) => ({ person_id, amount_minor: base + (index < remainder ? 1 : 0) }));
  const draft: SplitDraft = { occurred_on, payer_person_id: payer, participant_person_ids: participants, amount_minor: totalAmount, topic, category, currency_code, notes: cleanedNotes };
  const transactions = participant_allocations
    .filter(({ person_id }) => person_id !== payer)
    .map(({ person_id, amount_minor: allocation }) => ({ workspace_id: workspaceId, occurred_on, entry_kind: 'split' as const, topic, category, creditor_person_id: payer, debtor_person_id: person_id, amount_minor: allocation, currency_code, notes: cleanedNotes, import_group_id: null }));
  return { plan: { draft, transactions, participant_allocations, total_amount_minor: totalAmount, debt_amount_minor: transactions.reduce((total, transaction) => total + transaction.amount_minor, 0) } };
}

export function splitDraftHash(plan: SplitPlan): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(plan.draft))).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

export function validIdempotencyKey(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
}

export function splitResponse(plan: SplitPlan, transactions: SplitTransaction[]): Omit<SplitPlan, 'draft'> & { transactions: SplitTransaction[] } {
  return { transactions, participant_allocations: plan.participant_allocations, total_amount_minor: plan.total_amount_minor, debt_amount_minor: plan.debt_amount_minor };
}
