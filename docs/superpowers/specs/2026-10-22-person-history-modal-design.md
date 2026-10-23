# Person History Modal Design

## Goal

Make the Balances tab resemble the supplied ledger reference while retaining Trip Finance Workspace's existing workflow: a compact settlement plan and people list, with a tap on a person revealing their complete financial history and cumulative net amount over time.

## Scope

This changes the existing person-detail modal opened from the Balances people list. It does not add routes, persistence, API endpoints, or database fields.

## User experience

### Balances list

- Keep the existing compact person cards in the Balances tab.
- Each card continues to show the person identity, active/archived state, record count, and current net amount(s).
- Selecting a card opens the existing person-detail modal.

### Person-detail modal

- Preserve the existing settlement and profile information already shown by the modal.
- Add a `Full history` section below the existing content.
- Show every non-archived transaction involving the selected person, across all group members; do not restrict the history to a pairwise relationship.
- Group records by currency.
- Sort each currency group oldest to newest using the ledger's existing stable ordering for equal dates.
- Each group displays its final net amount in the currency heading.
- Each record row renders: date, plain-language detail, signed amount, and the cumulative running net after that record.
- Plain-language detail identifies the payment/debt direction relative to the selected person and includes the topic or note using current ledger phrasing.
- The sign convention is consistent throughout the view: a positive amount or cumulative net means the group owes the selected person; a negative amount or cumulative net means the selected person owes the group.
- A selected person with no active records receives an explicit empty state.

## Data and calculation model

- Reuse the transactions already loaded for the Balances view and existing modal. No new endpoint is introduced.
- Exclude soft-deleted/archived ledger records from the history and cumulative calculation.
- Reuse the canonical transaction-sign helper so the history, Balances list, settlement plan, and person summary cannot disagree about a row's effect.
- Compute independent cumulative totals for every currency; never combine currencies.
- Keep existing auto-netting and settlement semantics unchanged.

## Responsive and accessibility behavior

- Keep the existing modal's focus trap, close controls, and keyboard behavior.
- Render history in a semantic labelled table, with a horizontal scroll container at narrow widths.
- Preserve readable row wrapping for long topics and notes; numerical columns stay scannable.
- Ensure cards and table rows do not rely solely on color to communicate owed direction.

## Tests

Add or extend focused tests to verify:

1. the person modal renders a full-history section;
2. all selected-person records across counterparties appear, while unrelated records do not;
3. deleted records are excluded;
4. records are correctly grouped and chronologically ordered by currency;
5. signed row values and cumulative totals match the canonical net calculation;
6. settled people can still open and inspect history;
7. the generated markup includes the narrow-screen table overflow treatment.

Run typechecking and the complete test suite before implementation is considered complete.

## Update: offsets retired

The auto-offset feature was removed after this design. Balances are net balances, so reciprocal-debt netting added nothing a reader could not already see, and it wrote bookkeeping rows that the ledger then had to explain. Reciprocal debts now stay exactly as recorded; the offset card, the "Offset these" suggestion in the person drawer, the `auto_offset` setting, `src/netting.ts`, and the `/offset-suggestions`, `/offsets/preview` and `/offsets` endpoints are all gone. Rows already stored with `entry_kind = 'offset'` remain readable so historic ledgers still add up.
