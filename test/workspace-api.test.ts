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
    const state = await request(`/api/workspaces/${secret}`);
    assert.equal(state.status, 200); assert.equal(state.headers.get('cache-control'), 'no-store'); assert.equal(state.headers.get('referrer-policy'), 'no-referrer'); assert.equal(state.headers.get('x-content-type-options'), 'nosniff'); assert.match(state.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const body = await state.json() as { workspace: { name: string; secret_hash?: string }; people: unknown[]; currencies: unknown[] };
    assert.equal(body.workspace.name, 'Mountain weekend'); assert.equal(body.workspace.secret_hash, undefined); assert.equal(body.people.length, 2); assert.equal(body.currencies.length, 2);
    assert.equal((query('SELECT COUNT(*) AS count FROM audit_log') as { count: number }[])[0].count, 6);
    assert.equal((await request('/api/workspaces/not-a-valid-secret')).status, 404);
  });
});

test('workspace APIs isolate settings, people, currencies, and audited transactions', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request); const secondSecret = await createWorkspace(request);
    const state = await (await request(`/api/workspaces/${secret}`)).json() as { people: { id: number }[]; currencies: { id: number; code: string }[] };
    const [ada, lin] = state.people;
    let response = await request(`/api/workspaces/${secret}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mountain ledger', settings: { categories: ['Food'], small_amount_guard: { USD: 100 } } }) }); assert.equal(response.status, 200);
    response = await request(`/api/workspaces/${secret}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mia' }) }); assert.equal(response.status, 201); const mia = await response.json() as { person: { id: number } };
    assert.equal((await request(`/api/workspaces/${secret}/people/${mia.person.id}/archive`, { method: 'POST' })).status, 200); assert.equal((await request(`/api/workspaces/${secret}/people/${mia.person.id}/restore`, { method: 'POST' })).status, 200);
    response = await request(`/api/workspaces/${secret}/currencies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'EUR', is_default: false }) }); assert.equal(response.status, 201); const eur = await response.json() as { currency: { id: number } };
    assert.equal((await request(`/api/workspaces/${secret}/currencies/${eur.currency.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_default: true }) })).status, 200); assert.equal((await request(`/api/workspaces/${secret}/currencies/${eur.currency.id}/archive`, { method: 'POST' })).status, 400); assert.equal((await request(`/api/workspaces/${secret}/currencies/${eur.currency.id}/restore`, { method: 'POST' })).status, 200);
    response = await request(`/api/workspaces/${secret}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Dinner', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1234, currency_code: 'USD' }) }); assert.equal(response.status, 201); const transaction = await response.json() as { transaction: { id: number } };
    assert.equal((await request(`/api/workspaces/${secret}/transactions/${transaction.transaction.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'Dinner update', amount_minor: 1500 }) })).status, 200); assert.equal((await request(`/api/workspaces/${secret}/transactions/${transaction.transaction.id}/delete`, { method: 'POST' })).status, 200); assert.equal((await request(`/api/workspaces/${secret}/transactions/${transaction.transaction.id}/restore`, { method: 'POST' })).status, 200);
    const list = await (await request(`/api/workspaces/${secret}/transactions`)).json() as { transactions: { topic: string }[] }; assert.deepEqual(list.transactions.map((entry) => entry.topic), ['Dinner update']);
    const other = await (await request(`/api/workspaces/${secondSecret}`)).json() as { people: { id: number }[] };
    const crossWorkspace = await request(`/api/workspaces/${secret}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-09', entry_kind: 'debt', topic: 'Invalid', category: 'Food', creditor_person_id: other.people[0].id, debtor_person_id: lin.id, amount_minor: 1, currency_code: 'USD' }) }); assert.equal(crossWorkspace.status, 400); assert.equal((query("SELECT COUNT(*) AS count FROM transactions WHERE topic = 'Invalid'") as { count: number }[])[0].count, 0); assert.equal((await request(`/api/workspaces/${secret}/people/${other.people[0].id}/archive`, { method: 'POST' })).status, 404);
    const audit = await (await request(`/api/workspaces/${secret}/audit`)).json() as { audit: { entity_type: string; action: string }[] }; assert.deepEqual(audit.audit.filter((entry) => entry.entity_type === 'transaction').map(({ action }) => action), ['create', 'update', 'archive', 'restore']);
  });
});
