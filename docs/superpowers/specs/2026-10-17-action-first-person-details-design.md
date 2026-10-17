# Action-first person details

## Problem

A person can have a zero group-net balance while the ledger still contains direct pairwise balances. The current person drawer announces that they are "settled up" and then immediately presents **Who owes whom** rows as equal-weight information. A person unfamiliar with group netting can reasonably interpret those rows as unpaid actions, contradicting the zero-net status.

## Decision

The person drawer will make the current **group settlement action** the only primary answer. Pairwise balances remain available for auditability, but are explicitly labeled as ledger context—not payments currently required by the group settlement plan—and are collapsed by default.

## Drawer layout

For each currency:

1. Show one action-status card first.
   - Zero net: **No group payment required**.
   - Positive net: **Receive {amount} in the group settlement**.
   - Negative net: **Pay {amount} in the group settlement**.
2. For zero net with active pairwise rows, add a short explanation:
   - "Direct ledger balances below cancel within the group. No payment is required from this person in the group settlement."
3. Do not display gross "Owed to" or "owes" monetary lines in the primary status area. They imply a next action and recreate the contradiction.
4. Follow with the neutral record count.

## Ledger trail

Replace the visible **Who owes whom** heading with a closed disclosure:

- Summary: **Ledger trail and original pairwise balances**
- Supporting text: "These show the direct expense and repayment record. They are not necessarily payments required by the group settlement."
- When closed, it shows neither pairwise amounts nor counterparty action language.
- When opened, it retains the existing pair rows, expandable record histories, archived labels, and offset controls. The existing pairwise figures must not be deleted or rewritten.

## Language

- Do not use bare "settled up" for zero net status.
- Use **No group payment required**.
- The main Balance-page People/history hint will say that opening a person shows their group-settlement status and optional ledger trail, rather than implying all displayed pairwise balances are required payments.

## Data and behavior

No ledger, API, settlement algorithm, payment, offset, import, or audit behavior changes. The UI continues to use the existing per-person summary response and current live group settlement calculation. This change only changes information hierarchy and wording.

## Accessibility and interaction

- The ledger trail disclosure uses a native `<details>`/`<summary>` control.
- It starts closed on every person-drawer open.
- Existing nested pair toggles retain correct `aria-expanded` state.
- The status explanation is visible text, not tooltip-only.

## Regression coverage

Served-page assertions must verify:

- the action-first zero-net wording is present;
- the direct-balance labels are absent from the primary status renderer;
- the ledger-trail summary and its explanatory language are present;
- the old bare **Who owes whom** heading is absent;
- existing payment-limit, person-summary API, and offset behavior remain covered.
