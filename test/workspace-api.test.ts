import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const migrations = ['0001_core.sql', '0002_audit_triggers.sql', '0003_audit_lock.sql'];

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
    const request = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, init);
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
    const audit = await (await request(`/w/${secret}/api/audit`)).json() as { audit: { entity_type: string; action: string }[] }; assert.deepEqual(audit.audit.filter((entry) => entry.entity_type === 'transaction').map(({ action }) => action), ['create', 'update', 'archive', 'restore']);
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
