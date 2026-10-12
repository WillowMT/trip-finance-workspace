# Debtor Ranking Route Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Add a mobile-friendly, read-only, per-currency Ranking route showing only people who currently owe money, ordered from largest debt to smallest.

**Architecture:** Keep this entirely in `src/pages.ts`: the Ranking tab fetches the same `/transactions` payload already used by Balances, calls the shared `netsByCurrency(rows)` signed-balance helper, and renders only active people whose selected-currency net is negative. Currency selection is client state; Ranking rows delegate to the existing `openPerson(id)` modal flow. No API endpoint, database schema, auth, audit record, or mutation is added.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, server-rendered HTML with inline browser JavaScript/CSS, Node test runner via `tsx`.

---

### Task 1: Add regression coverage for the ranking contract

**Objective:** Pin down the served UI contract and signed, per-currency debtor selection before adding UI code.

**Files:**
- Modify: `test/workspace-api.test.ts` near the existing person-summary test around lines 715–795
- Modify: `test/workspace-api.test.ts` static served-page assertions near the new ranking test

**Step 1: Write a failing ranking test fixture**

Add a self-contained test using `withWorkspaceApi` and a throwaway workspace. Disable `auto_offset` so the net arithmetic is explicit. Seed at least:

```ts
// USD: Ada is owed 100.00 after Lin repays 20.00; Mia owes 40.00.
await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 12000, currency_code: 'USD', entry_kind: 'debt', topic: 'Dinner' });
await post({ creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 2000, currency_code: 'USD', entry_kind: 'payment', topic: 'Repayment' });
await post({ creditor_person_id: ada.id, debtor_person_id: mia.id, amount_minor: 4000, currency_code: 'USD', entry_kind: 'debt', topic: 'Taxi' });
// VND remains independent.
await post({ creditor_person_id: lin.id, debtor_person_id: mia.id, amount_minor: 500000, currency_code: 'VND', entry_kind: 'debt', topic: 'Hotel' });
```

Add a small in-test pure helper mirroring the UI contract (or lift the served helper only if that is already the established test pattern): apply `payment ? -amount_minor : amount_minor` at creditor/debtor sides, then assert that USD debtors sort as Lin (10000) then Mia (4000), and VND has only Mia (500000). Add a fully settled person/row case and assert it does not appear.

**Step 2: Run the test to verify failure**

Run:

```bash
cd /opt/data/vietnam-finance-workspace
npx tsx --test --test-name-pattern='debtor ranking' test/workspace-api.test.ts
```

Expected: FAIL because the Ranking markup/function/wiring does not exist yet.

**Step 3: Add served-page contract assertions**

After fetching `const page = await (await request(`/w/${secret}`)).text();`, assert the page contains:

```ts
assert.match(page, /id="tab-ranking"/);
assert.match(page, /id="ranking" hidden/);
assert.match(page, /function renderRanking\(rows\)/);
assert.match(page, /No one owes money in/);
assert.match(page, /data-person=/);
assert.match(page, /openPerson\(Number\(card\.getAttribute\('data-person'\)\)\)/);
```

Use the actual final, stable markup/function identifiers if they differ; do not assert whitespace or incidental CSS values.

**Step 4: Commit the failing test**

```bash
git add test/workspace-api.test.ts
git commit -m "test: define debtor ranking behavior"
```

Do not proceed until the test fails only for the missing ranking implementation.

### Task 2: Add the route shell, tab registration, and ranking styles

**Objective:** Make Ranking a first-class accessible tab with an initially empty content mount and mobile-safe visual primitives.

**Files:**
- Modify: `src/pages.ts` navigation markup around lines 1636–1644
- Modify: `src/pages.ts` section markup immediately before or after `<section id="balances" ...>` around line 1723
- Modify: `src/pages.ts` CSS constants near existing `.tabs`, `.person-card`, and responsive rules around lines 120–235

**Step 1: Add the navigation button**

Add a button between the existing Balances and Bulk/import buttons:

```html
<button id="tab-ranking" role="tab" aria-selected="false" type="button"><span aria-hidden="true">🏆</span> Ranking</button>
```

Keep the existing navigation model: `TABS` is discovered from `.tabs button`, so no manually duplicated array entry is needed when buttons are present.

**Step 2: Add the read-only route shell**

Create the hidden section with clear heading/hint and stable UI mounts:

```html
<section id="ranking" hidden>
  <div class="card">
    <h2><span aria-hidden="true">🏆</span> Who owes money</h2>
    <p class="hint">Ranked by the current amount each person owes. Choose a currency; amounts are never combined across currencies.</p>
    <div id="ranking-currencies" class="ranking-currencies" aria-label="Ranking currency"></div>
    <div id="ranking-list"><div class="empty">Loading…</div></div>
  </div>
</section>
```

Do not add create, settle, offset, edit, delete, or form controls to this section.

**Step 3: Add minimal reusable CSS**

Add styles using the existing design tokens for:

```css
.ranking-currencies { display:flex; flex-wrap:wrap; gap:var(--sp-2); margin:var(--sp-4) 0; }
.ranking-currency[aria-pressed=true] { /* selected token-based treatment */ }
.ranking-row { /* full-width semantic button; text-align:left; existing focus behavior */ }
.ranking-rank { /* fixed rank column */ }
.ranking-bar { /* horizontal track */ }
.ranking-bar > span { /* proportional fill */ }
```

Make the row’s text wrappers `min-width: 0`; permit long names and formatted VND figures to wrap rather than overflow. Use `width: Math.max(4, Math.round(...)) + '%'` later in rendering so nonzero debts remain visible. Add any phone-width adjustment in the existing responsive block rather than a new breakpoint.

**Step 4: Run typecheck**

Run:

```bash
cd /opt/data/vietnam-finance-workspace
npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit the UI shell**

```bash
git add src/pages.ts
git commit -m "feat: add debtor ranking route shell"
```

### Task 3: Implement pure per-currency debtor derivation and read-only renderer

**Objective:** Render only active debtors in descending current-debt order, based on the canonical signed balance arithmetic.

**Files:**
- Modify: `src/pages.ts` beside `netsByCurrency(rows)` around lines 1254–1271
- Modify: `src/pages.ts` near `loadBalances()` around lines 625–680

**Step 1: Keep arithmetic central**

Use the existing helper unchanged as the source of truth:

```js
function netsByCurrency(rows){
  // skips is_deleted rows; calls signedMinor(t); adds creditor and subtracts debtor
}
```

Do not recreate arithmetic that treats `payment` or `offset` differently. This automatically incorporates repayments, canonical negative offsets, and archived-row exclusion.

**Step 2: Add selected-currency state and default selection**

Introduce narrow state near the balances/ranking functions:

```js
var rankingCurrency='';
function defaultRankingCurrency(){
  var active=currencies.filter(function(c){ return !c.is_archived });
  return (active.find(function(c){ return c.is_default }) || active[0] || {}).code || '';
}
```

On first Ranking render, initialize from `defaultRankingCurrency()`. When the saved selection is no longer active, fall back to the default.

**Step 3: Add `renderRanking(rows)`**

Implement a renderer that:

1. Clears/uses `ranking-currencies` and `ranking-list`; return safely if either is absent.
2. Renders only active workspace currencies as `<button type="button" class="ranking-currency" data-ranking-currency="USD" aria-pressed="true">USD</button>` controls.
3. Reads `var by = netsByCurrency(rows)[rankingCurrency] || {};`.
4. Builds candidates only from `people.filter(function(p){ return !p.is_archived })`, with `net_minor < 0`, preserving only `{ id, display_name, emoji, owed_minor: -net }`.
5. Sorts `owed_minor` descending, then `display_name.localeCompare`, then numeric `id` for deterministic ties.
6. Emits the exact empty state when there are no candidates:

```js
list.innerHTML='<div class="empty">No one owes money in '+esc(rankingCurrency)+'.</div>';
```

7. Renders each candidate as a semantic `<button type="button" class="ranking-row" data-person="..." aria-haspopup="dialog">` showing ordinal `i + 1`, avatar/name, literal text `owes`, `money(owed_minor, rankingCurrency)`, and a bar width proportional to the largest row. Set `aria-label` to include rank, name, the word “owes,” and formatted amount so colour/bar length are never the only meaning.

Never include a person with a positive net (someone owed money), an archived person, zero net, or a transaction action control.

**Step 4: Add `loadRanking()`**

Mirror `loadBalances()` only for fetching:

```js
async function loadRanking(){
  var list=$('ranking-list');
  if(!list){ return }
  list.innerHTML='<div class="empty">Loading…</div>';
  var r=await call('/transactions');
  if(!r.ok){ list.innerHTML='<div class="err">'+esc(r.error)+'</div>'; return }
  renderRanking((r.data&&r.data.transactions)||[]);
}
```

This is a GET-only view; do not add a ranking API route.

**Step 5: Register route activation**

Extend `showTab(tab)` with exactly one branch:

```js
if(tab==='ranking'){ loadRanking() }
```

**Step 6: Run focused test**

Run:

```bash
cd /opt/data/vietnam-finance-workspace
npx tsc --noEmit
npx tsx --test --test-name-pattern='debtor ranking' test/workspace-api.test.ts
```

Expected: PASS.

**Step 7: Commit the renderer**

```bash
git add src/pages.ts test/workspace-api.test.ts
git commit -m "feat: rank current debtors by currency"
```

### Task 4: Wire currency switching and person-modal activation

**Objective:** Make ranking pills update only the read-only view and rows reuse the existing person popup.

**Files:**
- Modify: `src/pages.ts` delegated click handler around lines 1428–1467
- Modify: `test/workspace-api.test.ts` debtor-ranking test

**Step 1: Extend the delegated selector safely**

Add `[data-ranking-currency]` and `[data-person]` to the existing nearest-ancestor selector. Preserve every existing selector and branch.

**Step 2: Add ranking control branches before write/action branches**

Use the following behaviour:

```js
var rankCurrency=t.getAttribute('data-ranking-currency');
if(rankCurrency){ rankingCurrency=rankCurrency; loadRanking(); return }
var personId=t.getAttribute('data-person');
if(personId){ openPerson(Number(personId)); return }
```

If `data-person` is already handled elsewhere, consolidate rather than duplicating it. Confirm that this continues to support existing Balances person cards as well as Ranking rows.

**Step 3: Expand the test’s served-page assertions**

Assert that the served page contains both `data-ranking-currency` and the final exact open-person activation expression. Assert there is no `POST`/`DELETE` reference in the ranking function body if practical; otherwise assert the design by checking only `loadRanking` calls `/transactions` through the generic `call` GET path and has no buttons with known write data attributes (`data-settle`, `data-off`, `data-del`).

**Step 4: Run relevant regression tests**

Run:

```bash
cd /opt/data/vietnam-finance-workspace
npx tsc --noEmit
npx tsx --test --test-name-pattern='debtor ranking|person summary reports|settlement' test/workspace-api.test.ts
```

Expected: PASS.

**Step 5: Commit interaction wiring**

```bash
git add src/pages.ts test/workspace-api.test.ts
git commit -m "feat: open debtor details from ranking"
```

### Task 5: Run full automated verification and inspect the actual served app

**Objective:** Verify source, inline script delivery, and full integration behaviour before deployment.

**Files:**
- Verify only; do not modify files unless a failing test demonstrates a defect.

**Step 1: Inspect source and rendered page safety**

Because `APP_SCRIPT` is a TypeScript template literal, inspect the diff for accidental unescaped backticks or `${` introduced into the inline script. Then run the app’s test server/test route that fetches the served page; do not rely solely on source text.

**Step 2: Run the complete suite to a durable log**

Run:

```bash
cd /opt/data/vietnam-finance-workspace
{ timeout 1700 npm test; echo "EXIT=$?"; } > /opt/data/scratch/suite-debtor-ranking.log 2>&1
```

Read `/opt/data/scratch/suite-debtor-ranking.log` afterward and verify its literal final `EXIT=0` line. Do not infer success from a wrapper/background process status.

**Step 3: Review the working tree**

Run:

```bash
cd /opt/data/vietnam-finance-workspace
git diff --check
git status --short
git log -3 --oneline
```

Expected: no whitespace errors; only intended ranking changes are present/committed.

### Task 6: Deploy and production-smoke-test without touching the Demo workspace

**Objective:** Confirm the deployed Worker meets the mobile/read-only acceptance criteria using only a disposable workspace.

**Files:**
- Verify only; the deployment updates the Cloudflare Worker.

**Step 1: Deploy only after Task 5 passes**

Run through the terminal:

```bash
cd /opt/data/vietnam-finance-workspace
npx wrangler deploy
```

Capture the returned deployment identifier.

**Step 2: Create a throwaway workspace and seed the exact test cases**

Use the project’s existing controlled test/probe mechanism, never the Demo workspace id `3`. Seed USD debt, repayment, a fully settled/zero-net person, and an independent VND debt. Do not expose the capability URL/token in logs or responses; redact it as `[REDACTED]`.

**Step 3: Browser verify at 390×844**

At mobile width, verify all of the following against the deployed app:

- Ranking tab appears and opens.
- Default-currency pill is selected.
- Only current USD debtors appear, largest amount first.
- Repayment reduces the amount and a zero-net person is absent.
- VND pill shows only the VND debtor; no cross-currency total is visible.
- A currency with no current debtor shows `No one owes money in <currency>.`
- Bars scale relative to the largest debt in the selected currency.
- Tapping a row opens the existing person modal.
- No Ranking write controls exist.
- No horizontal page overflow exists at 390px.

**Step 4: Retire only the named throwaway workspace**

Use `tools/purge-test-workspaces.sh` with the explicit disposable workspace identifier. Verify remotely that its `is_active` is `0`. Never deactivate workspace id `3`.

**Step 5: Commit the final verified tree if needed**

If Tasks 1–4 were not already committed individually, make one final focused commit:

```bash
git add src/pages.ts test/workspace-api.test.ts
git commit -m "feat: add per-currency debtor ranking"
git push origin main
```

Then verify the pushed commit with:

```bash
git status --short
git log -1 --oneline
```

### Acceptance checklist

- [ ] Ranking is a dedicated visible tab/route.
- [ ] It is read-only and does not add a backend route, schema, audit record, authentication, or capability mechanism.
- [ ] It shows only non-archived people with current `net_minor < 0`.
- [ ] Largest owed amount ranks first with deterministic ties.
- [ ] Payments, canonical offsets, and archived rows reconcile via shared `netsByCurrency` arithmetic.
- [ ] Currencies use separate pills with no cross-currency aggregate/conversion.
- [ ] Fully settled people disappear, and the exact selected-currency empty state renders.
- [ ] Ranking rows open the pre-existing person-detail modal.
- [ ] UI is accessible and has no horizontal overflow at 390px.
- [ ] `npx tsc --noEmit`, targeted test, and full suite log (`EXIT=0`) pass.
- [ ] Deployment and live disposable-workspace smoke test are verified; the disposable workspace is retired safely.
