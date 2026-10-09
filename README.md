# Trip finance workspace

A generic Cloudflare Worker and D1 app for a shared friends’ trip ledger. It supports a capability-secured onboarding link plus auditable workspace settings, people, currencies, transactions, soft deletion, restoration, and read-only audit history. Batch entry, CSV review, offsets, exports, analytics, and the full web UI follow in later phases.

## Local verification

```sh
npm install
npm test
npm run typecheck
npm run deploy:dry-run
```

The migration tests use an isolated local Wrangler D1 database and apply the actual SQL migrations. They do not contact Cloudflare or any production database.

## Transaction amount contract

`POST /w/:secret/api/transactions` is the ordinary-entry endpoint. It accepts only `debt` and `payment`; split, offset, and import entries belong to their dedicated flows. Amounts are integer `amount_minor` values (never decimal JSON numbers), and `currency_code` must be an active three-letter currency scoped to the workspace.

## Split preview and commit

`POST /w/:secret/api/splits/preview` accepts a raw split draft and writes nothing. It returns deterministic participant allocations (ascending person ID takes any remainder) and the exact proposed `split` ledger rows. `POST /w/:secret/api/splits` accepts the same raw draft plus an `Idempotency-Key` header, revalidates the raw draft, and atomically records the generated rows. Repeating a key with the same normalized draft returns the original rows; reusing it for a different draft returns `409`. A positive integer `amount_minor` is divided across 1–200 unique active participants; the active payer may be outside that list.

## Audit boundary

SQLite triggers write whole before/after snapshots for workspace, people, currencies, settings, and transactions. Workspace capability hashes are deliberately excluded from snapshots. `audit_log` rejects application-level updates and deletes; a Cloudflare account or database owner can still alter D1 schema/data and is outside this database-only protection boundary.
