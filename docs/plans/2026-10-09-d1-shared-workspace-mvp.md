# D1 Shared Workspace MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Deliver a functional Cloudflare Worker + D1 finance tracker where a group creates a workspace, shares one secret link, records/edits/archives debts and payments, manages people/currencies/settings, exports data, and reads an immutable audit log.

**Architecture:** Static HTML is served by a Worker. All workspace APIs resolve an opaque shared-link capability to a D1 workspace row and scope every query to that row. SQLite triggers create complete audit snapshots for business/configuration changes; no API writes the audit log directly.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Wrangler, Node test runner, Miniflare/Wrangler local D1.

**Product contract:** `docs/superpowers/specs/2026-10-09-cloudflare-d1-shared-workspace-design.md`.

---

## Functional-first order

### Task 1: Worker project and local verification harness

**Objective:** Create a deployable TypeScript Worker project with a D1 binding and local test command.

**Files:** `package.json`, `tsconfig.json`, `wrangler.toml`, `src/worker.ts`, `test/worker.test.ts`, `.gitignore`.

**Steps:**
1. Add a failing test that requests `/` and expects the create-workspace landing page.
2. Configure TypeScript, Wrangler, and a test runner compatible with Workers/D1.
3. Implement minimal static landing response and verify test pass.
4. Add scripts for `test`, `typecheck`, and `deploy:dry-run`.
5. Commit.

### Task 2: D1 core schema and auditable migrations

**Objective:** Add workspace, people, currencies, settings, transactions, and append-only audit schema.

**Files:** `migrations/0001_core.sql`, `migrations/0002_audit_triggers.sql`, `migrations/0003_audit_lock.sql`, migration tests.

**Steps:**
1. Test migrations apply to blank local D1.
2. Implement core schema using integer minor amounts and workspace scoping.
3. Add triggers for create/update/archive/restore/delete whole-row snapshots for all mutable entities; never snapshot `workspaces.secret_hash`.
4. Add audit update/delete rejection triggers and prove they reject direct changes.
5. Commit.

### Task 3: Capability resolution and onboarding

**Objective:** Create a secret-link workspace only after a valid wizard confirmation and resolve it on every workspace request.

**Files:** `src/auth.ts`, `src/validation.ts`, `src/onboarding.ts`, `src/worker.ts`, onboarding tests.

**Steps:**
1. Test missing/invalid secret returns no workspace data and does not mutate D1.
2. Implement 32-byte base64url secret generation, SHA-256 storage, and constant-time hash comparison where applicable.
3. Implement `POST /api/onboarding` with workspace name, 2+ people, 1+ currencies, exactly one default currency, and atomic D1 write.
4. Verify onboarding triggers audit entries for workspace, people, currencies, and settings.
5. Commit.

### Task 4: Workspace configuration APIs

**Objective:** Deliver people, currencies, workspace-name, categories, and guard settings operations with strict workspace isolation.

**Files:** `src/settings.ts`, `src/db.ts`, API tests.

**Steps:**
1. Test create/rename/archive/restore/default-currency flows, including cross-workspace rejection.
2. Implement allowlisted mutation handlers and archive instead of physical removal.
3. Enforce default currency and active-reference safeguards.
4. Verify every mutation produces one correct audit row.
5. Commit.

### Task 5: Transaction domain and audited APIs

**Objective:** Deliver reviewed-create, reviewed-edit, list, analytics, and soft-delete/restore transaction flows.

**Files:** `src/ledger.ts`, `src/currency.ts`, `src/worker.ts`, transaction tests.

**Steps:**
1. Test decimal-to-minor conversion, direction rules, archived references, cross-workspace IDs, and stale reviewed edits.
2. Implement preview endpoints that cannot write data/audit rows.
3. Implement create, edit, list, analytics, archive/delete, and restore; require full review payload/canonical fingerprint to prevent stale confirmation.
4. Verify audit before/after JSON for create/update/archive/restore exactly once per change.
5. Commit.

### Task 6: Batch, split, import, and offset workflows

**Objective:** Implement functional review/commit flows for the reusable tracker’s multi-row features.

**Files:** `src/imports.ts`, `src/splits.ts`, `src/offsets.ts`, tests.

**Steps:**
1. Test previews produce no writes and commits revalidate raw data server-side.
2. Implement CSV limits/reparse, split payer rules, batch entry, and reciprocal offset recalculation.
3. Commit each reviewed result in an atomic D1 batch.
4. Verify one audit record per created transaction and test no partial result on invalid payload.
5. Commit.

### Task 7: Functional web UI

**Objective:** Make every required function usable in the browser before visual refinement.

**Files:** `public/*`, UI tests.

**Steps:**
1. Implement onboarding wizard and copy-link result.
2. Implement dashboard/navigation, settings, normal transaction create/edit/delete, transaction list, audit, analytics, export, split/batch/import/offset pages.
3. Require review dialogs before all writes and confirmations before archive/delete.
4. Use accessible labels, status/error states, and mobile-safe tables. Do not add visual polish until flows work.
5. Commit.

### Task 8: Export, security headers, integration verification, documentation

**Objective:** Finish operational functionality and prove it works locally.

**Files:** `src/responses.ts`, `README.md`, integration tests.

**Steps:**
1. Implement workspace-scoped JSON/CSV export including optional audit data.
2. Add no-store/no-referrer/CSP/nosniff headers and no CORS by default.
3. Add an integration test covering onboarding in two workspaces, CRUD/configuration isolation, audit read/immutability, export isolation, and absence of Telegram functionality.
4. Run typecheck, full test suite, migration test, and Wrangler dry run.
5. Commit and push.

## Completion gate

Do not claim completion until the full local test suite, typecheck, migration application, and Worker dry-run pass. Do not deploy or use a production D1 database without an explicit later user instruction. Never access or print credentials; use native Cloudflare/GitHub credential stores only.
