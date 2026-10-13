# Telegram Debt Summary Image Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let a connected Telegram chat tap one Summary button and receive one current PNG listing every directed outstanding debt in its linked workspace.

**Architecture:** Extend the existing `/start` inline menu with a callback action that is bound to an enabled `telegram_connections` row. The webhook verifies the callback and builds its current rows directly from active transactions. A dependency-free bitmap renderer encodes a compact PNG in memory; the existing Bot API client posts it via multipart `sendPhoto` to the same chat.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, Telegram Bot API, Node test fake.

---

### Task 1: Capture Telegram photo and callback behaviour in the fake Bot API

**Objective:** Make the focused Telegram harness able to assert real multipart photo calls and callback acknowledgements.

**Files:**
- Modify: `test/telegram-api.test.ts:22-101`
- Test: `test/telegram-api.test.ts`

**Step 1: Write failing tests**

Add cases that send a `/start`, read the `📊 Send debt summary` callback payload from `reply_markup`, submit a matching `callback_query`, then assert:

```ts
assert.equal(harness.bot.photos.length, 1);
assert.equal(harness.bot.photos[0].chat_id, '101');
assert.deepEqual(harness.bot.photos[0].bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(harness.bot.callbackAnswers.length, 1);
```

Seed reciprocal USD rows and an MYR row; assert rendered text data is not a second calculation source by checking only the image transport and one-current-image behaviour.

**Step 2: Run focused test to verify failure**

Run:

```bash
python3 - <<'PY'
import socket
s=socket.socket(); s.bind(('127.0.0.1',8987)); s.close()
print('port 8987 bindable')
PY
npx tsx --test --test-name-pattern='sends a current debt summary image' test/telegram-api.test.ts
```

Expected: fail because no summary button/callback/photo exists.

**Step 3: Extend FakeBot minimally**

Parse JSON as today for normal calls and retain raw multipart bytes for `sendPhoto`; record `chat_id` from multipart fields. Record `answerCallbackQuery` calls. Keep all pre-existing `sendMessage` tests unchanged.

**Step 4: Run focused test to verify the harness is ready**

Run the same command. Expected: fail only at the absent feature assertion.

**Step 5: Commit**

```bash
git add test/telegram-api.test.ts
git commit -m "test: capture Telegram debt summary photos"
```

### Task 2: Add safe callback action plumbing and the Summary menu button

**Objective:** Give each connected menu entry an opaque callback tied to its connection and route authenticated callback updates without adding any ledger write path.

**Files:**
- Modify: `src/telegram.ts:140-143,344-348,560-630,789-833`
- Test: `test/telegram-api.test.ts`

**Step 1: Write failing coverage**

Add assertions that `/start` has one full-width `📊 Send debt summary` inline row per linked trip, that its payload contains no `/w/` or workspace secret, and that callbacks for a disabled/mismatched chat produce no photo.

**Step 2: Implement minimal safe routing**

- Extend `TelegramUpdate` with `callback_query` fields needed to bind a chat and callback id.
- Use an HMAC-like short-lived hash derived from an opaque random token stored only in an in-memory mapping is **not acceptable** because isolates are not durable. Instead use a compact signed callback value containing the connection id and an expiry, authenticated with the webhook secret; validate format, signature, expiry, enabled connection, and chat id before reading D1.
- Add `answerCallbackQuery` for the Telegram tap acknowledgement.
- Extend the existing `sendStartMenu` final row with `callback_data`; retain existing URL navigation rows unmodified.

**Step 3: Run the focused callback tests**

```bash
npx tsx --test --test-name-pattern='debt summary|summary callback|start menu' test/telegram-api.test.ts
```

Expected: pass; existing navigation callbacks remain URLs.

**Step 4: Commit**

```bash
git add src/telegram.ts test/telegram-api.test.ts
git commit -m "feat: add Telegram debt summary action"
```

### Task 3: Compute directed debts and encode one PNG

**Objective:** Turn active ledger records into a readable, deterministic in-memory PNG with no external service or stored artifact.

**Files:**
- Create: `src/telegram-summary-image.ts`
- Modify: `src/telegram.ts`
- Test: `test/telegram-api.test.ts`

**Step 1: Write failing unit-level assertions through webhook coverage**

Seed debt rows for `Ada → Lin USD`, `Ada → May USD`, `Lin → Ada USD` and `Lin → May MYR`; verify the bot receives exactly one PNG for the invoking chat and an all-settled workspace also receives exactly one valid PNG.

**Step 2: Implement the isolated renderer**

Export a renderer taking `{ workspaceName, generatedAt, lines }` and returning `Uint8Array` PNG bytes. It must:

- aggregate active records by `(debtor, creditor, currency)`;
- cancel only reciprocal directions in the same currency;
- exclude zero/negative remainders;
- sort by debtor label, creditor label, then currency;
- use a fixed bitmap font, row cap, readable `+N more` footer, and `All settled` empty state;
- write PNG signature, IHDR, IDAT (stored deflate blocks or Worker-supported compression), and IEND with valid CRC-32;
- never embed capability strings, transaction notes, or raw database ids.

**Step 3: Send the image**

Add `sendPhoto` using `FormData` and a `Blob` with MIME `image/png`. Caption starts with `📊` and names the trip; callback errors use the existing emoji-led response convention.

**Step 4: Verify feature and typecheck**

```bash
npx tsc --noEmit
npx tsx --test --test-name-pattern='sends a current debt summary image|all-settled summary' test/telegram-api.test.ts
```

Expected: typecheck succeeds; each test sends exactly one valid PNG, to the caller’s chat.

**Step 5: Commit**

```bash
git add src/telegram-summary-image.ts src/telegram.ts test/telegram-api.test.ts
git commit -m "feat: send Telegram debt summary image"
```

### Task 4: Integration regression and deploy verification

**Objective:** Prove the feature does not change existing Telegram messaging and ship only a confirmed build.

**Files:**
- Modify if necessary: `test/telegram-api.test.ts`

**Step 1: Run Telegram and type checks**

```bash
npx tsc --noEmit
npx tsx --test test/telegram-api.test.ts
```

Expected: all Telegram API tests pass.

**Step 2: Deploy with an explicit ship assertion**

```bash
npx wrangler deploy
```

Expected: output contains `Deployed` and does not contain `Build failed`.

**Step 3: Read back deployed assets**

Probe the public root for HTTP 200 and verify the deployed Worker responds `401` to an unauthenticated Telegram webhook. Do not send an update to a real chat during verification.

**Step 4: Commit any final test-only changes**

```bash
git add test/telegram-api.test.ts
git commit -m "test: verify Telegram debt summary delivery"
```
