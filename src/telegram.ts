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


import { creditMinorSql, isSettlementRow } from './money';

export type TelegramEnv = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_API_BASE?: string;
  /** Chart renderer override: a loopback address in tests, https in production. */
  CHART_RENDER_URL?: string;
  PUBLIC_ORIGIN?: string;
};

/** How long a connect link stays usable. Short enough that a leaked link is worthless soon after. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/**
 * How long a /start menu keeps working. The buttons sit in a chat message that is stored on Telegram's
 * servers and read by everyone in the chat, so they expire rather than becoming a permanent way in.
 */
export const NAV_TTL_MS = 24 * 60 * 60 * 1000;
/** Summary callbacks are signed, self-contained menu actions rather than stored capabilities. */
export const SUMMARY_CALLBACK_TTL_MS = 15 * 60 * 1000;
/** A chat following more trips than this gets the first few buttons here and the rest in the browser. */
const MAX_MENU_TRIPS = 3;

/** The app's own sections, in the app's own order: creating first, then reading, then the workshop.
 *  This is also the allow-list for /go/<token>/<section> passes, so it stays the full app surface. */
export const NAV_SECTIONS: { tab: string; label: string }[] = [
  { tab: 'add', label: '➕ Create debt' },
  { tab: 'pay', label: '↩️ Record a payment' },
  { tab: 'split', label: '✂️ Split a bill' },
  { tab: 'ledger', label: '📒 Transactions' },
  { tab: 'balances', label: '⚖️ Balances' },
  { tab: 'ranking', label: '🏆 Ranking' },
  { tab: 'receipts', label: '🧾 Receipts' },
  { tab: 'tools', label: '📥 Bulk & import' },
  { tab: 'audit', label: '🕐 Audit' },
  { tab: 'settings', label: '⚙️ Setup' },
];

/** What the /start menu offers as buttons: add a record, read the ledger, check balances. Audit, Setup,
 *  Ranking, Receipts and Bulk & import are deliberately left out — those are pages you reach from the
 *  app's own drawer, not from a chat. */
const MENU_TABS = new Set(['add', 'pay', 'split', 'ledger', 'balances']);
/** Chat-only wording. The website keeps calling that page Balances; a chat button has to say what the
 *  tap gets you, so the inline button promises debts and analytics. */
const CHAT_LABELS: Record<string, string> = { balances: '⚖️ View debts and analytics' };
export const MENU_SECTIONS: { tab: string; label: string }[] = NAV_SECTIONS
  .filter((section) => MENU_TABS.has(section.tab))
  .map((section) => ({ tab: section.tab, label: CHAT_LABELS[section.tab] ?? section.label }));

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
type TelegramUpdate = {
  message?: { chat?: TelegramChat; from?: TelegramUser; text?: string };
  callback_query?: { id?: string; from?: TelegramUser; message?: { chat?: TelegramChat }; data?: string };
};

const NO_DECIMAL_CURRENCIES = ['BIF', 'CLP', 'DJF', 'GNF', 'HUF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];

const SETTING_LABELS: Record<string, string> = {
  timezone: 'Time zone',
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
    return `🕒 ${new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)}`;
  } catch {
    return `🕒 ${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)}`;
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
  return readApiResponse<T>(response, body);
}

/** One answer shape for every Bot API call, whether it carried JSON or multipart. */
function readApiResponse<T>(response: Response, body: ApiEnvelope<unknown> | null): ApiResult<T> {
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


/**
 * The command menu Telegram shows when someone opens the chat. Keep it to commands the webhook really
 * answers: a menu entry that does nothing is worse than no menu at all. Descriptions go to Telegram, so
 * they stay short and free of anything private.
 */
/** Telegram caps a message at 4096 characters; a trip with many people and currencies must still send. */
const MAX_NET_SUMMARY_LINES = 120;

export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: 'start', description: 'Open the trip menu, or connect a trip' },
  { command: 'netsummary', description: 'Net balances with the payments under each person' },
  { command: 'chart', description: 'Bar chart of what each person owes and is owed' },
  { command: 'disconnect', description: 'Stop trip notifications in this chat' },
];

let commandsRegistered = false;

let webhookUpdatesChecked = false;

/**
 * Telegram only forwards update types listed at setWebhook time. Older registrations listed
 * "message" alone, so inline-button taps (callback queries) were dropped before they ever reached
 * us. This runs once per isolate after an authenticated update: it checks the live registration and
 * widens it when callback queries are missing. Both calls use the bot token bound to this Worker,
 * so no credential ever leaves the runtime.
 */
export async function ensureWebhookAcceptsCallbacks(env: TelegramEnv, request: Request): Promise<void> {
  if (webhookUpdatesChecked || !telegramConfigured(env)) return;
  webhookUpdatesChecked = true;
  try {
    const info = await callApi<{ allowed_updates?: string[]; url?: string }>(env, 'getWebhookInfo', {});
    if (!info.ok) return;
    const allowed = info.result?.allowed_updates ?? [];
    if (allowed.includes('callback_query')) return;
    const url = `${new URL(request.url).origin}/api/telegram/webhook`;
    await callApi(env, 'setWebhook', {
      url,
      secret_token: webhookSecret(env),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
  } catch {
    // A failed widening attempt must never break update handling; the next isolate retries.
    webhookUpdatesChecked = false;
  }
}


/**
 * Publishes BOT_COMMANDS to Telegram. Idempotent — `setMyCommands` replaces the list rather than adding
 * to it — so it is safe on every deploy and every cold start. Called once per isolate on the first
 * authenticated update (see the webhook), and again explicitly by tools/telegram-setup.sh.
 */
export async function syncBotCommands(env: TelegramEnv): Promise<{ ok: boolean; registered: string[]; error?: string }> {
  if (!telegramConfigured(env)) return { ok: false, registered: [], error: 'Telegram is not configured' };
  const result = await callApi<boolean>(env, 'setMyCommands', { commands: BOT_COMMANDS });
  if (!result.ok) return { ok: false, registered: [], error: result.description };
  commandsRegistered = true;
  return { ok: true, registered: BOT_COMMANDS.map((entry) => entry.command) };
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

async function answerCallbackQuery(env: TelegramEnv, callbackQueryId: string): Promise<ApiResult<boolean>> {
  return callApi<boolean>(env, 'answerCallbackQuery', { callback_query_id: callbackQueryId });
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
    env.DB.prepare('DELETE FROM telegram_nav_links WHERE connection_id = ?').bind(connectionId),
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
    'Tap the button below to create a trip or open one you already have. To get trip updates here, open that trip’s ⚙️ Setup tab and press “Connect Telegram chat”: changes are then announced in this chat, naming who owes or paid what, and this chat can never change a record itself.',
    '',
    'Once a trip is connected, /start shows a menu that jumps straight into it, /netsummary puts each person\u2019s balance above the payments they make or take, and /disconnect stops the messages in this chat.',
  ];
  const markup = root ? { inline_keyboard: [[{ text: 'Open Trip Finance Workspace', url: root }]] } : undefined;
  await sendMessage(env, chatId, lines.join('\n'), markup);
}

// ---------------------------------------------------------------------------- navigation menu

type LinkedTrip = { connectionId: number; workspaceId: number; enabled: boolean; name: string };

/**
 * The trips this chat follows. The menu only counts the ones switched on and still active; /disconnect
 * passes includeDisabled so a switched-off connection can be removed too.
 */
async function linkedTrips(env: TelegramEnv, chatId: string, includeDisabled = false): Promise<LinkedTrip[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id AS connection_id, c.workspace_id, c.enabled, w.name
       FROM telegram_connections c JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.chat_id = ?${includeDisabled ? '' : ' AND c.enabled = 1 AND w.is_active = 1'}
      ORDER BY c.id`,
  )
    .bind(chatId)
    .all<{ connection_id: number; workspace_id: number; enabled: number; name: string }>();
  return (rows.results ?? []).map((row) => ({
    connectionId: row.connection_id,
    workspaceId: row.workspace_id,
    enabled: Number(row.enabled) === 1,
    name: row.name,
  }));
}

/**
 * Mints the expiring token behind one menu button. The trip's capability secret is stored only as a
 * hash and cannot be rebuilt from D1, so the button carries a pass of its own: hash-only at rest,
 * bound to one connection, swept when it expires, and deleted with the connection. Minting a fresh
 * menu retires the previous pass, so a chat holds exactly one live way in at a time.
 */
async function mintNavToken(env: TelegramEnv, connectionId: number): Promise<string | null> {
  const token = randomToken();
  const now = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM telegram_nav_links WHERE connection_id = ?').bind(connectionId),
      env.DB.prepare('INSERT INTO telegram_nav_links (connection_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(connectionId, await sha256Hex(token), new Date(Date.now() + NAV_TTL_MS).toISOString(), now),
    ]);
  } catch {
    return null;
  }
  return token;
}

function shortTripName(name: string): string {
  const trimmed = name.trim() || 'Trip';
  return trimmed.length > 18 ? `${trimmed.slice(0, 17)}…` : trimmed;
}


type SummaryBalance = { debtor_id: number; creditor_id: number; currency_code: string; outstanding: number; debtor: string; creditor: string };
type SettlementPayment = { from_id: number; to_id: number; from: string; to: string; amount_minor: number; currency_code: string };
type PersonNet = { id: number; name: string; net: number };

/**
 * The smallest set of payments that clears every balance, mirroring the Settle Up card: net each
 * person per currency, then pair the biggest debtor with the biggest creditor until nothing is
 * left. Pairwise debts can chain through a middleman, so this
 * is what a chat needs to act on.
 */
/**
 * Every person's net per currency, signed from the creditor's side: positive means the trip owes them,
 * negative means they owe the trip. /netsummary prints this list and spends it, so the balances and the
 * payments in a reply can never disagree about what a balance is.
 */
function netByCurrency(rows: SummaryBalance[]): Map<string, PersonNet[]> {
  const nets = new Map<string, { id: number; name: string; currency_code: string; net: number }>();
  const bump = (id: number, name: string, currency_code: string, delta: number) => {
    const key = `${currency_code}:${id}`;
    const entry = nets.get(key) ?? { id, name, currency_code, net: 0 };
    entry.net += delta;
    entry.name = name;
    nets.set(key, entry);
  };
  for (const row of rows) {
    bump(row.creditor_id, row.creditor, row.currency_code, row.outstanding);
    bump(row.debtor_id, row.debtor, row.currency_code, -row.outstanding);
  }
  const byCurrency = new Map<string, PersonNet[]>();
  for (const entry of nets.values()) {
    if (!entry.net) continue;
    const people = byCurrency.get(entry.currency_code) ?? [];
    people.push({ id: entry.id, name: entry.name, net: entry.net });
    byCurrency.set(entry.currency_code, people);
  }
  return byCurrency;
}

function settlementPayments(rows: SummaryBalance[]): SettlementPayment[] {
  const payments: SettlementPayment[] = [];
  for (const [currency_code, people] of netByCurrency(rows)) {
    const creditors = people.filter((person) => person.net > 0).sort((a, b) => b.net - a.net);
    const debtors = people.filter((person) => person.net < 0).sort((a, b) => a.net - b.net);
    let debtor = 0;
    let creditor = 0;
    while (debtor < debtors.length && creditor < creditors.length) {
      const amount = Math.min(-debtors[debtor].net, creditors[creditor].net);
      if (amount > 0) {
        payments.push({ from_id: debtors[debtor].id, to_id: creditors[creditor].id, from: debtors[debtor].name, to: creditors[creditor].name, amount_minor: amount, currency_code });
      }
      debtors[debtor].net += amount;
      creditors[creditor].net -= amount;
      if (!debtors[debtor].net) debtor += 1;
      if (!creditors[creditor].net) creditor += 1;
    }
  }
  return payments.sort((a, b) =>
    a.currency_code.localeCompare(b.currency_code) || b.amount_minor - a.amount_minor || a.from.localeCompare(b.from));
}

/**
 * One reading of the ledger for every chat command: same rows, same canonical arithmetic. A command that
 * summed transactions its own way could report a different balance than the app, which is the whole bug
 * class `creditMinorSql` exists to prevent.
 */
async function readOutstanding(env: TelegramEnv, workspaceId: number): Promise<SummaryBalance[]> {
  const rows = await env.DB.prepare(
    `SELECT t.debtor_person_id AS debtor_id, t.creditor_person_id AS creditor_id, t.currency_code,
            SUM(${creditMinorSql('t')}) AS outstanding,
            d.display_name AS debtor, c.display_name AS creditor
       FROM transactions t
       JOIN workspace_people d ON d.id = t.debtor_person_id
       JOIN workspace_people c ON c.id = t.creditor_person_id
      WHERE t.workspace_id = ? AND t.is_deleted = 0
      GROUP BY t.debtor_person_id, t.creditor_person_id, t.currency_code
      HAVING outstanding <> 0`,
  ).bind(workspaceId).all<SummaryBalance>();
  return rows.results;
}

async function activeTripName(env: TelegramEnv, workspaceId: number): Promise<string | null> {
  const workspace = await env.DB.prepare('SELECT name FROM workspaces WHERE id = ? AND is_active = 1').bind(workspaceId).first<{ name: string }>();
  return workspace ? workspace.name : null;
}



// ---------------------------------------------------------------------------- /chart

/**
 * /chart draws what /netsummary says in words: one row per person, the money they owe stacked out to the
 * left and the money they are owed stacked out to the right, with a diamond sitting on the net that
 * actually has to change hands. Rows are sorted by net, so creditors rise to the top.
 *
 * A Worker has no canvas, so the Chart.js config goes to a renderer that returns a PNG; only names and
 * amounts leave the runtime — never a capability token, a chat id, or the workspace link. Read-only: no
 * command in this bot writes the ledger.
 */
const DEFAULT_CHART_RENDER_URL = 'https://quickchart.io/chart';
const CHART_WIDTH = 1100;
const CHART_MIN_HEIGHT = 460;
const CHART_ROW_HEIGHT = 44;
const CHART_MAX_CURRENCIES = 4;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** One person as the chart needs them: both gross sides and the net they produce. */
type ChartPerson = { id: number; name: string; owes: number; owed: number; net: number };

/** Same rule as the Bot API origin: an override is honoured for loopback or https only. */
export function chartRenderUrl(env: TelegramEnv, fallbackToDefault = true): string {
  const raw = (env.CHART_RENDER_URL ?? '').trim();
  if (!raw) return fallbackToDefault ? DEFAULT_CHART_RENDER_URL : '';
  try {
    const url = new URL(raw);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !loopback) return fallbackToDefault ? DEFAULT_CHART_RENDER_URL : '';
    return url.toString();
  } catch {
    return fallbackToDefault ? DEFAULT_CHART_RENDER_URL : '';
  }
}

function minorToChartUnits(minor: number): number {
  return Math.round((Number(minor) || 0)) / 100;
}

/** Chart labels are drawn by the renderer with no formatting of their own, so the text is built here. */
export function chartAmount(minor: number): string {
  const fixed = Math.abs(minorToChartUnits(minor)).toFixed(2);
  const [whole, cents] = fixed.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/** Signed net as the chart prints it: no minus on zero, ASCII hyphen so it survives every font. */
export function chartNet(minor: number): string {
  if (!minor) return '0.00';
  return `${minor > 0 ? '+' : '-'}${chartAmount(minor)}`;
}

/**
 * The Chart.js v3 request body. Every row starts at the shared zero line: the negative dataset is what
 * the person owes, the positive dataset is what they are owed, and the net is an annotation rather than
 * a third bar so the two gross sides stay comparable.
 */
export function netBarChartRequest(trip: string, currency: string, book: ChartPerson[]): Json {
  const ordered = [...book].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  const height = Math.max(CHART_MIN_HEIGHT, 190 + CHART_ROW_HEIGHT * Math.max(ordered.length, 3));
  const annotations: Json[] = [{
    type: 'line', scaleID: 'x', value: 0, borderColor: '#334155', borderWidth: 1,
  }];
  ordered.forEach((person, index) => {
    // The renderer formats nothing for us, so every figure on the picture is written as a label here:
    // paid-out amounts sit outside the left tip, owed amounts outside the right tip, and the diamond
    // marks the net that has to change hands. Without these the bars carry no numbers at all.
    const tip = (xValue: number, text: string, colour: string, xAdjust: number): Json => ({
      type: 'label', xValue, yValue: index, content: [text], xAdjust,
      color: colour, font: { size: 13, weight: 'bold' }, backgroundColor: 'transparent',
      callout: { display: false },
    });
    if (person.owes) annotations.push(tip(-minorToChartUnits(person.owes), chartAmount(person.owes), '#334155', -26));
    if (person.owed) annotations.push(tip(minorToChartUnits(person.owed), chartAmount(person.owed), '#1D4ED8', 26));
    annotations.push({
      type: 'point', xValue: minorToChartUnits(person.net), yValue: index,
      pointStyle: 'rectRot', radius: 7, borderWidth: 0, backgroundColor: '#0F172A',
    });
    // The diamond's own figure, on a dark pill so it reads over either bar. It goes to whichever side of
    // the marker is emptier, measured against the two bar-tip labels it would otherwise run into.
    const net = minorToChartUnits(person.net);
    const roomLeft = net + minorToChartUnits(person.owes);
    const roomRight = minorToChartUnits(person.owed) - net;
    const pill = roomRight >= roomLeft ? { xAdjust: 34 } : { xAdjust: -34 };
    annotations.push({
      type: 'label', xValue: net, yValue: index, content: [chartNet(person.net)],
      ...pill, color: '#FFFFFF', backgroundColor: '#0F172A', borderRadius: 6,
      padding: { top: 2, bottom: 2, left: 6, right: 6 },
      font: { size: 12, weight: 'bold' }, callout: { display: false },
    });
  });
  return {
    version: '3',
    format: 'png',
    width: CHART_WIDTH,
    height,
    backgroundColor: '#FFFFFF',
    chart: {
      type: 'bar',
      data: {
        labels: ordered.map((person) => `${person.name}  ${chartNet(person.net)}`),
        datasets: [
          {
            label: 'they owe',
            data: ordered.map((person) => -minorToChartUnits(person.owes)),
            backgroundColor: '#94A3B8',
            borderSkipped: false,
          },
          {
            label: 'owed to them',
            data: ordered.map((person) => minorToChartUnits(person.owed)),
            backgroundColor: '#1D4ED8',
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        layout: { padding: { right: 40, left: 4 } },
        plugins: {
          title: { display: true, text: `${trip} — ${currency}`, font: { size: 22 } },
          legend: { position: 'top', labels: { boxWidth: 14, font: { size: 14 } } },
          annotation: { annotations },
        },
        scales: {
          x: {
            stacked: true,
            grace: '14%',
            grid: { color: '#E2E8F0' },
            title: { display: true, text: 'owes  ←   |   →  is owed', font: { size: 14 } },
          },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 15, weight: 'bold' } } },
        },
      },
    },
  };
}

/** Gross each way and the resulting net for every active person, in one currency. */
export function chartBook(rows: SummaryBalance[], active: { id: number; name: string }[], currency: string): ChartPerson[] {
  const book = new Map<number, ChartPerson>();
  const entry = (id: number, name: string): ChartPerson => {
    const found = book.get(id);
    if (found) return found;
    const created: ChartPerson = { id, name, owes: 0, owed: 0, net: 0 };
    book.set(id, created);
    return created;
  };
  for (const person of active) entry(person.id, person.name);
  for (const row of rows) {
    if (row.currency_code !== currency) continue;
    const amount = Number(row.outstanding) || 0;
    if (amount > 0) {
      entry(row.debtor_id, row.debtor).owes += amount;
      entry(row.creditor_id, row.creditor).owed += amount;
    } else if (amount < 0) {
      entry(row.creditor_id, row.creditor).owes -= amount;
      entry(row.debtor_id, row.debtor).owed -= amount;
    }
  }
  for (const person of book.values()) person.net = person.owed - person.owes;
  return [...book.values()];
}

/** Any HTML or non-PNG answer means "no chart": the command falls back to pointing at /netsummary. */
async function renderChartPng(env: TelegramEnv, body: Json): Promise<Uint8Array | null> {
  let response: Response;
  try {
    response = await fetch(chartRenderUrl(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('image')) return null;
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    return null;
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < PNG_MAGIC.length) return null;
  if (PNG_MAGIC.some((value, index) => bytes[index] !== value)) return null;
  return bytes;
}

/** A PNG travels as multipart, not JSON, so it needs its own call. Answers arrive in the usual shape. */
async function sendPhoto(env: TelegramEnv, chatId: string, bytes: Uint8Array, caption: string): Promise<ApiResult<{ message_id?: number }>> {
  const token = botToken(env);
  if (!token) return { ok: false, error_code: 0, description: 'Telegram is not configured', retry_after: 0 };
  const form = new FormData();
  form.set('chat_id', chatId);
  form.set('caption', caption);
  form.set('photo', new Blob([bytes], { type: 'image/png' }), 'balances.png');
  let response: Response;
  try {
    response = await fetch(`${telegramApiBase(env)}/bot${token}/sendPhoto`, { method: 'POST', body: form });
  } catch {
    return { ok: false, error_code: 0, description: 'Telegram was unreachable', retry_after: 0 };
  }
  let body: ApiEnvelope<unknown> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    body = null;
  }
  return readApiResponse<{ message_id?: number }>(response, body);
}

/** /chart sends one picture per linked trip, one chart per currency: the same numbers, drawn. */
async function handleChartCommand(env: TelegramEnv, update: TelegramUpdate): Promise<void> {
  const chat = update.message?.chat;
  if (!chat || chat.id === undefined || chat.id === null) return;
  const chatId = String(chat.id);
  const trips = await linkedTrips(env, chatId);
  if (!trips.length) {
    await sendMessage(env, chatId, '📭 This chat is not connected to any trip. Open a trip’s ⚙️ Setup tab and press “Connect Telegram chat”.');
    return;
  }
  for (const trip of trips) {
    await handleChart(env, { id: trip.connectionId, workspace_id: trip.workspaceId }, chatId);
  }
}

async function handleChart(env: TelegramEnv, connection: { id: number; workspace_id: number }, chatId: string): Promise<void> {
  const trip = await activeTripName(env, connection.workspace_id);
  if (!trip) { await sendMessage(env, chatId, '💤 This trip is no longer active. Send /start for a fresh menu.'); return; }
  const rows = await readOutstanding(env, connection.workspace_id);
  const nets = netByCurrency(rows);
  if (!nets.size) { await sendMessage(env, chatId, `✅ ${trip} is all settled — nothing to chart.`); return; }
  const people = await env.DB.prepare('SELECT id, display_name AS name, is_archived FROM workspace_people WHERE workspace_id = ?')
    .bind(connection.workspace_id)
    .all<{ id: number; name: string; is_archived: number }>();
  const active = people.results.filter((person) => !person.is_archived).map((person) => ({ id: person.id, name: person.name }));
  let sent = 0;
  for (const currency of [...nets.keys()].sort().slice(0, CHART_MAX_CURRENCIES)) {
    const book = chartBook(rows, active, currency);
    if (!book.length) continue;
    const png = await renderChartPng(env, netBarChartRequest(trip, currency, book));
    if (!png) continue;
    const open = book.filter((person) => person.net !== 0).length;
    const caption = `📊 ${trip} — ${currency}\n`
      + 'Each row starts at zero: left is everything that person owes, right is everything they are owed.\n'
      + `Bars are labelled in ${currency}; ◆ is the net balance. ${book.length} people · ${open} with a balance`;
    const result = await sendPhoto(env, chatId, png, caption);
    if (result.ok) sent += 1;
  }
  if (!sent) await sendMessage(env, chatId, '⚠️ The chart could not be drawn just now. /netsummary carries the same numbers as text.');
}

/**
 * /summary and /net were replaced by /netsummary, which answers both questions in one message. A retired
 * command says so rather than going quiet or falling through to /start, so old habits land somewhere.
 */
async function handleRetiredCommand(env: TelegramEnv, update: TelegramUpdate): Promise<void> {
  const chat = update.message?.chat;
  if (!chat || chat.id === undefined || chat.id === null) return;
  await sendMessage(env, String(chat.id), '↪️ /summary and /net have been replaced by /netsummary — it shows every person’s balance with the payments under it.');
}

/** /netsummary replies with each person's net balance and, under it, the payments that move that money. */
async function handleNetSummaryCommand(env: TelegramEnv, update: TelegramUpdate): Promise<void> {
  const chat = update.message?.chat;
  if (!chat || chat.id === undefined || chat.id === null) return;
  const chatId = String(chat.id);
  const trips = await linkedTrips(env, chatId);
  if (!trips.length) {
    await sendMessage(env, chatId, '📭 This chat is not connected to any trip. Open a trip’s ⚙️ Setup tab and press “Connect Telegram chat”.');
    return;
  }
  for (const trip of trips) {
    await handleNetSummary(env, { id: trip.connectionId, workspace_id: trip.workspaceId }, chatId);
  }
}

/**
 * Balances and payments in one message: each person's net first, then — indented under it — the exact
 * transfers that settle it, worded from that person's side (`pays Ww USD 22.90`, `receives USD 11.50
 * from Nik`). It replaces the separate /net and /summary replies, which now only point here.
 */
async function handleNetSummary(env: TelegramEnv, connection: { id: number; workspace_id: number }, chatId: string): Promise<void> {
  const workspace = await activeTripName(env, connection.workspace_id);
  if (!workspace) { await sendMessage(env, chatId, '💤 This trip is no longer active. Send /start for a fresh menu.'); return; }
  const rows = await readOutstanding(env, connection.workspace_id);
  const nets = netByCurrency(rows);
  if (!nets.size) { await sendMessage(env, chatId, `✅ ${workspace} is all settled.`); return; }
  const payments = settlementPayments(rows);
  const legs = new Map<string, { pays: SettlementPayment[]; receives: SettlementPayment[] }>();
  const leg = (key: string) => {
    const entry = legs.get(key) ?? { pays: [], receives: [] };
    legs.set(key, entry);
    return entry;
  };
  for (const payment of payments) {
    leg(`${payment.currency_code}:${payment.from_id}`).pays.push(payment);
    leg(`${payment.currency_code}:${payment.to_id}`).receives.push(payment);
  }
  const people = await env.DB.prepare('SELECT id, display_name AS name, is_archived FROM workspace_people WHERE workspace_id = ?')
    .bind(connection.workspace_id)
    .all<{ id: number; name: string; is_archived: number }>();
  const lines: string[] = [`💵 ${workspace} — net balances & settlements`, '+ is owed · − owes'];
  for (const currency_code of [...nets.keys()].sort()) {
    /* Only people who still stand somewhere in this currency are listed. A settled person used to be
       printed as "0.00", which reads as a task to go and check; the currency header already carries
       the count and the money that moves, so nothing is lost. Archived people stay out too, exactly
       as they do in /chart, and a zero-net person can never own a settlement leg anyway (the legs of
       a plan sum to that person's net), so no payment line goes missing with them. */
    const active = new Set(people.results.filter((person) => !person.is_archived).map((person) => person.id));
    const ordered = (nets.get(currency_code) ?? [])
      .filter((person) => active.has(person.id) && person.net)
      .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
    const group = payments.filter((payment) => payment.currency_code === currency_code);
    const moved = group.reduce((total, payment) => total + payment.amount_minor, 0);
    lines.push('', `${currency_code} · ${group.length} payment${group.length === 1 ? '' : 's'} move${group.length === 1 ? 's' : ''} ${money(moved, currency_code)}`);
    for (const person of ordered) {
      const sign = person.net > 0 ? '+' : person.net < 0 ? '−' : '';
      lines.push(`• ${person.name} ${sign}${money(person.net, currency_code)}`);
      const entry = legs.get(`${currency_code}:${person.id}`);
      for (const payment of entry?.pays ?? []) lines.push(`   ↳ pays ${payment.to} ${money(payment.amount_minor, currency_code)}`);
      for (const payment of entry?.receives ?? []) lines.push(`   ↳ receives ${money(payment.amount_minor, currency_code)} from ${payment.from}`);
    }
  }
  if (lines.length > MAX_NET_SUMMARY_LINES) {
    lines.length = MAX_NET_SUMMARY_LINES;
    lines.push(`… truncated`);
  }
  await sendMessage(env, chatId, lines.join('\n'));
}


/**
 * /start in a chat that follows a trip: a grid of buttons, one per section of the portal, each opening
 * that part of the trip in the browser. A chat with no trip yet gets the plain welcome instead.
 */
async function sendStartMenu(env: TelegramEnv, chatId: string, root: string): Promise<void> {
  const trips = root ? (await linkedTrips(env, chatId)).slice(0, MAX_MENU_TRIPS) : [];
  const passes: { trip: LinkedTrip; token: string }[] = [];
  for (const trip of trips) {
    const token = await mintNavToken(env, trip.connectionId);
    if (token) passes.push({ trip, token });
  }
  if (!passes.length) {
    await sendWelcome(env, chatId, root);
    return;
  }
  const names = passes.map((pass) => `“${shortTripName(pass.trip.name)}”`);
  const lines =
    passes.length > 1
      ? [
          'Trip Finance Workspace',
          '',
          `This chat follows ${names.join(', ')}. Tap a section to open that trip in the browser.`,
          '',
          'The buttons work for a day — send /start again for a fresh menu.',
        ]
      : [
          'Trip Finance Workspace',
          '',
          `Tap a section of ${names[0]} to open it in the browser.`,
          '',
          'The buttons work for a day — send /start again for a fresh menu.',
        ];
  const buttons: { text: string; url?: string; callback_data?: string }[][] = [];
  for (const pass of passes) {
    const suffix = passes.length > 1 ? ` · ${shortTripName(pass.trip.name)}` : '';
    const row: { text: string; url: string }[] = [];
    for (const section of MENU_SECTIONS) {
      row.push({ text: `${section.label}${suffix}`, url: `${root}/go/${pass.token}/${section.tab}` });
      if (row.length === 2) buttons.push(row.splice(0, 2));
    }
    if (row.length) buttons.push(row);
  }
  await sendMessage(env, chatId, lines.join('\n'), { inline_keyboard: buttons });
}

export function isNavPath(pathname: string): boolean {
  return pathname === '/go' || pathname.startsWith('/go/');
}

/**
 * The workspace behind a live menu token, or null. The token is a capability of its own while it lasts,
 * so every read of a capability secret comes through here as well as the trip's own hashes — that is
 * what lets a chat open the trip without the trip's real link ever entering the conversation.
 */
export async function resolveNavWorkspace(
  db: D1Database,
  secret: string,
): Promise<{ id: number; name: string; is_active: number; created_at: string; updated_at: string } | null> {
  const row = await db
    .prepare(
      `SELECT w.id, w.name, w.is_active, w.created_at, w.updated_at
         FROM telegram_nav_links l
         JOIN telegram_connections c ON c.id = l.connection_id
         JOIN workspaces w ON w.id = c.workspace_id
        WHERE l.token_hash = ? AND l.expires_at > ? AND c.enabled = 1 AND w.is_active = 1`,
    )
    .bind(await sha256Hex(secret), nowIso())
    .first<{ id: number; name: string; is_active: number; created_at: string; updated_at: string }>();
  return row ?? null;
}

function navProblem(origin: string, message: string, status: number): Response {
  const safeOrigin = origin.replace(/[<>"']/g, '');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trip Finance Workspace</title><style>
:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#f2f2f5;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
.box{max-width:32rem;background:#141419;border:1px solid #2a2a33;border-radius:16px;padding:24px}h1{margin:0 0 8px;font-size:1.15rem}p{margin:0 0 16px;color:#a9a9b3}p:last-child{margin:0}a{color:#7cc4ff}</style></head>
<body><div class="box"><h1>Trip Finance Workspace</h1><p>${message}</p><p><a href="${safeOrigin}">Open Trip Finance Workspace</a></p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

/**
 * A menu button: `/go/<token>/<section>`. It validates the token and its one-day window, counts the
 * tap, and hands the browser to that section under the token's own path. The trip's real link is never
 * on the wire — the browser address bar carries this expiring pass, which is the whole point of it.
 */
export async function handleNavRedirect(request: Request, env: TelegramEnv): Promise<Response> {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const token = (segments[1] ?? '').trim();
  const wanted = (segments[2] ?? '').trim();
  const origin = publicRoot(env, request);
  const known = NAV_SECTIONS.find((section) => section.tab === wanted)?.tab;
  const section = known ?? (wanted ? null : 'ledger');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token) || section === null) {
    return navProblem(origin, 'That menu link is not a section of a trip. Send /start in Telegram for a fresh menu.', 404);
  }
  const row = await env.DB.prepare(
    `SELECT l.id, l.expires_at, c.enabled, w.is_active
       FROM telegram_nav_links l
       JOIN telegram_connections c ON c.id = l.connection_id
       JOIN workspaces w ON w.id = c.workspace_id
      WHERE l.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<{ id: number; expires_at: string; enabled: number; is_active: number }>();
  if (!row || !row.is_active) return navProblem(origin, 'That menu link is not valid any more. Send /start in Telegram for a fresh menu.', 404);
  if (!row.enabled) return navProblem(origin, 'That chat was disconnected from the trip, so this link no longer opens it.', 410);
  if (Date.parse(row.expires_at) <= Date.now()) {
    return navProblem(origin, 'That menu has expired — a menu works for a day. Send /start in Telegram for a fresh one.', 410);
  }
  await env.DB.prepare('UPDATE telegram_nav_links SET uses = uses + 1 WHERE id = ?').bind(row.id).run();
  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin}/w/${token}#${section}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  });
}

const PAIRING_REFUSALS: Record<string, string> = {
  invalid: '⚠️ That connect link is not valid. Open the trip’s ⚙️ Setup tab and press “Connect Telegram chat” to get a fresh one.',
  used: '⚠️ That connect link has already been used — each one works exactly once. Open the trip’s ⚙️ Setup tab for a new one.',
  expired: '⏳ That connect link has expired — they last ten minutes. Open the trip’s ⚙️ Setup tab for a fresh one.',
  inactive: '💤 That trip is no longer active, so this chat cannot be connected to it.',
};

async function handleStart(env: TelegramEnv, update: TelegramUpdate, root: string): Promise<void> {
  const message = update.message;
  const chat = message?.chat;
  if (!chat || chat.id === undefined || chat.id === null) return;
  const chatId = String(chat.id);
  const text = (message?.text ?? '').trim();
  // handleStart answers /start only; /disconnect is routed before it. No command can read, let alone
  // write, the ledger.
  if (!/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) return;
  const payload = text.split(/\s+/).slice(1).join('').trim();
  if (!payload) {
    // A chat that follows a trip gets the navigation grid; one that follows nothing gets the welcome.
    await sendStartMenu(env, chatId, root);
    return;
  }
  if (chatType(chat) !== 'private' && !(await eligible(env, chat, message?.from))) {
    await sendMessage(env, chatId, '🔒 Only a Telegram administrator can connect a group. Ask an admin of this group to send that command.');
    return;
  }
  const consumed = await consumePairingToken(env, payload);
  if ('error' in consumed) {
    await sendMessage(env, chatId, PAIRING_REFUSALS[consumed.error] ?? PAIRING_REFUSALS.invalid);
    return;
  }
  const linked = await linkChat(env, consumed.workspaceId, chat);
  if (!linked) {
    await sendMessage(env, chatId, '⚠️ That trip could not be connected right now. Please try again from its ⚙️ Setup tab.');
    return;
  }
  const opening = linked.duplicate ? '✅ This chat is already connected to' : '✅ This chat is now connected to';
  await sendMessage(
    env,
    chatId,
    [
      `${opening} “${linked.name}”.`,
      '',
      'Changes to that trip’s ledger are announced here, naming who owes or paid what. This chat cannot change any record. Disconnect any time from the trip’s ⚙️ Setup tab.',
    ].join('\n'),
  );
  await sendStartMenu(env, chatId, root);
}

function joinNames(names: string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * /disconnect unlinks this chat from every trip it follows, and takes the chat's menu passes with it, so
 * the buttons in older messages stop working at the same moment the notifications do. A group may only
 * be disconnected by one of its administrators, exactly like connecting it — a passer-by must not be
 * able to mute the trip for everyone. No command touches the ledger itself.
 */
async function handleDisconnect(env: TelegramEnv, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const chat = message?.chat;
  if (!chat || chat.id === undefined || chat.id === null) return;
  const chatId = String(chat.id);
  const trips = await linkedTrips(env, chatId, true);
  if (!trips.length) {
    await sendMessage(
      env,
      chatId,
      '🔕 This chat is not connected to any trip, so there is nothing to disconnect. Open a trip’s ⚙️ Setup tab to connect one.',
    );
    return;
  }
  if (chatType(chat) !== 'private' && !(await eligible(env, chat, message?.from))) {
    await sendMessage(env, chatId, '🔒 Only a Telegram administrator can disconnect this group. Ask an admin of this group to send /disconnect.');
    return;
  }
  const removed: string[] = [];
  for (const trip of trips) {
    if (await removeConnection(env, trip.workspaceId, trip.connectionId)) removed.push(trip.name);
  }
  await sendMessage(
    env,
    chatId,
    removed.length
      ? [
          `🔌 Disconnected ${joinNames(removed)}.`,
          '',
          'This chat stops hearing about those changes and the menu buttons stop working. To connect again, open the trip’s ⚙️ Setup tab and press “Connect Telegram chat”.',
        ].join('\n')
      : '🔕 Nothing is connected to this chat any more.',
  );
}

/**
 * The commands this bot answers: /start connects a trip and opens its menu, /netsummary puts every
 * person's balance above the payments they make or take, /chart draws those balances, /disconnect
 * unlinks this chat. /summary and
 * /net were folded into /netsummary and now only point at it. Anything else is left alone — no
 * command can write the ledger.
 */
async function handleCommand(env: TelegramEnv, update: TelegramUpdate, root: string): Promise<void> {
  const text = (update.message?.text ?? '').trim();
  if (/^\/disconnect(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return handleDisconnect(env, update);
  if (/^\/netsummary(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return handleNetSummaryCommand(env, update);
  if (/^\/chart(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return handleChartCommand(env, update);
  if (/^\/(?:summary|net)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return handleRetiredCommand(env, update);
  return handleStart(env, update, root);
}

/** Callback data is authenticated before D1 is consulted, then bound again to the source chat. */
async function handleCallbackQuery(env: TelegramEnv, update: TelegramUpdate): Promise<void> {
  const callback = update.callback_query;
  const chat = callback?.message?.chat;
  const chatId = chat?.id;
  if (!callback?.id || chatId === undefined || chatId === null) return;
  await answerCallbackQuery(env, callback.id).catch(() => {});
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
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  // Publishing the command menu is idempotent and per isolate, so a deploy never leaves the chat menu
  // offering a command the code no longer answers.
  if (!commandsRegistered) await syncBotCommands(env).catch(() => {});
  if (update.callback_query) await ensureWebhookAcceptsCallbacks(env, request).catch(() => {});
  try {
    if (update.callback_query) await handleCallbackQuery(env, update);
    else await handleCommand(env, update, publicRoot(env, request));
  } catch {
    // Our own bookkeeping must never turn into an endless Telegram retry loop, but the person on the
    // other end is still owed an answer.
    if (chatId !== undefined && chatId !== null) await sendMessage(env, String(chatId), '⚠️ Something went wrong on our side. Please try the connect button in the trip’s ⚙️ Setup tab again.').catch(() => {});
    return jsonResponse({ ok: true });
  }
  // Any incoming update is also a chance to flush messages that a rate limit or an outage left queued.
  await retryQueued(env).catch(() => {});
  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------- message wording

function header(name: string): string {
  return `🧳 Trip Finance — ${name.slice(0, 60)}`;
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

/** Person ids resolve to the name and avatar the trip already shows them under. */
type PersonLabels = Map<number, string>;

export type MessageContext = { name: string; timeZone: string; people: PersonLabels };

/**
 * Notifications name the entities. "A transaction was recorded" leaves the reader with nothing to act
 * on, so every line is built out of the row itself: who owes whom, who paid whom, and how much.
 */
function labelOf(people: PersonLabels, value: unknown): string {
  const id = Number(value);
  const label = Number.isFinite(id) ? people.get(id) : undefined;
  return label && label.trim() ? label.trim() : 'Someone';
}

function topicOf(after: Json): string {
  return String(after['topic'] ?? '').trim().slice(0, 60);
}

/**
 * A line that stands alone is the whole event, so a lone debt leads with its own emoji. Inside an
 * action line or a grouped message the heading has already said what happened and what kind of rows
 * these are, so repeating the emoji on every line would only add noise.
 */
function pairLine(after: Json, people: PersonLabels, leadDebt = false): string {
  const debtor = labelOf(people, after['debtor_person_id']);
  const creditor = labelOf(people, after['creditor_person_id']);
  const amount = money(after['amount_minor'], after['currency_code']);
  const tail = amount ? ` ${amount}` : '';
  // A repayment moves money the other way: the debtor is the one who paid.
  if (String(after['entry_kind'] ?? 'debt') === 'payment') return `💸 ${debtor} paid ${creditor}${tail}`;
  return `${leadDebt ? '🧾 ' : ''}${debtor} owes ${creditor}${tail}`;
}

/** A topic only earns its place on a grouped message when every row in it agrees. */
function sharedTopic(rows: AuditRow[]): string {
  const topics = new Set(rows.map((row) => topicOf(parseJson(row.after_json))));
  return topics.size === 1 ? [...topics][0] : '';
}

const MAX_PAIR_LINES = 6;

function pairLines(rows: AuditRow[], people: PersonLabels): string[] {
  const lines = rows.slice(0, MAX_PAIR_LINES).map((row) => pairLine(parseJson(row.after_json), people));
  if (rows.length > MAX_PAIR_LINES) lines.push(`+${rows.length - MAX_PAIR_LINES} more entries`);
  return lines;
}

function groupHeadline(rows: AuditRow[], people: PersonLabels): string {
  const prefixes = new Set(rows.map((row) => (groupIdOf(row) ?? '').split(':')[0]));
  const parsed = rows.map((row) => parseJson(row.after_json));
  const count = parsed.length;
  if (prefixes.has('import')) return `📥 ${count} ${count === 1 ? 'entry' : 'entries'} imported from a spreadsheet`;
  // In a split every row credits the same person: whoever laid the money out.
  if (prefixes.has('split')) return `🧾 ${labelOf(people, parsed[0]['creditor_person_id'])} split a bill`;
  if (prefixes.has('batch')) return `🧾 ${count} ${count === 1 ? 'entry' : 'entries'} added in one batch`;
  if (prefixes.has('offset') || prefixes.has('auto-offset')) {
    const named = [...new Set(parsed.flatMap((after) => [labelOf(people, after['debtor_person_id']), labelOf(people, after['creditor_person_id'])]))];
    const verb = prefixes.has('auto-offset') ? 'netted their reciprocal balances' : 'settled up';
    return `🔁 ${named.slice(0, 2).join(' and ')} ${verb} · ${count} ${count === 1 ? 'row' : 'rows'}`;
  }
  return `📝 ${count} ${count === 1 ? 'entry' : 'entries'} added`;
}

function perCurrencyTotals(rows: AuditRow[]): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const after = parseJson(row.after_json);
    // A repayment or a netting offset is not new spending, however it happens to be signed on disk.
    const kind = String(after['entry_kind'] ?? 'debt');
    if (isSettlementRow({ entry_kind: kind, amount_minor: Number(after['amount_minor']) || 0 })) continue;
    const currency = String(after['currency_code'] ?? '').toUpperCase();
    if (!currency) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + Math.abs(Number(after['amount_minor']) || 0));
  }
  // Currencies are never added together: each one keeps its own line.
  const lines = [...totals.entries()].filter(([, total]) => total > 0).map(([currency, total]) => money(total, currency));
  if (lines.length <= 3) return lines.join(' · ');
  return `${lines.slice(0, 3).join(' · ')} +${lines.length - 3} more currencies`;
}

function createMessage(rows: AuditRow[], context: MessageContext): { key: string; body: string } {
  const { name, timeZone, people } = context;
  const key = keyFor(rows);
  const lines = [header(name), ''];
  const grouped = rows.length > 1 || Boolean(groupIdOf(rows[0]));
  if (!grouped) {
    const after = parseJson(rows[0].after_json);
    // A single entry is the event itself, so its line carries the emoji for what it is.
    lines.push([pairLine(after, people, true), topicOf(after)].filter(Boolean).join(' · '));
  } else {
    lines.push([groupHeadline(rows, people), sharedTopic(rows)].filter(Boolean).join(' · '));
    const offsets = rows.filter(isOffsetRow);
    const linear = rows.filter((row) => !isOffsetRow(row));
    // Netting writes its own signed rows, so a pair line for one would read as arithmetic nobody
    // performed: the headline already says which two people it was between.
    if (!offsets.length) {
      lines.push(...pairLines(rows, people));
      if (rows.length > MAX_PAIR_LINES) {
        const totals = perCurrencyTotals(rows.filter((row) => String(parseJson(row.after_json)['entry_kind'] ?? 'debt') !== 'payment'));
        if (totals) lines.push(totals);
      }
    } else if (linear.length) {
      lines.push(...pairLines(linear, people));
    }
  }
  const stamp = formatStamp(rows[rows.length - 1].occurred_at, timeZone);
  if (stamp) lines.push(stamp);
  return { key, body: lines.join('\n') };
}

const ACTION_LEAD: Record<string, string> = {
  update: '✏️ Edited',
  archive: '🗄️ Removed',
  restore: '♻️ Restored',
  delete: '❌ Deleted',
};

function transactionActionMessage(rows: AuditRow[], context: MessageContext): { key: string; body: string } {
  const { name, timeZone, people } = context;
  const lines = [header(name), ''];
  for (const action of ['update', 'archive', 'restore', 'delete']) {
    const matching = rows.filter((row) => row.action === action);
    if (!matching.length) continue;
    const lead = ACTION_LEAD[action] ?? '✏️ Changed';
    if (matching.length === 1) {
      const after = parseJson(matching[0].after_json);
      const before = parseJson(matching[0].before_json);
      // Whichever snapshot carries the row describes it; an edit can arrive with either side filled in.
      const source = Object.keys(after).length ? after : before;
      const topic = topicOf(source) || topicOf(before);
      lines.push(`${lead} — ${pairLine(source, people)}${topic ? ` · ${topic}` : ''}`);
    } else {
      lines.push(`${lead} — ${matching.length} entries`);
      lines.push(...pairLines(matching, people));
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
        if (key === 'backup_every') {
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
      if (changed(before, after, 'name')) note(`🧳 Trip renamed to “${String(after['name'] ?? '')}”`);
      continue;
    }
    if (row.entity_type === 'person') {
      const who = (source: Json): string => `${String(source['emoji'] ?? '')} ${String(source['display_name'] ?? '')}`.trim();
      const label = who(Object.keys(after).length ? after : before);
      const was = who(before);
      if (row.action === 'create') note(`🙋 ${label} joined the trip`);
      else if (row.action === 'update') note(was && was !== label ? `✏️ ${was} is now ${label}` : `✏️ ${label} updated their details`);
      else if (row.action === 'restore') note(`🙋 ${label} rejoined the trip`);
      else note(`👋 ${label} left the trip`);
      continue;
    }
    if (row.entity_type === 'currency') {
      const code = String(after['code'] ?? before['code'] ?? '');
      if (row.action === 'update' && Number(after['is_default']) === 1) push('Default currency', code);
      else if (row.action === 'create') note(`💱 Currency ${code} is available in this trip`);
      else note(`💱 Currency ${code} was ${row.action === 'delete' ? 'removed' : 'changed'}`);
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
export function buildMessages(rows: AuditRow[], context: MessageContext): { key: string; body: string }[] {
  const messages: { key: string; body: string }[] = [];
  for (const cluster of clusterByTime(rows)) {
    const creates = cluster.filter((row) => row.entity_type === 'transaction' && row.action === 'create');
    const touched = cluster.filter((row) => row.entity_type === 'transaction' && row.action !== 'create');
    const settings = cluster.filter((row) => row.entity_type !== 'transaction');
    if (creates.length) messages.push(createMessage(creates, context));
    if (touched.length) messages.push(transactionActionMessage(touched, context));
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
  // Names are resolved once per dispatch, archived members included: their rows are still in the log.
  const roster = await env.DB.prepare('SELECT id, display_name, emoji FROM workspace_people WHERE workspace_id = ?')
    .bind(workspaceId)
    .all<{ id: number; display_name: string; emoji: string | null }>();
  const people: PersonLabels = new Map(roster.results.map((person) => [person.id, person.emoji ? `${person.emoji} ${person.display_name}` : person.display_name]));
  for (const connection of connections.results) {
    const rows = await env.DB.prepare(
      'SELECT id, entity_type, entity_id, action, before_json, after_json, occurred_at FROM audit_log WHERE workspace_id = ? AND id > ? ORDER BY id LIMIT ?',
    )
      .bind(workspaceId, connection.last_audit_id, AUDIT_WINDOW_LIMIT)
      .all<AuditRow>();
    if (!rows.results.length) continue;
    const statements: D1PreparedStatement[] = buildMessages(rows.results, { name: workspace.name, timeZone, people }).map((message) =>
      // Dedupe lives in the database: the unique (connection, event) key makes a replayed dispatch a no-op.
      env.DB.prepare('INSERT OR IGNORE INTO telegram_notifications (workspace_id, connection_id, event_key, body) VALUES (?, ?, ?, ?)').bind(workspaceId, connection.id, message.key, message.body),
    );
    statements.push(env.DB.prepare('UPDATE telegram_connections SET last_audit_id = ? WHERE id = ?').bind(rows.results[rows.results.length - 1].id, connection.id));
    await env.DB.batch(statements);
  }
  await flushConnection(env, workspaceId);
}
