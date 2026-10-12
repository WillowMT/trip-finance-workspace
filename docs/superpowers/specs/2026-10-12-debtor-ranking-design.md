# Debtor ranking route — design

## Purpose

Add a read-only **Ranking** route to the shared Trip Finance Workspace. It answers one question: **who currently owes money, and by how much?** The visual model is a mobile-friendly ranked list with proportional bars.

## Scope

- Add a `🏆 Ranking` tab to the existing workspace navigation.
- Show only active people with a net amount owed in the selected currency.
- Keep currencies separate. No cross-currency totals, conversion, exchange rate, or base-currency calculation is introduced.
- Make each ranked row a button that opens the existing per-person balance popup.
- Do not add any mutation route, authentication, audit event, or new database schema.

## Data and arithmetic

The client will reuse the workspace transaction state already used by Balances and the settlement plan. It will use the shared signed-money rule:

- debt: `+amount_minor`
- payment: `-amount_minor`
- offset: stored signed and consumed as-is

For each currency and person, the ranking derives that person's net from active transactions only. A person appears when their net is negative; the displayed owed magnitude is `abs(net_minor)`. Repayments and offsets therefore reduce the ranking automatically, and a fully settled person is omitted.

Archived transactions remain excluded from the calculation, matching the ledger, Balances cards, person summary, and settlement plan.

## User experience

1. Selecting **🏆 Ranking** opens the new route.
2. Currency pills appear at the top. The default workspace currency is selected initially; choosing a pill changes only the displayed ranking.
3. The route begins with a plain-language hint: ranked by the current amount each person owes in the selected currency.
4. Each row contains:
   - ordinal rank;
   - person emoji/avatar and name;
   - `owes <amount>` text, with the existing negative/debt colour treatment;
   - a horizontal proportional bar, sized against the largest owed amount in that currency.
5. Tapping a person opens the existing person modal with their detailed balances, payments, offsets, and activity.
6. If no active person owes money in the selected currency, render a clear empty state: `No one owes money in <currency>.`

The route is read-only. It does not offer settle, offset, delete, edit, or create actions.

## Components and boundaries

- `src/pages.ts`
  - Navigation markup adds the Ranking tab.
  - Client script adds a narrow ranking derivation/render function, consuming existing in-memory `people`, `currencies`, and transactions state rather than duplicating API logic.
  - Styling extends the token-based design system with reusable ranking-row/bar classes. It must maintain wrapping and fit at a 390px viewport.
  - Existing `openPerson(id)` handles row activation; no duplicate modal or detail API is created.
- `test/workspace-api.test.ts`
  - Served page assertions cover the Ranking route, currency controls, empty state, and row-to-person-modal wiring.
  - The ranking fixture includes debt, repayment, reverse debt, and offset cases to pin signed arithmetic and ensure settled people disappear.

## Error handling and accessibility

- A missing/empty transaction set renders the empty state rather than an error.
- Currency controls are buttons with clear selected state.
- Ranking rows are semantic buttons and retain the established visible keyboard-focus treatment.
- The amount is expressed in words (`owes`) and colour; colour is never the sole meaning.
- Long person names and VND-scale amounts wrap without horizontal overflow.

## Verification

1. Typecheck.
2. Targeted ranking API/UI test, including signed repayment and offset cases.
3. Full test suite on a frozen tree.
4. Deploy automatically after green tests.
5. Use a throwaway workspace only to verify the production UI; test debt, repayment, offset, currency switching, empty state, row activation, 390px layout, and absence of horizontal overflow. Retire the throwaway workspace afterward.

## Non-goals

- Ranking people who are owed money.
- A cross-currency leaderboard.
- Exchange rates or a base currency.
- Historical/trend rankings.
- Any change to settlement, offset, ledger, or person-summary arithmetic.
