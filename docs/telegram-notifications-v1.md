# Telegram notifications & chat linking — V1

A workspace can announce its own audited changes to one or more Telegram chats, and those chats are
managed from the trip's **⚙️ Setup** tab. The layer is deliberately one-way: it can *announce* ledger
changes and *link* chats, and it can never write a ledger row. Telegram-side financial writes, receipt
processing, AI features, transaction commands and user authentication are out of scope.

## What was built

**Bot behaviour**

- `/start` replies with a short welcome that says what Trip Finance Workspace is, plus one inline button
  labelled **Open Trip Finance Workspace**. The button's URL is the public application root
  (`PUBLIC_ORIGIN`) and never a private `/w/<secret>` capability URL.
- The welcome explains that notifications are connected from a workspace's ⚙️ Setup tab.
- `/start <pairing_token>` links the chat that sent it. Private chats link directly; a group or supergroup
  links only when the sender's `getChatMember` status is `creator` or `administrator`, and the refusal is
  answered in the chat without consuming the token.
- Nothing a chat can say reaches the ledger: the webhook handles `/start` and `/start <token>` only.

**Settings UI (Setup tab → 🔔 Telegram notifications)**

- **Connect Telegram Chat** button: `POST /w/<secret>/api/telegram/pair` mints a cryptographically random,
  single-use pairing token that expires 10 minutes after it is created, and the card shows a bot deep link
  (`https://t.me/<bot>?start=<token>`) to tap. For groups, add the bot to the group first and follow the
  same link from inside the group as an administrator.
- The connected-chat list shows each chat's **display name and type**, a per-connection **enabled** status
  and a **Disconnect** button. Disconnecting deletes the connection and its queued notifications.
- The card is inert (and says so) while the worker has no bot token and webhook secret.

**Notifications**

- The immutable `audit_log` is the single source of truth. After a mutating `/w/:secret/api` request has
  already committed (HTTP < 400) the worker reads the audit rows newer than each chat's watermark, turns
  them into one message per logical operation, and queues it in the outbox; delivery happens separately.
- Covered: transaction created, edited, archived/deleted and restored; payment/settlement recorded; split,
  batch and CSV-import commits; person and currency changes; workspace settings changes; the workspace's
  own name change; backup restore actions. Preview-only requests, refused writes and failed writes announce
  nothing — that is structural, not a special case.
- Wording is anonymous and passive: no actor, no attribution. "⚙️ The trip's setup was changed" with one
  sentence per change (`Trip members: Ada was added`), never a key/value dump.
- **Backup and receipt housekeeping stay silent** rather than inventing a line for housekeeping events.
- Delivery dedupe lives in the database: `UNIQUE(connection_id, event_key)` plus `INSERT OR IGNORE`, and the
  watermark is advanced in the same D1 batch, so a replayed window cannot repeat or lose an event. A chat
  Telegram reports as blocked/unreachable is disabled instead of being retried forever.
- Money is grouped per currency and never summed across currencies; the message never contains an
  exchange rate or a cross-currency total.

## Migration and files

| Path | Change |
|---|---|
| `migrations/0015_telegram_notifications.sql` | **new** — `telegram_connections`, `telegram_pairing_tokens`, `telegram_notifications` |
| `src/telegram.ts` | **new** — config gating, pairing mint/consume, `/start`, webhook auth, audit→message mapping, delivery loop |
| `src/worker.ts` | webhook route, capability-gated Telegram routes, `telegram` in the state payload, post-commit dispatch |
| `src/pages.ts` | Setup-tab Telegram card + client wiring |
| `test/telegram-api.test.ts` | **new** — the Telegram suite |
| `test/migrations.test.ts` | expected-table list extended with the three new tables |

Schema notes:

- `telegram_connections` — `workspace_id`, `chat_id` **TEXT** (a 64-bit chat id must survive byte-exact;
  an INTEGER column or a `Number` round-trip loses precision), `chat_type`, `chat_title`, `enabled`,
  `last_audit_id` watermark, `last_error`. `UNIQUE(workspace_id, chat_id)` is the duplicate-link gate;
  `chat_id` alone is deliberately not unique, so one chat can follow several trips.
- `telegram_pairing_tokens` — `token_hash` only (SHA-256), `expires_at`, `consumed_at`, `consumed_chat_id`.
  Consumption is a guarded `UPDATE … WHERE token_hash = ? AND consumed_at IS NULL`; zero rows affected means
  already used or expired. Raw tokens are never stored, and no capability secret is ever placed in one.
- `telegram_notifications` — durable outbox with `UNIQUE(connection_id, event_key)`.
- The three tables deliberately carry **no audit triggers**: chat management is not a ledger event and the
  audit semantics the suite pins are unchanged.

## Required Worker config

Set as Worker secrets — never committed, never echoed. `tools/telegram-setup.sh` does all of it in one go:
it prompts for the bot token, generates the webhook secret itself, pipes both values straight into
Cloudflare, asks before running the deploy, then registers and verifies the webhook — printing names and
fingerprints, never values.
`DRY_RUN=1 bash tools/telegram-setup.sh` shows exactly what it would run. The manual equivalent:

```sh
printf '%s' '[REDACTED]' | npx wrangler secret put TELEGRAM_BOT_TOKEN        # from BotFather
printf '%s' '[REDACTED]' | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string
```

Both forms feed the value on stdin, so it never lands in shell history, a process list, or a transcript.

Optional vars (`wrangler.toml` `[vars]` or secrets):

| Var | Role |
|---|---|
| `TELEGRAM_BOT_USERNAME` | Overrides the bot name used in the deep link; otherwise resolved once via `getMe` and cached |
| `PUBLIC_ORIGIN` | The app root the `/start` button opens (defaults to the live worker origin). Never a `/w/<secret>` URL |
| `TELEGRAM_API_BASE` | Bot API base; https only in production (loopback is allowed so tests can point at a fake) |

`TELEGRAM_BOT_TOKEN` **and** `TELEGRAM_WEBHOOK_SECRET` must both be present or the whole feature is inert:
the card reports `configured:false` and every Telegram route answers "not configured". Nothing else in the
app depends on Telegram, so the feature can stay dark indefinitely without affecting the ledger.

## Telegram setup (manual, one-off)

**Order matters: secrets → `npx wrangler deploy` → webhook registration.** A webhook pointed at a Worker
that doesn't yet carry the secrets answers `401` on every delivery, and Telegram backs off.

`bash tools/telegram-setup.sh` does the whole ordered sequence in one command: it prompts for the bot token
(hidden), generates the webhook secret, pipes both into Cloudflare, asks before running
`npx wrangler deploy`, checks the route is live (`401`, not `404`), registers the webhook with that same
secret, and verifies it via `getWebhookInfo` — printing fingerprints and names, never values.
`--secrets-only` stops after the secrets, `--dry-run` prints the commands without running them, `--yes`
skips the confirmation. Steps 1–4 below are BotFather housekeeping; the manual sequence is spelled out too,
for when you'd rather do it by hand.

1. **Create the bot** — in BotFather: `/newbot`, pick a name and a username ending in `bot`. Copy the token
   into `TELEGRAM_BOT_TOKEN` (above) and never into a file in the repo.
2. **Describe it** — `/setdescription` and `/setabouttext` explaining it announces a shared trip's
   activity. No commands are registered: the only supported input is `/start`.
3. **Leave group privacy on** (BotFather `/setprivacy` → Enabled, the default). The bot only needs to see
   `/start`, so it should not be able to read group chatter. If it was ever disabled, re-enable it and
   remove/re-add the bot to each group for the change to take effect.
4. **Group use** — add the bot to the group, then have a group **administrator** send
   `/start <pairing_token>` inside the group. The bot needs permission to send messages there.
5. **Register the webhook** — one call, using the deployed origin, with the token and secret substituted:

   ```sh
   curl -sS -X POST "https://api.telegram.org/bot[REDACTED]/setWebhook" \
     -H 'content-type: application/json' \
     -d '{"url":"https://trip-finance-workspace.waiyanmt.workers.dev/api/telegram/webhook",
          "secret_token":"[REDACTED]",
          "allowed_updates":["message"],
          "drop_pending_updates":true}'
   ```

   `secret_token` must be exactly the `TELEGRAM_WEBHOOK_SECRET` value; Telegram echoes it in the
   `X-Telegram-Bot-Api-Secret-Token` header on every delivery and the worker compares it in constant time,
   answering `401` otherwise.

6. **Verify** — `curl -sS "https://api.telegram.org/bot[REDACTED]/getWebhookInfo"` should report the URL
   above, `pending_update_count: 0` and no `last_error_message`.
7. **Disable again** — `curl -sS -X POST "https://api.telegram.org/bot[REDACTED]/deleteWebhook"`; the
   feature goes quiet while the secrets stay set.

## Applying the schema

Apply `migrations/0015_telegram_notifications.sql` to the remote D1 **before** deploying code that reads it.
`wrangler d1 migrations apply --remote` cannot be trusted on this database (`d1_migrations` is empty, so it
replays from `0001` and aborts on `table workspaces already exists`). Use an additive statement directly,
then record the filename so a later `apply` no-ops:

```sh
npx wrangler d1 execute DB --remote --file=migrations/0015_telegram_notifications.sql
npx wrangler d1 execute DB --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0015_telegram_notifications.sql');"
npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'telegram%';"
```

## Tests

`test/telegram-api.test.ts` boots the normal local harness (wrangler dev + a fresh D1 built from
`migrations/*.sql`) and injects the feature's config on the spawn args — the harness only sees
`wrangler.toml`'s vars, so a config-gated feature is inert in tests without this:

```
--var TELEGRAM_BOT_TOKEN:123456:TEST --var TELEGRAM_WEBHOOK_SECRET:test-secret
--var TELEGRAM_API_BASE:http://127.0.0.1:<fake-port> --var PUBLIC_ORIGIN:http://127.0.0.1:8987
```

A fake Bot API (`node:http`) on loopback records every `sendMessage`/`getChatMember` call, so no real
Telegram request is ever made and no real token is ever needed. Scenarios share one booted harness, so each
mints its own throwaway workspace.

Covered, all required by the spec:

1. a pairing token is single use, expires after ten minutes, and is stored only as a hash (replay refused,
   no raw token anywhere in D1);
2. a successful link, a repeat connect that is not a duplicate, one chat following a second workspace, and
   per-workspace isolation on `PATCH`/`DELETE` (another workspace's connection id answers `404`);
3. invalid webhook authentication (`401` with no header and with a wrong secret) and the group-administrator
   rule (a plain member is refused, an administrator succeeds, a refusal does not burn the token);
4. announcements after committed writes; **silence** for preview-only and refused writes; a rewound-watermark
   replay that re-sends nothing and queues nothing, while a genuinely new event is still announced exactly
   once; disconnect stops delivery;
5. no capability secret on any Telegram surface — no `/w/`, no secret in any message, response body or
   audit row — and chat management that leaves the immutable audit trail untouched.

Results:

- `npx tsx --test test/telegram-api.test.ts` → **exit 0, 5/5 blocks** (`/opt/data/scratch/telegram-focused-2.log`).
- `npm test` (whole suite, own log, frozen tree) → **`EXIT=0`, 45 passed, 0 failed, 0 skipped**
  (`/opt/data/scratch/suite-telegram-v1.log`).
- `npx tsc --noEmit` → exit 0.

Three failures on the first full run were all in the test harness, not the app, and each one is worth
knowing about because it is a way a Telegram test can lie:

- A group-administrator case sent its update with a *private*-shaped chat object carrying a group id, so
  the private branch linked it and the admin rule was never exercised. Send a real `type:'group'` chat.
- The dedupe case rewound the watermark to `0` and asserted no resend. That is not a retry: the dispatcher
  re-read the whole history in one pass and re-clustered rows that had previously been announced in
  separate batches, so a *legitimately new* message appeared. A retry re-reads the same window, so the test
  rewinds to the watermark that stood before one write and triggers the dispatch with a preview request
  (which writes no audit rows), then asserts the queue and the message count are unchanged **and** that the
  watermark advanced — that last assertion is what stops the test passing vacuously if the dispatcher never
  ran. A further write then proves dedupe still lets a new event through exactly once.
- The leak sweep only looked at messages sent inside its own block and so never saw the `/start` welcome,
  which is precisely the message carrying the button URL. Send a bare `/start` first.

## Deployment status

**Not deployed.** Per the spec, deployment waits for the Telegram secrets to be available and for explicit
authorization; no secret has been set, no webhook has been registered and no `wrangler deploy` has been run
for this feature. The code is inert in production until both secrets exist.
