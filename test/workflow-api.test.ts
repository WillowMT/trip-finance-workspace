import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const migrations = ['0001_core.sql', '0002_audit_triggers.sql', '0003_audit_lock.sql', '0004_split_commits.sql', '0005_workflow_commits.sql'];

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

test('offset suggestions, preview, and commit net reciprocal balances with audited atomic writes', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    // Ada owes Lin 300; Lin owes Ada 100 => reciprocal min = 100.
    await seedDebt(request, api, { occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Hotel', category: 'Lodging', creditor_person_id: lin.id, debtor_person_id: ada.id, amount_minor: 300, currency_code: 'USD' });
    await seedDebt(request, api, { occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Taxi', category: 'Transport', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 100, currency_code: 'USD' });
    const suggestions = await request(`${api}/offset-suggestions`);
    assert.equal(suggestions.status, 200);
    const suggested = await suggestions.json() as { suggestions: { first_person_id: number; second_person_id: number; first_owes_second_minor: number; second_owes_first_minor: number; offset_amount_minor: number; currency_code: string }[] };
    assert.equal(suggested.suggestions.length, 1);
    assert.equal(suggested.suggestions[0].offset_amount_minor, 100);
    assert.equal(suggested.suggestions[0].currency_code, 'USD');

    const beforePreview = (query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count;
    const preview = await request(`${api}/offsets/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ first_person_id: lin.id, second_person_id: ada.id, currency_code: 'USD' }) });
    assert.equal(preview.status, 200);
    const planned = await preview.json() as { transactions: { entry_kind: string; amount_minor: number; creditor_person_id: number; debtor_person_id: number }[]; offset_amount_minor: number };
    assert.equal(planned.offset_amount_minor, 100);
    assert.equal(planned.transactions.length, 2);
    assert.ok(planned.transactions.every((transaction) => transaction.entry_kind === 'offset' && transaction.amount_minor === -100));
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, beforePreview);

    const invalidBody = await request(`${api}/offsets/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ first_person_id: ada.id, second_person_id: ada.id, currency_code: 'USD' }) });
    assert.equal(invalidBody.status, 400);
    const unknownPeople = await request(`${api}/offsets/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ first_person_id: 99991, second_person_id: 99992, currency_code: 'USD' }) });
    assert.equal(unknownPeople.status, 400);

    const committed = await request(`${api}/offsets`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'offset-1' }, body: JSON.stringify({ first_person_id: lin.id, second_person_id: ada.id, currency_code: 'USD' }) });
    assert.equal(committed.status, 201);
    const saved = await committed.json() as { transactions: { id: number }[]; offset_amount_minor: number };
    assert.equal(saved.transactions.length, 2); assert.equal(saved.offset_amount_minor, 100);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE entry_kind = 'offset'") as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'transaction' AND action = 'create' AND json_extract(after_json, '$.entry_kind') = 'offset'") as { count: number }[])[0].count, 2);
    const duplicate = await request(`${api}/offsets`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'offset-1' }, body: JSON.stringify({ first_person_id: lin.id, second_person_id: ada.id, currency_code: 'USD' }) });
    assert.equal(duplicate.status, 200);

    // Reciprocal balance is now zero in USD; a second offset must 409 with no new rows.
    const empty = await request(`${api}/offsets`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'offset-2' }, body: JSON.stringify({ first_person_id: lin.id, second_person_id: ada.id, currency_code: 'USD' }) });
    assert.equal(empty.status, 409);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE entry_kind = 'offset'") as { count: number }[])[0].count, 2);
  });
});

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
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE import_group_id LIKE 'import:%'") as { count: number }[])[0].count, 2);
    assert.equal((query("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'transaction' AND action = 'create'") as { count: number }[])[0].count, 2);
    const duplicate = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'import-1' }, body: csv });
    assert.equal(duplicate.status, 200);
    assert.equal((query('SELECT COUNT(*) AS count FROM transactions') as { count: number }[])[0].count, 2);
    const conflict = await request(`${api}/imports`, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'import-1' }, body: csv.replace('Brunch', 'Changed') });
    assert.equal(conflict.status, 409);
  });
});
