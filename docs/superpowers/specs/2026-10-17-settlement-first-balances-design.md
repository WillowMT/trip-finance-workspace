---
title: Settlement-first Balances page
date: 2026-10-17
status: approved
---

# Settlement-first Balances page

## Goal

Make the Balances page answer the group's immediate action question first: which settlement payments should be made. Do not make users scan a list of every participant's individual incoming and outgoing balance.

## Main page

1. Make **Group settlement** the primary Balances content.
2. Render the existing deterministic, per-currency settlement plan first, retaining its current `Record` action and review-before-write flow.
3. Do not render the current per-person overall-net cards in the main Balances page.
4. Keep reciprocal offset suggestions below the settlement plan.
5. Preserve the existing empty state when no settlement payments are needed.

## Details and auditability

1. Keep person cards available as an entry point to a person detail modal.
2. Move the compact per-person overall net into the detail modal's opening summary.
3. Retain pairwise balances and transaction history in that modal as the explanation/audit layer.
4. Do not hide or delete individual debt records, person summaries, offset controls, or the ledger.

## Data and interaction constraints

- No API or database schema changes.
- The plan remains client-calculated from active transaction rows and remains separated by currency.
- Selecting `Record` continues to prefill the ordinary payment form and requires review/confirmation before any write.
- Pairwise details remain read-only unless using existing controls.

## Verification

- Update page-level tests so the settlement plan is present and precedes secondary balance content.
- Assert that direct multi-person balance cards are absent from the main view.
- Assert that person details retain overall-net, pairwise, and history information.
- Run typecheck and relevant workspace tests.
