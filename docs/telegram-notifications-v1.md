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
- **Wording names the entities, in the active voice** (see *Wording: who did what to whom* below):
  "🧾 Lin owes Ada USD 42.50 · Night market", never "A transaction was recorded". (This supersedes the original
  V1 line that asked for anonymous, passive wording.)
- One sentence per change for settings (`⚙️ The trip's setup was changed`, `🙋 Ada joined the trip`), never a
  key/value dump.
- **Backup and receipt housekeeping stay silent** rather than inventing a line for housekeeping events.
- Delivery dedupe lives in the database: `UNIQUE(connection_id, event_key)` plus `INSERT OR IGNORE`, and the
  watermark is advanced in the same D1 batch, so a replayed window cannot repeat or lose an event. A chat
  Telegram reports as blocked/unreachable is disabled instead of being retried forever.
- Money is grouped per currency and never summed across currencies; the message never contains an
  exchange rate or a cross-currency total.

## Wording: who did what to whom

Every line is built out of the audited row itself — the debtor, the creditor and the amount that row already
carries — resolved against the trip's member list for the name and avatar the trip shows them under. Nothing
is inferred and no actor is invented: `audit_log.actor_label` is `shared workspace editor` for everyone, so a
sentence naming an "editor" would be a lie.

| What happened | What the chat reads |
|---|---|
| a debt was recorded | `🧾 Lin owes Ada USD 42.50 · Night market` |
| a repayment was recorded | `💸 Lin paid Ada USD 25.00 · Settling up` |
| a row was edited | `✏️ Edited — Lin owes Ada USD 50.00 · Night market snacks` |
| archived or deleted | `🗄️ Removed — Lin owes Ada USD 50.00 · Night market snacks` |
| restored | `♻️ Restored — Lin owes Ada USD 50.00 · Night market snacks` |
| a bill was split | `🧾 Ada split a bill · Dinner`, then one `owes` line per participant |
| spreadsheet import | `📥 4 entries imported from a spreadsheet`, then the `owes` lines |
| a batch commit | `🧾 3 entries added in one batch · Hotel`, then the `owes` lines |
| two people settled up | `🔁 Lin and Ada settled up · 2 rows` |
| reciprocal balances netted | `🔁 Lin and Ada netted their reciprocal balances · 2 rows` |
| a member joined / left | `🙋 🦊 Ada joined the trip` / `👋 Ada left the trip` |
| the trip was renamed | `🧳 Trip renamed to “Tet lunch”` |

Every alert opens with `🧳 Trip Finance — <trip name>` and closes with a `🕒 <date, time>` stamp, so a
message read away from its chat still says which trip it is about and when it happened. A line that
stands alone — a single entry, the header, the stamp — leads with its own emoji; the rows inside a
grouped message do not repeat one, because the headline has already said what happened and what kind
of rows these are.

- Grouped messages list up to `MAX_PAIR_LINES = 6` entity pairs, then `+N more entries` and the per-currency
  totals of the debts (payments are excluded from that total — they move the other way).
- A split credits one person on every row, so the payer is read off the rows' creditor and named once in the
  headline instead of repeated on every line.
- Netting is the one case with no pair lines: its rows carry signed amounts nobody typed, so the headline
  names the two people and the amount is left out rather than dressed up as arithmetic.
- A member archived later still resolves by name, because the rows being announced are older than the
  archive. A person id that resolves to nothing reads `Someone`, never a bare number.

## The `/start` menu: a navigation grid

A chat that is already connected to a trip gets a **grid of buttons instead of a single link**. The two
columns are the app's own everyday surfaces, in the app's own sidebar order, two to a row — creating
first, then reading. **Audit and Setup are deliberately not in the menu**: they are workshop pages the
chat has no use for, reachable from the app's own drawer.

```
➕ Add expense    ↩️ Record a payment
✂️ Split a bill   📒 Transactions
⚖️ Balances
```

- A chat that follows **nothing** still gets the plain welcome and its single public-root button; the grid
  appears only once a trip is connected, and the chat's own `/start <pairing_token>` answer now ends with it.
- A chat that follows **several** trips gets four rows per trip, each label suffixed with the trip's name
  (`📒 Transactions · Japan 2028`), capped at `MAX_MENU_TRIPS = 3` — the rest are reachable from the app root.
- Groups get the same grid, from the addressed command Telegram actually delivers in a group
  (`/start@tripfinancethingbot`). **Any member** of a connected group can open the menu — the grid is a way
  into the trip the chat already reads, while *linking* a group stays administrator-only.

### Why the buttons are `/go/…` and not the trip link

The capability secret is stored only as a SHA-256 hash, so a link to the trip **cannot be rebuilt from the
database** — and the spec forbids putting the secret or a capability URL in a Telegram message anyway. Each
trip's buttons therefore carry a pass of their own:

| | |
|---|---|
| Button URL | `https://<origin>/go/<token>/<section>` — the public origin, never `/w/…` |
| Storage | `telegram_nav_links.token_hash`, SHA-256 only; the raw pass is never written anywhere |
| Bound to | one `telegram_connections` row, so a pass only opens the trip that chat is connected to |
| Lifetime | `NAV_TTL_MS = 24 h`, **one live pass per connected trip**: minting a fresh menu retires the previous one, so an older message's buttons stop working once a new menu is sent |
| Request path | `/go/<token>/<section>` → `302` → `/w/<token>#<section>` |
| How that works | `resolveWorkspace()` accepts a live pass exactly as it accepts the trip's own link, so the page, the API and post-commit notification dispatch all behave identically |
| Dead pass | `404` (unknown or the trip is gone) / `410` (expired, or the chat was disconnected) with an HTML page that says to send `/start` again |
| Unknown section | refused (`404`) rather than reflected into the redirect |
| Disconnect | deletes that connection's passes with the connection |
| Headers | `cache-control: no-store`, `referrer-policy: no-referrer`, `x-robots-tag: noindex` |

`uses` counts taps, and only the tap that lands is counted — the API calls the page then makes do not each
spend one. Nothing about the pass is announced in the chat, and no message the bot sends contains `/w/`, a
capability secret, or a stable link to a trip.

## Commands

Telegram only delivers a group command when it is addressed to the bot (`/start@tripfinancethingbot`),
so every command is matched with or without the `@username` suffix; private chats use the plain form.

| Command | Who may send it | What it does |
|---|---|---|
| `/start` | anyone | Unconnected chat: the welcome and the public app root. Connected chat: the navigation grid below. With a pairing token: connects the chat — a group only if an administrator sends it. |
| `/disconnect` | private chat: anyone; group: an administrator | Unlinks the chat from **every** trip it follows, and deletes those connections' menu passes in the same batch, so the buttons in older messages stop working the moment the notifications do. |

Both commands answer in text only: neither can read, let alone write, the ledger, and neither is a way
into a trip beyond the expiring menu passes described below.

### Registering the commands

`BOT_COMMANDS` in `src/telegram.ts` is the single source of truth for the menu Telegram shows inside a
chat. `syncBotCommands()` publishes it with `setMyCommands` — idempotent, because that call replaces the
list rather than adding to it — and the webhook publishes it once per isolate on the first authenticated
update, so a deploy can never leave the menu offering a command the code no longer answers.
`tools/telegram-setup.sh` publishes the same list explicitly and prints what `getMyCommands` reads back.

## Migration and files

| Path | Change |
|---|---|
| `migrations/0015_telegram_notifications.sql` | **new** — `telegram_connections`, `telegram_pairing_tokens`, `telegram_notifications` |
| `migrations/0016_telegram_nav_links.sql` | **new** — `telegram_nav_links`: the expiring passes behind the `/start` menu buttons |
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
- `telegram_nav_links` — `connection_id`, `token_hash` only, `uses`, `expires_at`. Nothing here is a
  capability secret: the pass is a credential of its own that happens to fit a `/w/` path segment, and it is
  deleted with its connection.
- These tables deliberately carry **no audit triggers**: chat management is not a ledger event and the
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

**Live.** Deployed 2026-10-13 as version `25b27774-25ae-4c40-a05b-b23141a968e1` (Cloudflare stamps it
`2026-10-12T19:09:55Z`, i.e. 02:09 Bangkok — the listings are UTC, which is why the date appears to differ);
`wrangler deployments list` shows it as the current 100% version, directly after the two secret-change
versions. The app root answers `200` and the bot is **@tripfinancethingbot**.

- Migration `0015` applied to the remote D1 first (`npx wrangler d1 execute DB --remote --file …`, exit 0)
  and recorded in `d1_migrations`. It is additive and fully `IF NOT EXISTS`, and the change was checked to
  touch nothing else: `transactions` 356, `audit_log` 747, `workspaces` 44 (3 active) before and after, and
  the live app answered `200` throughout. Remote DDL shows `telegram_connections.chat_id TEXT` and
  `telegram_pairing_tokens.token_hash TEXT NOT NULL UNIQUE` — hashes only, as designed. Applying it before
  the deploy is deliberate: the code reads these tables, so the schema has to exist first.
- Worker secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are set. Only the names are recorded
  anywhere; no value is written to this repo, printed by the setup script, or stored in D1.
- Webhook registered at `…/api/telegram/webhook` with `secret_token` and `allowed_updates: ["message"]`.
  `getWebhookInfo` reports the URL set, `pending_update_count` 0 and no `last_error`, and the route answers
  `401` to both an unsigned and a wrongly-signed POST.
- **The Worker's secret and the registered secret are provably the same value.** A registered webhook whose
  secret the Worker doesn't hold fails **silently** — every delivery is answered `401`, Telegram backs off and
  the only symptom is notifications that never arrive — so the two were minted in one shell and the equality
  was then demonstrated: a POST signed with that value returns `200 {"ok":true}` (an update with no `message`,
  so nothing is sent), the same POST with a wrong value returns `401`, and `setWebhook` for that value
  reported `ok=True`. Re-check this the same way after any secret rotation.
- Bot facts from `getMe`: **@tripfinancethingbot** (`TripFinance`, id 8797469683), `can_join_groups: true`,
  `can_read_all_group_messages: false` — i.e. BotFather's privacy mode is on, which is the right default
  here: the bot only needs `/start`, and commands reach it in groups regardless of privacy mode, so it never
  sees unrelated group chatter.
- Live checks on throwaway workspaces (created, probed, purged in the same run): the Settings-card endpoint
  returned `configured: true` with the bot's username and an empty connection list, leaking no capability
  secret; a connect link was minted (`201`, `https://t.me/tripfinancethingbot?start=<43 chars>`, TTL 600 s,
  command `/start <token>`); D1 held exactly one row whose `token_hash` equals `sha256(token)`, unconsumed and
  expiring ~10 minutes out; neither the raw token nor the capability secret appeared in the link or in D1;
  deleting a foreign connection id returned `404`. Every probe was purged — no Telegram rows remain, three
  workspaces are active, Demo `3` untouched.
- **Not exercised end to end:** anything needing a real Telegram account — a `/start` from a private chat or
  a group, and so the delivery of a live notification. That is the human step: a workspace's Settings →
  *Connect Telegram Chat* → send the prefilled `/start`.

**Rotating the bot token later:** `bash tools/telegram-setup.sh` re-sets both secrets (it generates a fresh
webhook secret), deploys, and re-registers the webhook, in the one order that works. Don't split it across
runs: the generated secret is stored nowhere, so a secrets-only run leaves the webhook unregisterable with
the same value.

**Bookkeeping gap to know about:** `d1_migrations` lists `0001`–`0011` and `0015`, but `0012`, `0013` and
`0014` are missing even though their objects are live (`receipts`, `receipt_attachments`,
`receipts.transaction_id` all exist). Because of that, `npx wrangler d1 migrations apply --remote` would
try to replay from `0001` and abort — apply migrations by hand with `d1 execute --remote` and record the
name, which is how `0015` was applied. The three unrecorded receipts migrations were left exactly as found
rather than back-filled on inference.

## Delivery: what is guaranteed, and where the edges are

Proven by the last block of `test/telegram-api.test.ts` ("one workspace fans out to every linked chat, and
one unreachable chat never costs the others a message"), which links two private chats and one group to a
single workspace, breaks one chat on purpose, and drives the dispatch by hand.

**Guaranteed**

- **Fan-out.** A workspace holds one row per `(workspace_id, chat_id)` and can hold any number of them. One
  committed write produces exactly one outbox row per *enabled* chat, and every chat receives the same words.
- **Exactly once.** `UNIQUE(connection_id, event_key)` makes each (chat, event) pair unique in the database,
  so a replayed or concurrent dispatch can neither queue nor send it twice — asserted for a whole run, where
  no chat received the same message twice.
- **Isolation.** A failing chat never affects another: the flush walks the queue, and only a `429` stops it
  (deliberately, to respect the rate limit — those rows flush on the next chance). A chat answering `5xx`
  stays enabled with its message parked as `pending` while the healthy chats are still served.
- **Order.** The queue drains oldest-first per chat, so a recovering chat receives what it missed in the
  order it was recorded, before the newer event that triggered the flush.
- **Retry chances.** Every committed audited write *and* every incoming Telegram update is a chance to drain
  the queue (the dispatcher runs in `ctx.waitUntil` after the response, so the ledger never waits on
  Telegram).
- **No history dump.** Linking a chat sets its watermark to `MAX(audit_log.id)` in the same `INSERT`, so a
  newly linked chat hears only what happens next.

**Not guaranteed — the edges worth knowing**

- **Twelve chances, then it is dropped.** A retryable failure (`5xx`, timeout, `429`) keeps the message
  queued across `MAX_ATTEMPTS = 12` dispatch chances; past that the row is marked `failed` and abandoned,
  with `Undelivered message: …` written to the *connection* so the Setup tab shows it. Nothing revives an
  abandoned message automatically. Note that a `429` spends one of those chances like any other failure — a
  large backlog draining into a rate-limited group chat can burn a few — so treat 12 as the tolerance for a
  long outage, not as an infinite queue.
- **Nothing retries while the workspace is idle.** V1 has no scheduled sweep, so a message parked during an
  outage waits for the next write in that workspace or the next incoming update. Not lost — just not prompt.
- **A crash between the Bot API send and the outbox update can duplicate.** Sending and marking `sent` are not
  atomic with Telegram, so a Worker failure inside that window re-sends on the next dispatch. Rare, and it
  errs towards delivering.
- **A blocked bot is switched off after one attempt** (`403`/`400`/`404`): messages queued for that chat are
  marked failed, and the chat hears nothing until it is unblocked and reconnected.
- **A chat reconnected after a long silence may receive a catch-up** of what it missed while it was off,
  bounded to the last `AUDIT_WINDOW_LIMIT = 200` audited rows and clustered into messages by two-second gaps.


