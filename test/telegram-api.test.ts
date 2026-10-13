import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
// Read the directory instead of pinning names: a hardcoded list has silently skipped migrations twice.
const migrations = readdirSync(join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort();

const PORT = 8987;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// A token carries a colon, like BotFather's, so the local harness and the URL builder are exercised
// with the real shape rather than a convenient slug.
const BOT_TOKEN = '7000000001:AAHfake-token-for-the-test-double';
const WEBHOOK_SECRET = 'fake-webhook-secret-0123456789abcdef';
const BOT_USERNAME = 'trip_finance_test_bot';

type BotCall = { method: string; token: string; payload: Record<string, unknown> };
type BotPhoto = { chat_id: string; bytes: number[]; caption?: string };
type CallbackAnswer = { callback_query_id: string; text?: string };

/**
 * Decode only the small FormData fixture produced in this test file. This is deliberately not a
 * general multipart parser: production only needs the fake Bot API to inspect its own generated
 * test requests, not to accept arbitrary client uploads.
 */
function generatedFormDataFixture(bytes: Buffer, contentType: string): { fields: Record<string, string>; photo: number[] } {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return { fields: {}, photo: [] };
  const fields: Record<string, string> = {};
  let photo: number[] = [];
  for (const part of bytes.toString('latin1').split(`--${boundary}`)) {
    const divider = part.indexOf('\r\n\r\n');
    const name = part.slice(0, divider).match(/name="([^"]+)"/i)?.[1];
    if (divider < 0 || !name) continue;
    const value = part.slice(divider + 4).replace(/\r\n$/, '');
    if (name === 'photo') photo = [...Buffer.from(value, 'latin1')];
    else fields[name] = Buffer.from(value, 'latin1').toString('utf8');
  }
  return { fields, photo };
}

/** A minimal Bot API double: records every call and lets a test choose how the next send behaves. */
class FakeBot {
  readonly calls: BotCall[] = [];
  readonly messages: { chat_id: string; text: string; reply_markup?: unknown }[] = [];
  readonly photos: BotPhoto[] = [];
  readonly callbackAnswers: CallbackAnswer[] = [];
  readonly statuses = new Map<string, string>();
  mode: { error_code: number; description: string } | null = null;
  /** Failures aimed at one chat only, so a test can break a single connection while the rest stay healthy. */
  readonly failFor = new Map<string, { error_code: number; description: string }>();
  private server?: Server;
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); });
      incoming.on('end', () => {
        const path = incoming.url ?? '';
        const match = path.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
        if (!match) {
          outgoing.writeHead(404, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' }));
          return;
        }
        const [, token, method] = match;
        const bytes = Buffer.concat(chunks);
        const contentType = String(incoming.headers['content-type'] ?? '');
        let payload: Record<string, unknown> = {};
        let photo: number[] = [];
        if (contentType.startsWith('multipart/form-data')) {
          const multipart = generatedFormDataFixture(bytes, contentType);
          payload = multipart.fields;
          photo = multipart.photo;
        } else {
          try { payload = JSON.parse(bytes.toString('utf8') || '{}') as Record<string, unknown>; } catch { payload = {}; }
        }
        this.calls.push({ method, token, payload });
        const reply = (data: unknown, status = 200) => {
          outgoing.writeHead(status, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify(data));
        };
        if (method === 'getMe') {
          reply({ ok: true, result: { id: 7000000001, is_bot: true, first_name: 'Trip Finance', username: BOT_USERNAME } });
          return;
        }
        if (method === 'getChatMember') {
          const chatId = String(payload.chat_id ?? '');
          reply({ ok: true, result: { status: this.statuses.get(chatId) ?? 'member' } });
          return;
        }
        if (method === 'sendMessage') {
          const aimed = this.failFor.get(String(payload.chat_id ?? ''));
          const mode = aimed ?? this.mode;
          if (mode) {
            reply({ ok: false, error_code: mode.error_code, description: mode.description });
            return;
          }
          this.messages.push({
            chat_id: String(payload.chat_id ?? ''),
            text: String(payload.text ?? ''),
            reply_markup: payload.reply_markup,
          });
          reply({ ok: true, result: { message_id: this.messages.length } });
          return;
        }
        if (method === 'sendPhoto') {
          this.photos.push({ chat_id: String(payload.chat_id ?? ''), bytes: photo, caption: typeof payload.caption === 'string' ? payload.caption : undefined });
          reply({ ok: true, result: { message_id: this.photos.length } });
          return;
        }
        if (method === 'answerCallbackQuery') {
          this.callbackAnswers.push({ callback_query_id: String(payload.callback_query_id ?? ''), text: typeof payload.text === 'string' ? payload.text : undefined });
          reply({ ok: true, result: true });
          return;
        }
        reply({ ok: false, error_code: 404, description: 'Not Found' });
      });
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  sentMatching(needle: string): { chat_id: string; text: string }[] {
    return this.messages.filter((message) => message.text.includes(needle));
  }

  lastText(): string {
    return this.messages.length ? this.messages[this.messages.length - 1].text : '';
  }
}

test('FakeBot captures multipart photos and callback acknowledgements', async () => {
  const bot = new FakeBot();
  await bot.start();
  try {
    const form = new FormData();
    form.set('chat_id', '101');
    form.set('caption', '📊 Summary trip — 2 outstanding lines across 2 currencies');
    form.set('photo', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'summary.png');
    const photo = await fetch(`http://127.0.0.1:${bot.port}/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
    assert.equal(photo.status, 200);
    assert.deepEqual(bot.photos, [{
      chat_id: '101',
      caption: '📊 Summary trip — 2 outstanding lines across 2 currencies',
      bytes: [137, 80, 78, 71, 13, 10, 26, 10],
    }]);

    const callback = await fetch(`http://127.0.0.1:${bot.port}/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback_query_id: 'callback-101' }),
    });
    assert.equal(callback.status, 200);
    assert.deepEqual(bot.callbackAnswers, [{ callback_query_id: 'callback-101', text: undefined }]);
  } finally {
    await bot.stop();
  }
});

type Harness = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  query: (sql: string) => Record<string, unknown>[];
  bot: FakeBot;
};

async function withTelegramApi(run: (harness: Harness) => Promise<void>): Promise<void> {
  const persistTo = mkdtempSync(join(tmpdir(), 'trip-finance-telegram-'));
  const args = (extra: string[]) => ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', persistTo, '--json', ...extra];
  const execute = (extra: string[]) => JSON.parse(execFileSync('npx', args(extra), { cwd: root, encoding: 'utf8' }));
  const query = (sql: string) => execute(['--command', sql])[0].results as Record<string, unknown>[];
  const bot = new FakeBot();
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await bot.start();
    for (const migration of migrations) execute(['--file', `migrations/${migration}`]);
    server = spawn('npx', [
      'wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persistTo,
      '--var', `TELEGRAM_BOT_TOKEN:${BOT_TOKEN}`,
      '--var', `TELEGRAM_WEBHOOK_SECRET:${WEBHOOK_SECRET}`,
      '--var', `TELEGRAM_BOT_USERNAME:${BOT_USERNAME}`,
      '--var', `TELEGRAM_API_BASE:http://127.0.0.1:${bot.port}`,
      '--var', `PUBLIC_ORIGIN:${ORIGIN}`,
    ], { cwd: root, stdio: 'ignore', detached: true });
    const request = (path: string, init: RequestInit = {}) => fetch(`${ORIGIN}${path}`, { ...init, headers: { connection: 'close', ...(init.headers ?? {}) } });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try { if ((await request('/')).ok) { ready = true; break; } } catch { /* worker is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'local Worker should start');
    await run({ request, query, bot });
  } finally {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
      await Promise.race([
        new Promise<void>((resolve) => server!.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    await bot.stop();
    rmSync(persistTo, { recursive: true, force: true });
  }
}

async function createWorkspace(request: Harness['request'], name: string): Promise<string> {
  const response = await request('/api/workspaces', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, people: ['Ada', 'Lin'], currencies: [{ code: 'USD', is_default: true }, { code: 'THB', is_default: false }] }),
  });
  assert.equal(response.status, 201);
  const created = await response.json() as { workspace_url: string };
  return created.workspace_url.slice(3);
}

async function mintPairing(request: Harness['request'], secret: string): Promise<{ token: string; command: string; group_command: string | null; url: string | null }> {
  const response = await request(`/w/${secret}/api/telegram/pair`, { method: 'POST' });
  assert.equal(response.status, 201);
  const body = await response.json() as { pairing: { token: string; command: string; group_command: string | null; url: string | null; expires_in_seconds: number } };
  assert.equal(body.pairing.expires_in_seconds, 600);
  assert.equal(body.pairing.command, `/start ${body.pairing.token}`);
  assert.equal(body.pairing.group_command, `/start@${BOT_USERNAME} ${body.pairing.token}`, 'a group needs the command to name the bot');
  return body.pairing;
}

type UpdateInit = { chat: { id: number; type: string; title?: string; first_name?: string }; from?: { id: number; first_name?: string }; text: string };

async function sendUpdate(harness: Harness, update: UpdateInit, secretHeader: string | null = WEBHOOK_SECRET): Promise<Response> {
  const message: Record<string, unknown> = { message_id: Math.floor(Math.random() * 1000), chat: update.chat, text: update.text };
  if (update.from) message.from = update.from;
  return harness.request('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secretHeader === null ? {} : { 'x-telegram-bot-api-secret-token': secretHeader }) },
    body: JSON.stringify({ update_id: Math.floor(Math.random() * 1_000_000), message }),
  });
}

async function sendCallbackQuery(harness: Harness, chat: UpdateInit['chat'], data: string, callbackId: string, from = { id: 4242, first_name: 'Willow' }): Promise<{ response: Response; callbackId: string }> {
  const response = await harness.request('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: Math.floor(Math.random() * 1_000_000),
      callback_query: { id: callbackId, from, message: { message_id: Math.floor(Math.random() * 1000), chat }, data },
    }),
  });
  return { response, callbackId };
}

const PRIVATE_CHAT = (id: number, name = 'Willow') => ({ id, type: 'private', first_name: name });
const GROUP_CHAT = (id: number, title = 'Chiang Mai trip') => ({ id, type: 'group', title });

/** POST /start <token> into a private chat and return the answer Telegram received back. */
async function startInPrivate(harness: Harness, token: string, chatId: number): Promise<string> {
  const before = harness.bot.messages.length;
  const response = await sendUpdate(harness, { chat: PRIVATE_CHAT(chatId), text: `/start ${token}` });
  assert.equal(response.status, 200);
  await waitFor(() => harness.bot.messages.length > before, 'a pairing answer should come back');
  // The first new message is the answer to the command; a successful connect then also sends a menu,
  // so reading the newest message would return the grid instead of the confirmation.
  return harness.bot.messages[before].text;
}

/** POST a pairing command from inside a group or channel, where the sender decides eligibility. */
async function startIn(harness: Harness, chat: UpdateInit['chat'], from: { id: number; first_name?: string }, token: string, text = `/start ${token}`): Promise<string> {
  const before = harness.bot.messages.length;
  const response = await sendUpdate(harness, { chat, from, text });
  assert.equal(response.status, 200);
  await waitFor(() => harness.bot.messages.length > before, 'a pairing answer should come back');
  return harness.bot.messages[before].text;
}

async function waitFor(predicate: () => boolean, message: string, timeout = 8_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(predicate(), message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Builds an expired opaque summary token with the test webhook secret, matching the public callback protocol. */
function expiredSummaryCallback(connectionId: number): string {
  const key = createHash('sha256').update(WEBHOOK_SECRET, 'utf8').digest();
  const nonce = Buffer.alloc(12, 7);
  const plain = Buffer.alloc(8);
  plain.writeUInt32BE(connectionId, 0);
  plain.writeUInt32BE(Math.floor(Date.now() / 1000) - 1, 4);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('trip-finance-summary-v1', 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return `ds2.${Buffer.concat([nonce, ciphertext]).toString('base64url')}`;
}

/** The chat a connection row points at: chat ids are 64-bit, so they are stored and read as text. */
function connectionRows(query: Harness['query'], workspaceId: number): { id: number; chat_id: string; chat_type: string; enabled: number }[] {
  return query(`SELECT id, chat_id, chat_type, enabled FROM telegram_connections WHERE workspace_id = ${workspaceId} ORDER BY id`) as { id: number; chat_id: string; chat_type: string; enabled: number }[];
}

test('pairing tokens are single use, expire after ten minutes, and never land in storage raw', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Pairing trip');
    const workspaceId = Number(query('SELECT id FROM workspaces')[0].id);

    // /start with no payload: a welcome whose button opens the public app root, never a workspace link.
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(555), text: '/start' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a welcome should be sent');
    const welcome = bot.messages[0];
    const markup = welcome.reply_markup as { inline_keyboard: { text: string; url: string }[][] };
    assert.equal(markup.inline_keyboard[0][0].text, 'Open Trip Finance Workspace');
    assert.equal(markup.inline_keyboard[0][0].url, ORIGIN);
    assert.ok(!welcome.text.includes('/w/'));
    assert.equal(connectionRows(query, workspaceId).length, 0);

    // The first authenticated update of a deployment also publishes the bot's command menu, so the chat
    // offers exactly the commands the code answers — and nothing that would do nothing.
    const published = bot.calls.find((call) => call.method === 'setMyCommands');
    assert.ok(published, 'the command menu should be published on the first update');
    const commands = (published.payload as unknown as { commands: { command: string; description: string }[] }).commands ?? [];
    assert.deepEqual(commands.map((entry) => entry.command), ['start', 'disconnect']);
    assert.ok(commands.every((entry) => entry.description.length > 0 && entry.description.length <= 256));

    // A token is stored as a hash only.
    const pairing = await mintPairing(request, secret);
    assert.match(pairing.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(pairing.url, `https://t.me/${BOT_USERNAME}?start=${pairing.token}`);
    const stored = query('SELECT token_hash, consumed_at, expires_at FROM telegram_pairing_tokens') as { token_hash: string; consumed_at: string | null; expires_at: string }[];
    assert.equal(stored.length, 1);
    assert.match(stored[0].token_hash, /^[a-f0-9]{64}$/);
    assert.equal(stored[0].token_hash, sha256(pairing.token));
    assert.equal(stored[0].token_hash === pairing.token, false);
    const rawLeak = query(`SELECT COUNT(*) AS count FROM telegram_pairing_tokens WHERE token_hash = '${pairing.token}'`) as { count: number }[];
    assert.equal(rawLeak[0].count, 0);

    // Expiry is enforced on the server clock, not by the link's own text.
    query(`UPDATE telegram_pairing_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token_hash = '${stored[0].token_hash}'`);
    const expired = await startInPrivate({ request, query, bot }, pairing.token, 555);
    assert.match(expired, /expired/);
    assert.equal(connectionRows(query, workspaceId).length, 0);

    // A live token links once and only once.
    const fresh = await mintPairing(request, secret);
    const linked = await startInPrivate({ request, query, bot }, fresh.token, 555);
    assert.match(linked, /is now connected/);
    assert.equal(connectionRows(query, workspaceId).length, 1);
    assert.equal((query('SELECT consumed_at FROM telegram_pairing_tokens ORDER BY id DESC LIMIT 1') as { consumed_at: string | null }[])[0].consumed_at !== null, true);

    const replayed = await startInPrivate({ request, query, bot }, fresh.token, 555);
    assert.match(replayed, /already been used/);
    assert.equal(connectionRows(query, workspaceId).length, 1);
  });
});

test('one chat can follow several trips, a repeat connect is not a duplicate, and connections stay per workspace', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const first = await createWorkspace(request, 'Trip one');
    const second = await createWorkspace(request, 'Trip two');
    const ids = query('SELECT id, name FROM workspaces ORDER BY id') as { id: number; name: string }[];
    assert.equal(ids.length, 2);

    const chatId = 900001;
    const chat = PRIVATE_CHAT(chatId, 'Willow');
    const firstToken = await mintPairing(request, first);
    const firstReply = await startInPrivate({ request, query, bot }, firstToken.token, chatId);
    assert.match(firstReply, /connected to “Trip one”/);

    // The same chat follows the second trip as well.
    const secondToken = await mintPairing(request, second);
    const secondReply = await startInPrivate({ request, query, bot }, secondToken.token, chatId);
    assert.match(secondReply, /connected to “Trip two”/);
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat, text: '/start' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a multi-trip menu should be sent');
    const multiTripGrid = (bot.messages[0].reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard;
    assert.equal(multiTripGrid.filter((row) => row.length === 1 && row[0].text === '📊 Send debt summary').length, 2, 'one full-width Summary row is present for each linked trip');

    // Re-connecting the first trip reuses the row and says so.
    const againToken = await mintPairing(request, first);
    query(`UPDATE telegram_connections SET enabled = 0 WHERE workspace_id = ${ids[0].id} AND chat_id = '${chatId}'`);
    const againReply = await startInPrivate({ request, query, bot }, againToken.token, chatId);
    assert.match(againReply, /already connected to “Trip one”/);
    const rows = connectionRows(query, ids[0].id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, 1);
    assert.equal(rows[0].chat_id, '900001');

    // Each workspace sees only its own chat, and neither can touch the other's connection.
    const stateA = await (await request(`/w/${first}/api`)).json() as { telegram: { configured: boolean; connections: { id: number; chat_title: string; chat_type: string }[] } };
    const stateB = await (await request(`/w/${second}/api`)).json() as { telegram: { configured: boolean; connections: { id: number }[] } };
    assert.equal(stateA.telegram.configured, true);
    assert.equal(stateA.telegram.connections.length, 1);
    assert.equal(stateA.telegram.connections[0].chat_title, 'Willow');
    assert.equal(stateA.telegram.connections[0].chat_type, 'private');
    assert.equal(stateB.telegram.connections.length, 1);
    assert.notEqual(stateB.telegram.connections[0].id, stateA.telegram.connections[0].id);

    const foreignId = stateA.telegram.connections[0].id;
    assert.equal((await request(`/w/${second}/api/telegram/connections/${foreignId}`, { method: 'DELETE' })).status, 404);
    assert.equal((await request(`/w/${second}/api/telegram/connections/${foreignId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status, 404);
    assert.equal(connectionRows(query, ids[0].id).length, 1, 'another workspace must not be able to disconnect it');

    // Listed, toggled and disconnected through this workspace's own routes.
    const listed = await (await request(`/w/${first}/api/telegram`)).json() as { configured: boolean; bot_username: string | null; connections: { id: number; enabled: boolean }[] };
    assert.equal(listed.bot_username, BOT_USERNAME);
    assert.equal((await request(`/w/${first}/api/telegram/connections/${foreignId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status, 200);
    assert.equal(connectionRows(query, ids[0].id)[0].enabled, 0);
    assert.equal((await request(`/w/${first}/api/telegram/connections/${foreignId}`, { method: 'DELETE' })).status, 200);
    assert.equal(connectionRows(query, ids[0].id).length, 0);
    assert.equal((query('SELECT COUNT(*) AS count FROM telegram_notifications') as { count: number }[])[0].count, 0);
  });
});

test('the webhook refuses unauthenticated calls and only a group administrator can link a group', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Group trip');
    const workspaceId = Number(query('SELECT id FROM workspaces')[0].id);
    const pairing = await mintPairing(request, secret);

    const before = bot.calls.length;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(1), text: '/start' }, null)).status, 401);
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(1), text: '/start' }, 'wrong-secret')).status, 401);
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(1), text: '/start' }, '')).status, 401);
    assert.equal((await request('/api/telegram/webhook', { method: 'GET' })).status, 405);
    assert.equal((await request('/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body: 'not json' })).status, 400);
    assert.equal(bot.calls.length, before, 'a refused update must not reach the Bot API');
    assert.equal(connectionRows(query, workspaceId).length, 0);
    assert.equal((query('SELECT consumed_at FROM telegram_pairing_tokens ORDER BY id DESC LIMIT 1') as { consumed_at: string | null }[])[0].consumed_at, null);

    // A plain member cannot link the group, and that refusal does not burn the workspace's link.
    const group = GROUP_CHAT(-1001234567890);
    bot.statuses.set('-1001234567890', 'member');
    const memberReply = await startIn({ request, query, bot }, group, { id: 4242, first_name: 'Willow' }, pairing.token);
    assert.match(memberReply, /administrator/);
    assert.equal(connectionRows(query, workspaceId).length, 0);
    assert.equal((query('SELECT consumed_at FROM telegram_pairing_tokens ORDER BY id DESC LIMIT 1') as { consumed_at: string | null }[])[0].consumed_at, null, 'a refused attempt must not consume the token');
    assert.ok(bot.calls.some((call) => call.method === 'getChatMember'));

    // A group administrator can, and the stored chat id keeps its full 64-bit text form.
    bot.statuses.set('-1001234567890', 'administrator');
    const adminUpdate = await sendUpdate({ request, query, bot }, { chat: group, from: { id: 4242, first_name: 'Willow' }, text: `/start ${pairing.token}` });
    assert.equal(adminUpdate.status, 200);
    await waitFor(() => connectionRows(query, workspaceId).length === 1, 'an administrator should be able to link the group');
    const linked = connectionRows(query, workspaceId)[0];
    assert.equal(linked.chat_id, '-1001234567890');
    assert.equal(linked.chat_type, 'group');
    assert.equal((await request(`/w/${secret}/api/telegram`).then((response) => response.json()) as { connections: { chat_title: string }[] }).connections[0].chat_title, 'Chiang Mai trip');
    assert.equal((query(`SELECT COUNT(*) AS count FROM telegram_connections WHERE chat_id LIKE '%e%'`) as { count: number }[])[0].count, 0, 'a chat id must never be stored as a float');

    // A channel is never linkable, however the update arrives.
    const channelToken = await mintPairing(request, secret);
    bot.statuses.set('-1009876543210', 'member');
    const channelReply = await startIn({ request, query, bot }, { id: -1009876543210, type: 'channel', title: 'Chiang Mai announcements' }, { id: 4242, first_name: 'Willow' }, channelToken.token);
    assert.match(channelReply, /administrator/);
    assert.equal(connectionRows(query, workspaceId).length, 1);
  });
});

test('committed writes are announced, previews and refused writes are not, and a replay never repeats a message', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Quiet trip');
    const workspaceId = Number(query('SELECT id FROM workspaces')[0].id);
    const pairing = await mintPairing(request, secret);
    const chatId = 770001;
    assert.match(await startInPrivate({ request, query, bot }, pairing.token, chatId), /is now connected/);
    const connectionId = connectionRows(query, workspaceId)[0].id;
    await waitFor(() => bot.messages.some((message) => message.text.includes('is now connected')), 'the pairing answer should be recorded');

    const stateBefore = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[] };
    const [ada, lin] = stateBefore.people;
    const write = (body: Record<string, unknown>) => request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const transaction = { occurred_on: '2026-10-12', entry_kind: 'debt', topic: 'Night market', category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 4250, currency_code: 'USD' };

    // A refused write is never announced.
    const delivered = () => bot.sentMatching('Night market').length;
    assert.equal((await write({ ...transaction, amount_minor: 'nope' })).status, 400);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(delivered(), 0);
    assert.equal((query('SELECT COUNT(*) AS count FROM telegram_notifications') as { count: number }[])[0].count, 0);

    // A preview of a split writes nothing, so it has nothing to announce.
    const splitPreview = await request(`/w/${secret}/api/splits/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occurred_on: '2026-10-12', topic: 'Preview only', category: 'Food', payer_person_id: ada.id, participant_person_ids: [ada.id, lin.id], amount_minor: 3000, currency_code: 'USD', notes: '' }),
    });
    assert.equal(splitPreview.status, 200, 'a valid draft is previewed without writing anything');
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(delivered(), 0);

    // A committed write is announced, once, with the amount and no attribution.
    const created = await write(transaction);
    assert.equal(created.status, 201);
    const transactionId = ((await created.json()) as { transaction: { id: number } }).transaction.id;
    await waitFor(() => delivered() === 1, 'a committed transaction should be announced');
    const announcement = bot.sentMatching('Night market')[0];
    assert.equal(announcement.chat_id, String(chatId));
    assert.match(announcement.text, /🧳 Trip Finance — Quiet trip/);
    // Active voice with both entities named: the debtor owes the creditor, and the amount follows.
    assert.match(announcement.text, /🧾 Lin owes Ada USD 42\.50/);
    assert.match(announcement.text, /Night market/);
    // Alerts lead with an emoji on every line: the trip, the entry, the time it happened.
    for (const line of announcement.text.split('\n').filter((line) => line.trim())) {
      assert.match(line, /^\p{Extended_Pictographic}/u, `line without a leading emoji: ${line}`);
    }
    assert.equal(
      /was recorded|was created|was split|were recorded|Entries were added/.test(announcement.text),
      false,
      'a notification never falls back to entity-free passive wording',
    );
    assert.equal((query("SELECT COUNT(*) AS count FROM telegram_notifications WHERE status = 'sent'") as { count: number }[])[0].count, 1);
    assert.equal((query('SELECT last_audit_id FROM telegram_connections') as { last_audit_id: number }[])[0].last_audit_id > 0, true);

    // Editing, archiving and restoring the row are each announced in the same chat.
    assert.equal((await request(`/w/${secret}/api/transactions/${transactionId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'Night market snacks', amount_minor: 5000 }) })).status, 200);
    await waitFor(() => bot.sentMatching('Night market snacks').length === 1, 'an edit should be announced');
    assert.match(bot.sentMatching('Night market snacks')[0].text, /✏️ Edited — Lin owes Ada USD 50\.00/, 'an edit still names both entities and the amount');
    assert.equal((await request(`/w/${secret}/api/transactions/${transactionId}`, { method: 'DELETE' })).status, 200);
    await waitFor(() => bot.sentMatching('🗄️ Removed — Lin owes Ada USD 50.00').length === 1, 'an archive should be announced');
    assert.equal((await request(`/w/${secret}/api/transactions/${transactionId}/restore`, { method: 'POST' })).status, 200);
    await waitFor(() => bot.sentMatching('♻️ Restored — Lin owes Ada USD 50.00').length === 1, 'a restore should be announced');
    assert.equal((await request(`/w/${secret}/api`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { auto_offset: false } }) })).status, 200);
    await waitFor(() => bot.sentMatching('setup was changed').length === 1, 'a settings change should be announced');

    // A repayment reads the other way round: the debtor is the one who handed the money over.
    assert.equal((await write({ ...transaction, entry_kind: 'payment', topic: 'Settling up', amount_minor: 2500 })).status, 201);
    await waitFor(() => bot.sentMatching('Settling up').length === 1, 'a repayment should be announced');
    assert.match(bot.sentMatching('Settling up')[0].text, /💸 Lin paid Ada USD 25\.00/, 'a repayment says who paid whom');

    // Delivery is deduplicated at the database, not by luck: rewind the watermark and replay.
    // A retry re-reads the same audit window, so capture the watermark, let a write be announced, then
    // put the watermark back where it stood before that write and replay the window. A split preview
    // writes nothing but still reaches the dispatcher, which is exactly the re-read a retry performs.
    const watermarkBefore = Number((query('SELECT last_audit_id FROM telegram_connections') as { last_audit_id: number }[])[0].last_audit_id);
    assert.equal((await write({ ...transaction, topic: 'Second round', amount_minor: 1000 })).status, 201);
    await waitFor(() => bot.sentMatching('Second round').length === 1, 'a committed write should be announced once');
    const queuedAfterDelivery = Number((query(`SELECT COUNT(*) AS count FROM telegram_notifications WHERE connection_id = ${connectionId}`) as { count: number }[])[0].count);
    const messagesAfterDelivery = bot.messages.length;

    query(`UPDATE telegram_connections SET last_audit_id = ${watermarkBefore} WHERE id = ${connectionId}`);
    assert.equal((await request(`/w/${secret}/api/splits/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occurred_on: '2026-10-12', topic: 'Preview only', category: 'Food', payer_person_id: ada.id, participant_person_ids: [ada.id, lin.id], amount_minor: 3000, currency_code: 'USD', notes: '' }),
    })).status, 200, 'the replay is driven by a write that commits nothing');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bot.messages.length, messagesAfterDelivery, 'a replayed window must not resend what was already delivered');
    assert.equal(Number((query(`SELECT COUNT(*) AS count FROM telegram_notifications WHERE connection_id = ${connectionId}`) as { count: number }[])[0].count), queuedAfterDelivery, 'a replay must add no outbox row');
    assert.equal(Number((query('SELECT COUNT(*) AS count FROM telegram_notifications') as { count: number }[])[0].count), Number((query('SELECT COUNT(DISTINCT event_key) AS count FROM telegram_notifications') as { count: number }[])[0].count), 'one outbox row per event key');
    assert.equal(Number((query('SELECT last_audit_id FROM telegram_connections') as { last_audit_id: number }[])[0].last_audit_id) > watermarkBefore, true, 'the replay still advances the watermark past what it re-read');

    // Deduplication must not swallow a genuinely new event.
    assert.equal((await write({ ...transaction, topic: 'Third round', amount_minor: 800 })).status, 201);
    await waitFor(() => bot.sentMatching('Third round').length === 1, 'a new event after a replay should be announced');
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(bot.sentMatching('Third round').length, 1, 'and exactly once');

    // A chat that no longer exists is switched off instead of being retried forever.
    bot.mode = { error_code: 403, description: 'Forbidden: bot was blocked by the user' };
    assert.equal((await write({ ...transaction, topic: 'Blocked round', amount_minor: 700 })).status, 201);
    await waitFor(() => connectionRows(query, workspaceId)[0].enabled === 0, 'a blocked chat should be disabled');
    assert.match(String((query('SELECT last_error FROM telegram_connections') as { last_error: string }[])[0].last_error), /blocked/);
    bot.mode = null;

    // Disconnecting removes the chat and everything queued for it, and stops the announcements.
    const queuedBefore = Number((query(`SELECT COUNT(*) AS count FROM telegram_notifications WHERE connection_id = ${connectionId}`) as { count: number }[])[0].count);
    assert.ok(queuedBefore > 0);
    assert.equal((await request(`/w/${secret}/api/telegram/connections/${connectionId}`, { method: 'DELETE' })).status, 200);
    assert.equal(connectionRows(query, workspaceId).length, 0);
    assert.equal((query(`SELECT COUNT(*) AS count FROM telegram_notifications WHERE connection_id = ${connectionId}`) as { count: number }[])[0].count, 0);
    const sendsBefore = bot.messages.length;
    assert.equal((await write({ ...transaction, topic: 'After disconnect', amount_minor: 900 })).status, 201);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bot.messages.length, sendsBefore, 'a disconnected chat hears nothing');
  });
});

test('no Telegram surface leaks a capability secret and the audit trail is untouched by chat management', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Secret trip');
    const workspaceId = Number(query('SELECT id FROM workspaces')[0].id);
    // A bare /start comes first, so this block's leak sweep also covers the welcome and its button.
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(880001), text: '/start' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a welcome should be sent');
    const pairing = await mintPairing(request, secret);
    assert.match(await startInPrivate({ request, query, bot }, pairing.token, 880001), /is now connected/);
    const connectionId = connectionRows(query, workspaceId)[0].id;
    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    await request(`/w/${secret}/api/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ occurred_on: '2026-10-12', entry_kind: 'debt', topic: 'Ferry tickets', category: 'Transport', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: 1500, currency_code: 'USD' }) }).then((response) => assert.equal(response.status, 201));
    await waitFor(() => bot.sentMatching('Ferry tickets').length === 1, 'the write should be announced');
    assert.equal((await request(`/w/${secret}/api/telegram/connections/${connectionId}`, { method: 'DELETE' })).status, 200);

    // Nothing Telegram ever received may contain the capability secret, the workspace URL, the bot
    // token or a pairing token.
    assert.ok(bot.messages.length >= 2);
    for (const message of bot.messages) {
      assert.equal(message.text.includes(secret), false, 'a message must never carry the capability secret');
      assert.equal(message.text.includes('/w/'), false, 'a message must never carry a workspace URL');
      assert.equal(message.text.includes(BOT_TOKEN), false, 'a message must never carry the bot token');
      assert.equal(message.text.includes(WEBHOOK_SECRET), false, 'a message must never carry the webhook secret');
      assert.equal(/\/start [A-Za-z0-9_-]{20,}/.test(message.text), false, 'a pairing token must not be echoed back');
      assert.equal(JSON.stringify(message.reply_markup ?? {}).includes(secret), false);
    }
    const welcome = bot.messages.find((message) => message.text.includes('Trip Finance Workspace'));
    assert.ok(welcome, 'the /start welcome should have been sent');
    assert.equal(JSON.stringify(welcome!.reply_markup).includes(ORIGIN), true);
    assert.equal(JSON.stringify(welcome!.reply_markup).includes('/w/'), false, 'the bot button opens the public root, never a capability URL');

    // The requests the worker made carried the token in the path (as the Bot API requires) and the
    // stored hash is all we keep.
    assert.equal(bot.calls.every((call) => call.token === BOT_TOKEN), true);
    assert.equal((query('SELECT COUNT(*) AS count FROM telegram_pairing_tokens WHERE length(token_hash) != 64') as { count: number }[])[0].count, 0);

    // Chat management is not a ledger event: nothing about it may enter the immutable trail, and the
    // ledger's own rows are still the only audited entities.
    assert.equal((query("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type LIKE 'telegram%'") as { count: number }[])[0].count, 0);
    const entities = (query('SELECT DISTINCT entity_type FROM audit_log') as { entity_type: string }[]).map((row) => row.entity_type);
    assert.ok(entities.includes('transaction'), 'ledger writes are still audited');
    const known = ['currency', 'person', 'receipt', 'receipt_attachment', 'transaction', 'workspace', 'workspace_backup', 'workspace_settings'];
    assert.deepEqual(entities.filter((entity) => !known.includes(entity)), [], 'chat management invents no audited entity');
  });
});

test('one workspace fans out to every linked chat, and one unreachable chat never costs the others a message', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Fan-out trip');
    const workspaceId = Number(query('SELECT id FROM workspaces')[0].id);

    // Three chats on one workspace: two private chats and a group an administrator links.
    const first = 880101;
    const second = 880102;
    const third = 880103;
    const group = { id: -100777000333, type: 'group', title: 'Fan-out group' };
    bot.statuses.set(String(group.id), 'administrator');
    const link = async (chat: UpdateInit['chat'], from?: { id: number; first_name?: string }) => {
      const pairing = await mintPairing(request, secret);
      // The group is linked exactly the way the Setup card tells an administrator to do it: by a command
      // that names the bot, because Telegram does not pass a bare group command on to it.
      return from
        ? startIn({ request, query, bot }, chat, from, pairing.token, String(pairing.group_command))
        : startInPrivate({ request, query, bot }, pairing.token, chat.id);
    };
    assert.match(await link(PRIVATE_CHAT(first)), /is now connected/);
    assert.match(await link(PRIVATE_CHAT(second)), /is now connected/);
    assert.match(await link(group, { id: 5150, first_name: 'Willow' }), /is now connected/);
    assert.deepEqual(
      connectionRows(query, workspaceId).map((row) => row.chat_id),
      [String(first), String(second), String(group.id)],
      'one workspace holds one row per chat, however many are linked',
    );
    assert.equal(connectionRows(query, workspaceId)[2].chat_type, 'group', 'a group is stored as a group, with its own row and watermark');

    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const write = (topic: string, amount: number) => request(`/w/${secret}/api/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occurred_on: '2026-10-12', entry_kind: 'debt', topic, category: 'Food', creditor_person_id: ada.id, debtor_person_id: lin.id, amount_minor: amount, currency_code: 'USD' }),
    });
    const preview = () => request(`/w/${secret}/api/splits/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occurred_on: '2026-10-12', topic: 'Preview only', category: 'Food', payer_person_id: ada.id, participant_person_ids: [ada.id, lin.id], amount_minor: 500, currency_code: 'USD', notes: '' }),
    });
    const queued = (topic: string) => query(
      `SELECT n.status, n.attempts, n.last_error FROM telegram_notifications n JOIN telegram_connections c ON c.id = n.connection_id WHERE c.chat_id = '${second}' AND n.body LIKE '%${topic}%'`,
    ) as { status: string; attempts: number; last_error: string | null }[];
    // A split preview commits nothing but still reaches the dispatcher, so it is a pure retry chance:
    // the same chance a later write would give the queue, with no new event to confuse the counting.
    const retryChance = async (topic: string, rounds: number) => {
      for (let round = 0; round < rounds; round += 1) {
        const before = queued(topic)[0]?.attempts ?? 0;
        assert.equal((await preview()).status, 200);
        await waitFor(() => (queued(topic)[0]?.attempts ?? 0) > before, `retry chance ${round + 1} should be recorded`, 6_000);
      }
    };

    // One committed write reaches every chat, once each, with wording that names the entities.
    assert.equal((await write('Fan out one', 1100)).status, 201);
    await waitFor(() => bot.sentMatching('Fan out one').length === 3, 'every linked chat should hear about one write');
    const firstRound = bot.sentMatching('Fan out one');
    assert.deepEqual(firstRound.map((message) => message.chat_id).sort(), [String(first), String(second), String(group.id)].sort());
    assert.equal(new Set(firstRound.map((message) => message.text)).size, 1, 'every chat hears the same words');
    assert.equal((query("SELECT COUNT(*) AS count FROM telegram_notifications WHERE status = 'sent'") as { count: number }[])[0].count, 3, 'one outbox row per chat');

    // A transient failure aimed at the middle chat only.
    bot.failFor.set(String(second), { error_code: 500, description: 'Internal Server Error' });
    assert.equal((await write('Fan out two', 2200)).status, 201);
    await waitFor(() => bot.sentMatching('Fan out two').length === 2, 'the chats that can be reached are served regardless');
    assert.deepEqual(bot.sentMatching('Fan out two').map((message) => message.chat_id).sort(), [String(first), String(group.id)].sort());
    assert.deepEqual(queued('Fan out two').map((row) => row.status), ['pending'], 'a 500 is retryable, so the message waits instead of disappearing');
    assert.equal(queued('Fan out two')[0].attempts, 1);
    assert.match(String(queued('Fan out two')[0].last_error), /Internal Server Error/);
    assert.equal(connectionRows(query, workspaceId).length, 3, 'a transient failure must not drop another chat');
    assert.equal(connectionRows(query, workspaceId).find((row) => row.chat_id === String(second))!.enabled, 1, 'and must not switch the chat off');

    // The next write is also a retry chance: the missed message goes out, once, in the order it was queued.
    bot.failFor.delete(String(second));
    assert.equal((await write('Fan out three', 3300)).status, 201);
    await waitFor(() => bot.sentMatching('Fan out two').length === 3, 'the queued message should catch up on the next dispatch');
    await waitFor(() => bot.sentMatching('Fan out three').length === 3, 'and the new one should reach the recovered chat too');
    assert.deepEqual(
      bot.messages.filter((message) => message.chat_id === String(second) && /Fan out (two|three)/.test(message.text))
        .map((message) => (message.text.includes('Fan out two') ? 'two' : 'three')),
      ['two', 'three'],
      'the queue drains oldest first',
    );

    // A sustained outage must not quietly cost the message: six chances in a row, still queued.
    bot.failFor.set(String(second), { error_code: 502, description: 'Bad Gateway' });
    assert.equal((await write('Fan out four', 4400)).status, 201);
    await waitFor(() => queued('Fan out four')[0]?.attempts === 1, 'the first attempt should be recorded');
    await retryChance('Fan out four', 5);
    assert.equal(queued('Fan out four')[0].attempts, 6);
    assert.equal(queued('Fan out four')[0].status, 'pending', 'an outage that outlasts a few chances must not drop the message');

    // A chat linked later hears what happens next, never the trip's history.
    assert.match(await link(PRIVATE_CHAT(third)), /is now connected/);
    // The confirmation and the navigation menu, and nothing at all from the trip's history.
    const afterLink = bot.messages.filter((message) => message.chat_id === String(third));
    assert.equal(afterLink.length, 2, 'linking sends the confirmation and the menu, nothing else');
    assert.match(afterLink[0].text, /is now connected/);
    assert.match(afterLink[1].text, /Tap a section/);
    assert.equal((await write('Fan out five', 5500)).status, 201);
    await waitFor(() => bot.sentMatching('Fan out five').some((message) => message.chat_id === String(third)), 'a new chat hears the next write');
    assert.equal(bot.sentMatching('Fan out one').some((message) => message.chat_id === String(third)), false, 'history is never replayed into a new chat');

    // The outage ends: the backlog drains, oldest first, and never twice.
    bot.failFor.delete(String(second));
    assert.equal((await write('Fan out six', 6600)).status, 201);
    await waitFor(
      () => ['Fan out four', 'Fan out five', 'Fan out six'].every((topic) => bot.sentMatching(topic).some((message) => message.chat_id === String(second))),
      'the backlog should drain once the chat answers again',
    );
    assert.deepEqual(
      bot.messages.filter((message) => message.chat_id === String(second))
        .map((message) => /Fan out (one|two|three|four|five|six)/.exec(message.text)?.[1])
        .filter((topic) => topic !== undefined),
      ['one', 'two', 'three', 'four', 'five', 'six'],
      'a chat receives events in the order they were recorded, with nothing repeated and nothing skipped',
    );

    // The one way a message can still go missing: twelve chances is the limit. It is then abandoned and
    // the reason is left on the connection, where the Setup tab shows it.
    bot.failFor.set(String(second), { error_code: 503, description: 'Service Unavailable' });
    assert.equal((await write('Fan out seven', 7700)).status, 201);
    await waitFor(() => queued('Fan out seven')[0]?.attempts === 1, 'the first attempt should be recorded');
    await retryChance('Fan out seven', 11);
    assert.equal(queued('Fan out seven')[0].attempts, 12);
    assert.equal(queued('Fan out seven')[0].status, 'failed', 'past twelve chances the message is given up on');
    assert.match(String((query(`SELECT last_error FROM telegram_connections WHERE chat_id = '${second}'`) as { last_error: string | null }[])[0].last_error), /Undelivered message/);
    assert.equal(connectionRows(query, workspaceId).find((row) => row.chat_id === String(second))!.enabled, 1, 'an outage never switches a chat off');

    // And a later dispatch does not revive it: only reconnecting the chat clears the queue.
    bot.failFor.delete(String(second));
    const sendsBefore = bot.messages.length;
    assert.equal((await preview()).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(bot.messages.length, sendsBefore, 'an abandoned message is not revived by a later dispatch');

    // Nothing anywhere in the run was delivered twice, and the outbox holds one row per chat and event.
    const seen = new Map<string, number>();
    for (const message of bot.messages) {
      const key = `${message.chat_id}|${message.text}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    assert.deepEqual([...seen.entries()].filter(([, count]) => count > 1), [], 'no chat ever receives the same message twice');
    assert.equal(
      Number((query('SELECT COUNT(*) AS count FROM telegram_notifications') as { count: number }[])[0].count),
      Number((query('SELECT COUNT(*) AS count FROM (SELECT DISTINCT connection_id, event_key FROM telegram_notifications)') as { count: number }[])[0].count),
      'one outbox row per chat and event, however often a dispatch runs',
    );
  });
});

test('the /start menu hands out expiring section passes, never the trip link', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Menu trip');
    const workspaceId = Number((query(`SELECT id FROM workspaces WHERE name = 'Menu trip'`) as { id: number }[])[0].id);

    // A chat that follows nothing gets the plain welcome, and no pass is minted for it.
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(770001), text: '/start' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a welcome should be sent');
    assert.ok(!bot.messages[0].text.includes('Tap a section'), 'an unlinked chat gets no menu');
    assert.equal(Number((query('SELECT COUNT(*) AS count FROM telegram_nav_links') as { count: number }[])[0].count), 0, 'a chat that follows nothing is handed no pass');

    // Connect the chat, then ask for the menu.
    await startInPrivate({ request, query, bot }, (await mintPairing(request, secret)).token, 770002);
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(770002), text: '/start' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a menu should be sent');

    const menu = bot.messages[0];
    const grid = (menu.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard;
    const navigationRows = grid.filter((row) => row.every((button) => button.url));
    const summaryRows = grid.filter((row) => row.length === 1 && row[0].text === '📊 Send debt summary');
    assert.match(menu.text, /Menu trip/, 'the menu names the trip');
    assert.match(menu.text, /work for a day/);
    assert.equal(navigationRows.length, 3, 'three rows of sections, two per row');
    assert.equal(summaryRows.length, 1, 'each linked trip gets one full-width Summary row');
    assert.deepEqual(navigationRows[0].map((button) => button.text), ['➕ Create debt', '↩️ Record a payment']);
    assert.deepEqual(navigationRows[1].map((button) => button.text), ['✂️ Split a bill', '📒 Transactions'], 'writing and reading surfaces sit in the app order');
    assert.deepEqual(navigationRows[2].map((button) => button.text), ['⚖️ View debts and analytics'], 'the reading row names what the page holds');
    assert.ok(navigationRows.flat().every((button) => button.url !== ORIGIN), 'no button opens the public root');
    const menuLabels = grid.flat().map((button) => button.text).join(' | ');
    assert.ok(!/Audit|Setup|Ranking|Receipts|Bulk|new trip/i.test(menuLabels), `audit, setup, ranking, receipts and bulk import stay out of the chat menu: ${menuLabels}`);
    assert.ok(!menu.text.includes(secret) && !menu.text.includes('/w/'), 'the menu never carries the trip link');
    for (const row of navigationRows) {
      for (const button of row) {
        assert.ok(button.url, `a navigation button must have a URL: ${button.text}`);
        assert.ok(!button.url.includes('/w/'), `a menu button must not carry a capability URL: ${button.text}`);
        assert.ok(!button.url.includes(secret), 'no button carries the capability secret');
        assert.match(button.url, new RegExp(`^${ORIGIN}/go/[A-Za-z0-9_-]{20,}/(add|pay|split|ledger|balances|ranking|receipts|tools|audit|settings)$`));
      }
    }

    const ledgerUrl = grid[0][0].url;
    const token = ledgerUrl.match(/\/go\/([^/]+)\//)![1];
    const stored = query('SELECT token_hash, uses FROM telegram_nav_links') as { token_hash: string; uses: number }[];
    assert.equal(stored.length, 1, 'one pass per connected trip, not one per section');
    assert.equal(stored[0].token_hash, sha256(token));
    assert.equal(Number((query(`SELECT COUNT(*) AS count FROM telegram_nav_links WHERE token_hash = '${token}'`) as { count: number }[])[0].count), 0, 'the raw pass is never stored');

    // Tapping a button counts the tap and lands on the section that was asked for.
    const tap = await request(`/go/${token}/ranking`, { redirect: 'manual' });
    assert.equal(tap.status, 302);
    assert.equal(tap.headers.get('location'), `${ORIGIN}/w/${token}#ranking`);
    assert.equal(tap.headers.get('x-robots-tag'), 'noindex');
    // A section the app does not have is refused rather than reflected into the redirect.
    assert.equal((await request(`/go/${token}/admin`, { redirect: 'manual' })).status, 404);
    assert.equal(Number((query('SELECT uses FROM telegram_nav_links') as { uses: number }[])[0].uses), 1, 'only the tap that landed counts');

    // The pass opens the trip itself: the page and the API both answer for this workspace.
    assert.equal((await request(`/w/${token}`)).status, 200, 'a menu pass opens the trip page');
    const state = await request(`/w/${token}/api`);
    assert.equal(state.status, 200, 'a menu pass opens the trip API');
    assert.ok(JSON.stringify(await state.json()).includes(String(workspaceId)), 'the pass resolves to the trip the chat is connected to');

    // A day later the pass is dead, and asking for a fresh menu sweeps it away.
    query(`UPDATE telegram_nav_links SET expires_at = '2000-01-01T00:00:00.000Z'`);
    const expired = await request(`/go/${token}/ledger`, { redirect: 'manual' });
    assert.equal(expired.status, 410);
    assert.match(await expired.text(), /expired/);
    assert.equal((await request(`/w/${token}/api`)).status, 404, 'an expired pass is not a way into the trip');
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(770002), text: '/start' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a second menu should be sent');
    assert.equal(Number((query('SELECT COUNT(*) AS count FROM telegram_nav_links') as { count: number }[])[0].count), 1, 'the spent pass is swept and one fresh pass remains');

    // Disconnecting the chat takes its passes with it.
    const connectionId = Number((query(`SELECT id FROM telegram_connections WHERE chat_id = '770002'`) as { id: number }[])[0].id);
    assert.equal((await request(`/w/${secret}/api/telegram/connections/${connectionId}`, { method: 'DELETE' })).status, 200);
    assert.equal(Number((query('SELECT COUNT(*) AS count FROM telegram_nav_links') as { count: number }[])[0].count), 0, 'a disconnected chat keeps no passes');
    assert.equal((await request(`/go/${token}/ledger`, { redirect: 'manual' })).status, 404);

    // A group gets the same grid, from the command Telegram actually delivers to a bot in a group.
    const groupSecret = await createWorkspace(request, 'Group menu trip');
    const groupChat = GROUP_CHAT(-770003, 'Menu group');
    bot.statuses.set(String(groupChat.id), 'administrator');
    const groupPair = await mintPairing(request, groupSecret);
    await startIn({ request, query, bot }, groupChat, { id: 770010, first_name: 'Ada' }, groupPair.token, groupPair.group_command ?? `/start ${groupPair.token}`);
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: groupChat, text: `/start@${BOT_USERNAME}` })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a group menu should be sent');
    const groupMenu = bot.messages[0];
    assert.match(groupMenu.text, /Group menu trip/, 'the group menu names its trip');
    const groupGrid = (groupMenu.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard;
    assert.equal(groupGrid.filter((row) => row.every((button) => button.url)).length, 3, 'the group gets the same navigation rows');
    assert.equal(groupGrid.filter((row) => row.length === 1 && row[0].text === '📊 Send debt summary').length, 1, 'the group gets one Summary row per linked trip');
    assert.equal(Number((query(`SELECT COUNT(*) AS count FROM telegram_nav_links WHERE connection_id = (SELECT id FROM telegram_connections WHERE chat_id = '${groupChat.id}')`) as { count: number }[])[0].count), 1);
  });
});

test('/disconnect unlinks this chat, takes its menu passes with it, and a group needs an administrator', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const first = await createWorkspace(request, 'Disconnect trip one');
    const second = await createWorkspace(request, 'Disconnect trip two');
    const firstId = Number(query(`SELECT id FROM workspaces WHERE name = 'Disconnect trip one'`)[0].id);
    const secondId = Number(query(`SELECT id FROM workspaces WHERE name = 'Disconnect trip two'`)[0].id);
    const chatId = 880001;
    const passesFor = `SELECT COUNT(*) AS count FROM telegram_nav_links WHERE connection_id IN (SELECT id FROM telegram_connections WHERE chat_id = '${chatId}')`;

    // A chat that follows nothing is told so, and nothing else happens.
    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(chatId), text: '/disconnect' })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'an unconnected chat should still get an answer');
    assert.match(bot.messages[0].text, /not connected to any trip/);

    // One chat can follow two trips. The addressed form is what a group sends, so it has to work here.
    await startInPrivate({ request, query, bot }, (await mintPairing(request, first)).token, chatId);
    await startInPrivate({ request, query, bot }, (await mintPairing(request, second)).token, chatId);
    assert.equal(connectionRows(query, firstId).length, 1);
    assert.equal(connectionRows(query, secondId).length, 1);
    assert.equal(Number((query(passesFor) as { count: number }[])[0].count), 2, 'each connected trip has a live menu pass');

    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat: PRIVATE_CHAT(chatId), text: `/disconnect@${BOT_USERNAME}` })).status, 200);
    await waitFor(() => bot.messages.length === 1, 'a disconnect answer should come back');
    const gone = bot.messages[0].text;
    assert.match(gone, /Disconnected/);
    assert.match(gone, /Disconnect trip one/);
    assert.match(gone, /Disconnect trip two/, 'both trips are named');
    assert.match(gone, /Setup/, 'the way back is spelled out');
    assert.equal(connectionRows(query, firstId).length, 0, 'the first connection is gone');
    assert.equal(connectionRows(query, secondId).length, 0, 'the second connection is gone');
    assert.equal(Number((query(passesFor) as { count: number }[])[0].count), 0, 'the menu passes go with the connection');

    // A group is only disconnected by one of its administrators, exactly like connecting it.
    const groupSecret = await createWorkspace(request, 'Disconnect group trip');
    const groupId = Number(query(`SELECT id FROM workspaces WHERE name = 'Disconnect group trip'`)[0].id);
    const groupChat = GROUP_CHAT(-880003, 'Disconnect group');
    const groupPasses = `SELECT COUNT(*) AS count FROM telegram_nav_links WHERE connection_id IN (SELECT id FROM telegram_connections WHERE chat_id = '${groupChat.id}')`;
    bot.statuses.set(String(groupChat.id), 'administrator');
    const pairing = await mintPairing(request, groupSecret);
    await startIn({ request, query, bot }, groupChat, { id: 880010, first_name: 'Ada' }, pairing.token, pairing.group_command ?? `/start ${pairing.token}`);
    assert.equal(connectionRows(query, groupId).length, 1);

    bot.statuses.set(String(groupChat.id), 'member');
    bot.messages.length = 0;
    await sendUpdate({ request, query, bot }, { chat: groupChat, from: { id: 880011, first_name: 'Pip' }, text: '/disconnect' });
    await waitFor(() => bot.messages.length === 1, 'a refusal should come back');
    assert.match(bot.messages[0].text, /administrator/);
    assert.equal(connectionRows(query, groupId).length, 1, 'a member cannot mute the group');
    assert.equal(Number((query(groupPasses) as { count: number }[])[0].count), 1, 'and cannot take its menu away either');

    bot.statuses.set(String(groupChat.id), 'administrator');
    bot.messages.length = 0;
    await sendUpdate({ request, query, bot }, { chat: groupChat, from: { id: 880010, first_name: 'Ada' }, text: '/disconnect' });
    await waitFor(() => bot.messages.length === 1, 'an administrator disconnect should be answered');
    assert.match(bot.messages[0].text, /Disconnected .*Disconnect group trip/);
    assert.equal(connectionRows(query, groupId).length, 0, 'an administrator can disconnect the group');
    assert.equal(Number((query(groupPasses) as { count: number }[])[0].count), 0);
  });
});

test('routes an authenticated Summary callback to one current text summary', async () => {
  await withTelegramApi(async ({ request, query, bot }) => {
    const secret = await createWorkspace(request, 'Summary trip');
    const workspaceId = Number(query(`SELECT id FROM workspaces WHERE name = 'Summary trip'`)[0].id);
    // A multi-digit id makes a plaintext decimal/base36 leak detectable without random-token coincidences.
    query("DELETE FROM sqlite_sequence WHERE name = 'telegram_connections'");
    query("INSERT INTO sqlite_sequence(name, seq) VALUES ('telegram_connections', 1234566)");
    query(`INSERT INTO workspace_currencies (workspace_id, code, is_default) VALUES (${workspaceId}, 'MYR', 0)`);
    const chatId = 101;
    const chat = PRIVATE_CHAT(chatId);
    assert.match(await startInPrivate({ request, query, bot }, (await mintPairing(request, secret)).token, chatId), /is now connected/);

    const state = await (await request(`/w/${secret}/api`)).json() as { people: { id: number }[] };
    const [ada, lin] = state.people;
    const write = (creditor: number, debtor: number, amount: number, currency: string) => request(`/w/${secret}/api/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occurred_on: '2026-10-13', entry_kind: 'debt', topic: 'Summary fixture', category: 'Food', creditor_person_id: creditor, debtor_person_id: debtor, amount_minor: amount, currency_code: currency }),
    });
    // Reciprocal USD entries and a separate MYR debt ensure the callback reads the current, multi-currency ledger.
    assert.equal((await write(ada.id, lin.id, 5_000, 'USD')).status, 201);
    assert.equal((await write(lin.id, ada.id, 1_200, 'USD')).status, 201);
    assert.equal((await write(lin.id, ada.id, 3_300, 'MYR')).status, 201);

    bot.messages.length = 0;
    assert.equal((await sendUpdate({ request, query, bot }, { chat, text: '/start' })).status, 200);
    await waitFor(() => bot.messages.some((message) => message.text.includes('Tap a section')), 'the connected chat should receive its menu');
    const menu = bot.messages.find((message) => message.text.includes('Tap a section'))!;
    const buttons = ((menu.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard).flat();
    const summary = buttons.find((button) => button.text === '📊 Send debt summary');
    const callbackData = summary?.callback_data;
    const connectionId = connectionRows(query, workspaceId)[0].id;
    assert.ok(callbackData, 'the menu should offer a Summary callback');
    assert.ok(callbackData.length < 64, 'Telegram callback_data stays below its 64-byte limit');
    assert.equal(callbackData.includes('/w/'), false, 'callback_data never carries a workspace path');
    assert.equal(callbackData.includes(secret), false, 'callback_data never carries the workspace secret');
    assert.equal(callbackData.includes(WEBHOOK_SECRET), false, 'callback_data never carries the webhook secret');
    assert.equal(callbackData.includes(String(connectionId)), false, 'callback_data never exposes the decimal connection id');
    assert.equal(callbackData.includes(connectionId.toString(36)), false, 'callback_data never exposes the base36 connection id');

    const submitted = await sendCallbackQuery({ request, query, bot }, chat, callbackData, 'summary-callback-101');
    assert.equal(submitted.response.status, 200);
    await waitFor(() => bot.messages.some((message) => message.text.includes('2 outstanding lines across 2 currencies')), 'the Summary callback should send one current text summary');
    await waitFor(() => bot.callbackAnswers.length === 1, 'the Summary callback should be acknowledged');
    const summaryMessage = bot.messages.find((message) => message.text.includes('2 outstanding lines across 2 currencies'))!;
    assert.match(summaryMessage.text, /📊 Summary trip — 2 outstanding lines across 2 currencies/, 'the summary leads with trip and counts');
    assert.match(summaryMessage.text, /owes Ada - USD 38\.00/, 'USD lines are netted');
    assert.match(summaryMessage.text, /owes Lin - MYR 33\.00/, 'MYR stays a separate line');
    assert.equal(summaryMessage.text.includes('/w/'), false, 'the summary text carries no workspace link');
    assert.equal(bot.callbackAnswers.length, 1);
    assert.equal(bot.callbackAnswers[0].callback_query_id, submitted.callbackId);

    const rejected = async (data: string, callbackId: string, sourceChat = chat) => {
      const photosBefore = bot.photos.length;
      const messagesBefore = bot.messages.length;
      const answerBefore = bot.callbackAnswers.length;
      const result = await sendCallbackQuery({ request, query, bot }, sourceChat, data, callbackId);
      assert.equal(result.response.status, 200);
      await waitFor(() => bot.messages.length === messagesBefore + 1, `${callbackId} should receive recovery guidance`);
      await waitFor(() => bot.callbackAnswers.length === answerBefore + 1, `${callbackId} should still be acknowledged`);
      assert.equal(bot.photos.length, photosBefore, `${callbackId} must not produce a photo`);
      assert.match(bot.lastText(), /^⚠️ .*fresh menu/, `${callbackId} gets emoji recovery guidance`);
    };

    await rejected(callbackData, 'summary-wrong-chat', PRIVATE_CHAT(chatId + 1));
    const altered = `${callbackData.slice(0, -1)}${callbackData.endsWith('A') ? 'B' : 'A'}`;
    await rejected(altered, 'summary-altered');
    query(`UPDATE telegram_connections SET enabled = 0 WHERE id = ${connectionId}`);
    await rejected(callbackData, 'summary-disabled');
    query(`UPDATE telegram_connections SET enabled = 1 WHERE id = ${connectionId}`);
    await rejected('ds2.not-a-valid-packet', 'summary-malformed');
    await rejected(expiredSummaryCallback(connectionId), 'summary-expired');
  });
});
