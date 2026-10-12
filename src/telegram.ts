/**
 * Telegram notifications.
 *
 * Notifications are a read of the immutable audit log, never a second ledger: this module can only
 * append to its own outbox and call the Bot API, so no Telegram message, command or failure can
 * create, change or remove a financial record. Delivery is durable — an event is written to the
 * outbox in the same batch that advances a chat's watermark, and only then sent — so a crash, a
 * retry or a rate limit can never duplicate or lose the record of what happened.
 *
 * Wording is anonymous and passive, exactly like the in-app digest: a message says what happened,
 * never who did it.
 *
 * Configuration lives in Worker secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) plus an
 * optional `TELEGRAM_BOT_USERNAME` / `PUBLIC_ORIGIN` / `TELEGRAM_API_BASE`. With no token and no
 * webhook secret the whole feature stays inert: nothing is sent, nothing is paired, and the webhook
 * endpoint refuses every request.
 */

export type TelegramEnv = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_API_BASE?: string;
  PUBLIC_ORIGIN?: string;
};

/** How long a connect link stays usable. Short enough that a leaked link is worthless soon after. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** How long a chat keeps hearing about changes once it is linked. */
export const WEBHOOK_PATH = '/api/telegram/webhook';

const DEFAULT_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIME_ZONE = 'UTC';
/**
 * How many dispatch chances a *retryable* failure gets (rate limits, outages, timeouts) before the message
 * is given up on. Every committed write and every incoming update is a chance, so this is a long window in
 * a workspace anyone is using — but it is not infinite: a chat that stays unreachable for this many
 * opportunities loses its queued messages, and the reason is recorded on the connection where the Setup tab
 * shows it. Failures that can never succeed (blocked bot, deleted chat) skip this entirely and switch the
 * chat off on the first attempt.
 */
const MAX_ATTEMPTS = 12;
const SEND_BATCH_LIMIT = 20;
const MAX_OPEN_TOKENS = 5;
const AUDIT_WINDOW_LIMIT = 200;
/** Rows committed by one request land within a few milliseconds of each other; two seconds apart is a different action. */
const CLUSTER_GAP_MS = 2000;

export type TelegramConnectionRow = {
  id: number;
  workspace_id: number;
  chat_id: string;
  chat_title: string;
  chat_type: string;
  enabled: number;
  last_audit_id: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicTelegramConnection = {
  id: number;
  chat_title: string;
  chat_type: string;
  enabled: boolean;
  last_error: string | null;
  created_at: string;
};

export type TelegramStatus = {
  configured: boolean;
  bot_username: string | null;
  connections: PublicTelegramConnection[];
};

export type PairingLink = {
  token: string;
  command: string;
  /** The same command addressed to the bot by name — the form a group needs, since Telegram only passes
   *  on a group command that names the bot. Null until the bot username is known. */
  group_command: string | null;
  url: string | null;
  expires_at: string;
  expires_in_seconds: number;
};

type AuditRow = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  occurred_at: string;
};

type Json = Record<string, unknown>;

type ApiResult<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string; retry_after: number };

type ApiEnvelope<T> = { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };

type TelegramChat = { id: number | string; type?: string; title?: string; first_name?: string; last_name?: string; username?: string };
type TelegramUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TelegramUpdate = { message?: { chat?: TelegramChat; from?: TelegramUser; text?: string } };

const NO_DECIMAL_CURRENCIES = ['BIF', 'CLP', 'DJF', 'GNF', 'HUF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];

const SETTING_LABELS: Record<string, string> = {
  timezone: 'Time zone',
  auto_offset: 'Automatic netting',
  backup_every: 'Backup every',
  categories_json: 'Categories',
  small_amount_guard_json: 'Small-amount guard',
};

// ---------------------------------------------------------------------------- configuration

function botToken(env: TelegramEnv): string {
  return (env.TELEGRAM_BOT_TOKEN ?? '').trim();
}

function webhookSecret(env: TelegramEnv): string {
  return (env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
}

/** A deployment with no bot token and no webhook secret cannot pair, receive or send anything. */
export function telegramConfigured(env: TelegramEnv): boolean {
  return Boolean(botToken(env) && webhookSecret(env));
}

/**
 * The Bot API origin. A token travels in the path of every call, so an override is only honoured for
 * a loopback address (the test double) — anything else must be https.
 */
export function telegramApiBase(env: TelegramEnv): string {
  const raw = (env.TELEGRAM_API_BASE ?? '').trim();
  if (!raw) return DEFAULT_API_BASE;
  try {
    const url = new URL(raw);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !loopback) return DEFAULT_API_BASE;
    return url.origin;
  } catch {
    return DEFAULT_API_BASE;
  }
}

/** The public app root. Never a workspace capability URL: the button only ever opens the front door. */
function publicRoot(env: TelegramEnv, request: Request): string {
  const configured = (env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

export function isTelegramWebhookPath(pathname: string): boolean {
  return pathname === WEBHOOK_PATH;
}

// ---------------------------------------------------------------------------- primitives

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes, url-safe: the same shape as a workspace secret, so both fit a chat message. */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameSecret(first: string, second: string): boolean {
  if (!first || !second || first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Telegram never sees a token in our storage, and our logs never keep one from Telegram. */
function redact(text: string): string {
  return String(text ?? '')
    .replace(/[0-9]{6,}:[A-Za-z0-9_-]{30,}/g, '[redacted]')
    .slice(0, 200);
}

function money(minor: unknown, code: unknown): string {
  const value = Number(minor) || 0;
  const currency = String(code ?? '').toUpperCase();
  const decimals = NO_DECIMAL_CURRENCIES.includes(currency) && value % 100 === 0 ? 0 : 2;
  const text = Math.abs(value / 100).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency ? `${currency} ${text}` : text;
}

function formatStamp(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseJson(value: string | null): Json {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------- Bot API

let cachedBotUsername: string | null = null;

async function callApi<T>(env: TelegramEnv, method: string, payload: Json): Promise<ApiResult<T>> {
  const token = botToken(env);
  if (!token) return { ok: false, error_code: 0, description: 'Telegram is not configured', retry_after: 0 };
  let response: Response;
  try {
    response = await fetch(`${telegramApiBase(env)}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error_code: 0, description: 'Telegram was unreachable', retry_after: 0 };
  }
  let body: { ok?: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    body = null;
  }
  if (!body || body.ok !== true) {
    return {
      ok: false,
      error_code: Number(body?.error_code ?? response.status ?? 0),
      description: redact(String(body?.description ?? 'Telegram rejected the request')),
      retry_after: Number(body?.parameters?.retry_after ?? 0) || 0,
    };
  }
  return { ok: true, result: body.result as T };
}

/** The bot's @username, needed for a `t.me` deep link. Public information, cached per isolate. */
export async function botUsername(env: TelegramEnv): Promise<string | null> {
  const override = (env.TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '');
  if (override) return /^[A-Za-z0-9_]{3,64}$/.test(override) ? override : null;
  if (cachedBotUsername) return cachedBotUsername;
  if (!botToken(env)) return null;
  const me = await callApi<{ username?: string }>(env, 'getMe', {});
  const username = me.ok ? (me.result?.username ?? '') : '';
  if (!/^[A-Za-z0-9_]{3,64}$/.test(username)) return null;
  cachedBotUsername = username;
  return cachedBotUsername;
}

async function sendMessage(env: TelegramEnv, chatId: string, text: string, replyMarkup?: Json): Promise<ApiResult<{ message_id?: number }>> {
  const payload: Json = { chat_id: chatId, text, link_preview_options: { is_disabled: true } };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return callApi<{ message_id?: number }>(env, 'sendMessage', payload);
}

// ---------------------------------------------------------------------------- connections

function publicConnection(row: Pick<TelegramConnectionRow, 'id' | 'chat_title' | 'chat_type' | 'enabled' | 'last_error' | 'created_at'>): PublicTelegramConnection {
  return {
    id: row.id,
    chat_title: row.chat_title,
    chat_type: row.chat_type,
    enabled: Number(row.enabled) === 1,
    last_error: row.last_error,
    created_at: row.created_at,
  };
}

export async function listConnections(env: TelegramEnv, workspaceId: number): Promise<PublicTelegramConnection[]> {
  const rows = await env.DB.prepare(
    'SELECT id, chat_title, chat_type, enabled, last_error, created_at FROM telegram_connections WHERE workspace_id = ? ORDER BY id',
  )
    .bind(workspaceId)
    .all<Pick<TelegramConnectionRow, 'id' | 'chat_title' | 'chat_type' | 'enabled' | 'last_error' | 'created_at'>>();
  return rows.results.map(publicConnection);
}

/** `withUsername` costs a Bot API call, so it is only asked for when a connect link is about to be built. */
export async function telegramStatus(env: TelegramEnv, workspaceId: number, withUsername = false): Promise<TelegramStatus> {
  const configured = telegramConfigured(env);
  return {
    configured,
    bot_username: configured && withUsername ? await botUsername(env) : null,
    connections: await listConnections(env, workspaceId),
  };
}

/** Mints a single-use connect link. Only the hash is stored; the token itself never reaches D1. */
export async function createPairing(env: TelegramEnv, workspaceId: number): Promise<PairingLink | null> {
  if (!telegramConfigured(env)) return null;
  const expiry = nowIso();
  await env.DB.batch([
    // A link that is already dead can never be used, so it only sits there as clutter.
    env.DB.prepare('DELETE FROM telegram_pairing_tokens WHERE workspace_id = ? AND consumed_at IS NULL AND expires_at <= ?').bind(workspaceId, expiry),
    // Keep the newest few open links: an abandoned click on "Connect" must not leave a trail of live tokens.
    env.DB.prepare(
      'DELETE FROM telegram_pairing_tokens WHERE workspace_id = ? AND consumed_at IS NULL AND id NOT IN (SELECT id FROM telegram_pairing_tokens WHERE workspace_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT ?)',
    ).bind(workspaceId, workspaceId, MAX_OPEN_TOKENS),
  ]);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  await env.DB.prepare('INSERT INTO telegram_pairing_tokens (workspace_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(workspaceId, await sha256Hex(token), expiresAt).run();
  const username = await botUsername(env);
  return {
    token,
    command: `/start ${token}`,
    group_command: username ? `/start@${username} ${token}` : null,
    url: username ? `https://t.me/${username}?start=${token}` : null,
    expires_at: expiresAt,
    expires_in_seconds: Math.round(PAIRING_TTL_MS / 1000),
  };
}

export async function setConnectionEnabled(env: TelegramEnv, workspaceId: number, connectionId: number, enabled: boolean): Promise<PublicTelegramConnection | null> {
  const row = await env.DB.prepare('SELECT id FROM telegram_connections WHERE id = ? AND workspace_id = ?').bind(connectionId, workspaceId).first<{ id: number }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE telegram_connections SET enabled = ?, last_error = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(enabled ? 1 : 0, nowIso(), connectionId, workspaceId)
    .run();
  if (!enabled) {
    // Nothing is owed to a chat that has been switched off: drop its queued messages instead of
    // letting them pile up and burst out if it is switched on again later.
    await env.DB.prepare("UPDATE telegram_notifications SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE connection_id = ? AND status = 'pending'")
      .bind('Turned off before delivery', connectionId)
      .run();
  }
  const updated = await env.DB.prepare('SELECT id, chat_title, chat_type, enabled, last_error, created_at FROM telegram_connections WHERE id = ? AND workspace_id = ?')
    .bind(connectionId, workspaceId)
    .first<Pick<TelegramConnectionRow, 'id' | 'chat_title' | 'chat_type' | 'enabled' | 'last_error' | 'created_at'>>();
  return updated ? publicConnection(updated) : null;
}

export async function removeConnection(env: TelegramEnv, workspaceId: number, connectionId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM telegram_connections WHERE id = ? AND workspace_id = ?').bind(connectionId, workspaceId).first<{ id: number }>();
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM telegram_notifications WHERE connection_id = ?').bind(connectionId),
    env.DB.prepare('DELETE FROM telegram_connections WHERE id = ? AND workspace_id = ?').bind(connectionId, workspaceId),
  ]);
  return true;
}

// ---------------------------------------------------------------------------- pairing

type PairingFailure = { error: 'invalid' | 'used' | 'expired' | 'inactive' };

async function consumePairingToken(env: TelegramEnv, token: string): Promise<{ workspaceId: number } | PairingFailure> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return { error: 'invalid' };
  const row = await env.DB.prepare('SELECT id, workspace_id, expires_at, consumed_at FROM telegram_pairing_tokens WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<{ id: number; workspace_id: number; expires_at: string; consumed_at: string | null }>();
  if (!row || row.consumed_at) return { error: row ? 'used' : 'invalid' };
  if (Date.parse(row.expires_at) <= Date.now()) return { error: 'expired' };
  const workspace = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ? AND is_active = 1').bind(row.workspace_id).first<{ id: number }>();
  if (!workspace) return { error: 'inactive' };
  // This guarded update is the single-use gate: whichever request wins the race consumes the token,
  // and any loser sees zero changed rows and is refused.
  const consumed = await env.DB.prepare('UPDATE telegram_pairing_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(nowIso(), row.id).run();
  if (!consumed.meta || Number(consumed.meta.changes) === 0) return { error: 'used' };
  return { workspaceId: row.workspace_id };
}

function chatTitle(chat: TelegramChat): string {
  const title = (chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ?? '').trim();
  return title.slice(0, 120) || 'Telegram chat';
}

function chatType(chat: TelegramChat): string {
  const type = String(chat.type ?? '').trim();
  return ['private', 'group', 'supergroup', 'channel'].includes(type) ? type : 'private';
}

/** A private chat is its own administrator; a group or channel needs a Telegram administrator to say yes. */
async function eligible(env: TelegramEnv, chat: TelegramChat, from: TelegramUser | undefined): Promise<boolean> {
  const type = chatType(chat);
  if (type === 'private') return true;
  if (type === 'channel') return false;
  if (!from || !Number.isInteger(from.id)) return false;
  const member = await callApi<{ status?: string }>(env, 'getChatMember', { chat_id: String(chat.id), user_id: from.id });
  if (!member.ok) return false;
  return member.result?.status === 'creator' || member.result?.status === 'administrator';
}

async function linkChat(env: TelegramEnv, workspaceId: number, chat: TelegramChat): Promise<{ name: string; duplicate: boolean } | null> {
  const workspace = await env.DB.prepare('SELECT id, name FROM workspaces WHERE id = ? AND is_active = 1').bind(workspaceId).first<{ id: number; name: string }>();
  if (!workspace) return null;
  const chatId = String(chat.id);
  const existing = await env.DB.prepare('SELECT id FROM telegram_connections WHERE workspace_id = ? AND chat_id = ?').bind(workspace.id, chatId).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare('UPDATE telegram_connections SET enabled = 1, chat_title = ?, chat_type = ?, last_error = NULL, updated_at = ? WHERE id = ?')
      .bind(chatTitle(chat), chatType(chat), nowIso(), existing.id)
      .run();
    return { name: workspace.name, duplicate: true };
  }
  // The watermark is read in the same statement that inserts the row, so linking a chat never
  // replays the trip's history into it — only what happens next is announced.
  await env.DB.prepare(
    'INSERT INTO telegram_connections (workspace_id, chat_id, chat_title, chat_type, last_audit_id) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM audit_log WHERE workspace_id = ?))',
  )
    .bind(workspace.id, chatId, chatTitle(chat), chatType(chat), workspace.id)
    .run();
  return { name: workspace.name, duplicate: false };
}

async function sendWelcome(env: TelegramEnv, chatId: string, root: string): Promise<void> {
  const lines = [
    'Trip Finance Workspace',
    '',
    'A shared trip-expense ledger. One private link per trip — no accounts, no sign-ups, nothing to install.',
    '',
    'Tap the button below to create a trip or open one you already have. To get trip updates here, open that trip’s ⚙️ Setup tab and press “Connect Telegram chat”: changes are then announced in this chat anonymously, and this chat can never change a record itself.',
  ];
  const markup = root ? { inline_keyboard: [[{ text: 'Open Trip Finance Workspace', url: root }]] } : undefined;
  await sendMessage(env, chatId, lines.join('\n'), markup);
}

const PAIRING_REFUSALS: Record<string, string> = {
  invalid: 'That connect link is not valid. Open the trip’s ⚙️ Setup tab and press “Connect Telegram chat” to get a fresh one.',
  used: 'That connect link has already been used — each one works exactly once. Open the trip’s ⚙️ Setup tab for a new one.',
  expired: 'That connect link has expired — they last ten minutes. Open the trip’s ⚙️ Setup tab for a fresh one.',
  inactive: 'That trip is no longer active, so this chat cannot be connected to it.',
};

async function handleStart(env: TelegramEnv, update: TelegramUpdate, root: string): Promise<void> {
  const message = update.message;
  const chat = message?.chat;
  if (!chat || chat.id === undefined || chat.id === null) return;
  const chatId = String(chat.id);
  const text = (message?.text ?? '').trim();
  // V1 answers /start and nothing else: no command can read, let alone write, the ledger.
  if (!/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) return;
  const payload = text.split(/\s+/).slice(1).join('').trim();
  if (!payload) {
    await sendWelcome(env, chatId, root);
    return;
  }
  if (chatType(chat) !== 'private' && !(await eligible(env, chat, message?.from))) {
    await sendMessage(env, chatId, 'Only a Telegram administrator can connect a group. Ask an admin of this group to send that command.');
    return;
  }
  const consumed = await consumePairingToken(env, payload);
  if ('error' in consumed) {
    await sendMessage(env, chatId, PAIRING_REFUSALS[consumed.error] ?? PAIRING_REFUSALS.invalid);
    return;
  }
  const linked = await linkChat(env, consumed.workspaceId, chat);
  if (!linked) {
    await sendMessage(env, chatId, 'That trip could not be connected right now. Please try again from its ⚙️ Setup tab.');
    return;
  }
  const opening = linked.duplicate ? '✅ This chat is already connected to' : '✅ This chat is now connected to';
  await sendMessage(
    env,
    chatId,
    [
      `${opening} “${linked.name}”.`,
      '',
      'Changes to that trip’s ledger are announced here with a short, anonymous message — it never says who made the change. This chat cannot change any record. Disconnect any time from the trip’s ⚙️ Setup tab.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------- webhook

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/**
 * Telegram calls this endpoint with the secret registered at setWebhook time. Without a configured
 * token and secret the endpoint refuses everything, so an unconfigured deployment stays shut.
 */
export async function handleTelegramWebhook(request: Request, env: TelegramEnv): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const expected = webhookSecret(env);
  const provided = (request.headers.get('x-telegram-bot-api-secret-token') ?? '').trim();
  if (!telegramConfigured(env) || !sameSecret(provided, expected)) return jsonResponse({ error: 'Unauthorized' }, 401);
  let update: TelegramUpdate | null = null;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return jsonResponse({ error: 'Invalid update' }, 400);
  }
  if (!update || typeof update !== 'object') return jsonResponse({ error: 'Invalid update' }, 400);
  const chatId = update.message?.chat?.id;
  try {
    await handleStart(env, update, publicRoot(env, request));
  } catch {
    // Our own bookkeeping must never turn into an endless Telegram retry loop, but the person on the
    // other end is still owed an answer.
    if (chatId !== undefined && chatId !== null) await sendMessage(env, String(chatId), 'Something went wrong on our side. Please try the connect button in the trip’s ⚙️ Setup tab again.').catch(() => {});
    return jsonResponse({ ok: true });
  }
  // Any incoming update is also a chance to flush messages that a rate limit or an outage left queued.
  await retryQueued(env).catch(() => {});
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------- message wording

function header(name: string): string {
  return `Trip Finance — ${name.slice(0, 60)}`;
}

function groupIdOf(row: AuditRow): string | null {
  const group = parseJson(row.after_json)['import_group_id'];
  return typeof group === 'string' && group ? group : null;
}

function isOffsetRow(row: AuditRow): boolean {
  const group = groupIdOf(row) ?? '';
  return group.startsWith('offset:') || group.startsWith('auto-offset:');
}

function firstAuditId(key: string): number {
  return Number(key.split('-')[0]) || 0;
}

function keyFor(rows: AuditRow[]): string {
  return `${rows[0].id}-${rows[rows.length - 1].id}`;
}

function clusterByTime(rows: AuditRow[]): AuditRow[][] {
  const clusters: AuditRow[][] = [];
  for (const row of rows) {
    const current = clusters[clusters.length - 1];
    const previous = current?.[current.length - 1];
    const gap = previous ? Math.abs(Date.parse(row.occurred_at) - Date.parse(previous.occurred_at)) : Number.POSITIVE_INFINITY;
    if (current && gap <= CLUSTER_GAP_MS) current.push(row);
    else clusters.push([row]);
  }
  return clusters;
}

function createHeadline(rows: AuditRow[]): string {
  const prefixes = new Set(rows.map((row) => (groupIdOf(row) ?? '').split(':')[0]));
  if (prefixes.has('import')) return '📥 An import from a spreadsheet was committed';
  if (prefixes.has('split')) return '🧾 A bill was split';
  if (prefixes.has('batch')) return '🧾 A batch of entries was committed';
  if (prefixes.has('offset')) return '🔁 A settlement was recorded';
  if (prefixes.has('auto-offset')) return '🔁 Reciprocal balances were netted';
  return '📝 Entries were added';
}

function perCurrencyTotals(rows: AuditRow[]): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const after = parseJson(row.after_json);
    if (String(after['entry_kind'] ?? 'debt') === 'payment') continue;
    const currency = String(after['currency_code'] ?? '').toUpperCase();
    if (!currency) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + (Number(after['amount_minor']) || 0));
  }
  // Currencies are never added together: each one keeps its own line.
  const lines = [...totals.entries()].filter(([, total]) => total > 0).map(([currency, total]) => money(total, currency));
  if (lines.length <= 3) return lines.join(' · ');
  return `${lines.slice(0, 3).join(' · ')} +${lines.length - 3} more currencies`;
}

function createMessage(rows: AuditRow[], name: string, timeZone: string): { key: string; body: string } {
  const key = keyFor(rows);
  const first = parseJson(rows[0].after_json);
  if (rows.length === 1 && !groupIdOf(rows[0])) {
    const payment = String(first['entry_kind'] ?? 'debt') === 'payment';
    const lines = [header(name), '', payment ? '💸 A repayment was recorded' : '🟢 A transaction was recorded'];
    const detail = [String(first['topic'] ?? '').trim(), money(first['amount_minor'], first['currency_code'])].filter(Boolean).join(' · ');
    if (detail) lines.push(detail);
    const stamp = formatStamp(rows[0].occurred_at, timeZone);
    if (stamp) lines.push(stamp);
    return { key, body: lines.join('\n') };
  }
  const parsed = rows.map((row) => parseJson(row.after_json));
  const offsets = rows.filter(isOffsetRow);
  const payments = rows.filter((row) => !isOffsetRow(row) && String(parseJson(row.after_json)['entry_kind'] ?? 'debt') === 'payment');
  const debts = rows.filter((row) => !isOffsetRow(row) && String(parseJson(row.after_json)['entry_kind'] ?? 'debt') !== 'payment');
  const lines = [header(name), '', createHeadline(rows)];
  const added = debts.length + payments.length;
  if (added) lines.push(`${added} ${added === 1 ? 'entry was' : 'entries were'} added`);
  const topics = [...new Set(debts.map((row) => String(parseJson(row.after_json)['topic'] ?? '').trim()).filter(Boolean))];
  if (topics.length) lines.push(topics.slice(0, 3).join(', ') + (topics.length > 3 ? ` +${topics.length - 3} more` : ''));
  const totals = perCurrencyTotals(debts);
  if (totals) lines.push(totals);
  if (payments.length) lines.push(`💸 ${payments.length} ${payments.length === 1 ? 'repayment was' : 'repayments were'} recorded`);
  if (offsets.length) lines.push(`🔁 ${offsets.length} netting ${offsets.length === 1 ? 'row was' : 'rows were'} written`);
  const stamp = formatStamp(rows[rows.length - 1].occurred_at, timeZone);
  if (stamp) lines.push(stamp);
  void parsed;
  return { key, body: lines.join('\n') };
}

const ACTION_LABELS: Record<string, string> = {
  update: '✏️ A row was edited',
  archive: '🗄️ A row was archived',
  restore: '♻️ A row was restored',
  delete: '❌ A row was removed',
};

function transactionActionMessage(rows: AuditRow[], name: string, timeZone: string): { key: string; body: string } {
  const lines = [header(name), ''];
  for (const action of ['update', 'archive', 'restore', 'delete']) {
    const matching = rows.filter((row) => row.action === action);
    if (!matching.length) continue;
    const label = ACTION_LABELS[action] ?? '✏️ A row was changed';
    lines.push(matching.length === 1 ? label : `${label.replace(/^(\S+ )An? /, '$1')}${matching.length} rows were ${label.split(' ').slice(2).join(' ')}`);
    if (matching.length === 1) {
      const after = parseJson(matching[0].after_json);
      const before = parseJson(matching[0].before_json);
      const detail = [String(after['topic'] ?? before['topic'] ?? '').trim(), money(after['amount_minor'] ?? before['amount_minor'], after['currency_code'] ?? before['currency_code'])].filter(Boolean).join(' · ');
      if (detail) lines.push(detail);
    }
  }
  const stamp = formatStamp(rows[rows.length - 1].occurred_at, timeZone);
  if (stamp) lines.push(stamp);
  return { key: keyFor(rows), body: lines.join('\n') };
}

function settingLines(rows: AuditRow[]): string[] {
  const lines: string[] = [];
  const changed = (before: Json, after: Json, key: string): boolean => JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  const push = (label: string, value: string) => {
    lines.push(`Setting: ${label}`, `New value: ${value}`);
  };
  // A roster or currency change reads as a sentence rather than a label with a value under it.
  const note = (text: string) => {
    lines.push(text);
  };
  for (const row of rows) {
    const before = parseJson(row.before_json);
    const after = parseJson(row.after_json);
    if (row.entity_type === 'workspace_settings') {
      for (const [key, label] of Object.entries(SETTING_LABELS)) {
        if (!changed(before, after, key)) continue;
        const value = after[key];
        if (key === 'auto_offset') push(label, Number(value) === 1 || value === true ? 'On' : 'Off');
        else if (key === 'backup_every') {
          const count = Number(value) || 0;
          push(label, count > 0 ? `Every ${count} ledger rows` : 'Off');
        } else if (key === 'categories_json') {
          const categories = Array.isArray(value) ? value.map((item) => String(item)) : [];
          push(label, `${categories.slice(0, 3).join(', ')}${categories.length > 3 ? ` +${categories.length - 3} more` : ''}`);
        } else if (key === 'small_amount_guard_json') {
          const guard = value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
          const amounts = Object.entries(guard).map(([currency, amount]) => money(amount, currency));
          push(label, amounts.length ? amounts.slice(0, 3).join(', ') : 'Off');
        } else push(label, String(value ?? ''));
      }
      continue;
    }
    if (row.entity_type === 'workspace') {
      if (changed(before, after, 'name')) note(`Trip name is now “${String(after['name'] ?? '')}”`);
      continue;
    }
    if (row.entity_type === 'person') {
      note(`Trip members: ${`${String(after['emoji'] ?? '')} ${String(after['display_name'] ?? before['display_name'] ?? '')}`.trim()} was ${row.action}d`);
      continue;
    }
    if (row.entity_type === 'currency') {
      if (row.action === 'update' && Number(after['is_default']) === 1) push('Default currency', String(after['code'] ?? ''));
      else note(`Currency ${String(after['code'] ?? before['code'] ?? '')} was ${row.action}d`);
      continue;
    }
    // Anything else stays quiet on purpose: backup bookkeeping and receipt housekeeping are not
    // changes anyone made to the ledger, and dressing them up as one would only be noise.
  }
  if (lines.length > 6) return [...lines.slice(0, 6), `+${lines.length - 6} more changes`];
  return lines;
}

function settingsMessage(rows: AuditRow[], name: string, timeZone: string): { key: string; body: string } | null {
  const lines = settingLines(rows);
  if (!lines.length) return null;
  const stamp = formatStamp(rows[rows.length - 1].occurred_at, timeZone);
  return { key: keyFor(rows), body: [header(name), '', '⚙️ The trip’s setup was changed', ...lines, stamp].filter((line) => line !== '').join('\n') };
}

/** Turns a window of audit rows into the fewest messages that still say exactly what happened. */
export function buildMessages(rows: AuditRow[], context: { name: string; timeZone: string }): { key: string; body: string }[] {
  const messages: { key: string; body: string }[] = [];
  for (const cluster of clusterByTime(rows)) {
    const creates = cluster.filter((row) => row.entity_type === 'transaction' && row.action === 'create');
    const touched = cluster.filter((row) => row.entity_type === 'transaction' && row.action !== 'create');
    const settings = cluster.filter((row) => row.entity_type !== 'transaction');
    if (creates.length) messages.push(createMessage(creates, context.name, context.timeZone));
    if (touched.length) messages.push(transactionActionMessage(touched, context.name, context.timeZone));
    const settingsBody = settings.length ? settingsMessage(settings, context.name, context.timeZone) : null;
    if (settingsBody) messages.push(settingsBody);
  }
  return messages.sort((first, second) => firstAuditId(first.key) - firstAuditId(second.key));
}

// ---------------------------------------------------------------------------- dispatch

async function flushConnection(env: TelegramEnv, workspaceId: number): Promise<void> {
  const pending = await env.DB.prepare(
    `SELECT n.id, n.connection_id, n.body, n.attempts, c.chat_id, c.enabled
       FROM telegram_notifications n
       JOIN telegram_connections c ON c.id = n.connection_id
      WHERE n.workspace_id = ? AND n.status = 'pending' AND n.attempts < ?
      ORDER BY n.id LIMIT ?`,
  )
    .bind(workspaceId, MAX_ATTEMPTS, SEND_BATCH_LIMIT)
    .all<{ id: number; connection_id: number; body: string; attempts: number; chat_id: string; enabled: number }>();
  for (const row of pending.results) {
    if (Number(row.enabled) !== 1) {
      await env.DB.prepare("UPDATE telegram_notifications SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?").bind('Chat is turned off', row.id).run();
      continue;
    }
    const sent = await sendMessage(env, row.chat_id, row.body);
    if (sent.ok) {
      await env.DB.prepare("UPDATE telegram_notifications SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?").bind(nowIso(), row.id).run();
      continue;
    }
    const attempts = row.attempts + 1;
    // A blocked bot, a deleted chat or a kicked bot will never recover by retrying, so the chat is
    // switched off and the reason is kept for the Setup tab.
    if (sent.error_code === 403 || sent.error_code === 400 || sent.error_code === 404) {
      await env.DB.batch([
        env.DB.prepare("UPDATE telegram_notifications SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").bind(attempts, sent.description, row.id),
        env.DB.prepare('UPDATE telegram_connections SET enabled = 0, last_error = ?, updated_at = ? WHERE id = ?').bind(sent.description, nowIso(), row.connection_id),
      ]);
      continue;
    }
    const exhausted = attempts >= MAX_ATTEMPTS;
    const updates = [
      env.DB.prepare('UPDATE telegram_notifications SET status = ?, attempts = ?, last_error = ? WHERE id = ?')
        .bind(exhausted ? 'failed' : 'pending', attempts, sent.description, row.id),
    ];
    // Giving up is worth seeing: this chat stays switched on, so the reason is recorded on the connection
    // too — where the Setup tab already renders it — instead of the message going missing quietly.
    if (exhausted) {
      updates.push(
        env.DB.prepare('UPDATE telegram_connections SET last_error = ?, updated_at = ? WHERE id = ?')
          .bind(`Undelivered message: ${sent.description}`, nowIso(), row.connection_id),
      );
    }
    await env.DB.batch(updates);
    // Rate limited: the rest of the queue waits for the next dispatch instead of hammering the API.
    if (sent.error_code === 429) break;
  }
}

/** Flushes whatever is queued, wherever it is queued. Used by the webhook, which is always a retry chance. */
async function retryQueued(env: TelegramEnv): Promise<void> {
  const pending = await env.DB.prepare("SELECT DISTINCT workspace_id FROM telegram_notifications WHERE status = 'pending' AND attempts < ? LIMIT 5")
    .bind(MAX_ATTEMPTS)
    .all<{ workspace_id: number }>();
  for (const row of pending.results) await flushConnection(env, row.workspace_id);
}

/**
 * Announces everything that has been audited in this workspace since each chat last heard from us.
 *
 * Called only after a write has already committed: the ledger is never waiting on Telegram, and a
 * delivery failure can only ever leave a message queued. Events are written to the outbox and the
 * chat's watermark is advanced in one batch, so a retry cannot repeat or lose an event.
 */
export async function dispatchWorkspaceNotifications(env: TelegramEnv, workspaceId: number): Promise<void> {
  if (!telegramConfigured(env)) return;
  const workspace = await env.DB.prepare(
    'SELECT w.id, w.name, s.timezone FROM workspaces w LEFT JOIN workspace_settings s ON s.workspace_id = w.id WHERE w.id = ? AND w.is_active = 1',
  )
    .bind(workspaceId)
    .first<{ id: number; name: string; timezone: string | null }>();
  if (!workspace) return;
  const timeZone = workspace.timezone && validTimeZone(workspace.timezone) ? workspace.timezone : DEFAULT_TIME_ZONE;
  const connections = await env.DB.prepare('SELECT id, last_audit_id FROM telegram_connections WHERE workspace_id = ? AND enabled = 1 ORDER BY id')
    .bind(workspaceId)
    .all<{ id: number; last_audit_id: number }>();
  for (const connection of connections.results) {
    const rows = await env.DB.prepare(
      'SELECT id, entity_type, entity_id, action, before_json, after_json, occurred_at FROM audit_log WHERE workspace_id = ? AND id > ? ORDER BY id LIMIT ?',
    )
      .bind(workspaceId, connection.last_audit_id, AUDIT_WINDOW_LIMIT)
      .all<AuditRow>();
    if (!rows.results.length) continue;
    const statements: D1PreparedStatement[] = buildMessages(rows.results, { name: workspace.name, timeZone }).map((message) =>
      // Dedupe lives in the database: the unique (connection, event) key makes a replayed dispatch a no-op.
      env.DB.prepare('INSERT OR IGNORE INTO telegram_notifications (workspace_id, connection_id, event_key, body) VALUES (?, ?, ?, ?)').bind(workspaceId, connection.id, message.key, message.body),
    );
    statements.push(env.DB.prepare('UPDATE telegram_connections SET last_audit_id = ? WHERE id = ?').bind(rows.results[rows.results.length - 1].id, connection.id));
    await env.DB.batch(statements);
  }
  await flushConnection(env, workspaceId);
}
