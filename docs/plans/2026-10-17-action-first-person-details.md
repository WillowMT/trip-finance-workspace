# Action-first person details Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make each person drawer state only the live group-settlement action by default and place pairwise ledger balances in an explained, collapsed audit trail.

**Architecture:** Keep the existing `/people/:id/summary` response and all settlement/payment/offset calculations unchanged. Modify only the HTML emitted by `renderPerson()` in the served workspace script: action status is derived from each existing `totals[].net_minor`; pairwise content is wrapped in a native closed disclosure. Update served-page regression assertions alongside the rendering change.

**Tech Stack:** TypeScript, inline browser JavaScript/HTML in `src/pages.ts`, Node `tsx --test` tests, npm typecheck.

---

### Task 1: Add the served-page wording contract

**Objective:** Define the copy and structural contract before changing the person drawer.

**Files:**
- Modify: `test/workspace-api.test.ts:810-830`
- Test: `test/workspace-api.test.ts`

**Step 1: Write the failing assertions**

Replace the current assertions that require the gross `Owed to`/`owes` status lines and the bare `Who owes whom` heading with assertions for the intended source strings:

```ts
assert.match(page, /No group payment required/);
assert.match(page, /Ledger trail and original pairwise balances/);
assert.match(page, /not necessarily payments required by the group settlement/);
assert.ok(!page.includes('<h3 class="pm-relations-title" id="pm-relations-title">Who owes whom</h3>'));
assert.ok(!page.includes("Owed to '+esc(meName)"));
```

Keep the existing API-data assertions, payment-limit assertions, offset assertions, and no-jargon assertion unchanged.

**Step 2: Run the focused test to verify failure**

Run:

```bash
npx tsx --test --test-name-pattern='person summary reports' test/workspace-api.test.ts
```

Expected: one failing test because the served page still uses the old primary wording and relation heading.

**Step 3: Commit the red test only if it is useful as an isolated checkpoint**

Do not make a standalone red commit on `main` unless the implementation task follows immediately; otherwise leave the test change paired with Task 2.

### Task 2: Render action-first group-settlement status

**Objective:** Replace ambiguous net/gross status copy with one action-first status per currency.

**Files:**
- Modify: `src/pages.ts:1014-1037` (`renderPerson`)
- Test: `test/workspace-api.test.ts`

**Step 1: Implement the minimal status renderer**

Within the existing `for (var c=0; c<totals.length; c++)` loop, render a status label based only on `t.net_minor`:

```js
var action = t.net_minor > 0
  ? 'Receive '+money(Math.abs(t.net_minor),t.currency_code)+' in the group settlement'
  : t.net_minor < 0
    ? 'Pay '+money(Math.abs(t.net_minor),t.currency_code)+' in the group settlement'
    : 'No group payment required';
var explanation = !t.net_minor && allPairs.length
  ? 'Direct ledger balances below cancel within the group. No payment is required from this person in the group settlement.'
  : '';
```

Render `action` as the primary status. For non-zero values, maintain the existing positive/negative amount color treatment, but do not add a second gross `Owed to` or `owes` monetary line. For zero, show the explanation only when pairwise data exists.

**Step 2: Run the focused test to verify pass**

Run:

```bash
npx tsx --test --test-name-pattern='person summary reports' test/workspace-api.test.ts
```

Expected: `1 passed, 0 failed`.

### Task 3: Collapse and explain pairwise audit data

**Objective:** Preserve complete pairwise auditability without presenting it as an immediate payment requirement.

**Files:**
- Modify: `src/pages.ts:1043-1071` (`renderPerson`)
- Test: `test/workspace-api.test.ts`

**Step 1: Wrap the relations section in native disclosure markup**

Replace the visible `Who owes whom` `<h3>` section header with a closed native disclosure. Use this copy exactly:

```html
<details class="pm-ledger-trail">
  <summary>Ledger trail and original pairwise balances</summary>
  <p class="hint">These show the direct expense and repayment record. They are not necessarily payments required by the group settlement.</p>
  <!-- existing pair rows -->
</details>
```

Keep `pairLine`, pair amounts, individual pair buttons, record counts, histories, archived rows, and offset controls unchanged inside the disclosure. Do not alter transaction data, API calls, settlement calculations, or payment behavior.

**Step 2: Add only required styling**

In the existing person-modal CSS area of `src/pages.ts`, add a small scoped rule for `.pm-ledger-trail` and its `summary` so it is visibly interactive and matches existing cards. Do not change global `details.card.fold` styling or unrelated existing uncommitted CSS.

**Step 3: Run the focused test to verify pass**

Run:

```bash
npx tsx --test --test-name-pattern='person summary reports' test/workspace-api.test.ts
```

Expected: `1 passed, 0 failed`.

### Task 4: Update Balance-page drill-in guidance and verify regressions

**Objective:** Align the Balance page with the new drawer hierarchy and prove no settlement behavior changed.

**Files:**
- Modify: `src/pages.ts:2288`
- Test: `test/workspace-api.test.ts`, `test/workflow-api.test.ts`

**Step 1: Update the People/history hint**

Replace wording that says the drawer includes “who they owe or are owed by” with wording that explains it shows group-settlement status first and an optional ledger trail/history.

**Step 2: Run focused regression tests**

Run:

```bash
npx tsx --test --test-name-pattern='person summary reports|settle-up plan|offset suggestions' test/workspace-api.test.ts test/workflow-api.test.ts
npm run typecheck
git diff --check
```

Expected: all selected tests pass, typecheck passes, and diff check returns no output.

**Step 3: Review the served source and scope**

Run:

```bash
git diff -- src/pages.ts test/workspace-api.test.ts
git status -sb
```

Confirm that the patch only changes action-first person-detail rendering, the Balance hint, focused styles, and regression tests; do not include pre-existing unrelated `src/pages.ts` edits.

**Step 4: Commit the implementation**

```bash
git add src/pages.ts test/workspace-api.test.ts
git commit -m "feat: clarify group settlement in person details"
```

Stage hunks selectively if `src/pages.ts` contains unrelated work. Verify afterward with `git status -sb` that unrelated work remains unstaged.

### Task 5: Deploy the verified non-destructive change

**Objective:** Publish the verified UI wording/hierarchy change through the project’s established preview-first deployment process.

**Files:**
- No source changes required.

**Step 1: Load and follow the deployment skill**

Load the repository-relevant deployment skill before issuing deployment commands. Use the project’s configured preview-first route; do not inspect or print secret environment variables.

**Step 2: Verify the deployment**

Read the deployed page and confirm it serves the new action-first and ledger-trail wording before reporting success. Include the deployment URL and the tests actually passed.
