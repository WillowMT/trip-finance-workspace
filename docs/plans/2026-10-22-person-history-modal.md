# Person History Modal Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a complete, per-currency transaction history with cumulative net amounts to the existing person modal in the Balances tab.

**Architecture:** Extend the existing `GET /people/:id/summary` response with a new, full active-ledger history collection. The Worker owns the canonical per-record signed impact, while `src/pages.ts` groups it by currency, orders it oldest-to-newest, calculates a cumulative balance, and renders a responsive semantic table beneath the existing modal content. Existing settlement, pairwise, activity, and offset behavior remain unchanged.

**Tech Stack:** TypeScript, Cloudflare Worker + D1, server-rendered HTML/CSS/vanilla JavaScript, Node `tsx --test`.

---

### Task 1: Define and test the complete active-history contract

**Objective:** Make the person-summary API provide all non-deleted ledger rows for the selected person, including auto-generated offset bookkeeping, without changing existing summary lists or totals.

**Files:**
- Modify: `test/workspace-api.test.ts: person summary tests around lines 780–901`
- Modify: `src/worker.ts: person-summary route around lines 524–589`

**Step 1: Write the failing API test**

In the person-summary fixture, create records for Ada across two counterparties and currencies, an auto-netted offset pair, and an archived transaction. Assert a new `history` collection:

```ts
type HistoryRow = {
  id: number;
  occurred_on: string;
  entry_kind: string;
  currency_code: string;
  direction: string;
  counterparty: string;
  amount_minor: number;
  is_deleted: number;
};

assert.deepEqual(
  summary.history.map((row: HistoryRow) => [row.currency_code, row.topic, row.entry_kind]),
  [
    ['USD', 'Dinner', 'debt'],
    ['USD', 'Taxi', 'debt'],
    ['USD', 'Offset', 'offset'],
    ['USD', 'Offset', 'offset'],
    ['SGD', 'Hotel', 'payment'],
  ],
);
assert.ok(summary.history.every((row: HistoryRow) => row.is_deleted === 0));
```

Keep the existing assertions proving `breakdown`, `recent`, visible record counts, and pair counts exclude offsets. The new `history` field is the dedicated complete-ledger source.

**Step 2: Run the focused test to verify failure**

Run:

```bash
npm test -- --test-name-pattern "person summary"
```

Expected: FAIL because `history` is absent from the summary response.

**Step 3: Add the minimal Worker response field**

In `src/worker.ts`, create a `history: SummaryRecord[]` beside `recent` and `breakdown`. While iterating `rows.results`:

```ts
const history: SummaryRecord[] = [];
// `rows` is newest-first; retain all live rows here. The browser will sort for its chronological view.
if (row.is_deleted === 0) history.push(record);
```

Return `history` in the summary payload:

```ts
return secretResponse({
  person,
  totals: /* existing value */,
  counterparties: /* existing value */,
  suggestions,
  recent,
  breakdown,
  history,
  recent_limit: 25,
  records: /* existing value */,
});
```

Do **not** filter offset rows from `history`; the user asked for the full transaction history. Do not change the existing `breakdown`, `recent`, counts, totals, or settlement calculations.

**Step 4: Run the focused test to verify pass**

Run:

```bash
npm test -- --test-name-pattern "person summary"
```

Expected: PASS, with both the existing offset-hidden assertions and new complete-history assertions passing.

**Step 5: Commit**

```bash
git add src/worker.ts test/workspace-api.test.ts
git commit -m "feat: expose complete person ledger history"
```

### Task 2: Render chronological currency history with cumulative balances

**Objective:** Render the API's complete history inside the existing person modal using one table per currency and correct per-row cumulative values.

**Files:**
- Modify: `test/workspace-api.test.ts: served-page assertions around lines 818–860`
- Modify: `src/pages.ts: modal CSS near lines 245–304 and `renderPerson()` near lines 1062–1155`

**Step 1: Write failing served-page assertions**

Add assertions that the page source includes:

```ts
assert.match(page, /<h3 class="mt-16">Full history<\/h3>/);
assert.match(page, /function personHistoryRows\(/);
assert.match(page, /<th scope="col">Running net<\/th>/);
assert.match(page, /history-table-wrap/);
assert.match(page, /history\.sort\(function\(a,b\)/);
```

Also add a focused unit-style extraction test, following the repository's existing `lift()` pattern, for a helper that receives synthetic history rows and returns rows with independent USD/SGD cumulative values. Include an offset and assert it changes the running net; include an archived row and assert it is ignored defensively.

**Step 2: Run the focused test to verify failure**

Run:

```bash
npm test -- --test-name-pattern "person drawer|person history"
```

Expected: FAIL because the full-history renderer and markup do not exist.

**Step 3: Add a small pure history helper**

In `src/pages.ts`, add a helper near `recRow()` that:

1. filters `is_deleted !== 1` defensively;
2. groups by `currency_code`;
3. sorts each group by `occurred_on` ascending, then `id` ascending for stable same-day order;
4. converts each row into the signed impact from the selected person's perspective:
   - `paid_for` and `settled_out` increase the selected person's running net;
   - `covered_for_them` and `settled_in` decrease it;
   - offset direction follows the canonical `direction` supplied by the Worker;
5. returns final net and rendered rows per currency.

Use existing `signedMoney`, `money`, `esc`, the person name, and current direction wording. Make offset rows clearly labelled `Offset` rather than pretending they were a user-entered debt or payment.

**Step 4: Render the section from `renderPerson()`**

After the existing Activity section and before optional offset suggestions, render:

```html
<h3 class="mt-16">Full history</h3>
<div class="history-currency">
  <div class="history-heading">USD <span>+… USD</span></div>
  <div class="history-table-wrap">
    <table class="history-table">
      <thead><tr><th scope="col">Date</th><th scope="col">Detail</th><th scope="col">Amount</th><th scope="col">Running net</th></tr></thead>
      <tbody>…</tbody>
    </table>
  </div>
</div>
```

Use `d.history || []` as the source. If it is empty, render a clear empty state: `No active records for this person.`

**Step 5: Add responsive history-table styles**

Near the existing person-modal styles in `src/pages.ts`:

- make `.history-table-wrap` horizontally scrollable;
- set a practical table min-width so four columns remain readable;
- align Amount and Running net numerically without relying only on color;
- allow Detail to wrap safely;
- retain current modal overflow, focus, Escape, and close behavior.

**Step 6: Run focused tests to verify pass**

Run:

```bash
npm test -- --test-name-pattern "person drawer|person history"
```

Expected: PASS, including the history source, chronology, cumulative-net, offset, accessibility-markup, and responsive-wrapper assertions.

**Step 7: Commit**

```bash
git add src/pages.ts test/workspace-api.test.ts
git commit -m "feat: show cumulative person history in balances"
```

### Task 3: Validate the feature against the full project gates

**Objective:** Confirm the new response and modal do not regress workspace behavior.

**Files:**
- Modify: none expected

**Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

**Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: exit code 0 with all test files passing.

**Step 3: Perform the dry-run deployment build**

Run:

```bash
npm run deploy:dry-run
```

Expected: Wrangler completes without publishing a deployment.

**Step 4: Inspect the final diff**

Run:

```bash
git diff HEAD~2..HEAD -- src/worker.ts src/pages.ts test/workspace-api.test.ts
```

Expected: only the history contract, renderer/styles, and relevant tests are included.

**Step 5: Commit only if needed**

If validation required a corrective change:

```bash
git add src/worker.ts src/pages.ts test/workspace-api.test.ts
git commit -m "fix: preserve cumulative history semantics"
```

Otherwise, do not create an empty commit.
