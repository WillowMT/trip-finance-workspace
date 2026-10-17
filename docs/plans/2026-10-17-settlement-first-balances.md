# Settlement-first Balances Page Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Group settlement the primary Balances experience and move person-by-person overall balances into the existing person detail modal.

**Architecture:** Keep the existing client-side `netsByCurrency` and `settlePlan` calculation unchanged. Restructure `loadBalances()` so the main panel renders a small set of person entry points without per-person money chips, then renders the settlement plan first. Existing `openPerson()`/`renderPerson()` continues to expose overall, pairwise, and ledger detail.

**Tech Stack:** TypeScript, server-rendered HTML with inline browser JavaScript, Cloudflare Workers, Node test runner via `tsx`.

---

### Task 1: Pin the settlement-first DOM contract

**Objective:** Add a focused served-page regression test that expresses the new information hierarchy.

**Files:**
- Modify: `test/workspace-api.test.ts` near existing settlement-plan page assertions around lines 1302–1308.
- Test: `test/workspace-api.test.ts`.

**Step 1: Write the failing test**

Add served-page assertions for stable markers introduced by the implementation:

```ts
assert.match(html, /id="settle-list"/, 'Group settlement has a dedicated main-page container');
assert.match(html, /id="balance-people"/, 'people remain available as detail entry points');
assert.doesNotMatch(html, /className='person-card[\s\S]{0,700}p-nets/, 'main person cards do not expose many per-person money chips');
```

**Step 2: Run the test to verify failure**

Run:

```bash
npx tsx --test --test-name-pattern='settle plan' test/workspace-api.test.ts
```

Expected: FAIL because `balance-people` does not yet exist.

**Step 3: Commit the test**

```bash
git add test/workspace-api.test.ts
git commit -m "test: define settlement-first balances contract"
```

### Task 2: Simplify main-page person entry points

**Objective:** Retain person detail access but remove per-person overall amount chips from the main Balance page.

**Files:**
- Modify: `src/pages.ts:892-927` (`loadBalances`).

**Step 1: Implement the smallest rendering change**

- Rename/use the person list container as `balance-people`.
- Keep the person card button, avatar, name, record count, and chevron.
- Remove `credits`, `debits`, `seen`, currency collection, `netChip()`, and the `p-nets` content from this main-page render path.
- Use neutral copy such as `Open settlement details and history` below each name, rather than a numeric pairwise or overall summary.
- Preserve the existing `data-person` wiring so a click calls `openPerson()`.

The target card markup shape is:

```js
el.innerHTML='<span class="avatar" aria-hidden="true">'+esc(p.emoji||initials(p.display_name))+'</span>'+
  '<span class="p-main"><span class="who">'+esc(p.display_name)+'</span>'+
  '<span class="meta">Open settlement details and history</span></span>'+
  '<span class="chev" aria-hidden="true">›</span>';
```

**Step 2: Run the focused test**

```bash
npx tsx --test --test-name-pattern='settle plan' test/workspace-api.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add src/pages.ts
git commit -m "feat: move balance amounts into person details"
```

### Task 3: Put Group settlement first in the Balances markup

**Objective:** Make the settlement plan the first substantive panel on the Balances tab and label it clearly as a group-level result.

**Files:**
- Modify: `src/pages.ts` near the `balances` section markup containing `settle-list`, `bal-list`, and `offset-list`.
- Test: `test/workspace-api.test.ts`.

**Step 1: Update the failing test with ordering assertions**

Assert the `Group settlement` heading appears before the person entry-point container in served HTML.

```ts
assert.ok(html.indexOf('Group settlement') < html.indexOf('id="balance-people"'), 'settlement comes before people details');
```

**Step 2: Run and confirm it fails**

```bash
npx tsx --test --test-name-pattern='settle plan' test/workspace-api.test.ts
```

**Step 3: Reorder and relabel markup**

- Place a `Group settlement` heading and short explanation immediately above `settle-list`.
- Place the neutral people list below it in a collapsed/details card or secondary section titled `People and history`.
- Keep `offset-list` available below that secondary section; do not remove existing offset behavior.
- Ensure all IDs referenced from JavaScript are updated consistently (`balance-people` rather than `bal-list`).

**Step 4: Run focused tests**

```bash
npx tsx --test --test-name-pattern='settle plan|person summary reports' test/workspace-api.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/pages.ts test/workspace-api.test.ts
git commit -m "feat: prioritize group settlement on balances"
```

### Task 4: Verify no regression in balance calculations or person audit detail

**Objective:** Confirm presentation changes did not alter signed money arithmetic, settlement planning, or modal detail access.

**Files:**
- Test: `test/workspace-api.test.ts`, `test/workflow-api.test.ts`.

**Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

**Step 2: Run targeted regression tests**

```bash
npx tsx --test --test-name-pattern='settle plan|person summary reports|offset suggestions' test/workspace-api.test.ts test/workflow-api.test.ts
```

Expected: all selected tests pass.

**Step 3: Run the full suite**

```bash
npm test
```

Expected: exits 0; if the suite exceeds the runner timeout, report the timeout and preserve the targeted-test evidence.

**Step 4: Check the working tree**

```bash
git status -sb
git diff --check
```

Expected: only intended commits and the pre-existing unrelated `src/pages.ts` changes remain accounted for.
