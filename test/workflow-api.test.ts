import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
// Read the directory instead of pinning names: a hardcoded list silently skipped migrations, so the
// local database lagged the real one and every create-workspace call 500'd on a missing column.
const migrations = readdirSync(join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort();

async function withWorkspaceApi(run: (request: (path: string, init?: RequestInit) => Promise<Response>, query: (sql: string) => unknown[]) => Promise<void>): Promise<void> {
  const persistTo = mkdtempSync(join(tmpdir(), 'trip-finance-workspace-workflows-'));
  const port = 8986;
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
    body: JSON.stringify({ name: 'Island trip', people: ['Ada', 'Lin'], currencies: [{ code: 'USD', is_default: true }, { code: 'THB', is_default: false }] }),
  });
  assert.equal(response.status, 201);
  const created = await response.json() as { workspace_url: string };
  return created.workspace_url.slice(3);
}

async function seedDebt(request: (path: string, init?: RequestInit) => Promise<Response>, api: string, body: Record<string, unknown>): Promise<void> {
  const response = await request(`${api}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 201);
}

test('batch preview writes nothing and batch commit revalidates every row atomically with per-row audits', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const rows = [
      { occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Dinner', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 900, currency_code: 'USD' },
      { occurred_on: '2026-10-08', entry_kind: 'payment', topic: 'Repayment', category: 'Cash', creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: -400, currency_code: 'USD' },
    ];
    const beforePreview = (query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count;
    const preview = await request(`${api}/batches/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) });
    assert.equal(preview.status, 200);
    const planned = await preview.json() as { rows: unknown[] };
    assert.equal(planned.rows.length, 2);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 0);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, beforePreview);

    const empty = await request(`${api}/batches/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: [] }) });
    assert.equal(empty.status, 400);
    const crossWorkspace = await request(`${api}/batches/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: [{ ...rows[0], creditor_person_id: 99991 }] }) });
    assert.equal(crossWorkspace.status, 400);
    const workflowKind = await request(`${api}/batches/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: [{ ...rows[0], entry_kind: 'split' }] }) });
    assert.equal(workflowKind.status, 400);

    const badCommit = await request(`${api}/batches`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-bad' }, body: JSON.stringify({ rows: [{ ...rows[0], amount_minor: 0 }] }) });
    assert.equal(badCommit.status, 400);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 0);

    const committed = await request(`${api}/batches`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-1' }, body: JSON.stringify({ rows }) });
    assert.equal(committed.status, 201);
    const saved = await committed.json() as { transactions: { topic: string }[] };
    assert.equal(saved.transactions.length, 2);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'transaction' AND action = 'create'") as { count: number }[])[0].count, 2);
    const duplicate = await request(`${api}/batches`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-1' }, body: JSON.stringify({ rows }) });
    assert.equal(duplicate.status, 200);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2);
    const conflict = await request(`${api}/batches`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-1' }, body: JSON.stringify({ rows: [rows[0]] }) });
    assert.equal(conflict.status, 409);
  });
});

test('CSV import preview and commit re-parse raw text server-side, reject parsed-row tampering, and audit per row', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number; display_name: string }[] };
    const [ada, lin] = state.people;
    const csv = ['occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes', `2026-10-09,debt,Brunch,Food,${ada.display_name},${lin.display_name},12.50,USD,first`, `2026-10-09,debt,Ferry,Transport,${lin.display_name},${ada.display_name},8.00,USD,`].join('\n');
    const beforePreview = (query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count;
    const preview = await request(`${api}/imports/preview`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv });
    assert.equal(preview.status, 200);
    const planned = await preview.json() as { rows: { topic: string; amount_minor: number; currency_code: string; creditor_person_id: number; debtor_person_id: number }[] };
    assert.equal(planned.rows.length, 2);
    assert.deepEqual(planned.rows.map((row) => row.amount_minor), [1250, 800]);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 0);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, beforePreview);

    const badCsv = await request(`${api}/imports/preview`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: 'occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency\n2026-10-09,debt,Bad,Food,Nobody,X,abc,USD' });
    assert.equal(badCsv.status, 400);
    const errorBody = await badCsv.json() as { errors?: unknown };
    assert.ok(Array.isArray(errorBody.errors) && errorBody.errors.length >= 1);

    const parsedTamper = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Tampered' }]) });
    assert.equal(parsedTamper.status, 400);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 0);

    const committed = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'import-1' }, body: csv });
    assert.equal(committed.status, 201);
    const saved = await committed.json() as { transactions: { topic: string; amount_minor: number }[] };
    assert.equal(saved.transactions.length, 2);
    assert.ok(saved.transactions.every((row) => row.amount_minor > 0));
    // Reciprocal or not, an import writes exactly the rows it was given.
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE import_group_id LIKE 'import:%'") as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE entry_kind = 'offset'") as { count: number }[])[0].count, 0, 'an import never writes netting rows');
    assert.equal((query("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'transaction' AND action = 'create'") as { count: number }[])[0].count, 2);
    const duplicate = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'import-1' }, body: csv });
    assert.equal(duplicate.status, 200);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2, 'a retried import writes nothing twice');
    const conflict = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'import-1' }, body: csv.replace('Brunch', 'Changed') });
    assert.equal(conflict.status, 409);
  });
});

// Take a function's own source out of the served page and run it, so an assertion covers the arithmetic
// the browser runs and not a copy of it.
const lift = (html: string, name: string): string => {
  const at = html.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} is shipped to the client`);
  let depth = 0;
  for (let k = html.indexOf('{', at); k < html.length; k += 1) {
    if (html[k] === '{') depth += 1;
    else if (html[k] === '}') { depth -= 1; if (depth === 0) return html.slice(at, k + 1); }
  }
  throw new Error(`unterminated ${name}`);
};

// The production incident this pins down: the CSV import stores a repayment as a negative 'payment' row
// while the page posts it positive, and the two conventions have to read as the same repayment on every
// surface. Under the old raw-sum math the legacy positive row ADDED 20.00 to the debt it was paying back,
// which invented a reciprocal balance, so auto-netting cancelled money that did not exist.
test('a repayment reduces the balance in the summary and the plan however it is stored', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number; display_name: string }[] };
    const [ada, lin] = state.people;
    const workspaceId = (query('SELECT id FROM workspaces ORDER BY id DESC LIMIT 1') as { id: number }[])[0].id;

    // Lin owes Ada 10.00 and Ada owes Lin 30.00, so the pair has a real reciprocal overlap to expose.
    await seedDebt(request, api, { occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Taxi', category: 'Transport', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1_000, currency_code: 'USD' });
    await seedDebt(request, api, { occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Hotel', category: 'Lodging', creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: 3_000, currency_code: 'USD' });

    // A repayment in the shape the 2026-10-11 import wrote: kind 'payment', POSITIVE amount on disk.
    query(`INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (${workspaceId}, '2026-10-09', 'payment', 'Legacy repayment', 'Other', ${ada.id}, ${lin.id}, 2000, 'USD', NULL, NULL)`);
    // A repayment in the shape the import writes today: negative on disk, straight from the CSV text.
    const csv = ['occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes', `2026-10-09,payment,Imported repayment,Other,${ada.display_name},${lin.display_name},-10.00,USD,`].join('\n');
    const imported = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'import-repay-1' }, body: csv });
    assert.equal(imported.status, 201);
    assert.deepEqual(
      (query("SELECT amount_minor FROM transactions WHERE import_group_id LIKE 'import:%'") as { amount_minor: number }[]).map((row) => row.amount_minor),
      [-1_000],
      'an imported repayment is stored signed for the creditor, so even a raw sum reads it as money coming back',
    );
    assert.deepEqual(
      (query("SELECT amount_minor FROM transactions WHERE entry_kind = 'payment' AND import_group_id IS NULL") as { amount_minor: number }[]).map((row) => row.amount_minor),
      [2_000],
      'a historical row keeps the sign it was written with — the fix is the reading, never the record',
    );

    // Ada fronted 10.00, was paid back 30.00 in total and owes Lin 30.00: she owes 50.00.
    type Summary = { totals: { currency_code: string; paid_for_minor: number; covered_for_them_minor: number; settled_in_minor: number; settled_out_minor: number; net_minor: number }[]; counterparties: { counterparty: string; net_minor: number }[]; suggestions: { counterpaltry?: string }[] };
    const summary = await (await request(`${api}/people/${ada.id}/summary`)).json() as Summary;
    const usd = summary.totals.find((row) => row.currency_code === 'USD')!;
    assert.deepEqual(
      { paid_for: usd.paid_for_minor, covered: usd.covered_for_them_minor, settled_in: usd.settled_in_minor, settled_out: usd.settled_out_minor, net: usd.net_minor },
      { paid_for: 1_000, covered: 3_000, settled_in: 3_000, settled_out: 0, net: -5_000 },
      'both repayment shapes are settlements worth 30.00 in total, so Ada owes 50.00 rather than being owed 10.00',
    );
    assert.equal(summary.counterparties.find((row) => row.counterparty === lin.display_name)!.net_minor, -5_000, 'the pair agrees with the total');

    // The page must arrive at the same figure the drawer does, from the same rows.
    const html = await (await request(`/w/${secret}`)).text();
    const nets = new Function(`${lift(html, 'signedMinor')};${lift(html, 'netsByCurrency')};return netsByCurrency`)() as (list: Record<string, unknown>[]) => Record<string, Record<number, number>>;
    const ledger = await (await request(`${api}/transactions`)).json() as { transactions: Record<string, unknown>[] };
    const usdNets = nets(ledger.transactions).USD;
    assert.deepEqual({ ada: usdNets[ada.id], lin: usdNets[lin.id] }, { ada: -5_000, lin: 5_000 }, 'the Balances view and settle plan read the same 50.00 the drawer reports');
    assert.equal(usdNets[ada.id], usd.net_minor, 'one number per person per currency, not one per surface');
  });
});

test('a settlement is stored signed for the creditor, and an ambiguous row is refused', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number; display_name: string }[] };
    const [ada, lin] = state.people;
    const write = (body: Record<string, unknown>) => request(`${api}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-11', entry_kind: 'debt', topic: 'Dinner', category: 'Food', currency_code: 'USD', ...body }) });
    assert.equal((await write({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 10_000 })).status, 201);
    // The page posts a repayment as a positive amount; the row that lands on disk is signed.
    assert.equal((await write({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 2_500, entry_kind: 'payment', topic: 'Paid back' })).status, 201);
    assert.deepEqual(
      (query("SELECT amount_minor FROM transactions WHERE entry_kind = 'payment'") as { amount_minor: number }[]).map((row) => row.amount_minor),
      [-2_500],
      'a repayment is stored as a credit against what the creditor is owed',
    );
    // A negative debt cannot mean anything but "money came back", which has its own kind, so it is refused
    // instead of being silently reinterpreted.
    const negativeDebt = await write({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: -1_000 });
    assert.equal(negativeDebt.status, 400);
    assert.match(((await negativeDebt.json()) as { error: string }).error, /must be positive/);
    const csv = ['occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes', `2026-10-09,debt,Bad,Food,${ada.display_name},${lin.display_name},-10.00,USD,`].join('\n');
    const preview = await request(`${api}/imports/preview`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv });
    assert.equal(preview.status, 400, 'a CSV cannot smuggle a settlement in as a negative debt either');
    assert.match(JSON.stringify(await preview.json()), /must be positive/);
  });
});
