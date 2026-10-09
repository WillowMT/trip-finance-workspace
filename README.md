# Trip finance workspace

A generic Cloudflare Worker and D1 foundation for a shared friends’ trip ledger. It starts with a landing page and database migrations; onboarding and workspace APIs are intentionally not part of this foundation phase.

## Local verification

```sh
npm install
npm test
npm run typecheck
npm run deploy:dry-run
```

The migration tests use an isolated local Wrangler D1 database and apply the actual SQL migrations. They do not contact Cloudflare or any production database.

## Audit boundary

SQLite triggers write whole before/after snapshots for workspace, people, currencies, settings, and transactions. Workspace capability hashes are deliberately excluded from snapshots. `audit_log` rejects application-level updates and deletes; a Cloudflare account or database owner can still alter D1 schema/data and is outside this database-only protection boundary.
