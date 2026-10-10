// Drives the live workspace page's real inline script with a minimal DOM stub.
const fs = require('fs');

const PAGE = process.argv[2];
const BASE = process.argv[3];
const html = fs.readFileSync(PAGE, 'utf8');

function dump(el) {
  if (!el) return '';
  const kids = (el.children || []).map(dump).join('');
  return (el._html || '') + (el._text || '') + kids;
}
function makeEl(tag) {
  const el = { tagName: (tag || 'div').toUpperCase(), children: [], options: [], attrs: {}, style: {},
    childElementCount: 0, hidden: false, className: '', textContent: '', _html: '', _text: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); this.childElementCount = this.children.length; if (String(c.tagName).toUpperCase() === 'OPTION') { this.options.push(c); if (String(this.tagName).toUpperCase() === 'SELECT' && !this.value && !this._userSet) { this.value = String(c.value); } } return c; },
    removeChild() {}, querySelector() { return null; },
    querySelectorAll(sel) {
      const want = String(sel || '').toLowerCase();
      const matches = (el) => {
        const tag = String(el.tagName).toLowerCase();
        if (!want) return true;
        if (want.includes('input') && tag === 'input') return true;
        if (want.includes('[type=') && tag === 'input' && want.includes(String(el.type || ''))) return true;
        return want.includes(tag);
      };
      const out = [];
      const walk = (el) => { for (const child of (el.children || [])) { if (matches(child)) out.push(child); walk(child); } };
      walk(this);
      return out;
    },
    addEventListener() {}, click() {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.children = []; this.childElementCount = 0; this.options = []; },
    focus() {}, remove() {} };
  Object.defineProperty(el, 'innerText', { get() { return dump(this); }, set(v) { this._text = String(v); } });
  return el;
}

const els = {};
for (const m of html.matchAll(/<(\w+)([^>]*?)id="([^"]+)"([^>]*?)>/g)) {
  const el = makeEl(m[1]);
  const tag = m[1].toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const v = /value="([^"]*)"/.exec(m[2] + m[4]);
    el.value = v ? v[1] : '';
  }
  els[m[3]] = el;
}
// the split picker is server-rendered: give the stub the same checkboxes the browser sees
(function giveSplitPickerItsBoxes() {
  const box = els['sp-people'];
  const block = /<div class="people" id="sp-people"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (!box || !block) return;
  for (const m of block[1].matchAll(/<label class="check"><input type="checkbox" value="([^"]+)"( checked)?><span>([^<]*)<\/span><\/label>/g)) {
    const label = makeEl('label');
    const input = makeEl('input');
    input.type = 'checkbox'; input.value = m[1]; input.checked = Boolean(m[2]); input.attrs.value = m[1];
    label.appendChild(input);
    box.appendChild(label);
  }
})();

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const src = scripts[scripts.length - 1];

// give each <select> its statically-rendered options + browser default
for (const m of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  const sel = els[m[1]]; if (!sel) continue;
  for (const o of m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) {
    const opt = makeEl('option');
    const v = /value="([^"]*)"/.exec(o[1]);
    opt.value = v ? v[1] : o[2].trim();
    opt.textContent = o[2].trim();
    if (/\bselected\b/.test(o[1])) { opt.selected = true; }
    sel.options.push(opt); sel.children.push(opt);
  }
  const chosen = sel.options.find((o) => o.selected) || sel.options[0];
  if (chosen) sel.value = String(chosen.value);
  sel.childElementCount = sel.children.length;
}

const tabButtons = [...html.matchAll(/<button\b[^>]*id="tab-([^"]+)"[^>]*>/g)].map((m) => {
  const el = makeEl('button'); el.id = 'tab-' + m[1]; el.attrs.id = 'tab-' + m[1]; return el;
});
const document = {
  readyState: 'complete', title: '',
  getElementById: (id) => els[id] || null,
  createElement: (t) => makeEl(t),
  querySelector: () => makeEl('h1'),
  querySelectorAll: (sel) => (String(sel).includes('.tabs') ? tabButtons : []),
  addEventListener: () => {},
  body: makeEl('body'),
};
const location = { pathname: BASE.replace(/^https?:\/\/[^/]+/, ''), hash: '#ledger', origin: (BASE.match(/^https?:\/\/[^/]+/) || [''])[0], href: BASE, reload() {} };
const history = { replaceState() {} };
const window = { addEventListener: () => {}, onerror: null, __initial: undefined };
const navigator = { clipboard: { writeText: async () => {} } };
const prompt = () => null, confirm = () => true, alert = () => {};

const runBoot = new Function('window', 'document', 'location', scripts[0] || '');
const run = new Function('window', 'document', 'location', 'history', 'navigator', 'prompt', 'confirm', 'alert', 'fetch', 'setTimeout', 'clearTimeout', 'console',
  src + '\n;return {get people(){return people}, get currencies(){return currencies}, get me(){return me}};');

(async () => {
  runBoot(window, document, location);
  const absFetch = (u, o) => { if (o && o.body && String(o.method || '').toUpperCase() !== 'GET') { try { console.log('POST', String(u).replace(/\/w\/[A-Za-z0-9_-]+/, '/w/<secret>'), typeof o.body === 'string' ? o.body.slice(0, 300) : o.body); } catch (e) {} } return fetch(String(u).startsWith('http') ? u : location.origin + u, o); };
  const api = run(window, document, location, history, navigator, prompt, confirm, alert, absFetch, setTimeout, clearTimeout, console);
  await new Promise((r) => setTimeout(r, 2500));

  console.log('PEOPLE:', api.people.map((p) => p.display_name).join(', ') || '(none)');
  console.log('SELECT OPTS creditor=', els['t-creditor'].options.length, 'currency=', els['t-currency'].options.length);
  console.log('BANNER:', els['banner'].hidden ? '(hidden ok)' : (els['banner'].textContent || els['banner']._html));
  console.log('LEDGER:', dump(els['tx-list']).replace(/\s+/g, ' ').slice(0, 200));

  if (els['t-creditor'].options.length >= 2) {
    els['t-creditor'].value = String(els['t-creditor'].options[0].value);
    els['t-debtor'].value = String(els['t-debtor'].options[1].value);
    els['t-date'].value = new Date().toISOString().slice(0, 10);
    els['t-amount'].value = '12.50';
    els['t-topic'].value = 'Harness dinner';
    els['t-category'].value = 'Food';
    await els['t-add'].onclick();
    await new Promise((r) => setTimeout(r, 2000));
    console.log('ADD ERR:', els['t-err'].textContent || els['t-err']._text || '(none)');
    console.log('LEDGER AFTER ADD:', dump(els['tx-list']).replace(/\s+/g, ' ').slice(0, 400));
    console.log('TOTALS AFTER ADD:', dump(els['tx-totals']).replace(/\s+/g, ' ').slice(0, 200));
  }
  const clickTab = (t) => els['tab-' + t].onclick();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  clickTab('balances'); await wait(1800);
  console.log('BALANCES:', dump(els['bal-list']).replace(/\s+/g, ' ').slice(0, 240));
  console.log('OFFSETS:', dump(els['offset-list']).replace(/\s+/g, ' ').slice(0, 240));

  clickTab('split'); await wait(600);
  const boxes = els['sp-people'].querySelectorAll('input');
  console.log('SPLIT PICKER:', boxes.length, 'people,', boxes.filter((b) => b.checked).length, 'ticked; payer=', els['sp-payer'].value);
  els['sp-topic'].value = 'Harness split'; els['sp-category'].value = 'Food';
  els['sp-amount'].value = '30.00'; els['sp-date'].value = new Date().toISOString().slice(0, 10);
  els['sp-payer'].value = String(boxes[0].value);
  els['sp-amount'].oninput(); await wait(100);
  console.log('SPLIT LOCAL PREVIEW:', dump(els['sp-out']).replace(/\s+/g, ' ').slice(0, 240));
  els['sp-preview'].onclick(); await wait(1800);
  console.log('SPLIT PREVIEW ERR:', els['sp-err'].textContent || '(none)');
  console.log('SPLIT SERVER PREVIEW:', dump(els['sp-out']).replace(/\s+/g, ' ').slice(0, 240));
  els['sp-none'].onclick();
  els['sp-commit'].onclick(); await wait(400);
  console.log('SPLIT GUARD (nobody ticked):', els['sp-err'].textContent || '(none)');
  boxes.forEach((b) => { b.checked = true });
  els['sp-commit'].onclick(); await wait(2200);
  console.log('SPLIT ERR:', els['sp-err'].textContent || '(none)');
  console.log('SPLIT RESULT:', dump(els['sp-out']).replace(/\s+/g, ' ').slice(0, 300));
  clickTab('ledger'); await wait(1500);
  console.log('LEDGER AFTER SPLIT:', dump(els['tx-list']).replace(/\s+/g, ' ').slice(0, 300));
  console.log('TOTALS AFTER SPLIT:', dump(els['tx-totals']).replace(/\s+/g, ' ').slice(0, 200));
  clickTab('balances'); await wait(1800);
  console.log('BALANCES AFTER SPLIT:', dump(els['bal-list']).replace(/\s+/g, ' ').slice(0, 300));

  clickTab('tools'); await wait(400);
  const promptText = dump(els['ai-prompt']).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  console.log('QUICK ENTRY REMOVED:', !els['q-text']);
  console.log('AI PROMPT:', JSON.stringify({ chars: promptText.length,
    header: promptText.includes('occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes'),
    namesRule: promptText.includes('Use exactly one of:'), oneRowPerDebtor: promptText.includes('One row per person who owes'),
    copyButton: Boolean(els['ai-copy']) && typeof els['ai-copy'].onclick === 'function' }));

  els['csv'].value = 'occurred_on,entry_kind,topic,category,creditor,debtor,amount,currency,notes\n2026-10-09,debt,Snacks,Food,A,B,3.25,USD,';
  els['csv-preview'].onclick(); await wait(2000);
  console.log('CSV PREVIEW:', dump(els['csv-result']).replace(/\s+/g, ' ').slice(0, 200));
  els['csv-commit'].onclick.call(els['csv-commit']); await wait(2500);
  console.log('CSV COMMIT:', dump(els['csv-result']).replace(/\s+/g, ' ').slice(0, 200));

  clickTab('audit'); await wait(1800);
  console.log('AUDIT:', dump(els['audit-list']).replace(/\s+/g, ' ').slice(0, 300));

  clickTab('settings'); await wait(600);
  console.log('SETTINGS PEOPLE:', dump(els['s-people']).replace(/\s+/g, ' ').slice(0, 200));
  console.log('SETTINGS CURRENCIES:', dump(els['s-currencies']).replace(/\s+/g, ' ').slice(0, 200));
  els['s-person'].value = 'Harness Ghost';
  els['s-add-person'].onclick(); await wait(2000);
  console.log('AFTER ADD PERSON:', dump(els['s-people']).replace(/\s+/g, ' ').slice(0, 240));

  process.exit(0);
})();
