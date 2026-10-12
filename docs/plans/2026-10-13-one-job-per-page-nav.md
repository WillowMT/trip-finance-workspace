# One job per page: navigation, cards, and the end of "Ledger"

Design locked 2026-10-13. Everything here is in `src/pages.ts` (the app shell) plus the matching
`NAV_SECTIONS` line in `src/telegram.ts`. The tests that pin it live in `test/workspace-api.test.ts`
(the section-structure test) and `test/telegram-api.test.ts` (the `/start` menu).

## The problem

A first-time reader could not tell what the `#ledger` page was for. It carried the entry form, a type
dropdown that flipped the meaning of the same two fields, the transaction list, and the spend chart —
so "add a new expense", "record money handed back", and "look at what happened" were one scroll apart.
Analytics and a writing form on one page invites the wrong reading of the form.

## The rule that replaced it

**One job per page, and reading never shares a page with writing.**

| Page | Job | Carries | Never carries |
| --- | --- | --- | --- |
| `#add` (➕ Add expense) | create a debt | the expense form, no type switch | analytics, lists |
| `#pay` (↩️ Record a payment) | close a debt out | the repayment form | analytics, lists |
| `#split` (✂️ Split a bill) | create several debts from one bill | the split form | the recent-splits list |
| `#ledger` (📒 Transactions) | **read only** | spend by day, the transaction list, recent splits | any `<input>`/`<select>` |

The kind of entry is no longer something a user picks: `#add` always writes `entry_kind = 'debt'` and
`#pay` always writes `'payment'`, through `addTx(kind, F)` with `TX_FORM` / `PAY_FORM` naming each page's
fields. `syncKindLabels()` and the `#t-kind` dropdown are gone — there is no state for a user to get
wrong, and no label that quietly changes meaning. The ids `t-*` and `p-*` keep each form's fields apart.

`#ledger` keeps its id so `#ledger` links, the hash default, and every existing section assertion still
resolve; only its label changed (`Transactions`). The word "ledger" now survives in code comments and
the data model, never in copy a first-timer reads.

## Cards collapse by default

The three data cards on the read page — spend by day, the transaction list, recent splits — are
`<details class="card fold">` with **no `open`**, matching the `pm-breakdown` convention the person
popup already used. The collapsed row is the card's own `<h2>` plus a live count (`#tx-count`,
`#splits-count`), so the read page states its volume without spending a screen of pixels on it.

## The sidebar

The always-visible tab bar is gone. Navigation is a hamburger (`#nav-open`) that opens a drawer
(`#nav-drawer`) over a backdrop, in three labelled groups — creating, reading, workshop — and the
current page is named next to the ☰ (`#nav-now`, filled by `navMark()` from the tab's own label, so the
two can never drift). It closes on a pick, on the backdrop, on ✕, and on Esc; it opens without the
`nav-open` body class, so it is closed in the served HTML and a test can prove it.

## Cross-links that had to move with it

- Settle-up (Balances → a suggested payment) used to flip the type dropdown on the ledger page; it now
  opens `#pay` with `p-*` prefilled and goes straight into the review sheet.
- Logging a receipt card fills the **Add expense** page (`#add`) with the card's title and note.
- After a split commit, `loadLedger()` is still called and the confirmation says "now in Transactions".

## The Telegram mirror

`NAV_SECTIONS` in `src/telegram.ts` is the same ten sections in the same order, two per row, so the
`/start` grid and the sidebar cannot disagree. `/go/<pass>/<section>` validates against `NAV_SECTIONS`,
so adding a page to the list is all it takes to make it addressable from Telegram.
