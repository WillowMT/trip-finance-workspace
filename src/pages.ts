const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

const page = (title: string, body: string, extra = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f4; color: #1c1917; }
main { max-width: 640px; margin: 2rem auto; padding: 0 1rem 4rem; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
.card { background: #fff; border: 1px solid #e7e5e4; border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 1rem; }
label { display: block; margin: .6rem 0 .2rem; font-size: .9rem; }
input, select, textarea, button { font: inherit; padding: .45rem .6rem; border: 1px solid #d6d3d1; border-radius: 6px; background: #fff; width: 100%; box-sizing: border-box; }
button { background: #2563eb; color: #fff; border: none; cursor: pointer; margin-top: .8rem; }
button.secondary { background: #57534e; } button.danger { background: #dc2626; } button.small { width: auto; padding: .3rem .7rem; font-size: .85rem; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .35rem .4rem; border-bottom: 1px solid #e7e5e4; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.row { display: flex; gap: .5rem; } .row > * { flex: 1; }
.muted { color: #78716c; font-size: .85rem; }
.err { color: #b91c1c; margin: .5rem 0; white-space: pre-wrap; }
.ok { color: #15803d; margin: .5rem 0; }
.tag { display: inline-block; background: #e7e5e4; border-radius: 4px; padding: 0 .4rem; font-size: .8rem; }
details { margin: .4rem 0; } summary { cursor: pointer; }
nav { display: flex; gap: .8rem; margin-bottom: 1rem; flex-wrap: wrap; }
nav a { color: #2563eb; text-decoration: none; }
@media (prefers-color-scheme: dark) {
  body { background: #1c1917; color: #e7e5e4; }
  .card { background: #292524; border-color: #44403c; }
  input, select, textarea { background: #292524; color: #e7e5e4; border-color: #57534e; }
  .tag { background: #44403c; } .muted { color: #a8a29e; }
}
</style>${extra}</head><body><main>${body}</main></body></html>`;

const home = () => page('Trip finance workspace', `
<h1>Trip finance workspace</h1>
<p>Create a workspace to share one editable finance ledger with your group. Everyone with the link can add, edit, and delete entries; every change is recorded in the audit log.</p>
<div class="card">
<h2>Create a shared workspace</h2>
<div id="err" class="err"></div>
<label for="name">Trip name</label>
<input id="name" placeholder="e.g. Bangkok weekend" required>
<label for="people">People (comma separated)</label>
<input id="people" placeholder="e.g. Willow, Ada, Lin" required>
<label for="currencies">Currencies (comma separated codes, first one is the default)</label>
<input id="currencies" placeholder="e.g. USD, THB" required>
<button id="create" type="button">Create shared workspace</button>
<p class="muted">After creating, you get one secret link. Share it with your group — it is the only way in, so save it.</p>
</div>
<script>
document.getElementById('create').onclick = async () => {
  const err = document.getElementById('err'); err.textContent = '';
  const name = document.getElementById('name').value.trim();
  const people = document.getElementById('people').value.split(',').map(s => s.trim()).filter(Boolean);
  const currencies = document.getElementById('currencies').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!name || !people.length || !currencies.length) { err.textContent = 'Fill in trip name, people, and currencies.'; return; }
  const res = await fetch('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, people, currencies: currencies.map((code, i) => ({ code, is_default: i === 0 })) }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 201 && data.workspace_url) { location.assign(data.workspace_url); }
  else { err.textContent = data.error || 'Could not create workspace (' + res.status + ').'; }
};
</script>`);

const app = async (db: D1Database, workspaceId: number, name: string): Promise<string> => {
  const people = await db.prepare('SELECT id, display_name, is_archived FROM workspace_people WHERE workspace_id = ? ORDER BY id').bind(workspaceId).all<{ id: number; display_name: string; is_archived: number }>();
  const currencies = await db.prepare('SELECT code, is_default, is_archived FROM workspace_currencies WHERE workspace_id = ? ORDER BY code').bind(workspaceId).all<{ code: string; is_default: number; is_archived: number }>();
  const title = name;
  const fmtMinor = (minor: number, code: string) => `${code} ${(minor / 100).toFixed(2)}`;
  const body = `
<h1>${esc(title)}</h1>
<p class="muted">Everyone with this link shares one editable ledger. All changes are audited.</p>
<nav>
<a href="#" id="tab-ledger">Ledger</a>
<a href="#" id="tab-balances">Balances</a>
<a href="#" id="tab-tools">Quick entry / Batch / Import</a>
<a href="#" id="tab-audit">Audit log</a>
</nav>
<div id="err" class="err"></div><div id="ok" class="ok"></div>
<section id="ledger">
<div class="card">
<h2>Add transaction</h2>
<label>Date <input id="t-date" type="date"></label>
<label>Kind <select id="t-kind"><option value="debt">Debt (I paid for someone)</option><option value="payment">Payment (repaid someone)</option></select></label>
<div class="row">
<label>Creditor (paid / receives) <select id="t-creditor">${people.results.map((p) => `<option value="${p.id}"${p.is_archived ? ' disabled' : ''}>${esc(p.display_name)}</option>`).join('')}</select></label>
<label>Debtor (owes / pays) <select id="t-debtor">${people.results.map((p) => `<option value="${p.id}"${p.is_archived ? ' disabled' : ''}>${esc(p.display_name)}</option>`).join('')}</select></label>
</div>
<div class="row">
<label>Amount <input id="t-amount" type="number" step="0.01" min="0.01" placeholder="12.50"></label>
<label>Currency <select id="t-currency">${currencies.results.map((c) => `<option value="${c.code}"${c.is_default ? ' selected' : ''}${c.is_archived ? ' disabled' : ''}>${esc(c.code)}</option>`).join('')}</select></label>
</div>
<div class="row">
<label>Topic <input id="t-topic" placeholder="Dinner"></label>
<label>Category <input id="t-category" placeholder="Food"></label>
</div>
<label>Notes (optional) <input id="t-notes"></label>
<button id="t-add" type="button">Add transaction</button>
</div>
<div class="card"><h2>Transactions</h2><div id="tx-list" class="muted">Loading…</div></div>
</section>
<section id="balances" hidden>
<div class="card"><h2>Balances per currency</h2><div id="bal-list" class="muted">Loading…</div></div>
<div class="card"><h2>Offsets</h2><div id="offset-list" class="muted">Loading…</div></div>
</section>
<section id="tools" hidden>
<div class="card"><h2>CSV import</h2>
<p class="muted">Header: occurred_on, entry_kind, topic, category, creditor, debtor, amount, currency, notes. entry_kind is debt or payment; creditor/debtor are person names; amount is a decimal number.</p>
<textarea id="csv" rows="8" placeholder="occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes&#10;2026-10-09,debt,Dinner,Food,Willow,Ada,12.50,USD,"></textarea>
<div class="row"><button class="secondary" id="csv-preview" type="button">Preview</button><button id="csv-commit" type="button" disabled>Commit import</button></div>
<div id="csv-result"></div>
</div>
</section>
<section id="audit" hidden>
<div class="card"><h2>Audit log (latest 200)</h2><div id="audit-list" class="muted">Loading…</div></div>
</section>
<script>
const api = location.pathname + '/api';
const people = ${JSON.stringify(people.results)};
const $ = (id) => document.getElementById(id);
const show = (tab) => { for (const s of ['ledger','balances','tools','audit']) { $(s).hidden = s !== tab; } };
for (const t of ['ledger','balances','tools','audit']) $('tab-' + t).onclick = (e) => { e.preventDefault(); show(t); if (t === 'ledger') loadTx(); if (t === 'balances') loadBalances(); if (t === 'tools') {}; if (t === 'audit') loadAudit(); };
const say = (msg, good) => { $('err').textContent = good ? '' : (msg || ''); $('ok').textContent = good ? (msg || 'Done.') : ''; };
$('t-date').valueAsDate = new Date();
const dec = (v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; return n.toFixed(2); };

async function loadTx() {
  const r = await fetch(api + '/transactions'); const d = await r.json();
  const byId = Object.fromEntries(people.map(p => [p.id, p.display_name]));
  $('tx-list').innerHTML = d.transactions.length ? '<table><tr><th>Date</th><th>Kind</th><th>Topic</th><th>From → To</th><th class="num">Amount</th><th></th></tr>' +
    d.transactions.map(t => '<tr><td>' + t.occurred_on + '</td><td><span class="tag">' + t.entry_kind + '</span></td><td>' + esc(t.topic) + '</td><td>' + esc(byId[t.creditor_person_id]) + ' → ' + esc(byId[t.debtor_person_id]) + '</td><td class="num">' + esc(t.currency_code) + ' ' + (t.amount_minor / 100).toFixed(2) + '</td>' +
    '<td><button class="small danger" onclick="delTx(' + t.id + ')">Delete</button></td></tr>').join('') + '</table>' : 'No transactions yet.';
  window.delTx = async (id) => { const r2 = await fetch(api + '/transactions/' + id, { method: 'DELETE' }); if (r2.ok) { say('Deleted (restorable in audit log).', true); loadTx(); } else say('Delete failed.'); };
}
async function loadBalances() {
  const r = await fetch(api + '/transactions'); const d = await r.json();
  const byId = Object.fromEntries(people.map(p => [p.id, p.display_name]));
  const net = {}; for (const t of d.transactions) { const k = t.currency_code; net[k] = net[k] || {}; net[k][t.creditor_person_id] = (net[k][t.creditor_person_id] || 0) + t.amount_minor; net[k][t.debtor_person_id] = (net[k][t.debtor_person_id] || 0) - t.amount_minor; }
  const rows = []; for (const [code, m] of Object.entries(net)) for (const [pid, v] of Object.entries(m)) rows.push({ code, pid, v });
  rows.sort((a, b) => a.code.localeCompare(b.code) || a.pid - b.pid);
  $('bal-list').innerHTML = rows.length ? '<table><tr><th>Person</th><th>Currency</th><th class="num">Net (positive = is owed)</th></tr>' +
    rows.map(b => '<tr><td>' + esc(byId[b.pid]) + '</td><td>' + esc(b.code) + '</td><td class="num">' + (b.v / 100).toFixed(2) + '</td></tr>').join('') + '</table>' : 'No balances yet.';
  const o = await fetch(api + '/offset-suggestions'); const od = await o.json();
  $('offset-list').innerHTML = od.suggestions.length ? '<table><tr><th>Pair</th><th>Currency</th><th class="num">Offsettable</th><th></th></tr>' +
    od.suggestions.map(s => '<tr><td>' + esc(byId[s.first_person_id]) + ' ↔ ' + esc(byId[s.second_person_id]) + '</td><td>' + esc(s.currency_code) + '</td><td class="num">' + (s.offset_amount_minor / 100).toFixed(2) + '</td><td><button class="small" onclick="doOffset(' + s.first_person_id + ',' + s.second_person_id + ',\\'' + s.currency_code + '\\')">Offset</button></td></tr>').join('') + '</table>' : 'No offsettable reciprocal balances.';
  window.doOffset = async (a, b, c) => {
    const r2 = await fetch(api + '/offsets', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2) }, body: JSON.stringify({ first_person_id: a, second_person_id: b, currency_code: c }) });
    if (r2.ok) { say('Offset committed.', true); loadBalances(); } else { const e = await r2.json().catch(() => ({})); say(e.error || 'Offset failed.'); }
  };
}
let csvDraft = null;
$('csv-preview').onclick = async () => {
  const r = await fetch(api + '/imports/preview', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: $('csv').value });
  const d = await r.json();
  if (!r.ok) { csvDraft = null; $('csv-commit').disabled = true; $('csv-result').innerHTML = '<div class="err">' + esc((d.errors || [d.error]).join('\\n')) + '</div>'; return; }
  csvDraft = $('csv').value;
  $('csv-result').innerHTML = '<table><tr><th>Date</th><th>Kind</th><th>Topic</th><th class="num">Amount</th></tr>' + d.rows.map(x => '<tr><td>' + x.occurred_on + '</td><td>' + x.entry_kind + '</td><td>' + esc(x.topic) + '</td><td class="num">' + esc(x.currency_code) + ' ' + (x.amount_minor / 100).toFixed(2) + '</td></tr>').join('') + '</table>';
  $('csv-commit').disabled = false;
};
$('csv-commit').onclick = async () => {
  if (!csvDraft) return;
  const r = await fetch(api + '/imports', { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2) }, body: csvDraft });
  if (r.ok) { csvDraft = null; $('csv-commit').disabled = true; $('csv-result').innerHTML = '<div class="ok">Imported.</div>'; say('Import committed.', true); }
  else { const e = await r.json().catch(() => ({})); say((e.errors || [e.error]).join('\\n')); }
};
async function loadAudit() {
  const r = await fetch(api + '/audit'); const d = await r.json();
  const entries = (d.audit || []).slice(-200).reverse();
  $('audit-list').innerHTML = entries.length ? '<table><tr><th>When</th><th>Entity</th><th>Action</th><th>By</th><th></th></tr>' +
    entries.map(e2 => '<tr><td>' + esc((e2.occurred_at || '').slice(0, 19)) + '</td><td>' + esc(e2.entity_type) + ' #' + e2.entity_id + '</td><td>' + esc(e2.action) + '</td><td>' + esc(e2.actor_label || '') + '</td><td><a href="#" onclick="showAudit(' + e2.id + ');return false">detail</a></td></tr>').join('') + '</table>' : 'No audit entries yet.';
  window.showAudit = (id) => {
    const e3 = entries.find(x => x.id === id); if (!e3) return;
    $('audit-list').innerHTML = '<h2>' + esc(e3.entity_type) + ' #' + e3.entity_id + '</h2>' +
      '<details open><summary>' + esc(e3.action) + ' at ' + esc((e3.occurred_at || '').slice(0, 19)) + '</summary><pre style="overflow-x:auto">' + esc(JSON.stringify({ before: e3.before_json, after: e3.after_json }, null, 1)) + '</pre></details>' +
      '<button class="small" onclick="backAudit()">Back</button>';
    window.backAudit = loadAudit;
  };
}

$('t-add').onclick = async () => {
  const body = { occurred_on: $('t-date').value, entry_kind: $('t-kind').value, topic: $('t-topic').value.trim(), category: $('t-category').value.trim(), creditor_person_id: Number($('t-creditor').value), debtor_person_id: Number($('t-debtor').value), amount: dec($('t-amount').value), currency_code: $('t-currency').value };
  if (body.topic && body.category && body.amount && body.creditor_person_id !== body.debtor_person_id) {
    const r = await fetch(api + '/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { say('Added.', true); $('t-amount').value = ''; $('t-topic').value = ''; $('t-category').value = ''; $('t-notes').value = ''; loadTx(); } else { const e = await r.json().catch(() => ({})); say(e.error || 'Add failed.'); }
  } else say('Fill in topic, category, a positive amount, and pick two different people.');
};
loadTx();
</script>`;
return page(title, body);
};

export const homeHtml = () => home();

export const appHtml = async (db: D1Database, workspaceId: number, name: string) => app(db, workspaceId, name);


