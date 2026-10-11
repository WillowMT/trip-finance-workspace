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

test('the ledger colours signed amounts, deletes with an icon, and pages at 50 rows', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const state = await (await request(api)).json() as { people: { id: number }[]; currencies: { code: string }[] };
    const [creditor, debtor] = state.people;
    const code = state.currencies[0].code;
    for (let i = 0; i < 55; i += 1) {
      const res = await request(`${api}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ occurred_on: '2026-10-08', entry_kind: 'debt', topic: `Row ${i}`, category: 'Food', creditor_person_id: creditor.id, debtor_person_id: debtor.id, amount_minor: 100 + i, currency_code: code }),
      });
      assert.equal(res.status, 201);
    }
    const listed = await (await request(`${api}/transactions`)).json() as { transactions: unknown[] };
    assert.equal(listed.transactions.length, 55, 'every row is still served');
    const html = await (await request(`/w/${secret}`)).text();

    assert.match(html, /var TXPAGE=50/, 'rows are capped at 50 per page');
    assert.match(html, /id="tx-pager"/);
    assert.match(html, /id="tx-prev"/);
    assert.match(html, /id="tx-next"/);
    assert.match(html, /class="amt '\+cls\+'"/, 'the amount carries a signed colour class');
    assert.match(html, /class="mini icon danger"/, 'delete is an icon button');
    assert.ok(!html.includes('>Delete</button>'), 'the old text delete button is gone');
    assert.match(html, /id="t-kind-hint"/, 'the mode hint is rendered');
    assert.match(html, /t-creditor-label">(<span[^>]*>[^<]*<\/span>\s*)?Paid by \(is owed\)/);
    assert.match(html, /t-debtor-label">(<span[^>]*>[^<]*<\/span>\s*)?For \(owes\)/);
    assert.match(html, /Repaid to \(was owed\)/, 'the repayment wording is shipped');
    assert.match(html, /Repaid by \(who owed it\)/);
  });
});

test('every page is styled from one token-based design system', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const pages: [string, Response][] = [
      ['workspace', await request(`/w/${secret}`)],
      ['home', await request('/')],
    ];
    for (const [label, res] of pages) {
      const html = await res.text();
      const style = /<style>([\s\S]*?)<\/style>/.exec(html);
      assert.ok(style, `${label} page carries the stylesheet`);
      const sheet = style![1];

      // the size scales are declared exactly once, and nothing hardcodes them
      for (const token of ['--ctl:44px', '--ctl-sm:34px', '--ctl-tab:36px', '--r-md:10px', '--r-lg:12px', '--r-xl:16px', '--sp-5:12px', '--fs-base:.95rem']) {
        assert.equal(sheet.split(token).length - 1, 1, `${token} is declared once`);
      }
      assert.ok(!/min-height:(34|36|44|92)px/.test(sheet), `${label}: control heights come from tokens`);
      assert.ok(!/border-radius:(8|10|12|14|16)px/.test(sheet), `${label}: radii come from tokens`);

      // the polish the design system promises
      assert.match(sheet, /select\{[\s\S]*?appearance:none/, 'dropdown arrows are drawn by us, not the browser default');
      assert.match(sheet, /data:image\/svg\+xml/, 'and drawn inline, with no external asset');
      assert.match(sheet, /:focus-visible/, 'keyboard focus is visible');
      assert.match(sheet, /prefers-reduced-motion/, 'motion is reduced when the OS asks for it');
      assert.match(sheet, /button\[aria-busy=true\]/, 'writes show a loading state');
      assert.match(sheet, /prefers-color-scheme:dark/, 'the dark theme is preserved');

      // no route-specific patches, no dead selectors
      assert.ok(!/#split \.btns|\.top-actions/.test(sheet), `${label}: no route-specific patches or dead selectors`);
    }
  });
});

test('the category field is a select that defaults to Other', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const html = await (await request(`/w/${secret}`)).text();

    assert.ok(!/<input id="t-category"/.test(html), 'the ledger category is no longer free text');
    assert.ok(!/<input id="sp-category"/.test(html), 'neither is the split one');
    for (const id of ['t-category', 'sp-category']) {
      assert.match(html, new RegExp('<select id="' + id + '">[\\s\\S]*?</select>'), id + ' is a select');
    }
    const select = /<select id="t-category">([\s\S]*?)<\/select>/.exec(html);
    assert.ok(select, 'the ledger category select is present');
    const options = [...select![1].matchAll(/<option value="([^"]+)"( selected)?>/g)].map((m) => m[1]);
    assert.deepEqual(options, ['Other', 'Food', 'Transport', 'Shopping']);
    assert.match(select![1], /<option value="Other" selected>/, 'Other is the default');
    assert.match(html, /\$\('t-category'\)\.value='Other'/, 'the entry form resets to Other');
    assert.match(html, /\$\('sp-category'\)\.value='Other'/, 'so does the split form');
  });
});

test('creating a transaction or a split asks for review before it writes', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const html = await (await request(`/w/${secret}`)).text();

    assert.match(html, /id="review-modal"/, 'the review sheet is shipped');
    assert.match(html, /id="rv-confirm"/);
    assert.match(html, /id="rv-back"[^>]*>/, 'Back to edit exists');
    assert.match(html, /aria-labelledby="rv-title"/);
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="rv-title"/);

    assert.match(html, /openReview\(txReview\(rows\)/, 'the ledger entry is reviewed before it is sent');
    assert.match(html, /openReview\(splitReview\(d\)/, 'so is a split');
    assert.ok(!html.includes('commitRows('), 'the ledger no longer posts straight from the form handler');
    assert.match(html, /async function postRows\(rows,btn,err\)\{/, 'the only write path is postRows, reached from the sheet');
    assert.match(html, /async function postSplit\(d,btn,err\)\{/, 'and postSplit for a split');

    assert.match(html, /Confirm debt/);
    assert.match(html, /Confirm repayment/);
    assert.match(html, /Confirm split/);
    assert.match(html, /rf-amt '\+\(pay\?'neg':'pos'\)\+'/, 'the reviewed amount carries the ledger colours');

    assert.match(html, /signedMoney\(pay\?-one\.amount_minor:one\.amount_minor/, 'and is signed like the ledger row it will produce');
    assert.match(html, /signedMoney\(owed,d\.currency_code\)/, 'a split reviews the debt it will actually create, not the bill');
    assert.match(html, /allocate\(d\.amount_minor,ids\)/, 'per-person shares come from the same allocator the server uses');
    assert.match(html, /if\(ev\.key==='Escape'\)\{[^}]*closeReview\(\)/, 'Escape backs out of the review');
    assert.match(html, /ev\.target\.id==='review-modal'/, 'a backdrop tap backs out too');
  });
});

test('a person carries an emoji that reaches every surface and is audited', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const edit = (id: number, payload: Record<string, unknown>) => request(`${api}/people/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const roster = async () => (await (await request(api)).json()) as { people: { id: number; display_name: string; emoji: string }[] };

    const person = (await roster()).people[0];
    assert.equal(person.emoji, '', 'people start without an emoji');

    const set = await edit(person.id, { emoji: '\u{1F98A}' });
    assert.equal(set.status, 200);
    assert.equal(((await set.json()) as { person: { emoji: string } }).person.emoji, '\u{1F98A}', 'the emoji is stored');
    assert.equal((await roster()).people.find((entry) => entry.id === person.id)!.emoji, '\u{1F98A}');

    assert.equal((await edit(person.id, { emoji: 'Ada' })).status, 400, 'letters belong in the name');
    assert.equal((await edit(person.id, { emoji: '\u{1F98A}'.repeat(9) })).status, 400, 'one emoji, not a paragraph');
    assert.equal((await edit(person.id, {})).status, 400, 'an empty patch changes nothing');

    const renamed = await edit(person.id, { display_name: 'Ada Lovelace' });
    assert.equal(renamed.status, 200);
    assert.equal(((await renamed.json()) as { person: { display_name: string; emoji: string } }).person.emoji, '\u{1F98A}', 'renaming keeps the emoji');

    const cleared = await edit(person.id, { emoji: '' });
    assert.equal(cleared.status, 200);
    assert.equal(((await cleared.json()) as { person: { emoji: string } }).person.emoji, '', 'an empty string clears it');

    const audit = (await (await request(`${api}/audit?entity=person`)).json()) as { audit: { action: string; before_json: string | null; after_json: string | null }[] };
    const emojiOf = (row: { before_json: string | null; after_json: string | null }, key: 'before_json' | 'after_json') =>
      row[key] === null ? null : (JSON.parse(row[key]!) as { emoji?: string }).emoji;
    const updates = audit.audit.filter((row) => row.action === 'update');
    assert.ok(
      updates.some((row) => emojiOf(row, 'before_json') === '' && emojiOf(row, 'after_json') === '\u{1F98A}'),
      'setting the emoji is audited with the value before and after',
    );
    assert.ok(
      updates.some((row) => emojiOf(row, 'before_json') === '\u{1F98A}' && emojiOf(row, 'after_json') === ''),
      'and so is clearing it',
    );

    const html = await (await request(`/w/${secret}`)).text();
    assert.match(html, /data-emoji-input/, 'the setup tab renders an emoji field per person');
    assert.match(html, /data-emoji-save/, 'and a control to save it');

    const onboarded = await request('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Emoji roster', people: ['\u{1F98A} Ada', { display_name: 'Lin', emoji: '\u{1F422}' }, 'Bo'], currencies: [{ code: 'USD', is_default: true }] }),
    });
    assert.equal(onboarded.status, 201);
    const created = (await onboarded.json()) as { workspace_url: string };
    const onboardRoster = (await (await request(`${created.workspace_url}/api`)).json()) as { people: { display_name: string; emoji: string }[] };
    assert.deepEqual(onboardRoster.people.map(({ display_name, emoji }) => [display_name, emoji]), [['Ada', '\u{1F98A}'], ['Lin', '\u{1F422}'], ['Bo', '']], 'onboarding accepts both spellings');
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
    assert.match(html, /<button id="ai-copy" type="button">(<span[^>]*>[^<]*<\/span>\s*)?Copy instructions</);
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

test('the balance-by-person view says who owes whom instead of leaning on colour', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const html = await (await request(`/w/${secret}`)).text();

    // the sign is stated in words, so green can never be read as "a debt I owe"
    assert.ok(html.includes('function netPhrase(v,who)'), 'one helper turns a net amount into a sentence');
    assert.ok(html.includes('function pairLine(pr,me)'), 'and one builds each counterparty row');
    assert.ok(html.includes("'<span class=\"p-main\">'+pairLine(pr,meName)"), 'the row keeps its p-main wrapper so the amount and meta stack');
    assert.ok(html.includes("pr.counterparty+' owes '+me"), 'the row names the person who owes');
    assert.ok(html.includes("me+' owes '+pr.counterparty"), 'and the other direction too');
    assert.ok(html.includes('Each line names who owes whom.'), 'the section says what it is');
    assert.ok(html.includes('Green means the money is owed to '), 'green is defined in words');
    assert.ok(html.includes(' owes it.</p>'), 'and so is red');
    assert.ok(html.includes('Green <b>+</b> is a debt someone owes the payer'), 'the ledger legend uses the same vocabulary');
    assert.ok(html.includes("fronted for others") && html.includes("Covered for '+meName"), 'the tiles name the person instead of saying "them"');
    assert.ok(html.includes("+esc(meName)+' fronted '") && html.includes("+esc(pr.counterparty)+' covered '"), 'the meta line names both people too');
    assert.ok(!html.includes('owed to them'), 'no pronoun-only net phrasing survives');
    assert.ok(!html.includes("kpi('Covered for them'"), 'nor the ambiguous tile label');
  });
});

test('VND-scale amounts format and parse without losing precision', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const html = await (await request(`/w/${secret}`)).text();

    // lift the shipped client helpers out of the page and run them for real
    const grab = (name: string) => {
      const at = html.indexOf(`function ${name}(`);
      assert.ok(at > 0, `${name} is shipped to the client`);
      let depth = 0;
      for (let k = html.indexOf('{', at); k < html.length; k++) {
        if (html[k] === '{') depth += 1;
        else if (html[k] === '}') { depth -= 1; if (depth === 0) return html.slice(at, k + 1); }
      }
      throw new Error(`unterminated ${name}`);
    };
    const nodecAt = html.indexOf('var NODEC=');
    assert.ok(nodecAt > 0, 'the zero-decimal currency list ships with the helpers');
    const nodec = html.slice(nodecAt, html.indexOf(';', nodecAt) + 1);
    const src = nodec + '\n' + ['money', 'toMinor', 'netPhrase', 'netChip'].map(grab).join('\n') + '\nfunction esc(s){return String(s)}';
    const helpers = new Function(`${src};return {toMinor:toMinor,money:money,netChip:netChip}`)() as {
      toMinor: (v: string) => number | null;
      money: (m: number, c?: string) => string;
      netChip: (v: number, c: string, who: string) => string;
    };

    // a whole VND amount drops the ".00"; a fractional one keeps both decimals so sub-units are never hidden
    assert.equal(helpers.money(20_570_800, 'VND'), 'VND 205,708');
    assert.equal(helpers.money(149_332_428, 'VND'), 'VND 1,493,324.28');
    assert.equal(helpers.money(20_570_800, 'USD'), 'USD 205,708.00');
    assert.equal(helpers.money(999_999_999_999_99, 'VND'), 'VND 999,999,999,999.99');
    // a billion-đồng chip keeps its words out of the nowrap amount span, so it wraps instead of clipping
    const chip = helpers.netChip(101_234_588_460_922, 'VND', 'Ada');
    assert.match(chip, /<span class="amt pos">\+VND 1,012,345,884,609\.22<\/span>/);
    assert.match(chip, /<span class="say">owed to Ada<\/span>/);
    assert.match(html, /\.p-nets \.amt,\.pm-nets \.amt\{flex:0 0 auto;white-space:normal;overflow-wrap:anywhere\}/);

    // grouping forms and comma decimals both resolve to the same minor units
    assert.equal(helpers.toMinor('205708'), 20_570_800);
    assert.equal(helpers.toMinor('205,708'), 20_570_800);
    assert.equal(helpers.toMinor('1.234.567'), 123_456_700);
    assert.equal(helpers.toMinor('205708,50'), 20_570_850, 'a comma decimal is not read as grouping');
    assert.equal(helpers.toMinor('1.234,56'), 123_456);
    assert.equal(helpers.toMinor('12,345'), 1_234_500, 'three digits after the comma stays grouping');
    assert.equal(helpers.toMinor('0,5'), 50);
    assert.equal(helpers.toMinor('999999999999999999999'), null, 'beyond the safe-integer ceiling');
    assert.equal(helpers.toMinor('1e21'), null);
    assert.equal(helpers.toMinor('-5'), null);

    // a long amount wraps to its own line instead of colliding with the row's text
    assert.match(html, /\.row\{display:flex;flex-wrap:wrap/);
    assert.match(html, /\.row-main\{flex:1 1 auto;min-width:0\}/);
    assert.match(html, /\.rec\{display:flex;flex-wrap:wrap/);
    assert.match(html, /\.split-sum\{display:flex;flex-wrap:wrap/);
    assert.match(html, /\.rf-amt\{font-size:clamp\(/);
  });
});

test('a VND-scale amount is stored, returned, and summed exactly', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    assert.equal((await request(`${api}/currencies`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'VND', is_default: false }),
    })).status, 201);
    const state = await (await request(`${api}`)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const post = (amount_minor: number) => request(`${api}/transactions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occurred_on: '2026-10-11', entry_kind: 'debt', topic: 'Brunch', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor, currency_code: 'VND' }),
    });

    assert.equal((await post(99_999_999_999_99)).status, 201);
    assert.equal((await post(99_999_999_999_99)).status, 201);
    const listed = await (await request(`${api}/transactions`)).json() as { transactions: { amount_minor: number }[] };
    const large = listed.transactions.map((t) => t.amount_minor).filter((a) => a > 1e12);
    assert.deepEqual(large, [99_999_999_999_99, 99_999_999_999_99], 'no rounding on the way in or out');
    assert.equal(large.reduce((a, b) => a + b, 0), 199_999_999_999_98, 'summing stays exact');

    // past the safe-integer ceiling the write is refused rather than silently rounded
    assert.equal((await post(1e21)).status, 400);
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

test('a tap anywhere on the delete icon resolves to its button', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    const html = await (await request(`/w/${secret}`)).text();

    // the delete glyph is a child span, so reading the action off the tapped node leaves the whole icon dead
    assert.match(
      html,
      /src\.closest\('\[data-del\],\[data-off\][^')]*\[data-def\][^')]*'\)/,
      'the click handler resolves row actions from the nearest ancestor'
    );
    // a 34px icon still has to answer a 44px finger
    assert.match(html, /button\.icon\{position:relative;width:var\(--ctl-sm\);padding:0;font-size:var\(--fs-base\)\}/, 'icon buttons anchor a hit ring');
    assert.match(html, /button\.icon::after\{content:'';position:absolute;inset:-5px/, 'the ring reaches 44px');
    assert.match(html, /button\.icon>span\{pointer-events:none\}/, 'the glyph never swallows the tap');
  });
});

test('mobile zoom is off and the tab carries an icon', async () => {
  await withWorkspaceApi(async (request) => {
    const secret = await createWorkspace(request);
    for (const path of ['/', `/w/${secret}`]) {
      const html = await (await request(path)).text();
      assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">/, `${path} locks the mobile viewport`);
      assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/, `${path} links the icon`);
      assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, `${path} links the touch icon`);
      assert.match(html, /touch-action:pan-x pan-y/, `${path} refuses pinch-zoom`);
      assert.match(html, /@media \(max-width:600px\)\{:where\(input,select,textarea\)\{font-size:16px\}\}/, `${path} keeps controls at 16px`);
    }
    const svg = await request('/favicon.svg');
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type') || '', /image\/svg\+xml/);
    assert.match(await svg.text(), /<svg[^>]*viewBox="0 0 64 64"/, 'the icon is a real svg');
    assert.equal((await request('/favicon.ico')).status, 200, 'the legacy icon path answers too');

    const apple = await request('/apple-touch-icon.png');
    assert.equal(apple.status, 200);
    assert.equal(apple.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await apple.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'the touch icon is a real png');
    assert.deepEqual([...bytes.slice(16, 24)], [0, 0, 0, 180, 0, 0, 0, 180], 'and it is 180x180 for iOS');
  });
});


type ReceiptAttachmentRow = { id: number; receipt_id: number; label: string; image_type: string; image_bytes: number; created_at: string };
type ReceiptCardRow = { id: number; title: string; note: string; link: string | null; is_added: number; added_at: string | null; created_at: string; attachments: ReceiptAttachmentRow[]; attachment_count: number };

test('the receipts backlog is a hand-kept tracker: two lanes, several attachments per card, notes, and an audit trail', async () => {
  await withWorkspaceApi(async (request, query) => {
    const secret = await createWorkspace(request);
    const api = `/w/${secret}/api`;
    const send = (path: string, init: RequestInit = {}) => request(`${api}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const board = async () => ((await (await send('/receipts')).json()) as { receipts: ReceiptCardRow[] }).receipts;
    const count = (table: string) => (query(`SELECT COUNT(*) AS count FROM ${table}`) as { count: number }[])[0].count;

    assert.deepEqual(await board(), [], 'a fresh workspace starts with an empty board');
    assert.equal((await send('/receipts', { method: 'POST', body: JSON.stringify({ title: '   ' }) })).status, 400, 'a receipt needs a title');
    assert.equal((await send('/receipts', { method: 'POST', body: JSON.stringify({ title: 'Big C', link: 'ftp://example.com/r' }) })).status, 400, 'receipt links must be http(s)');
    assert.equal((await send('/receipts', { method: 'POST', body: JSON.stringify({ title: 'Big C', is_added: 'yes' }) })).status, 400, 'is_added is a boolean - the app never infers it');
    assert.equal((await send('/receipts', { method: 'POST', body: JSON.stringify({ title: 'Big C', note: 'x'.repeat(2001) }) })).status, 400, 'notes are capped');

    const created = await send('/receipts', { method: 'POST', body: JSON.stringify({ title: 'Big C groceries', note: 'Ada paid', link: 'https://example.com/r/1' }) });
    assert.equal(created.status, 201);
    const card = ((await created.json()) as { receipt: ReceiptCardRow }).receipt;
    assert.equal(card.is_added, 0, 'a new card starts out not added');
    assert.equal(card.added_at, null);
    assert.equal(card.attachment_count, 0);

    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42, 7]);
    const upload = (id: number, label: string, bytes: Uint8Array = png, type = 'image/png') =>
      request(`${api}/receipts/${id}/attachments?label=${encodeURIComponent(label)}`, { method: 'POST', headers: { 'content-type': type }, body: bytes });
    assert.equal((await upload(card.id, 'notes.txt', png, 'text/plain')).status, 400, 'only images are accepted');
    assert.equal((await upload(card.id, 'empty.png', new Uint8Array(0))).status, 400, 'an empty file is not a photo');

    const firstUpload = await upload(card.id, 'front.jpg');
    assert.equal(firstUpload.status, 201);
    const firstAttachment = ((await firstUpload.json()) as { attachment: ReceiptAttachmentRow }).attachment;
    assert.equal(firstAttachment.label, 'front.jpg');
    assert.equal(Object.keys(firstAttachment).filter((key) => key.includes('key')).length, 0, 'the R2 object key never reaches the client');

    for (let extra = 1; extra <= 5; extra += 1) {
      assert.equal((await upload(card.id, `shot-${extra}.jpg`, new Uint8Array([extra, extra + 1]), 'image/jpeg')).status, 201, `photo ${extra + 1} lands`);
    }
    const over = await upload(card.id, 'seventh.jpg');
    assert.equal(over.status, 400, 'the seventh photo is refused');
    assert.match(((await over.json()) as { error: string }).error, /up to 6/);
    assert.equal(count('receipt_attachments'), 6);

    const listed = (await board())[0];
    assert.equal(listed.attachment_count, 6, 'the card reports how many photos it holds');
    assert.equal(listed.attachments.length, 6);

    const served = await request(`${api}/receipts/${card.id}/attachments/${firstAttachment.id}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png, 'the photo comes back byte for byte');

    const detached = await request(`${api}/receipts/${card.id}/attachments/${firstAttachment.id}`, { method: 'DELETE' });
    assert.equal(detached.status, 200);
    assert.equal((await request(`${api}/receipts/${card.id}/attachments/${firstAttachment.id}`)).status, 404, 'a detached photo stops being served');
    assert.equal(count('receipt_attachments'), 5);

    const added = await send(`/receipts/${card.id}`, { method: 'PATCH', body: JSON.stringify({ is_added: true, note: 'Entered as a Shopping row' }) });
    assert.equal(added.status, 200);
    const addedCard = ((await added.json()) as { receipt: ReceiptCardRow }).receipt;
    assert.equal(addedCard.is_added, 1);
    assert.ok(addedCard.added_at, 'moving it across stamps the time');
    assert.equal(addedCard.note, 'Entered as a Shopping row');
    const backAgain = ((await (await send(`/receipts/${card.id}`, { method: 'PATCH', body: JSON.stringify({ is_added: false }) })).json()) as { receipt: ReceiptCardRow }).receipt;
    assert.equal(backAgain.is_added, 0);
    assert.equal(backAgain.added_at, null, 'moving it back clears the stamp');

    const state = (await (await send('')).json()) as { receipts: ReceiptCardRow[] };
    assert.equal(state.receipts.length, 1, 'the board rides along in the state payload');
    assert.ok(!JSON.stringify(state).includes('image_key'), 'object keys stay server-side');

    const otherSecret = await createWorkspace(request);
    const foreign = { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_added: true }) };
    assert.equal((await request(`/w/${otherSecret}/api/receipts/${card.id}`, { method: 'PATCH', ...foreign })).status, 404, 'another workspace cannot reach the card');
    assert.equal((await request(`/w/${otherSecret}/api/receipts/${card.id}/attachments`)).status, 404);
    assert.equal((await request(`/w/${otherSecret}/api/receipts/${card.id}/attachments/${firstAttachment.id}`)).status, 404);

    const audit = ((await (await send('/audit')).json()) as { audit: { entity_type: string; action: string }[] }).audit;
    assert.ok(audit.some((row) => row.entity_type === 'receipt' && row.action === 'create'), 'cards are audited');
    assert.ok(audit.some((row) => row.entity_type === 'receipt' && row.action === 'update'), 'so is moving one across');
    assert.ok(audit.some((row) => row.entity_type === 'receipt_attachment' && row.action === 'create'), 'each photo is audited');
    assert.ok(audit.some((row) => row.entity_type === 'receipt_attachment' && row.action === 'delete'), 'so is taking one off');

    const removed = await send(`/receipts/${card.id}/delete`, { method: 'POST', body: JSON.stringify({}) });
    assert.equal(removed.status, 200);
    assert.equal(count('receipt_attachments'), 0, 'deleting a card takes its photos with it');
    assert.equal(count('receipts'), 0);

    const html = await (await request(`/w/${secret}`)).text();
    assert.match(html, /id="tab-receipts"/, 'the nav carries a receipts entry');
    assert.match(html, /id="rec-open"/, 'lane one: not added');
    assert.match(html, /id="rec-added"/, 'lane two: added');
    assert.match(html, /id="rec-files"[^>]*multiple/, 'a few photos can be picked in one go');
    assert.doesNotMatch(html, /id="rec-files"[^>]*\shidden/, 'the input stays activatable, so a mobile tap can open the picker');
    assert.match(html, /<label[^>]*for="rec-files"/, 'the picker is opened by a real label — mobile refuses a scripted click on a hidden input');
    assert.match(html, /accept="image\/\*"/, 'image/* so a phone offers the photo library, not just Files');
    assert.match(html, /class="ghost" for="rec-files"/, 'the control keeps the ghost-button look while being a label');
    assert.doesNotMatch(html, /data-rec-action="attach"/, 'the card hands image work to the sheet');
    assert.match(html, /function renderReceiptPhotos/, 'a photo can be taken off from the receipt edit sheet');
    assert.equal((html.match(/class="att-x"/g) ?? []).length, 0, 'no ✖ badge sits on a thumbnail — tiles are plain images');
    assert.match(html, /id="rec-view"/, 'a photo opens in a viewer');
    assert.match(html, /id="rec-view-remove"/, 'removal lives in the viewer, not on the tile');
    assert.match(html, /data-att-open="'\+/, 'thumbnails open that viewer instead of carrying an overlay control');
    assert.match(html, /data-att-idx/, 'a photo queued before saving can be taken off before the receipt exists');
    assert.match(html, /function clearPending/, 'closing the sheet discards queued photos — nothing is written');
    assert.match(html, /Nothing here writes transactions by itself/, 'the copy says the app never files receipts for you');
  });
});
