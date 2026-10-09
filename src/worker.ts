import { planSplit, splitDraftHash, splitResponse, type SplitTransaction, validIdempotencyKey as validSplitKey } from './splits';
import { hashJson, maxWorkflowRows, offsetTransactions, parseImportCsv, reciprocalBalance, validDate as validDateValue, validIdempotencyKey, validateWorkflowRow, type ImportPlanRow, type WorkflowTransaction } from './workflows';

export interface Env {
  DB: D1Database;
}

type Json = Record<string, unknown>;
type Workspace = { id: number; name: string; is_active: number; created_at: string; updated_at: string };
type Person = { id: number; workspace_id: number; display_name: string; is_archived: number; created_at: string; updated_at: string };
type Currency = { id: number; workspace_id: number; code: string; is_default: number; is_archived: number; created_at: string; updated_at: string };
type Transaction = { id: number; workspace_id: number; occurred_on: string; entry_kind: string; topic: string; category: string; creditor_person_id: number; debtor_person_id: number; amount_minor: number; currency_code: string; notes: string | null; import_group_id: string | null; is_deleted: number; created_at: string; updated_at: string };

const landingPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Trip finance workspace</title></head>
<body><main><h1>Trip finance workspace</h1><p>Create a workspace to share one editable finance ledger with your group.</p><button type="button">Create shared workspace</button></main></body></html>`;
const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const currencyPattern = /^[A-Z]{3}$/;
const entryKinds = new Set(['debt', 'payment']);
const maxJsonBytes = 256 * 1024;
const bodyTooLarge = Symbol('body too large');

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
function error(message: string, status = 400, headers: HeadersInit = {}): Response { return json({ error: message }, status, headers); }
function secretHeaders(): HeadersInit {
  return { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
}
function secretResponse(value: unknown, status = 200): Response { return json(value, status, secretHeaders()); }
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
function asObject(value: unknown): Json | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null; }
async function body(request: Request): Promise<Json | null | typeof bodyTooLarge> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxJsonBytes) return bodyTooLarge;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxJsonBytes) { await reader.cancel(); return bodyTooLarge; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return asObject(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}
function allowedOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function resolveWorkspace(db: D1Database, secret: string): Promise<Workspace | null> {
  if (!secretPattern.test(secret)) return null;
  return db.prepare('SELECT id, name, is_active, created_at, updated_at FROM workspaces WHERE secret_hash = ? AND is_active = 1').bind(await sha256(secret)).first<Workspace>();
}
async function requireWorkspace(db: D1Database, secret: string): Promise<Workspace | Response> {
  const workspace = await resolveWorkspace(db, secret);
  return workspace ?? secretResponse({ error: 'Workspace not found' }, 404);
}
async function state(db: D1Database, workspace: Workspace): Promise<Json> {
  const [people, currencies, settings] = await Promise.all([
    db.prepare('SELECT id, workspace_id, display_name, is_archived, created_at, updated_at FROM workspace_people WHERE workspace_id = ? ORDER BY id').bind(workspace.id).all<Person>(),
    db.prepare('SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE workspace_id = ? ORDER BY id').bind(workspace.id).all<Currency>(),
    db.prepare('SELECT categories_json, small_amount_guard_json, created_at, updated_at FROM workspace_settings WHERE workspace_id = ?').bind(workspace.id).first<{ categories_json: string; small_amount_guard_json: string; created_at: string; updated_at: string }>(),
  ]);
  return { workspace, people: people.results, currencies: currencies.results, settings: settings && { categories: JSON.parse(settings.categories_json), small_amount_guard: JSON.parse(settings.small_amount_guard_json), created_at: settings.created_at, updated_at: settings.updated_at } };
}
function onboarding(input: Json): { name: string; people: string[]; currencies: { code: string; is_default: boolean }[] } | null {
  const name = cleanText(input.name, 100);
  if (!name || !Array.isArray(input.people) || !Array.isArray(input.currencies)) return null;
  const people = input.people.map((person) => typeof person === 'string' ? cleanText(person, 80) : cleanText(asObject(person)?.display_name, 80));
  if (people.some((person) => !person) || people.length < 2 || new Set(people.map((person) => person!.toLocaleLowerCase())).size !== people.length) return null;
  const currencies = input.currencies.map((currency) => {
    const item = asObject(currency);
    return item && typeof item.code === 'string' && currencyPattern.test(item.code) && typeof item.is_default === 'boolean' ? { code: item.code, is_default: item.is_default } : null;
  });
  if (currencies.some((currency) => !currency) || currencies.length < 1 || new Set(currencies.map((currency) => currency!.code)).size !== currencies.length || currencies.filter((currency) => currency!.is_default).length !== 1) return null;
  return { name, people: people as string[], currencies: currencies as { code: string; is_default: boolean }[] };
}
async function ownedPerson(db: D1Database, workspaceId: number, id: unknown, active = false): Promise<Person | null> {
  if (!Number.isSafeInteger(id)) return null;
  return db.prepare(`SELECT id, workspace_id, display_name, is_archived, created_at, updated_at FROM workspace_people WHERE id = ? AND workspace_id = ?${active ? ' AND is_archived = 0' : ''}`).bind(id, workspaceId).first<Person>();
}
async function ownedCurrency(db: D1Database, workspaceId: number, code: unknown, active = false): Promise<Currency | null> {
  if (typeof code !== 'string' || !currencyPattern.test(code)) return null;
  return db.prepare(`SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE workspace_id = ? AND code = ?${active ? ' AND is_archived = 0' : ''}`).bind(workspaceId, code).first<Currency>();
}
async function validateTransaction(db: D1Database, workspaceId: number, input: Json): Promise<string | null> {
  if (!validDate(input.occurred_on) || !entryKinds.has(input.entry_kind as string) || !cleanText(input.topic, 200) || !cleanText(input.category, 80) || !Number.isSafeInteger(input.amount_minor) || input.amount_minor === 0 || input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') return 'Invalid transaction';
  if (input.creditor_person_id === input.debtor_person_id || !await ownedPerson(db, workspaceId, input.creditor_person_id, true) || !await ownedPerson(db, workspaceId, input.debtor_person_id, true) || !await ownedCurrency(db, workspaceId, input.currency_code, true)) return 'Transaction references must belong to this workspace and be active';
  return null;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === 'GET' && pathname === '/') return new Response(landingPage, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (request.method === 'POST' && pathname === '/api/workspaces') {
    const input = await body(request); if (input === bodyTooLarge) return error('Request body too large', 413, secretHeaders()); const valid = input && onboarding(input);
    if (!valid) return error('Invalid workspace onboarding payload', 400, secretHeaders());
    const secret = createSecret(); const hash = await sha256(secret);
    const statements: D1PreparedStatement[] = [env.DB.prepare('INSERT INTO workspaces (secret_hash, name) VALUES (?, ?)').bind(hash, valid.name), env.DB.prepare(`INSERT INTO workspace_settings (workspace_id) SELECT id FROM workspaces WHERE secret_hash = ?`).bind(hash)];
    for (const person of valid.people) statements.push(env.DB.prepare('INSERT INTO workspace_people (workspace_id, display_name) SELECT id, ? FROM workspaces WHERE secret_hash = ?').bind(person, hash));
    for (const currency of valid.currencies) statements.push(env.DB.prepare('INSERT INTO workspace_currencies (workspace_id, code, is_default) SELECT id, ?, ? FROM workspaces WHERE secret_hash = ?').bind(currency.code, currency.is_default ? 1 : 0, hash));
    await env.DB.batch(statements);
    const workspace = await resolveWorkspace(env.DB, secret);
    return json({ workspace: workspace && { id: workspace.id, name: workspace.name }, workspace_url: `/w/${secret}` }, 201, secretHeaders());
  }
  const match = pathname.match(/^\/w\/([^/]+)(?:\/(.*))?$/);
  if (!match) return new Response('Not found', { status: 404 });
  const [, secret, rawTail = ''] = match;
  const workspacePage = rawTail === '';
  const workspaceApi = rawTail === 'api' || rawTail.startsWith('api/');
  const tail = rawTail.startsWith('api/') ? rawTail.slice(4) : workspaceApi ? '' : rawTail;
  const required = await requireWorkspace(env.DB, secret);
  if (required instanceof Response) return required;
  const workspace = required;
  if (workspacePage) return request.method === 'GET' ? new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${workspace.name}</title></head><body><main><h1>${workspace.name}</h1><p>Your shared finance workspace is ready.</p><p>Use this private link to manage people, currencies, and transactions.</p></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', ...secretHeaders() } }) : new Response('Not found', { status: 404, headers: secretHeaders() });
  if (!workspaceApi) return new Response('Not found', { status: 404, headers: secretHeaders() });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !allowedOrigin(request, url)) return secretResponse({ error: 'Origin does not match this capability URL' }, 403);
  if (tail === '' && request.method === 'GET') return secretResponse(await state(env.DB, workspace));
  if (tail === 'audit' && request.method === 'GET') {
    const entries = await env.DB.prepare('SELECT id, workspace_id, entity_type, entity_id, action, actor_label, before_json, after_json, occurred_at FROM audit_log WHERE workspace_id = ? ORDER BY id').bind(workspace.id).all();
    return secretResponse({ audit: entries.results });
  }
  if (tail === '' && request.method === 'PATCH') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const statements: D1PreparedStatement[] = [];
    if ('name' in input) { const name = cleanText(input.name, 100); if (!name) return secretResponse({ error: 'Invalid workspace name' }, 400); statements.push(env.DB.prepare(`UPDATE workspaces SET name = ?, updated_at = ${now} WHERE id = ?`).bind(name, workspace.id)); }
    if ('settings' in input) {
      const settings = asObject(input.settings); if (!settings || !('categories' in settings) || !('small_amount_guard' in settings) || !Array.isArray(settings.categories) || !settings.categories.every((category) => typeof category === 'string' && cleanText(category, 80)) || !asObject(settings.small_amount_guard)) return secretResponse({ error: 'Invalid settings' }, 400);
      statements.push(env.DB.prepare(`UPDATE workspace_settings SET categories_json = ?, small_amount_guard_json = ?, updated_at = ${now} WHERE workspace_id = ?`).bind(JSON.stringify(settings.categories), JSON.stringify(settings.small_amount_guard), workspace.id));
    }
    if (!statements.length) return secretResponse({ error: 'No supported changes' }, 400);
    await env.DB.batch(statements); const updated = (await requireWorkspace(env.DB, secret)) as Workspace; return secretResponse(await state(env.DB, updated));
  }
  if (tail === 'people' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); const displayName = input && cleanText(input.display_name, 80); if (!displayName) return secretResponse({ error: 'Invalid person' }, 400);
    const result = await env.DB.prepare('INSERT INTO workspace_people (workspace_id, display_name) VALUES (?, ?) RETURNING id, workspace_id, display_name, is_archived, created_at, updated_at').bind(workspace.id, displayName).first<Person>(); return secretResponse({ person: result }, 201);
  }
  let route = tail.match(/^people\/(\d+)(?:\/(archive|restore))?$/);
  if (route) {
    const [, value, action] = route; const person = await ownedPerson(env.DB, workspace.id, Number(value)); if (!person) return secretResponse({ error: 'Person not found' }, 404);
    if (!action && request.method === 'PATCH') { const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); const displayName = input && cleanText(input.display_name, 80); if (!displayName) return secretResponse({ error: 'Invalid person' }, 400); await env.DB.prepare(`UPDATE workspace_people SET display_name = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(displayName, person.id, workspace.id).run(); }
    else if ((action === 'archive' || action === 'restore') && request.method === 'POST') await env.DB.prepare(`UPDATE workspace_people SET is_archived = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(action === 'archive' ? 1 : 0, person.id, workspace.id).run(); else return secretResponse({ error: 'Not found' }, 404);
    return secretResponse({ person: await ownedPerson(env.DB, workspace.id, person.id) });
  }
  if (tail === 'currencies' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); const code = input?.code; if (typeof code !== 'string' || !currencyPattern.test(code) || typeof input?.is_default !== 'boolean') return secretResponse({ error: 'Invalid currency' }, 400);
    if (input.is_default) await env.DB.batch([env.DB.prepare(`UPDATE workspace_currencies SET is_default = 0, updated_at = ${now} WHERE workspace_id = ? AND is_archived = 0`).bind(workspace.id), env.DB.prepare('INSERT INTO workspace_currencies (workspace_id, code, is_default) VALUES (?, ?, 1)').bind(workspace.id, code)]); else await env.DB.prepare('INSERT INTO workspace_currencies (workspace_id, code) VALUES (?, ?)').bind(workspace.id, code).run();
    return secretResponse({ currency: await ownedCurrency(env.DB, workspace.id, code) }, 201);
  }
  route = tail.match(/^currencies\/(\d+)(?:\/(archive|restore))?$/);
  if (route) {
    const [, value, action] = route; const currency = await env.DB.prepare('SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE id = ? AND workspace_id = ?').bind(Number(value), workspace.id).first<Currency>(); if (!currency) return secretResponse({ error: 'Currency not found' }, 404);
    if (!action && request.method === 'PATCH') { const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input || (input.code !== undefined && (typeof input.code !== 'string' || !currencyPattern.test(input.code))) || (input.is_default !== undefined && typeof input.is_default !== 'boolean')) return secretResponse({ error: 'Invalid currency' }, 400); if (input.is_default === false && currency.is_default && !currency.is_archived) return secretResponse({ error: 'A workspace must have one active default currency' }, 400); const code = input.code ?? currency.code; if (input.is_default) await env.DB.batch([env.DB.prepare(`UPDATE workspace_currencies SET is_default = 0, updated_at = ${now} WHERE workspace_id = ? AND is_archived = 0`).bind(workspace.id), env.DB.prepare(`UPDATE workspace_currencies SET code = ?, is_default = 1, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(code, currency.id, workspace.id)]); else await env.DB.prepare(`UPDATE workspace_currencies SET code = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(code, currency.id, workspace.id).run(); }
    else if (action === 'archive' && request.method === 'POST') { if (currency.is_default) return secretResponse({ error: 'Default currency cannot be archived' }, 400); await env.DB.prepare(`UPDATE workspace_currencies SET is_archived = 1, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(currency.id, workspace.id).run(); }
    else if (action === 'restore' && request.method === 'POST') await env.DB.prepare(`UPDATE workspace_currencies SET is_archived = 0, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(currency.id, workspace.id).run(); else return secretResponse({ error: 'Not found' }, 404);
    return secretResponse({ currency: await env.DB.prepare('SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE id = ? AND workspace_id = ?').bind(currency.id, workspace.id).first<Currency>() });
  }
  if (tail === 'splits/preview' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const prepared = await planSplit(env.DB, workspace.id, input); if (!prepared.plan) return secretResponse({ error: prepared.problem }, 400);
    return secretResponse(splitResponse(prepared.plan, prepared.plan.transactions));
  }
  if (tail === 'splits' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validSplitKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const prepared = await planSplit(env.DB, workspace.id, input); if (!prepared.plan) return secretResponse({ error: prepared.problem }, 400);
    const draftHash = await splitDraftHash(prepared.plan);
    const loadCommitted = async (): Promise<{ draft_hash: string; transactions: SplitTransaction[] } | null> => {
      const commit = await env.DB.prepare('SELECT draft_hash FROM split_commits WHERE workspace_id = ? AND idempotency_key = ?').bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `split:${idempotencyKey}`).all<SplitTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadCommitted();
    if (existing) return existing.draft_hash === draftHash ? secretResponse(splitResponse(prepared.plan, existing.transactions)) : secretResponse({ error: 'Idempotency key was already used for a different split draft' }, 409);
    const groupId = `split:${idempotencyKey}`;
    const statements: D1PreparedStatement[] = [env.DB.prepare('INSERT INTO split_commits (workspace_id, idempotency_key, draft_hash) VALUES (?, ?, ?)').bind(workspace.id, idempotencyKey, draftHash)];
    for (const transaction of prepared.plan.transactions) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(workspace.id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, groupId));
    try { await env.DB.batch(statements); } catch {
      const raced = await loadCommitted();
      if (!raced) return secretResponse({ error: 'Unable to commit split' }, 500);
      return raced.draft_hash === draftHash ? secretResponse(splitResponse(prepared.plan, raced.transactions)) : secretResponse({ error: 'Idempotency key was already used for a different split draft' }, 409);
    }
    const committed = await loadCommitted();
    if (!committed) return secretResponse({ error: 'Unable to load committed split' }, 500);
    return secretResponse(splitResponse(prepared.plan, committed.transactions), 201);
  }
  if (tail === 'offset-suggestions' && request.method === 'GET') {
    const people = await env.DB.prepare('SELECT id FROM workspace_people WHERE workspace_id = ? AND is_archived = 0 ORDER BY id').bind(workspace.id).all<{ id: number }>();
    const currencies = await env.DB.prepare('SELECT code FROM workspace_currencies WHERE workspace_id = ? AND is_archived = 0 ORDER BY code').bind(workspace.id).all<{ code: string }>();
    const suggestions: { first_person_id: number; second_person_id: number; first_owes_second_minor: number; second_owes_first_minor: number; offset_amount_minor: number; currency_code: string }[] = [];
    for (const currency of currencies.results) {
      for (let first = 0; first < people.results.length; first += 1) {
        for (let second = first + 1; second < people.results.length; second += 1) {
          const firstId = people.results[first].id; const secondId = people.results[second].id;
          const balance = await reciprocalBalance(env.DB, workspace.id, firstId, secondId, currency.code);
          const offset = Math.min(Math.max(balance.first_owes_second_minor, 0), Math.max(balance.second_owes_first_minor, 0));
          if (offset > 0) suggestions.push({ first_person_id: firstId, second_person_id: secondId, first_owes_second_minor: balance.first_owes_second_minor, second_owes_first_minor: balance.second_owes_first_minor, offset_amount_minor: offset, currency_code: currency.code });
        }
      }
    }
    return secretResponse({ suggestions });
  }
  if ((tail === 'offsets/preview' || tail === 'offsets') && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const firstId = input.first_person_id; const secondId = input.second_person_id; const currencyCode = input.currency_code;
    if (!Number.isSafeInteger(firstId) || !Number.isSafeInteger(secondId) || firstId === secondId || typeof currencyCode !== 'string' || !currencyPattern.test(currencyCode)) return secretResponse({ error: 'Invalid offset draft' }, 400);
    const currency = await ownedCurrency(env.DB, workspace.id, currencyCode, true); if (!currency) return secretResponse({ error: 'Offset currency must belong to this workspace and be active' }, 400);
    for (const personId of [firstId, secondId] as number[]) if (!(await ownedPerson(env.DB, workspace.id, personId, true))) return secretResponse({ error: 'Offset people must belong to this workspace and be active' }, 400);
    const balance = await reciprocalBalance(env.DB, workspace.id, firstId as number, secondId as number, currencyCode as string);
    const amount = Math.min(Math.max(balance.first_owes_second_minor, 0), Math.max(balance.second_owes_first_minor, 0));
    if (tail === 'offsets/preview') {
      if (amount <= 0) return secretResponse({ error: 'No reciprocal balance to offset between these people in this currency' }, 409);
      return secretResponse({ offset_amount_minor: amount, transactions: offsetTransactions(workspace.id, { occurred_on: validDateValue(input.occurred_on) ? input.occurred_on : new Date().toISOString().slice(0, 10), topic: 'Offset', category: 'Offset', notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null }, firstId as number, secondId as number, amount, currencyCode as string) });
    }
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validIdempotencyKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const loadOffset = async (): Promise<{ draft_hash: string; transactions: WorkflowTransaction[] } | null> => {
      const commit = await env.DB.prepare("SELECT draft_hash FROM workflow_commits WHERE workspace_id = ? AND kind = 'offset' AND idempotency_key = ?").bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `offset:${idempotencyKey}`).all<WorkflowTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadOffset();
    if (existing) return existing.draft_hash === (await hashJson({ first_person_id: firstId, second_person_id: secondId, currency_code: currencyCode })) ? secretResponse({ offset_amount_minor: amount, transactions: existing.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different offset draft' }, 409);
    if (amount <= 0) return secretResponse({ error: 'The recalculated reciprocal balance is no longer positive' }, 409);
    const occurredOn = typeof input.occurred_on === 'string' && validDateValue(input.occurred_on) ? input.occurred_on : new Date().toISOString().slice(0, 10);
    const transactions = offsetTransactions(workspace.id, { occurred_on: occurredOn, topic: 'Offset', category: 'Offset', notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null }, firstId as number, secondId as number, amount, currencyCode as string);
    const groupId = `offset:${idempotencyKey}`;
    const draftHash = await hashJson({ first_person_id: firstId, second_person_id: secondId, currency_code: currencyCode });
    const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO workflow_commits (workspace_id, kind, idempotency_key, draft_hash) VALUES (?, 'offset', ?, ?)").bind(workspace.id, idempotencyKey, draftHash)];
    for (const transaction of transactions) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(transaction.workspace_id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, groupId));
    try { await env.DB.batch(statements); } catch {
      const raced = await loadOffset();
      if (!raced) return secretResponse({ error: 'Unable to commit offset' }, 500);
      return raced.draft_hash === draftHash ? secretResponse({ offset_amount_minor: amount, transactions: raced.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different offset draft' }, 409);
    }
    const committed = await loadOffset();
    if (!committed) return secretResponse({ error: 'Unable to load committed offset' }, 500);
    return secretResponse({ offset_amount_minor: amount, transactions: committed.transactions }, 201);
  }
  if ((tail === 'batches/preview' || tail === 'batches') && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > maxWorkflowRows) return secretResponse({ error: 'Batch must include 1-200 rows' }, 400);
    const cleaned: Omit<WorkflowTransaction, 'workspace_id' | 'import_group_id'>[] = [];
    for (const raw of input.rows) {
      const item = asObject(raw); if (!item) return secretResponse({ error: 'Invalid batch row' }, 400);
      const validated = await validateWorkflowRow(env.DB, workspace.id, item); if (validated.problem || !validated.row) return secretResponse({ error: validated.problem ?? 'Invalid batch row' }, 400);
      cleaned.push(validated.row);
    }
    if (tail === 'batches/preview') return secretResponse({ rows: cleaned });
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validIdempotencyKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const draftHash = await hashJson(cleaned);
    const loadBatch = async (): Promise<{ draft_hash: string; transactions: WorkflowTransaction[] } | null> => {
      const commit = await env.DB.prepare("SELECT draft_hash FROM workflow_commits WHERE workspace_id = ? AND kind = 'batch' AND idempotency_key = ?").bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `batch:${idempotencyKey}`).all<WorkflowTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadBatch();
    if (existing) return existing.draft_hash === draftHash ? secretResponse({ transactions: existing.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different batch draft' }, 409);
    const groupId = `batch:${idempotencyKey}`;
    const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO workflow_commits (workspace_id, kind, idempotency_key, draft_hash) VALUES (?, 'batch', ?, ?)").bind(workspace.id, idempotencyKey, draftHash)];
    for (const transaction of cleaned) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(workspace.id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, groupId));
    try { await env.DB.batch(statements); } catch {
      const raced = await loadBatch();
      if (!raced) return secretResponse({ error: 'Unable to commit batch' }, 500);
      return raced.draft_hash === draftHash ? secretResponse({ transactions: raced.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different batch draft' }, 409);
    }
    const committed = await loadBatch();
    if (!committed) return secretResponse({ error: 'Unable to load committed batch' }, 500);
    return secretResponse({ transactions: committed.transactions }, 201);
  }
  if (tail === 'imports/preview' || tail === 'imports') {
    if (request.method !== 'POST') return new Response('Not found', { status: 404, headers: secretHeaders() });
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxJsonBytes) return secretResponse({ error: 'Request body too large' }, 413);
    const raw = await request.text(); if (raw.length > maxJsonBytes) return secretResponse({ error: 'Request body too large' }, 413);
    const peopleRows = await env.DB.prepare('SELECT id, display_name, is_archived FROM workspace_people WHERE workspace_id = ?').bind(workspace.id).all<{ id: number; display_name: string; is_archived: number }>();
    const peopleByName = new Map(peopleRows.results.map((person) => [person.display_name.toLowerCase(), person]));
    const currencyRows = await env.DB.prepare('SELECT code FROM workspace_currencies WHERE workspace_id = ? AND is_archived = 0').bind(workspace.id).all<{ code: string }>();
    const currencyCodes = new Set(currencyRows.results.map((currency) => currency.code));
    const parsed = parseImportCsv(raw, peopleByName, currencyCodes);
    if (parsed.errors.length || parsed.rows.length < 1) return secretResponse({ errors: parsed.errors.length ? parsed.errors : ['CSV contained no valid rows'] }, 400);
    if (parsed.rows.length > maxWorkflowRows) return secretResponse({ error: 'Import must include 1-200 rows' }, 400);
    if (tail === 'imports/preview') return secretResponse({ rows: parsed.rows, errors: [] });
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validIdempotencyKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const draftHash = await hashJson(parsed.rows);
    const loadImport = async (): Promise<{ draft_hash: string; transactions: WorkflowTransaction[] } | null> => {
      const commit = await env.DB.prepare("SELECT draft_hash FROM workflow_commits WHERE workspace_id = ? AND kind = 'import' AND idempotency_key = ?").bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `import:${idempotencyKey}`).all<WorkflowTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadImport();
    if (existing) return existing.draft_hash === draftHash ? secretResponse({ transactions: existing.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different import draft' }, 409);
    const groupId = `import:${idempotencyKey}`;
    const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO workflow_commits (workspace_id, kind, idempotency_key, draft_hash) VALUES (?, 'import', ?, ?)").bind(workspace.id, idempotencyKey, draftHash)];
    for (const row of parsed.rows as ImportPlanRow[]) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(workspace.id, row.occurred_on, row.entry_kind, row.topic, row.category, row.creditor_person_id, row.debtor_person_id, row.amount_minor, row.currency_code, row.notes, groupId));
    try { await env.DB.batch(statements); } catch {
      const raced = await loadImport();
      if (!raced) return secretResponse({ error: 'Unable to commit import' }, 500);
      return raced.draft_hash === draftHash ? secretResponse({ transactions: raced.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different import draft' }, 409);
    }
    const committed = await loadImport();
    if (!committed) return secretResponse({ error: 'Unable to load committed import' }, 500);
    return secretResponse({ transactions: committed.transactions }, 201);
  }
  if (tail === 'transactions' && request.method === 'GET') { const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND is_deleted = 0 ORDER BY occurred_on DESC, id DESC').bind(workspace.id).all<Transaction>(); return secretResponse({ transactions: transactions.results }); }
  if (tail === 'transactions' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400); const problem = await validateTransaction(env.DB, workspace.id, input); if (problem) return secretResponse({ error: problem }, 400);
    const transaction = await env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at').bind(workspace.id, input.occurred_on, input.entry_kind, cleanText(input.topic, 200), cleanText(input.category, 80), input.creditor_person_id, input.debtor_person_id, input.amount_minor, input.currency_code, input.notes ?? null, input.import_group_id ?? null).first<Transaction>(); return secretResponse({ transaction }, 201);
  }
  route = tail.match(/^transactions\/(\d+)(?:\/(delete|restore))?$/);
  if (route) {
    const [, value, action] = route; const transaction = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE id = ? AND workspace_id = ?').bind(Number(value), workspace.id).first<Transaction>(); if (!transaction) return secretResponse({ error: 'Transaction not found' }, 404);
    if (!action && request.method === 'PATCH') { if (transaction.is_deleted) return secretResponse({ error: 'Restore the transaction before editing it' }, 400); const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400); const updated = { ...transaction, ...input }; const problem = await validateTransaction(env.DB, workspace.id, updated); if (problem) return secretResponse({ error: problem }, 400); await env.DB.prepare(`UPDATE transactions SET occurred_on = ?, entry_kind = ?, topic = ?, category = ?, creditor_person_id = ?, debtor_person_id = ?, amount_minor = ?, currency_code = ?, notes = ?, import_group_id = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(updated.occurred_on, updated.entry_kind, cleanText(updated.topic, 200), cleanText(updated.category, 80), updated.creditor_person_id, updated.debtor_person_id, updated.amount_minor, updated.currency_code, updated.notes ?? null, updated.import_group_id ?? null, transaction.id, workspace.id).run(); }
    else if (action === 'delete' && request.method === 'POST') await env.DB.prepare(`UPDATE transactions SET is_deleted = 1, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(transaction.id, workspace.id).run();
    else if (action === 'restore' && request.method === 'POST') await env.DB.prepare(`UPDATE transactions SET is_deleted = 0, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(transaction.id, workspace.id).run(); else return secretResponse({ error: 'Not found' }, 404);
    return secretResponse({ transaction: await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE id = ? AND workspace_id = ?').bind(transaction.id, workspace.id).first<Transaction>() });
  }
  return new Response('Not found', { status: 404, headers: secretHeaders() });
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
