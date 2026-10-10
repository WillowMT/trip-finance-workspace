import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
// Read the directory instead of pinning names: a hardcoded list silently skipped migrations
// (0005/0006 were missing), so the local database lagged the real one and create-workspace 500'd.
const migrations = readdirSync(join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort();

async function withWorkspaceApi(run: (request: (path: string, init?: RequestInit) => Promise<Response>, query: (sql: string) => unknown[]) => Promise<void>): Promise<void> {
  const persistTo = mkdtempSync(join(tmpdir(), 'trip-finance-workspace-api-'));
  const port = 8987;
  const args = (extra: string[]) => ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', persistTo, '--json', ...extra];
  const execute = (extra: string[]) => JSON.parse(execFileSync('npx', args(extra), { cwd: root, encoding: 'utf8' }));
  const query = (sql: string): unknown[] => execute(['--command', sql])[0].results;
  let server: ReturnType<typeof spawn> | undefined;
  try {
    for (const migration of migrations) execute(['--file', `migrations/${migration}`]);
    server = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--persist-to', persistTo], { cwd: root, stdio: 'ignore', detached: true });
    const request = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { connection: 'close', ...(init.headers ?? {}) } });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await request('/')).ok) { ready = true; break; } } catch { /* worker is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'local Worker should start');
    await run(request, query);
  } finally {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
      await Promise.race([
        new Promise<void>((resolve) => server!.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    rmSync(persistTo, { recursive: true, force: true });
  }
}

async function createWorkspace(request: (path: string, init?: RequestInit) => Promise<Response>): Promise<string> {
  const response = await request('/api/workspaces', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mountain weekend', people: ['Ada', 'Lin'], currencies: [{ code: 'USD', is_default: true }, { code: 'THB', is_default: false }] }),
  });
  assert.equal(response.status, 201);
  const created = await response.json() as { workspace_url: string };
  assert.match(created.workspace_url, /^\/w\/[A-Za-z0-9_-]{43}$/);
  return created.workspace_url.slice(3);
}

test('onboarding atomically creates an audited capability-secured workspace', async () => {
  await withWorkspaceApi(async (request, query) => {
    const invalid = await request('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', people: ['Ada'], currencies: [{ code: 'usd', is_default: true }] }) });
    assert.equal(invalid.status, 400);
    assert.equal((query('SELECT COUNT(*) AS count FROM workspaces') as { count: number }[])[0].count, 0);
    const secret = await createWorkspace(request);
    const stored = (query('SELECT secret_hash FROM workspaces') as { secret_hash: string }[])[0];
    assert.match(stored.secret_hash, /^[a-f0-9]{64}$/); assert.notEqual(stored.secret_hash, secret);
    const state = await request(`/w/${secret}/api`);
    assert.equal(state.status, 200); assert.equal(state.headers.get('cache-control'), 'no-store, private'); assert.equal(state.headers.get('referrer-policy'), 'no-referrer'); assert.equal(state.headers.get('x-content-type-options'), 'nosniff'); assert.match(state.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const body = await state.json() as { workspace: { name: string; secret_hash?: string }; people: unknown[]; currencies: unknown[] };
    assert.equal(body.workspace.name, 'Mountain weekend'); assert.equal(body.workspace.secret_hash, undefined); assert.equal(body.people.length, 2); assert.equal(body.currencies.length, 2);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, 6);
    assert.equal((await request('/w/not-a-valid-secret/api')).status, 404);
  });
});

test('workspace APIs isolate settings, people, currencies, and audited transactions', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request); const secondSecret = await createWorkspace(request);
    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[]; currencies: { id: number; code: string }[] };
    const [ada, lin] = state.people;
    let response = await request(`/w/${secret}/api`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mountain ledger', settings: { categories: ['Food'], small_amount_guard: { USD: 100 } } }) }); assert.equal(response.status, 200);
    response = await request(`/w/${secret}/api/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mia' }) }); assert.equal(response.status, 201); const mia = await response.json() as { person: { id: number } };
    assert.equal((await request(`/w/${secret}/api/people/${mia.person.id}/archive`, { method: 'POST' })).status, 200); assert.equal((await request(`/w/${secret}/api/people/${mia.person.id}/restore`, { method: 'POST' })).status, 200);
    response = await request(`/w/${secret}/api/currencies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'EUR', is_default: false }) }); assert.equal(response.status, 201); const eur = await response.json() as { currency: { id: number } };
    assert.equal((await request(`/w/${secret}/api/currencies/${eur.currency.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_default: true }) })).status, 200); assert.equal((await request(`/w/${secret}/api/currencies/${eur.currency.id}/archive`, { method: 'POST' })).status, 400); assert.equal((await request(`/w/${secret}/api/currencies/${eur.currency.id}/restore`, { method: 'POST' })).status, 200);
    response = await request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Dinner', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1234, currency_code: 'USD' }) }); assert.equal(response.status, 201); const transaction = await response.json() as { transaction: { id: number } };
    assert.equal((await request(`/w/${secret}/api/transactions/${transaction.transaction.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'Dinner update', amount_minor: 1500 }) })).status, 200); assert.equal((await request(`/w/${secret}/api/transactions/${transaction.transaction.id}/delete`, { method: 'POST' })).status, 200); assert.equal((await request(`/w/${secret}/api/transactions/${transaction.transaction.id}/restore`, { method: 'POST' })).status, 200);
    const list = await (await request(`/w/${secret}/api/transactions`)).json() as { transactions: { topic: string }[] }; assert.deepEqual(list.transactions.map((entry) => entry.topic), ['Dinner update']);
    const other = await (await request(`/w/${secondSecret}/api`)).json() as { people: { id: number }[] };
    const crossWorkspace = await request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Invalid', category: 'Food', creditor_person_id: other.people[0].id, debtor_person_id: lin.id, amount_minor: 1, currency_code: 'USD' }) }); assert.equal(crossWorkspace.status, 400); assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE topic = 'Invalid'") as { count: number }[])[0].count, 0); assert.equal((await request(`/w/${secret}/api/people/${other.people[0].id}/archive`, { method: 'POST' })).status, 404);
    const audit = await (await request(`/w/${secret}/api/audit`)).json() as { audit: { entity_type: string; action: string }[] }; assert.deepEqual(audit.audit.filter((entry) => entry.entity_type === 'transaction').map(({ action }) => action), ['restore', 'archive', 'update', 'create']); // newest first: the route orders by id DESC
 });
 });

test('the ledger delete button works: DELETE /transactions/:id hides the row and it stays restorable', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const created = await (await request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-10', entry_kind: 'debt', topic: 'Dinner', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1250, currency_code: 'USD' }) })).json() as { transaction: { id: number } };
    const id = created.transaction.id;
    const removed = await request(`/w/${secret}/api/transactions/${id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(((await removed.json()) as { transaction: { is_deleted: number } }).transaction.is_deleted, 1);
    assert.equal(((await (await request(`/w/${secret}/api/transactions`)).json()) as { transactions: unknown[] }).transactions.length, 0);
    assert.equal((await request(`/w/${secret}/api/transactions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'Edit after delete' }) })).status, 400);
    assert.equal((await request(`/w/${secret}/api/transactions/${id}/restore`, { method: 'POST' })).status, 200);
    assert.equal(((await (await request(`/w/${secret}/api/transactions`)).json()) as { transactions: unknown[] }).transactions.length, 1);
    assert.equal((await request(`/w/${secret}/api/transactions/999999`, { method: 'DELETE' })).status, 404);
  });
});

 test('only canonical capability API routes resolve workspace secrets', async () => {
   await withWorkspaceApi(async (request) => {
     const secret = await createWorkspace(request);
     const canonical = await request(`/w/${secret}/api`);
     assert.equal(canonical.status, 200);

     for (const legacy of [`/api/workspaces/${secret}`, `/api/workspaces/${secret}/people`]) {
       const response = await request(legacy, legacy.endsWith('/people')
         ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mallory' }) }
         : undefined);
       assert.equal(response.status, 404);
       assert.equal(response.headers.get('cache-control'), null);
       assert.equal(response.headers.get('referrer-policy'), null);
     }
   });
 });

test('split preview is read-only and commit revalidates, allocates deterministically, audits atomically, and is idempotent', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const createdMia = await request(`${api}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mia' }) });
    assert.equal(createdMia.status, 201);
    const { person: mia } = await createdMia.json() as { person: { id: number } };
    const draft = { occurred_on: '2026-10-09', payer_person_id: ada.id, participant_person_ids: [mia.id, lin.id], amount_minor: 101, topic: 'Villa', category: 'Lodging', currency_code: 'USD', notes: 'Three nights' };
    const beforePreview = (query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count;
    const preview = await request(`${api}/splits/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
    assert.equal(preview.status, 200);
    const planned = await preview.json() as { transactions: { entry_kind: string; creditor_person_id: number; debtor_person_id: number; amount_minor: number; workspace_id: number }[]; participant_allocations: { person_id: number; amount_minor: number }[]; total_amount_minor: number; debt_amount_minor: number };
    assert.deepEqual(planned.participant_allocations, [{ person_id: lin.id, amount_minor: 51 }, { person_id: mia.id, amount_minor: 50 }]);
    assert.deepEqual(planned.transactions.map(({ entry_kind, creditor_person_id, debtor_person_id, amount_minor, workspace_id }) => ({ entry_kind, creditor_person_id, debtor_person_id, amount_minor, workspace_id })), [
      { entry_kind: 'split', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 51, workspace_id: 1 },
      { entry_kind: 'split', creditor_person_id: ada.id, debtor_person_id: mia.id, amount_minor: 50, workspace_id: 1 },
    ]);
    assert.equal(planned.total_amount_minor, 101); assert.equal(planned.debt_amount_minor, 101);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 0);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, beforePreview);

    const invalid = await request(`${api}/splits`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'invalid-split' }, body: JSON.stringify({ ...draft, participant_person_ids: [lin.id, lin.id] }) });
    assert.equal(invalid.status, 400);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 0);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, beforePreview);

    const committed = await request(`${api}/splits`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'split-v1-101' }, body: JSON.stringify(draft) });
    assert.equal(committed.status, 201);
    const saved = await committed.json() as { transactions: { id: number; amount_minor: number }[]; total_amount_minor: number; debt_amount_minor: number };
    assert.equal(saved.transactions.length, 2); assert.equal(saved.total_amount_minor, 101); assert.equal(saved.debt_amount_minor, 101);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE workspace_id = 1 AND entry_kind = 'split'") as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM audit_log WHERE workspace_id = 1 AND entity_type = 'transaction' AND action = 'create'") as { count: number }[])[0].count, 2);
    const duplicate = await request(`${api}/splits`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'split-v1-101' }, body: JSON.stringify(draft) });
    assert.equal(duplicate.status, 200); assert.deepEqual((await duplicate.json() as { transactions: { id: number }[] }).transactions.map((transaction) => transaction.id), saved.transactions.map((transaction) => transaction.id));
    const conflicting = await request(`${api}/splits`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'split-v1-101' }, body: JSON.stringify({ ...draft, topic: 'Changed' }) });
    assert.equal(conflicting.status, 409);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE workspace_id = 1 AND entry_kind = 'split'") as { count: number }[])[0].count, 2);
  });
});

test('the bulk tab ships copy-ready receipt instructions instead of the quick-entry box', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const state = await (await request(`/w/${secret}/api`)).json() as { people: { display_name: string }[]; currencies: { code: string; is_default: number }[] };
    const names = state.people.map((person) => person.display_name).join(', ');
    const codes = state.currencies.map((currency) => currency.code);
    const html = await (await request(`/w/${secret}`)).text();

    assert.ok(!html.includes('id="q-text"'), 'the quick-entry textarea is gone');
    assert.match(html, /id="ai-prompt"/, 'the instruction block is server-rendered');
    assert.match(html, /<button id="ai-copy" type="button">Copy instructions</);
    // the instructions must state the real contract, not a paraphrase
    assert.match(html, /occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes/);
    assert.match(html, new RegExp(`Use exactly one of: ${names.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the model is given this workspace\'s real names');
    assert.ok(codes.every((code) => html.includes(code)), 'every enabled currency is offered');
    assert.match(html, /never the same person as the creditor/);
    assert.match(html, /One row per person who owes/);
    // the import box it feeds is still there
    assert.match(html, /id="csv"/);
    assert.match(html, /id="csv-commit"/);
  });
});

test('the workspace page ships a usable split form: people pre-rendered, archived people left out', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number; display_name: string }[] };
    const [, lin] = state.people;
    const created = await request(`${api}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mia' }) });
    assert.equal(created.status, 201);
    const archived = await request(`${api}/people/${lin.id}/archive`, { method: 'POST' });
    assert.equal(archived.status, 200);

    const html = await (await request(`/w/${secret}`)).text();
    assert.match(html, /id="tab-split"[^>]*>(<span[^>]*>[^<]*<\/span>\s*)?Split</, 'the split tab is reachable');
    assert.match(html, /<section id="split" hidden>/, 'the split panel exists and starts hidden like its siblings');
    assert.match(html, /id="sp-preview"/); assert.match(html, /id="sp-commit"/); assert.match(html, /id="sp-payer"/);
    assert.match(html, /<label class="check"><input type="checkbox" value="\d+" checked><span>Ada<\/span><\/label>/);
    // The page's own rebuild template contains this attribute text too (`value="'+p.id+'"`), so count only
    // rendered options that carry a literal id.
    assert.equal((html.match(/<label class="check"><input type="checkbox" value="[0-9]+"/g) ?? []).length, 2, 'one tick per active person');
    assert.ok(!html.includes('<span>Lin</span>'), 'an archived person is not offered in the split picker');
    const payer = /<select id="sp-payer">([\s\S]*?)<\/select>/.exec(html);
    assert.ok(payer, 'the payer select is server-rendered so the form works before the first fetch resolves');
    assert.equal((payer![1].match(/<option/g) ?? []).length, 2);
    assert.ok(/<select id="sp-currency">[\s\S]*?value="USD" selected/.test(html), 'the split form defaults to the workspace currency');
    assert.ok(html.includes('Split an expense'), 'the panel explains what a split records');
  });
});

test('canonical capability routes enforce security, body, currency, and transaction guards', async () => {
 await withWorkspaceApi(async (request, query) => {
 const created = await request('/api/workspaces', {
   method: 'POST', headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ name: 'Guarded workspace', people: ['Ada', 'Lin'], currencies: [{ code: 'USD', is_default: true }, { code: 'THB', is_default: false }] }),
 });
 assert.equal(created.status, 201);
 for (const header of ['cache-control', 'referrer-policy', 'x-content-type-options', 'content-security-policy'] as const) assert.ok(created.headers.get(header), `onboarding should set ${header}`);
 assert.match(created.headers.get('cache-control')!, /private/);
 assert.match(created.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
 const { workspace_url } = await created.json() as { workspace_url: string };
 const secret = workspace_url.slice(3);
 const api = `/w/${secret}/api`;
 const page = await request(`/w/${secret}`);
 assert.equal(page.status, 200); assert.match(await page.text(), /Guarded workspace/);
 for (const header of ['cache-control', 'referrer-policy', 'x-content-type-options', 'content-security-policy'] as const) assert.ok(page.headers.get(header), `workspace page should set ${header}`);
 const state = await (await request(api)).json() as { people: { id: number }[]; currencies: { id: number; code: string; is_default: number }[] };
 const [ada, lin] = state.people;
 const usd = state.currencies.find((currency) => currency.code === 'USD')!;
 const thb = state.currencies.find((currency) => currency.code === 'THB')!;
 const blockedOrigin = await request(`${api}/people`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' }, body: JSON.stringify({ display_name: 'Mallory' }) });
 assert.equal(blockedOrigin.status, 403);
 assert.equal((query("SELECT COUNT(*) AS count FROM workspace_people WHERE display_name = 'Mallory'") as { count: number }[])[0].count, 0);
 const large = await request(`${api}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'x'.repeat(256 * 1024) }) });
 assert.equal(large.status, 413);
 const streamed = await request(`${api}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ display_name: 'y'.repeat(256 * 1024) }))); controller.close(); } }), duplex: 'half' } as RequestInit);
 assert.equal(streamed.status, 413);
 assert.equal((query("SELECT COUNT(*) AS count FROM workspace_people WHERE display_name LIKE 'x%' OR display_name LIKE 'y%'") as { count: number }[])[0].count, 0);
 const noDefault = await request(`${api}/currencies/${usd.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_default: false }) });
 assert.equal(noDefault.status, 400);
 assert.equal((query(`SELECT COUNT(*) AS count FROM workspace_currencies WHERE workspace_id = (SELECT id FROM workspaces WHERE name = 'Guarded workspace') AND is_archived = 0 AND is_default = 1`) as { count: number }[])[0].count, 1);
 assert.equal((await request(`${api}/currencies/${thb.id}/archive`, { method: 'POST' })).status, 200);
 assert.equal((await request(`${api}/currencies/${thb.id}/restore`, { method: 'POST' })).status, 200);
 assert.equal((await request(`${api}/currencies/${usd.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'EUR' }) })).status, 200);
 const createdTransaction = await request(`${api}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Dinner', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1234, currency_code: 'EUR' }) });
 assert.equal(createdTransaction.status, 201);
 const { transaction } = await createdTransaction.json() as { transaction: { id: number } };
 const invalidKind = await request(`${api}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-09', entry_kind: 'split', topic: 'No split', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1, currency_code: 'EUR' }) });
 assert.equal(invalidKind.status, 400);
 assert.equal((await request(`${api}/transactions/${transaction.id}/delete`, { method: 'POST' })).status, 200);
 const deletedPatch = await request(`${api}/transactions/${transaction.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'Must restore first' }) });
 assert.equal(deletedPatch.status, 400);
 assert.equal((query(`SELECT topic FROM transactions WHERE id = ${transaction.id}`) as { topic: string }[])[0].topic, 'Dinner');
 });
 });


const zoneDate = (timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

test('ledger and split dates are read-only and locked to today in the workspace time zone', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const first = await (await request(`/w/${secret}`)).text();
    assert.match(first, /id="t-date" type="text" value="[0-9]{4}-[0-9]{2}-[0-9]{2}" readonly aria-readonly="true"/);
    assert.match(first, /id="sp-date" type="text" value="[0-9]{4}-[0-9]{2}-[0-9]{2}" readonly aria-readonly="true"/);
    assert.doesNotMatch(first, /type="date"/, 'no date pickers left in the app');
    assert.ok(first.includes(`value="${zoneDate('Asia/Bangkok')}"`), 'both fields show today in the workspace default zone');
    assert.ok(first.includes('Today in Asia/Bangkok'), 'the zone is shown beside the field');
    assert.match(first, /<select id="s-tz">/);
    assert.match(first, /<option value="Asia\/Bangkok" selected>/);

    const patched = await request(`/w/${secret}/api`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { timezone: 'Asia/Yangon' } }) });
    assert.equal(patched.status, 200);
    assert.equal(((await patched.json()) as { settings: { timezone: string } }).settings.timezone, 'Asia/Yangon');
    const second = await (await request(`/w/${secret}`)).text();
    assert.ok(second.includes(`value="${zoneDate('Asia/Yangon')}"`), 'the read-only date follows the workspace zone');
    assert.ok(second.includes('Today in Asia/Yangon'));
    assert.match(second, /<option value="Asia\/Yangon" selected>/);

    const rejected = await request(`/w/${secret}/api`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { timezone: 'Mars/Olympus' } }) });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: 'Invalid time zone' });
  });
});


test('the import instructions follow the live people and currency roster', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const namesLine = 'Use exactly one of: Ada, Lin';
    const page = await (await request(`/w/${secret}`)).text();
    assert.ok(page.includes(namesLine), 'the card lists the current people');
    assert.ok(page.includes('one of: USD, THB'), 'the card lists the current currencies');

    const first = await request(`/w/${secret}/api/instructions`);
    assert.equal(first.status, 200);
    const before = ((await first.json()) as { text: string }).text;
    assert.ok(before.includes(namesLine));
    assert.ok(page.includes(before.split('\n').filter((line) => line.indexOf('- creditor:') === 0)[0].trim()), 'page and endpoint agree on the creditor line');

    const added = await request(`/w/${secret}/api/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mia' }) });
    assert.equal(added.status, 201);
    const after = ((await (await request(`/w/${secret}/api/instructions`)).json()) as { text: string }).text;
    assert.ok(after.includes('Use exactly one of: Ada, Lin, Mia'), 'a new person joins the instructions');
    assert.ok((await (await request(`/w/${secret}`)).text()).includes('Use exactly one of: Ada, Lin, Mia'), 'the served page agrees without a restart');

    const list = (await (await request(`/w/${secret}/api`)).json()) as { people: { id: number; display_name: string }[] };
    const mia = list.people.filter((person) => person.display_name === 'Mia')[0];
    assert.ok(mia, 'Mia is in the roster');
    const archived = await request(`/w/${secret}/api/people/${mia.id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(archived.status, 200);
    const third = ((await (await request(`/w/${secret}/api/instructions`)).json()) as { text: string }).text;
    assert.ok(!third.includes('Mia'), 'an archived person leaves the instructions');
    assert.equal(third.trim(), before.trim(), 'the roster text returns to its original shape');
  });
});

test('a new transaction nets the reciprocal balance between two people automatically', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const post = (body: Record<string, unknown>) => request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-10', entry_kind: 'debt', topic: 'Entry', category: 'Food', currency_code: 'USD', ...body }) });
    const ledger = async () => ((await (await request(`/w/${secret}/api/transactions`)).json()) as {
      transactions: { entry_kind: string; amount_minor: number; creditor_person_id: number; debtor_person_id: number; notes: string | null; import_group_id: string | null }[];
    }).transactions;
    const offsets = (rows: Awaited<ReturnType<typeof ledger>>) => rows.filter((row) => row.entry_kind === 'offset');
    const owes = (rows: Awaited<ReturnType<typeof ledger>>, creditor: number, debtor: number) => rows.filter((row) => row.creditor_person_id === creditor && row.debtor_person_id === debtor).reduce((sum, row) => sum + row.amount_minor, 0);

    const oneWay = await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 4000 });
    assert.equal(oneWay.status, 201);
    assert.equal(((await oneWay.json()) as { netted_pairs: number }).netted_pairs, 0, 'one direction alone has nothing to offset');
    assert.equal(offsets(await ledger()).length, 0);

    const reverse = await post({ creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: 2500 });
    assert.equal(reverse.status, 201);
    assert.equal(((await reverse.json()) as { netted_pairs: number }).netted_pairs, 1, 'the reverse debt creates an offsettable overlap');
    const rows = await ledger();
    const netted = offsets(rows);
    assert.equal(netted.length, 2, 'netting writes one offset per direction');
    assert.deepEqual(netted.map((row) => row.amount_minor), [-2500, -2500], 'only the overlapping amount is offset');
    assert.equal(netted.every((row) => row.notes === 'Automatic bilateral netting'), true);
    assert.equal(netted.every((row) => row.import_group_id === `auto-offset:USD:${ada.id}-${lin.id}`), true);
    assert.equal(owes(rows, ada.id, lin.id), 1500, 'the unmatched remainder stays outstanding');
    assert.equal(owes(rows, lin.id, ada.id), 0, 'the offset side is cleared');
    assert.equal(Number((query("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'transaction'")[0] as { n: number }).n), 4, 'the automatic offsets are audited');

    await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1000 });
    assert.equal(offsets(await ledger()).length, 2, 'netting converges: no overlap means no new offsets');
    const again = await post({ creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: 1000 });
    assert.equal(((await again.json()) as { netted_pairs: number }).netted_pairs, 1);
    const after = await ledger();
    assert.deepEqual(offsets(after).map((row) => row.amount_minor), [-1000, -1000, -2500, -2500], 'the ledger lists newest first, so the latest offset pair leads');
    assert.equal(owes(after, ada.id, lin.id), 1500, 'Lin still owes Ada the unmatched remainder');
    assert.equal(owes(after, lin.id, ada.id), 0, 'the offset side is cleared');
  });
});

test('automatic netting is on by default and can be switched off per workspace', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[]; settings: { auto_offset: number; timezone: string } };
    assert.equal(state.settings.auto_offset, 1, 'netting is on by default');
    assert.equal((await request(`/w/${secret}/api`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { auto_offset: false } }) })).status, 200);
    const after = await (await request(`/w/${secret}/api`)).json() as { settings: { auto_offset: number; timezone: string } };
    assert.equal(after.settings.auto_offset, 0);
    assert.equal(after.settings.timezone, state.settings.timezone, 'a partial settings patch must not clear the time zone');
    const [ada, lin] = state.people;
    const post = (body: Record<string, unknown>) => request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-10', entry_kind: 'debt', topic: 'Entry', category: 'Food', currency_code: 'USD', ...body }) });
    assert.equal(((await (await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 4000 })).json()) as { netted_pairs: number }).netted_pairs, 0);
    assert.equal(((await (await post({ creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: 2500 })).json()) as { netted_pairs: number }).netted_pairs, 0, 'netting stays off when the workspace says so');
    const rows = ((await (await request(`/w/${secret}/api/transactions`)).json()) as { transactions: { entry_kind: string }[] }).transactions;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.entry_kind === 'offset').length, 0);
  });
});

test('the audit log can be filtered by entity, action, search text, and entity id', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const post = (body: Record<string, unknown>) => request(`${api}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-10', entry_kind: 'debt', topic: 'Dinner', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 900, currency_code: 'USD', ...body }) });
    await post({});
    const taxi = await (await post({ topic: 'Taxi', category: 'Transport', amount_minor: 400 })).json() as { transaction: { id: number } };
    const removed = await request(`${api}/transactions/${taxi.transaction.id}`, { method: 'DELETE' });
    assert.ok(removed.status < 300, `archiving a transaction should succeed (${removed.status})`);

    type AuditPayload = { audit: { id: number; entity_type: string; entity_id: number; action: string; before_json: string | null; after_json: string | null }[]; total: number; matched: number; truncated: boolean };
    const snapshotText = (row: AuditPayload['audit'][number]) => `${row.before_json ?? ''}${row.after_json ?? ''}`;

    const all = await (await request(`${api}/audit`)).json() as AuditPayload;
    assert.equal(all.matched, all.total, 'an unfiltered read matches every entry');
    assert.ok(all.audit.length > 2);
    assert.ok(all.audit[0].id > all.audit[all.audit.length - 1].id, 'newest first');
    assert.equal(all.truncated, false);

    const archived = await (await request(`${api}/audit?entity=transaction&action=archive,delete`)).json() as AuditPayload;
    assert.ok(archived.audit.length >= 1, 'the archived transaction is in the audit log');
    assert.ok(archived.audit.every((row) => row.entity_type === 'transaction' && ['archive', 'delete'].includes(row.action)));
    assert.ok(archived.audit.some((row) => snapshotText(row).includes('Taxi')), 'and it stays readable through its snapshot');
    assert.ok(archived.matched < all.matched, 'filtering narrows the result set');

    const searched = await (await request(`${api}/audit?entity=transaction&q=Dinner`)).json() as AuditPayload;
    assert.ok(searched.audit.length >= 1);
    assert.ok(searched.audit.every((row) => snapshotText(row).includes('Dinner')));
    assert.ok(!searched.audit.some((row) => snapshotText(row).includes('Taxi')));

    const byEntity = await (await request(`${api}/audit?entity=transaction&entity_id=${taxi.transaction.id}`)).json() as AuditPayload;
    assert.ok(byEntity.audit.length >= 1);
    assert.ok(byEntity.audit.every((row) => row.entity_id === taxi.transaction.id));
    assert.ok(!byEntity.audit.some((row) => snapshotText(row).includes('Dinner')), 'the entity id filter excludes the other transaction');

    assert.equal((await request(`${api}/audit?action=exploded`)).status, 400);
    assert.equal((await request(`${api}/audit?entity=nonsense`)).status, 400);
    assert.equal((await request(`${api}/audit?entity_id=abc`)).status, 400);
    const limited = await (await request(`${api}/audit?limit=1`)).json() as AuditPayload;
    assert.equal(limited.audit.length, 1);
    assert.equal(limited.truncated, true, 'truncation is reported so the UI can say so');
  });
});

test('a person summary reports what they fronted, what was covered for them, and every counterparty', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    assert.equal((await request(api, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { auto_offset: false } }) })).status, 200, 'netting off keeps the numbers below exact');
    const state = await (await request(api)).json() as { people: { id: number; display_name: string }[] };
    const [ada, lin] = state.people;
    const miaResponse = await request(`${api}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mia' }) });
    assert.equal(miaResponse.status, 201);
    const mia = await miaResponse.json() as { person: { id: number } };
    const post = (body: Record<string, unknown>) => request(`${api}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-11', entry_kind: 'debt', topic: 'Dinner', category: 'Food', currency_code: 'USD', ...body }) });
    await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 6000 });
    const taxi = await (await post({ creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: 2000, topic: 'Taxi', category: 'Transport' })).json() as { transaction: { id: number } };
    await post({ creditor_person_id: ada.id, debtor_person_id: mia.person.id, amount_minor: 1000, topic: 'Snacks' });
    await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: -1500, entry_kind: 'payment', topic: 'Transfer' });

    type Totals = { currency_code: string; paid_for_minor: number; covered_for_them_minor: number; settled_out_minor: number; settled_in_minor: number; net_minor: number; entries: number };
    type Pair = { counterparty_id: number; counterparty: string; paid_for_minor: number; covered_minor: number; net_minor: number; records: number; archived_records: number };
    type Summary = {
      person: { id: number; display_name: string };
      totals: Totals[];
      counterparties: Pair[];
      suggestions: { counterparty: string; offset_amount_minor: number }[];
      recent: { id: number; topic: string; is_deleted: number; direction: string; counterparty: string }[];
      records: { active: number; archived: number; total: number };
    };
    const summary = await (await request(`${api}/people/${ada.id}/summary`)).json() as Summary;
    assert.equal(summary.person.display_name, 'Ada');
    const usd = summary.totals.find((row) => row.currency_code === 'USD')!;
    assert.deepEqual(
      { paid_for: usd.paid_for_minor, covered: usd.covered_for_them_minor, settled_out: usd.settled_out_minor, settled_in: usd.settled_in_minor, net: usd.net_minor, entries: usd.entries },
      { paid_for: 7000, covered: 2000, settled_out: 0, settled_in: 1500, net: 5000, entries: 4 },
    );
    const linPair = summary.counterparties.find((row) => row.counterparty === 'Lin')!;
    assert.deepEqual(
      { paid_for: linPair.paid_for_minor, covered: linPair.covered_minor, net: linPair.net_minor, records: linPair.records },
      { paid_for: 6000, covered: 2000, net: 4000, records: 3 },
    );
    assert.equal(summary.counterparties.find((row) => row.counterparty === 'Mia')!.net_minor, 1000);
    assert.equal(summary.suggestions.length, 1, 'only Lin has a reciprocal balance worth offsetting');
    assert.deepEqual({ other: summary.suggestions[0].counterparty, offset: summary.suggestions[0].offset_amount_minor }, { other: 'Lin', offset: 2000 });
    assert.equal(summary.records.active, 4);
    assert.equal(summary.recent.length, 4);
    assert.equal(summary.recent[0].topic, 'Transfer', 'newest record first');
    assert.deepEqual({ direction: summary.recent[0].direction, amount_label: summary.recent[0].counterparty }, { direction: 'settled_in', amount_label: 'Lin' });

    const removed = await request(`${api}/transactions/${taxi.transaction.id}`, { method: 'DELETE' });
    assert.ok(removed.status < 300, `archiving should succeed (${removed.status})`);
    const after = await (await request(`${api}/people/${ada.id}/summary`)).json() as Summary;
    const afterUsd = after.totals.find((row) => row.currency_code === 'USD')!;
    assert.equal(afterUsd.covered_for_them_minor, 0, 'archived rows stop moving balances');
    assert.equal(afterUsd.net_minor, 7000);
    assert.equal(after.records.archived, 1);
    assert.equal(after.counterparties.find((row) => row.counterparty === 'Lin')!.archived_records, 1, 'the pair still reports the archived record');
    assert.ok(after.recent.some((row) => row.is_deleted === 1 && row.topic === 'Taxi'), 'archived rows stay readable as history');

    const page = await (await request(`/w/${secret}`)).text();
    assert.match(page, /id="person-modal"/, 'the workspace page ships the popup');
    assert.match(page, /role="dialog"/);
    assert.match(page, /setAttribute\('aria-haspopup','dialog'\)/, 'the served card only marks itself as a dialog opener in script');
    assert.match(page, /person-card/);
    assert.match(page, /people\/'\+pmOpenId\+'\/summary/, 'the popup reads the per-person summary endpoint');

    const other = await createWorkspace(request);
    assert.equal((await request(`/w/${other}/api/people/${ada.id}/summary`)).status, 404, 'people are workspace-scoped');
    assert.equal((await request(`${api}/people/999999/summary`)).status, 404);
  });
});

type BackupBody = {
  status: { every: number; rows_total: number; rows_since_backup: number; due_in: number; state: { last_backup_at: string | null; last_backup_rows: number | null } };
  backups: { sequence: number; rows: number; bytes: number; trigger: string; created_at: string }[];
  configured: boolean;
  keep: number;
};

test('automatic backups snapshot the workspace every N transactions and restore into a fresh workspace', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const json = { 'content-type': 'application/json' };
    const state = await (await request(api)).json() as { people: { id: number; display_name: string }[] };
    const ada = state.people.find((person) => person.display_name === 'Ada')!;
    const lin = state.people.find((person) => person.display_name === 'Lin')!;

    for (const every of [4, 10001, 12.5, 'soon']) {
      const rejected = await request(api, { method: 'PATCH', headers: json, body: JSON.stringify({ settings: { backup_every: every } }) });
      assert.equal(rejected.status, 400, `backup_every ${String(every)} is out of range`);
    }
    assert.equal((await request(api, { method: 'PATCH', headers: json, body: JSON.stringify({ settings: { backup_every: 5 } }) })).status, 200);

    const empty = await (await request(`${api}/backups`)).json() as BackupBody;
    assert.equal(empty.status.every, 5);
    assert.equal(empty.configured, true, 'the snapshot bucket is bound');
    assert.equal(empty.keep, 20);
    assert.equal(empty.backups.length, 0);
    assert.equal(empty.status.state.last_backup_at, null);

    const add = (index: number) => request(`${api}/transactions`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ occurred_on: '2026-10-10', entry_kind: 'debt', topic: `Dinner ${index}`, category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1000 + index, currency_code: 'USD' }),
    });
    for (let index = 1; index <= 4; index += 1) assert.equal((await add(index)).status, 201);

    const below = await (await request(`${api}/backups`)).json() as BackupBody;
    assert.equal(below.backups.length, 0, 'four transactions stay below the threshold');
    assert.equal(below.status.rows_total, 4);
    assert.equal(below.status.rows_since_backup, 4);
    assert.equal(below.status.due_in, 1);

    assert.equal((await add(5)).status, 201);
    const after = await (await request(`${api}/backups`)).json() as BackupBody;
    assert.equal(after.backups.length, 1, 'the fifth transaction writes the snapshot');
    assert.deepEqual([after.backups[0].rows, after.backups[0].trigger], [5, 'automatic:5-rows']);
    assert.equal(after.status.rows_since_backup, 0, 'the watermark moves to the snapshotted row count');
    assert.equal(after.status.due_in, 5);
    assert.ok(after.status.state.last_backup_at, 'the snapshot is timestamped');

    const file = await request(`${api}/backups/1`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition') ?? '', /backup-1\.json/);
    const document = await file.json() as { format: string; version: number; transactions: { amount_minor: number }[]; people: unknown[]; currencies: unknown[]; settings: { backup_every: number }; trigger: string; includes: { audit_log: boolean } };
    assert.equal(document.format, 'trip-finance-workspace-backup');
    assert.equal(document.version, 1);
    assert.equal(document.trigger, 'automatic:5-rows');
    assert.deepEqual(document.transactions.map((row) => row.amount_minor), [1001, 1002, 1003, 1004, 1005]);
    assert.deepEqual([document.people.length, document.currencies.length], [2, 2]);
    assert.equal(document.settings.backup_every, 5);
    assert.equal(document.includes.audit_log, false, 'the append-only trail is not copied into a snapshot');
    assert.equal((await request(`${api}/backups/99`)).status, 404, 'missing snapshots 404');

    const manual = await request(`${api}/backups`, { method: 'POST' });
    assert.equal(manual.status, 201);
    const manualBody = await manual.json() as { backup: { sequence: number; rows: number; trigger: string } };
    assert.deepEqual([manualBody.backup.sequence, manualBody.backup.rows, manualBody.backup.trigger], [2, 5, 'manual'], 'a manual snapshot ignores the watermark');

    for (let index = 6; index <= 10; index += 1) assert.equal((await add(index)).status, 201);
    const three = await (await request(`${api}/backups`)).json() as BackupBody;
    assert.deepEqual(three.backups.map((entry) => entry.trigger), ['automatic:10-rows', 'manual', 'automatic:5-rows'], 'snapshots are listed newest first');
    assert.deepEqual(three.backups.map((entry) => entry.sequence), [3, 2, 1]);

    const trail = query("SELECT entity_type, entity_id, action, after_json FROM audit_log WHERE entity_type = 'workspace_backup' ORDER BY id") as { entity_id: string; action: string; after_json: string }[];
    assert.deepEqual(trail.map((entry) => entry.entity_id), ['1', '2', '3'], 'every snapshot is recorded in the trail');
    assert.equal(JSON.parse(trail[2].after_json).rows, 10);

    const restore = await request(`${api}/backups/3/restore`, { method: 'POST' });
    assert.equal(restore.status, 201);
    const restored = await restore.json() as { workspace_url: string; workspace: { id: number; name: string }; restored: { people: number; currencies: number; transactions: number; skipped_transactions: number; workflow_commits: number; split_commits: number } };
    assert.match(restored.workspace_url, /^\/w\/[A-Za-z0-9_-]{43}$/);
    assert.notEqual(restored.workspace_url.slice(3), secret, 'the restored workspace mints its own capability link');
    assert.equal(restored.workspace.name, `Mountain weekend (restored ${new Date().toISOString().slice(0, 10)})`);
    assert.deepEqual(restored.restored, { people: 2, currencies: 2, transactions: 10, skipped_transactions: 0, workflow_commits: 0, split_commits: 0 });

    assert.equal((query('SELECT COUNT(*) AS count FROM transactions WHERE workspace_id = 1') as { count: number }[])[0].count, 10, 'restoring never rewrites the source workspace');
    const ledgers = query('SELECT w.id AS id, COUNT(t.id) AS rows, SUM(t.amount_minor) AS total FROM workspaces w LEFT JOIN transactions t ON t.workspace_id = w.id GROUP BY w.id ORDER BY w.id') as { rows: number; total: number }[];
    assert.deepEqual(ledgers.map((row) => [row.rows, row.total]), [[10, 10055], [10, 10055]], 'the restored ledger matches the source ledger');

    const restoredApi = `/w/${restored.workspace_url.slice(3)}/api`;
    assert.equal((await request(`/w/${restored.workspace_url.slice(3)}`)).status, 200, 'the restored workspace serves its own page');
    const restoredState = await (await request(restoredApi)).json() as { people: { display_name: string }[]; settings: { backup_every: number }; backups: { status: { rows_total: number; rows_since_backup: number } } };
    assert.deepEqual(restoredState.people.map((person) => person.display_name), ['Ada', 'Lin']);
    assert.equal(restoredState.settings.backup_every, 5, 'the restored workspace keeps the interval');
    assert.deepEqual([restoredState.backups.status.rows_total, restoredState.backups.status.rows_since_backup], [10, 10], 'a fresh workspace starts its own counter');
    assert.equal((await (await request(`${restoredApi}/backups`)).json() as BackupBody).backups.length, 0, 'snapshots themselves are not copied');

    const other = await createWorkspace(request);
    assert.equal((await request(`/w/${other}/api/backups/1`)).status, 404, 'snapshots are workspace-scoped');
    assert.equal((await request(`/w/${other}/api/backups/3/restore`, { method: 'POST' })).status, 404);

    const page = await (await request(`/w/${secret}`)).text();
    assert.match(page, /id="s-backup-every"/, 'the settings page ships the backup card');
    assert.match(page, /id="s-backup-now"/);
    assert.match(page, /id="s-backup-list"/);
    assert.match(page, /'\/backups\/'\+e\.sequence/, 'the snapshot list links at the download route');
    assert.match(page, /'\/backups\/'\+seq\+'\/restore'/, 'the restore button targets the restore route');
  });
});
