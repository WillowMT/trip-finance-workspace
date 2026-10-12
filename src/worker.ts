import { aiInstructions, appHtml, homeHtml, linkRetiredHtml, isValidTimeZone, DEFAULT_TIME_ZONE, zonedParts } from './pages';
import { planSplit, splitDraftHash, splitResponse, type SplitTransaction, validIdempotencyKey as validSplitKey } from './splits';
import { autoNettingStatements } from './netting';
import { backupEveryValue, backupStatus, createBackup, listBackups, readBackup, restoreName, restoreSnapshot, snapshotProblem, tickBackups, DEFAULT_BACKUP_EVERY, KEEP_BACKUPS } from './backups';
import { canonicalName, hashJson, maxWorkflowRows, offsetTransactions, parseImportCsv, reciprocalBalance, validDate as validDateValue, validIdempotencyKey, validateWorkflowRow, type ImportPlanRow, type WorkflowTransaction } from './workflows';
import { createPairing, dispatchWorkspaceNotifications, handleTelegramWebhook, isTelegramWebhookPath, removeConnection, setConnectionEnabled, telegramConfigured, telegramStatus } from './telegram';

export interface Env {
  DB: D1Database;
  // Automatic snapshots. Optional so a bare local environment can still serve the ledger.
  BACKUPS?: R2Bucket;
  RECEIPTS?: R2Bucket;
  // Telegram notifications. Absent on a bare deployment, which leaves the feature inert: nothing is
  // paired, nothing is sent, and the webhook endpoint refuses every request.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_API_BASE?: string;
  PUBLIC_ORIGIN?: string;
}

type Json = Record<string, unknown>;
type Workspace = { id: number; name: string; is_active: number; created_at: string; updated_at: string };
type Person = { id: number; workspace_id: number; display_name: string; emoji: string; is_archived: number; created_at: string; updated_at: string };
type Currency = { id: number; workspace_id: number; code: string; is_default: number; is_archived: number; created_at: string; updated_at: string };
type Transaction = { id: number; workspace_id: number; occurred_on: string; entry_kind: string; topic: string; category: string; creditor_person_id: number; debtor_person_id: number; amount_minor: number; currency_code: string; notes: string | null; import_group_id: string | null; is_deleted: number; created_at: string; updated_at: string };

const landingPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Trip finance workspace</title></head>
<body><main><h1>Trip finance workspace</h1><p>Create a workspace to share one editable finance ledger with your group.</p><button type="button">Create shared workspace</button></main></body></html>`;
const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const currencyPattern = /^[A-Z]{3}$/;
const entryKinds = new Set(['debt', 'payment']);
const maxJsonBytes = 256 * 1024;
const bodyTooLarge = Symbol('body too large');

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
function error(message: string, status = 400, headers: HeadersInit = {}): Response { return json({ error: message }, status, headers); }
function secretHeaders(): HeadersInit {
  return { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
}
// HTML pages carry inline <style>/<script> and fetch their own /api, so they need a
// policy that allows those — but never default-src 'none' (that silently kills the UI).
// manifest-src and worker-src are listed separately: both fall back to default-src 'none',
// which would block the web app manifest and the (no-cache) service worker behind the
// home-screen install.
function pageHeaders(): HeadersInit {
  return {
    'cache-control': 'no-store, private',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
}
function secretResponse(value: unknown, status = 200): Response { return json(value, status, secretHeaders()); }
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= max ? text : null;
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function asObject(value: unknown): Json | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null; }
async function body(request: Request): Promise<Json | null | typeof bodyTooLarge> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxJsonBytes) return bodyTooLarge;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxJsonBytes) { await reader.cancel(); return bodyTooLarge; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return asObject(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}
function allowedOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
// Every path that writes ledger rows commits through here, so the automatic-backup counter
// sees each write exactly once and a snapshot request can never land inside a half-applied batch.
async function commitLedger(env: Env, workspaceId: number, statements: D1PreparedStatement[]): Promise<void> {
  await env.DB.batch(statements);
  await tickBackups(env, workspaceId);
}
function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function resolveWorkspace(db: D1Database, secret: string): Promise<Workspace | null> {
  if (!secretPattern.test(secret)) return null;
  // Either the current secret or the one it superseded resolves: rotating a link
  // must never strand the people still holding the previous one.
  const hash = await sha256(secret);
  return db.prepare('SELECT id, name, is_active, created_at, updated_at FROM workspaces WHERE (secret_hash = ? OR prev_secret_hash = ?) AND is_active = 1').bind(hash, hash).first<Workspace>();
}
async function requireWorkspace(db: D1Database, secret: string): Promise<Workspace | Response> {
  const workspace = await resolveWorkspace(db, secret);
  return workspace ?? secretResponse({ error: 'Workspace not found' }, 404);
}
async function state(env: Env, workspace: Workspace): Promise<Json> {
  const db = env.DB;
  const [people, currencies, settings, receipts, attachments] = await Promise.all([
    db.prepare('SELECT id, workspace_id, display_name, emoji, is_archived, created_at, updated_at FROM workspace_people WHERE workspace_id = ? ORDER BY id').bind(workspace.id).all<Person>(),
    db.prepare('SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE workspace_id = ? ORDER BY id').bind(workspace.id).all<Currency>(),
    db.prepare('SELECT categories_json, small_amount_guard_json, timezone, auto_offset, backup_every, created_at, updated_at FROM workspace_settings WHERE workspace_id = ?').bind(workspace.id).first<{ categories_json: string; small_amount_guard_json: string; timezone: string; auto_offset: number; backup_every: number; created_at: string; updated_at: string }>(),
    db.prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE workspace_id = ? ORDER BY is_added ASC, id DESC`).bind(workspace.id).all<Receipt>(),
    db.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM receipt_attachments WHERE workspace_id = ? ORDER BY id`).bind(workspace.id).all<ReceiptAttachment>(),
  ]);
  const backups = await backupStatus(db, workspace.id);
  // Telegram connections ride along with the state the Setup tab already reads, so the card renders on
  // first paint. The bot's username is left out here (it costs a Bot API call) and fetched on demand.
  return { workspace, people: people.results, currencies: currencies.results, receipts: boardReceipts(receipts.results, attachments.results), settings: settings && { categories: JSON.parse(settings.categories_json), small_amount_guard: JSON.parse(settings.small_amount_guard_json), timezone: settings.timezone, auto_offset: settings.auto_offset, backup_every: backupEveryValue(settings.backup_every) ?? DEFAULT_BACKUP_EVERY, created_at: settings.created_at, updated_at: settings.updated_at }, backups: { status: backups, entries: await listBackups(db, workspace.id), configured: Boolean(env.BACKUPS), keep: KEEP_BACKUPS }, telegram: await telegramStatus(env, workspace.id) };
}
function workspaceTimeZone(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return DEFAULT_TIME_ZONE;
  return isValidTimeZone(raw) ? raw : null;
}
// A person's avatar is one emoji: letters and digits belong in the name, and the avatar
// never reaches the ledger as free text.
function cleanEmoji(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 16 || /[\p{L}\p{N}]/u.test(trimmed)) return null;
  return trimmed;
}
function splitEmoji(value: string): { name: string; emoji: string } {
  const parts = value.split(/\s+/).filter((part) => part !== '');
  if (parts.length < 2) return { name: value, emoji: '' };
  const avatar = (token: string): string => (/[\p{L}\p{N}]/u.test(token) ? '' : cleanEmoji(token) || '');
  const trailing = avatar(parts[parts.length - 1]);
  if (trailing) return { name: parts.slice(0, -1).join(' '), emoji: trailing };
  const leading = avatar(parts[0]);
  if (leading) return { name: parts.slice(1).join(' '), emoji: leading };
  return { name: value, emoji: '' };
}
const personLabel = (person: { display_name: string; emoji?: string | null }): string => person.emoji ? `${person.emoji} ${person.display_name}` : person.display_name;
function onboarding(input: Json): { name: string; people: { display_name: string; emoji: string }[]; currencies: { code: string; is_default: boolean }[]; timezone: string } | null {
  const name = cleanText(input.name, 100);
  if (!name || !Array.isArray(input.people) || !Array.isArray(input.currencies)) return null;
  // "Ada \ud83e\udd8a", "\ud83e\udd8a Ada" and { display_name, emoji } all work; an emoji token at either end becomes the avatar.
  const people: { display_name: string; emoji: string }[] = [];
  for (const person of input.people) {
    const item = typeof person === 'string' ? null : asObject(person);
    const cleaned = cleanText(typeof person === 'string' ? person : item?.display_name, 80);
    if (!cleaned) return null;
    const split = splitEmoji(cleaned);
    const emoji = cleanEmoji(item?.emoji === undefined ? split.emoji : item.emoji);
    if (emoji === null) return null;
    people.push({ display_name: split.name, emoji });
  }
  if (people.length < 2 || new Set(people.map((person) => person.display_name.toLocaleLowerCase())).size !== people.length) return null;
  const currencies = input.currencies.map((currency) => {
    const item = asObject(currency);
    return item && typeof item.code === 'string' && currencyPattern.test(item.code) && typeof item.is_default === 'boolean' ? { code: item.code, is_default: item.is_default } : null;
  });
  if (currencies.some((currency) => !currency) || currencies.length < 1 || new Set(currencies.map((currency) => currency!.code)).size !== currencies.length || currencies.filter((currency) => currency!.is_default).length !== 1) return null;
  const timezone = workspaceTimeZone(input.timezone);
  if (!timezone) return null;
  return { name, people, currencies: currencies as { code: string; is_default: boolean }[], timezone };
}
async function ownedPerson(db: D1Database, workspaceId: number, id: unknown, active = false): Promise<Person | null> {
  if (!Number.isSafeInteger(id)) return null;
  return db.prepare(`SELECT id, workspace_id, display_name, emoji, is_archived, created_at, updated_at FROM workspace_people WHERE id = ? AND workspace_id = ?${active ? ' AND is_archived = 0' : ''}`).bind(id, workspaceId).first<Person>();
}
async function ownedCurrency(db: D1Database, workspaceId: number, code: unknown, active = false): Promise<Currency | null> {
  if (typeof code !== 'string' || !currencyPattern.test(code)) return null;
  return db.prepare(`SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE workspace_id = ? AND code = ?${active ? ' AND is_archived = 0' : ''}`).bind(workspaceId, code).first<Currency>();
}
async function validateTransaction(db: D1Database, workspaceId: number, input: Json): Promise<string | null> {
  if (!validDate(input.occurred_on) || !entryKinds.has(input.entry_kind as string) || !cleanText(input.topic, 200) || !cleanText(input.category, 80) || !Number.isSafeInteger(input.amount_minor) || input.amount_minor === 0 || input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') return 'Invalid transaction';
  if (input.creditor_person_id === input.debtor_person_id || !await ownedPerson(db, workspaceId, input.creditor_person_id, true) || !await ownedPerson(db, workspaceId, input.debtor_person_id, true) || !await ownedCurrency(db, workspaceId, input.currency_code, true)) return 'Transaction references must belong to this workspace and be active';
  return null;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Trip finance">
  <rect width="64" height="64" rx="14" fill="#0d0d10"/>
  <circle cx="32" cy="32" r="22" fill="#2563eb"/>
  <path d="M21 26h21m0 0-6-6m6 6-6 6" fill="none" stroke="#fafafa" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M43 38H22m0 0 6-6m-6 6 6 6" fill="none" stroke="#fafafa" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  if (request.method === 'GET' && (pathname === '/favicon.svg' || pathname === '/favicon.ico')) {
    return new Response(FAVICON_SVG, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=604800' } });
  }
  if (request.method === 'GET' && pathname === '/apple-touch-icon.png') return pngResponse(APPLE_TOUCH_ICON_PNG);
  if (request.method === 'GET' && (pathname === '/icon-192.png' || pathname === '/icon-512.png' || pathname === '/icon-maskable-512.png')) {
    return pngResponse(pathname === '/icon-192.png' ? ICON_192_PNG : pathname === '/icon-512.png' ? ICON_512_PNG : ICON_MASKABLE_512_PNG);
  }
  if (request.method === 'GET' && pathname === '/') return new Response(homeHtml(), { headers: { 'content-type': 'text/html; charset=utf-8', ...pageHeaders() } });
  if (request.method === 'POST' && pathname === '/api/workspaces') {
    const input = await body(request); if (input === bodyTooLarge) return error('Request body too large', 413, secretHeaders()); const valid = input && onboarding(input);
    if (!valid) return error('Invalid workspace onboarding payload', 400, secretHeaders());
    const secret = createSecret(); const hash = await sha256(secret);
    const statements: D1PreparedStatement[] = [env.DB.prepare('INSERT INTO workspaces (secret_hash, name) VALUES (?, ?)').bind(hash, valid.name), env.DB.prepare(`INSERT INTO workspace_settings (workspace_id, timezone) SELECT id, ? FROM workspaces WHERE secret_hash = ?`).bind(valid.timezone, hash)];
    for (const person of valid.people) statements.push(env.DB.prepare('INSERT INTO workspace_people (workspace_id, display_name, emoji) SELECT id, ?, ? FROM workspaces WHERE secret_hash = ?').bind(person.display_name, person.emoji, hash));
    for (const currency of valid.currencies) statements.push(env.DB.prepare('INSERT INTO workspace_currencies (workspace_id, code, is_default) SELECT id, ?, ? FROM workspaces WHERE secret_hash = ?').bind(currency.code, currency.is_default ? 1 : 0, hash));
    await env.DB.batch(statements);
    const workspace = await resolveWorkspace(env.DB, secret);
    return json({ workspace: workspace && { id: workspace.id, name: workspace.name }, workspace_url: `/w/${secret}` }, 201, secretHeaders());
  }
  // Telegram's own endpoint: a dedicated path, authenticated by the secret registered at setWebhook
  // time, and shut entirely until a token and secret exist on the deployment.
  if (isTelegramWebhookPath(pathname)) return handleTelegramWebhook(request, env);
  const match = pathname.match(/^\/w\/([^/]+)(?:\/(.*))?$/);
  if (!match) return new Response('Not found', { status: 404 });
  const [, secret, rawTail = ''] = match;
  const workspacePage = rawTail === '';
  const workspaceApi = rawTail === 'api' || rawTail.startsWith('api/');
  const tail = rawTail.startsWith('api/') ? rawTail.slice(4) : workspaceApi ? '' : rawTail;
  const required = await requireWorkspace(env.DB, secret);
  if (required instanceof Response) {
    // A bare `{"error":"Workspace not found"}` in the address bar reads like the
    // site is broken; the page path gets a real answer instead.
    if (workspacePage && request.method === 'GET') return new Response(linkRetiredHtml(), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...pageHeaders() } });
    return required;
  }
  const workspace = required;
  if (workspacePage) return request.method === 'GET' ? new Response(await appHtml(env.DB, workspace.id, workspace.name), { headers: { 'content-type': 'text/html; charset=utf-8', ...pageHeaders() } }) : new Response('Not found', { status: 404, headers: secretHeaders() });
  // Served under the capability path so an installed icon opens this trip and nothing else.
  if (rawTail === 'manifest.webmanifest' && request.method === 'GET') return manifestResponse(workspace, secret);
  if (rawTail === 'sw.js' && request.method === 'GET') return serviceWorkerResponse(secret);
  if (!workspaceApi) return new Response('Not found', { status: 404, headers: secretHeaders() });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !allowedOrigin(request, url)) return secretResponse({ error: 'Origin does not match this capability URL' }, 403);
  if (tail === '' && request.method === 'GET') return secretResponse(await state(env, workspace));

  if (tail === 'receipts' && request.method === 'GET') return secretResponse({ receipts: await listReceipts(env.DB, workspace.id) });
  if (tail === 'receipts' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const title = cleanText(input.title, 120); if (!title) return secretResponse({ error: 'Give the receipt a short title' }, 400);
    const note = receiptNote(input.note); if (note === null) return secretResponse({ error: 'Notes must be 2000 characters or fewer' }, 400);
    const link = receiptLink(input.link); if (link === null) return secretResponse({ error: 'A receipt link must start with http:// or https:// and stay under 1000 characters' }, 400);
    const added = receiptState(input.is_added, 0); if (added === null) return secretResponse({ error: 'is_added must be true or false' }, 400);
    const created = await env.DB.prepare(`INSERT INTO receipts (workspace_id, title, note, link, is_added, added_at) VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN ${now} ELSE NULL END) RETURNING ${RECEIPT_COLUMNS}`)
      .bind(workspace.id, title, note, link, added, added).first<Receipt>();
    return secretResponse({ receipt: { ...created!, attachments: [], attachment_count: 0 } }, 201);
  }
  const recRoute = tail.match(/^receipts\/(\d+)(?:\/(attachments|delete|link)(?:\/(\d+))?)?$/);
  if (recRoute) {
    const receiptId = Number(recRoute[1]); const recAction = recRoute[2]; const attachmentId = recRoute[3] === undefined ? null : Number(recRoute[3]);
    const receipt = await env.DB.prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE id = ? AND workspace_id = ?`).bind(receiptId, workspace.id).first<Receipt>();
    if (!receipt) return secretResponse({ error: 'Receipt not found' }, 404);
    if (recAction === 'attachments') {
      if (!env.RECEIPTS) return secretResponse({ error: 'Receipt photo storage is not configured on this deployment' }, 400);
      if (attachmentId === null) {
        if (request.method === 'GET') return secretResponse({ attachments: await listAttachments(env.DB, workspace.id, receiptId) });
        if (request.method === 'POST') {
          const held = await env.DB.prepare('SELECT COUNT(*) AS count FROM receipt_attachments WHERE workspace_id = ? AND receipt_id = ?').bind(workspace.id, receiptId).first<{ count: number }>();
          if ((held?.count ?? 0) >= RECEIPT_MAX_ATTACHMENTS) return secretResponse({ error: `A card holds up to ${RECEIPT_MAX_ATTACHMENTS} attachments - remove one first` }, 400);
          const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
          if (!RECEIPT_IMAGE_TYPES.includes(type)) return secretResponse({ error: 'Upload a PNG, JPEG, WebP, GIF, AVIF, or HEIC image' }, 400);
          const declared = Number(request.headers.get('content-length') ?? '');
          if (Number.isFinite(declared) && declared > RECEIPT_MAX_IMAGE_BYTES) return secretResponse({ error: 'Each attachment must be 6 MB or smaller' }, 413);
          const bytes = await request.arrayBuffer();
          if (bytes.byteLength === 0) return secretResponse({ error: 'That file was empty' }, 400);
          if (bytes.byteLength > RECEIPT_MAX_IMAGE_BYTES) return secretResponse({ error: 'Each attachment must be 6 MB or smaller' }, 413);
          const label = cleanText(new URL(request.url).searchParams.get('label') ?? '', 120) ?? '';
          const key = `receipts/${workspace.id}/${receiptId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: type } });
          const created = await env.DB.prepare(`INSERT INTO receipt_attachments (workspace_id, receipt_id, label, image_key, image_type, image_bytes) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${ATTACHMENT_COLUMNS}`)
            .bind(workspace.id, receiptId, label, key, type, bytes.byteLength).first<ReceiptAttachment>();
          await env.DB.prepare(`UPDATE receipts SET updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(receiptId, workspace.id).run();
          return secretResponse({ attachment: publicAttachment(created!) }, 201);
        }
        return secretResponse({ error: 'Method not allowed' }, 405);
      }
      const attachment = await env.DB.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM receipt_attachments WHERE id = ? AND receipt_id = ? AND workspace_id = ?`).bind(attachmentId, receiptId, workspace.id).first<ReceiptAttachment>();
      if (!attachment) return secretResponse({ error: 'Attachment not found' }, 404);
      if (request.method === 'GET') {
        const object = await env.RECEIPTS.get(attachment.image_key);
        if (!object) return secretResponse({ error: 'That attachment is no longer stored' }, 404);
        return new Response(object.body, { headers: { 'content-type': attachment.image_type || 'application/octet-stream', 'content-length': String(object.size), 'cache-control': 'private, max-age=300', ...secretHeaders() } });
      }
      if (request.method === 'DELETE' || (request.method === 'POST' && request.headers.get('x-action') === 'delete')) {
        try { await env.RECEIPTS.delete(attachment.image_key) } catch { /* the row is going away anyway */ }
        await env.DB.prepare('DELETE FROM receipt_attachments WHERE id = ? AND receipt_id = ? AND workspace_id = ?').bind(attachmentId, receiptId, workspace.id).run();
        await env.DB.prepare(`UPDATE receipts SET updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(receiptId, workspace.id).run();
        return secretResponse({ deleted: attachmentId });
      }
      return secretResponse({ error: 'Method not allowed' }, 405);
    }
    if ((recAction === 'delete' && request.method === 'POST') || (!recAction && request.method === 'DELETE')) {
      const held = await env.DB.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM receipt_attachments WHERE workspace_id = ? AND receipt_id = ?`).bind(workspace.id, receiptId).all<ReceiptAttachment>();
      for (const attachment of held.results) { try { await env.RECEIPTS?.delete(attachment.image_key) } catch { /* the row is going away anyway */ } }
      await env.DB.prepare('DELETE FROM receipt_attachments WHERE workspace_id = ? AND receipt_id = ?').bind(workspace.id, receiptId).run();
      await env.DB.prepare('DELETE FROM receipts WHERE id = ? AND workspace_id = ?').bind(receiptId, workspace.id).run();
      return secretResponse({ deleted: receiptId });
    }
    if (recAction === 'link' && (request.method === 'POST' || request.method === 'DELETE')) {
      // Logging a card writes nothing to the ledger by itself: it records which row the user
      // entered, so the board can show what is still unlogged. Marking the card added is the
      // consequence of the user's own logging action, not a detector.
      if (request.method === 'DELETE') {
        await env.DB.prepare(`UPDATE receipts SET transaction_id = NULL, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(receiptId, workspace.id).run();
      } else {
        const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
        const transactionId = input.transaction_id;
        if (typeof transactionId !== 'number' || !Number.isInteger(transactionId) || transactionId <= 0) return secretResponse({ error: 'Link the receipt to a ledger row by id' }, 400);
        const owned = await env.DB.prepare('SELECT id FROM transactions WHERE id = ? AND workspace_id = ? AND is_deleted = 0').bind(transactionId, workspace.id).first<{ id: number }>();
        if (!owned) return secretResponse({ error: 'That ledger row is not in this workspace' }, 404);
        await env.DB.prepare(`UPDATE receipts SET transaction_id = ?, is_added = 1, added_at = COALESCE(added_at, ${now}), updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(owned.id, receiptId, workspace.id).run();
      }
      const linked = await env.DB.prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE id = ? AND workspace_id = ?`).bind(receiptId, workspace.id).first<Receipt>();
      const attached = await listAttachments(env.DB, workspace.id, receiptId);
      return secretResponse({ receipt: { ...linked!, attachments: attached, attachment_count: attached.length } });
    }
    if (!recAction && request.method === 'PATCH') {
      const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
      const title = input.title === undefined ? receipt.title : cleanText(input.title, 120); if (!title) return secretResponse({ error: 'Give the receipt a short title' }, 400);
      const note = input.note === undefined ? receipt.note : receiptNote(input.note); if (note === null) return secretResponse({ error: 'Notes must be 2000 characters or fewer' }, 400);
      const link = input.link === undefined ? receipt.link : receiptLink(input.link); if (link === null) return secretResponse({ error: 'A receipt link must start with http:// or https:// and stay under 1000 characters' }, 400);
      const added = receiptState(input.is_added, receipt.is_added); if (added === null) return secretResponse({ error: 'is_added must be true or false' }, 400);
      const updated = await env.DB.prepare(`UPDATE receipts SET title = ?, note = ?, link = ?, is_added = ?, added_at = CASE WHEN ? = 1 THEN COALESCE(added_at, ${now}) ELSE NULL END, updated_at = ${now} WHERE id = ? AND workspace_id = ? RETURNING ${RECEIPT_COLUMNS}`)
        .bind(title, note, link, added, added, receiptId, workspace.id).first<Receipt>();
      const attachments = await listAttachments(env.DB, workspace.id, receiptId);
      return secretResponse({ receipt: { ...updated!, attachments, attachment_count: attachments.length } });
    }
    return secretResponse({ error: 'Method not allowed' }, 405);
  }

  if (tail === 'instructions' && request.method === 'GET') {
    // Single source of truth: the card in the page is rendered from this same text, and the
    // client re-fetches it whenever the roster changes, so adding or archiving a person is
    // reflected without a reload.
    const snapshot = await state(env, workspace);
    const people = (snapshot.people ?? []) as { display_name: string; is_archived: number }[];
    const currencies = (snapshot.currencies ?? []) as { code: string; is_default: number; is_archived: number }[];
    const settings = snapshot.settings as { timezone?: string } | null;
    const tz = settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : DEFAULT_TIME_ZONE;
    const liveCurrencies = currencies.filter((currency) => !currency.is_archived);
    const codes = liveCurrencies.map((currency) => currency.code);
    return secretResponse({ text: aiInstructions({
      names: people.filter((person) => !person.is_archived).map((person) => personLabel(person)),
      codes,
      defaultCode: liveCurrencies.filter((currency) => currency.is_default)[0]?.code ?? codes[0] ?? 'USD',
      tz,
      today: zonedParts(tz).date,
    }) });
  }
  if (tail === 'audit' && request.method === 'GET') {
    // Filterable audit log: ?entity=transaction&action=archive,delete&entity_id=14&q=dinner&limit=300
    const params = new URL(request.url).searchParams;
    const entity = (params.get('entity') ?? '').trim();
    const actions = (params.get('action') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const entityId = (params.get('entity_id') ?? '').trim();
    const search = (params.get('q') ?? '').trim().slice(0, 120);
    // ?since=<ISO> is the watermark the "since your last visit" digest reads from: it only ever
    // asks what happened after the last time this device looked, so nothing has to be attributed.
    const since = (params.get('since') ?? '').trim();
    const requestedLimit = Number(params.get('limit') ?? 300);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 300;
    if (entity && !auditEntities.includes(entity)) return secretResponse({ error: 'Invalid entity filter' }, 400);
    if (actions.some((value) => !auditActions.includes(value))) return secretResponse({ error: 'Invalid action filter' }, 400);
    if (entityId && !/^[1-9][0-9]{0,11}$/.test(entityId)) return secretResponse({ error: 'Invalid entity id filter' }, 400);
    if (since && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(since)) return secretResponse({ error: 'Invalid since timestamp' }, 400);
    const clause = ['workspace_id = ?'];
    const values: unknown[] = [workspace.id];
    if (entity) { clause.push('entity_type = ?'); values.push(entity); }
    if (actions.length) { clause.push(`action IN (${actions.map(() => '?').join(', ')})`); values.push(...actions); }
    if (entityId) { clause.push('entity_id = ?'); values.push(entityId); } // audit_log.entity_id is TEXT
    if (since) { clause.push('occurred_at > ?'); values.push(since); } // strictly after the watermark, so a row is never counted twice
    if (search) { clause.push('(actor_label LIKE ? OR before_json LIKE ? OR after_json LIKE ?)'); const like = `%${search}%`; values.push(like, like, like); }
    const where = clause.join(' AND ');
    const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE workspace_id = ?').bind(workspace.id).first<{ count: number }>();
    const matched = await env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE ${where}`).bind(...values).first<{ count: number }>();
    const entries = await env.DB.prepare(`SELECT id, workspace_id, entity_type, entity_id, action, actor_label, before_json, after_json, occurred_at FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT ?`).bind(...values, limit).all();
    const matchedCount = matched?.count ?? 0;
    // audit_log.entity_id is TEXT; hand clients real numbers so id comparisons are not string-vs-number traps.
    const rows = entries.results.map((row) => {
      const text = row.entity_id === null || row.entity_id === undefined ? '' : String(row.entity_id);
      return /^[0-9]+$/.test(text) ? { ...row, entity_id: Number(text) } : row;
    });
    // Restoring is a NEW write (a `restore` row), so the trail stays read-only; the client only needs to know
    // which transactions are archived right now, or the button would offer a no-op on an already-restored row.
    const archivedRows = await env.DB.prepare('SELECT id FROM transactions WHERE workspace_id = ? AND is_deleted = 1 ORDER BY id').bind(workspace.id).all<{ id: number }>();
    return secretResponse({ audit: rows, total: total?.count ?? 0, matched: matchedCount, limit, truncated: matchedCount > entries.results.length, archived_transactions: archivedRows.results.map((row) => row.id) });
  }
  if (tail === '' && request.method === 'PATCH') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const statements: D1PreparedStatement[] = [];
    if ('name' in input) { const name = cleanText(input.name, 100); if (!name) return secretResponse({ error: 'Invalid workspace name' }, 400); statements.push(env.DB.prepare(`UPDATE workspaces SET name = ?, updated_at = ${now} WHERE id = ?`).bind(name, workspace.id)); }
    if ('settings' in input) {
      const settings = asObject(input.settings); if (!settings) return secretResponse({ error: 'Invalid settings' }, 400);
      const sets: string[] = []; const values: unknown[] = [];
      if ('categories' in settings) {
        if (!Array.isArray(settings.categories) || !settings.categories.every((category) => typeof category === 'string' && cleanText(category, 80))) return secretResponse({ error: 'Invalid settings' }, 400);
        sets.push('categories_json = ?'); values.push(JSON.stringify(settings.categories));
      }
      if ('small_amount_guard' in settings) {
        if (!asObject(settings.small_amount_guard)) return secretResponse({ error: 'Invalid settings' }, 400);
        sets.push('small_amount_guard_json = ?'); values.push(JSON.stringify(settings.small_amount_guard));
      }
      if ('timezone' in settings) {
        const timezone = workspaceTimeZone(settings.timezone);
        if (!timezone) return secretResponse({ error: 'Invalid time zone' }, 400);
        sets.push('timezone = ?'); values.push(timezone);
      }
      if ('auto_offset' in settings) {
        if (typeof settings.auto_offset !== 'boolean') return secretResponse({ error: 'Invalid settings' }, 400);
        sets.push('auto_offset = ?'); values.push(settings.auto_offset ? 1 : 0);
      }
      if ('backup_every' in settings) {
        const every = backupEveryValue(settings.backup_every);
        if (!every) return secretResponse({ error: 'Backups must run every 5 to 10000 transactions' }, 400);
        sets.push('backup_every = ?'); values.push(every);
      }
      if (!sets.length) return secretResponse({ error: 'No supported changes' }, 400);
      statements.push(env.DB.prepare(`UPDATE workspace_settings SET ${sets.join(', ')}, updated_at = ${now} WHERE workspace_id = ?`).bind(...values, workspace.id));
    }
    if (!statements.length) return secretResponse({ error: 'No supported changes' }, 400);
    await env.DB.batch(statements); const updated = (await requireWorkspace(env.DB, secret)) as Workspace; return secretResponse(await state(env, updated));
  }
  if (tail === 'people' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); const displayName = input && cleanText(input.display_name, 80); const emoji = input ? cleanEmoji(input.emoji) : ''; if (!displayName || emoji === null) return secretResponse({ error: emoji === null ? 'Pick one emoji for the avatar - letters and numbers belong in the name' : 'Invalid person' }, 400);
    const result = await env.DB.prepare('INSERT INTO workspace_people (workspace_id, display_name, emoji) VALUES (?, ?, ?) RETURNING id, workspace_id, display_name, emoji, is_archived, created_at, updated_at').bind(workspace.id, displayName, emoji).first<Person>(); return secretResponse({ person: result }, 201);
  }
  let route = tail.match(/^people\/(\d+)(?:\/(archive|restore))?$/);
  if (route) {
    const [, value, action] = route; const person = await ownedPerson(env.DB, workspace.id, Number(value)); if (!person) return secretResponse({ error: 'Person not found' }, 404);
    if (!action && request.method === 'PATCH') {
      const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413);
      const sets: string[] = []; const values: unknown[] = [];
      if (input && input.display_name !== undefined) { const displayName = cleanText(input.display_name, 80); if (!displayName) return secretResponse({ error: 'Invalid person' }, 400); sets.push('display_name = ?'); values.push(displayName); }
      if (input && input.emoji !== undefined) { const emoji = cleanEmoji(input.emoji); if (emoji === null) return secretResponse({ error: 'Pick one emoji for the avatar - letters and numbers belong in the name' }, 400); sets.push('emoji = ?'); values.push(emoji); }
      if (!sets.length) return secretResponse({ error: 'No supported changes' }, 400);
      await env.DB.prepare(`UPDATE workspace_people SET ${sets.join(', ')}, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(...values, person.id, workspace.id).run();
    }
    else if ((action === 'archive' || action === 'restore') && request.method === 'POST') await env.DB.prepare(`UPDATE workspace_people SET is_archived = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(action === 'archive' ? 1 : 0, person.id, workspace.id).run(); else return secretResponse({ error: 'Not found' }, 404);
    return secretResponse({ person: await ownedPerson(env.DB, workspace.id, person.id) });
  }
  if (tail === 'currencies' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); const code = input?.code; if (typeof code !== 'string' || !currencyPattern.test(code) || typeof input?.is_default !== 'boolean') return secretResponse({ error: 'Invalid currency' }, 400);
    if (input.is_default) await env.DB.batch([env.DB.prepare(`UPDATE workspace_currencies SET is_default = 0, updated_at = ${now} WHERE workspace_id = ? AND is_archived = 0`).bind(workspace.id), env.DB.prepare('INSERT INTO workspace_currencies (workspace_id, code, is_default) VALUES (?, ?, 1)').bind(workspace.id, code)]); else await env.DB.prepare('INSERT INTO workspace_currencies (workspace_id, code) VALUES (?, ?)').bind(workspace.id, code).run();
    return secretResponse({ currency: await ownedCurrency(env.DB, workspace.id, code) }, 201);
  }
  route = tail.match(/^currencies\/(\d+)(?:\/(archive|restore))?$/);
  if (route) {
    const [, value, action] = route; const currency = await env.DB.prepare('SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE id = ? AND workspace_id = ?').bind(Number(value), workspace.id).first<Currency>(); if (!currency) return secretResponse({ error: 'Currency not found' }, 404);
    if (!action && request.method === 'PATCH') { const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input || (input.code !== undefined && (typeof input.code !== 'string' || !currencyPattern.test(input.code))) || (input.is_default !== undefined && typeof input.is_default !== 'boolean')) return secretResponse({ error: 'Invalid currency' }, 400); if (input.is_default === false && currency.is_default && !currency.is_archived) return secretResponse({ error: 'A workspace must have one active default currency' }, 400); const code = input.code ?? currency.code; if (input.is_default) await env.DB.batch([env.DB.prepare(`UPDATE workspace_currencies SET is_default = 0, updated_at = ${now} WHERE workspace_id = ? AND is_archived = 0`).bind(workspace.id), env.DB.prepare(`UPDATE workspace_currencies SET code = ?, is_default = 1, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(code, currency.id, workspace.id)]); else await env.DB.prepare(`UPDATE workspace_currencies SET code = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(code, currency.id, workspace.id).run(); }
    else if (action === 'archive' && request.method === 'POST') { if (currency.is_default) return secretResponse({ error: 'Default currency cannot be archived' }, 400); await env.DB.prepare(`UPDATE workspace_currencies SET is_archived = 1, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(currency.id, workspace.id).run(); }
    else if (action === 'restore' && request.method === 'POST') await env.DB.prepare(`UPDATE workspace_currencies SET is_archived = 0, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(currency.id, workspace.id).run(); else return secretResponse({ error: 'Not found' }, 404);
    return secretResponse({ currency: await env.DB.prepare('SELECT id, workspace_id, code, is_default, is_archived, created_at, updated_at FROM workspace_currencies WHERE id = ? AND workspace_id = ?').bind(currency.id, workspace.id).first<Currency>() });
  }
  if (tail === 'splits/preview' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const prepared = await planSplit(env.DB, workspace.id, input); if (!prepared.plan) return secretResponse({ error: prepared.problem }, 400);
    return secretResponse(splitResponse(prepared.plan, prepared.plan.transactions));
  }
  if (tail === 'splits' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validSplitKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const prepared = await planSplit(env.DB, workspace.id, input); if (!prepared.plan) return secretResponse({ error: prepared.problem }, 400);
    const draftHash = await splitDraftHash(prepared.plan);
    const loadCommitted = async (): Promise<{ draft_hash: string; transactions: SplitTransaction[] } | null> => {
      const commit = await env.DB.prepare('SELECT draft_hash FROM split_commits WHERE workspace_id = ? AND idempotency_key = ?').bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `split:${idempotencyKey}`).all<SplitTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadCommitted();
    if (existing) return existing.draft_hash === draftHash ? secretResponse(splitResponse(prepared.plan, existing.transactions)) : secretResponse({ error: 'Idempotency key was already used for a different split draft' }, 409);
    const groupId = `split:${idempotencyKey}`;
    const statements: D1PreparedStatement[] = [env.DB.prepare('INSERT INTO split_commits (workspace_id, idempotency_key, draft_hash) VALUES (?, ?, ?)').bind(workspace.id, idempotencyKey, draftHash)];
    for (const transaction of prepared.plan.transactions) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(workspace.id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, groupId));
    statements.push(...await autoNettingStatements(env.DB, workspace.id, prepared.plan.transactions));
    try { await commitLedger(env, workspace.id, statements); } catch {
      const raced = await loadCommitted();
      if (!raced) return secretResponse({ error: 'Unable to commit split' }, 500);
      return raced.draft_hash === draftHash ? secretResponse(splitResponse(prepared.plan, raced.transactions)) : secretResponse({ error: 'Idempotency key was already used for a different split draft' }, 409);
    }
    const committed = await loadCommitted();
    if (!committed) return secretResponse({ error: 'Unable to load committed split' }, 500);
    return secretResponse(splitResponse(prepared.plan, committed.transactions), 201);
  }
  const personSummary = tail.match(/^people\/(\d+)\/summary$/);
  if (personSummary && request.method === 'GET') {
    const person = await ownedPerson(env.DB, workspace.id, Number(personSummary[1])); if (!person) return secretResponse({ error: 'Person not found' }, 404);
    const rows = await env.DB.prepare('SELECT id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, is_deleted FROM transactions WHERE workspace_id = ? AND (creditor_person_id = ? OR debtor_person_id = ?) ORDER BY occurred_on DESC, id DESC').bind(workspace.id, person.id, person.id).all<{ id: number; occurred_on: string; entry_kind: string; topic: string; category: string; creditor_person_id: number; debtor_person_id: number; amount_minor: number; currency_code: string; notes: string | null; is_deleted: number }>();
    const roster = await env.DB.prepare('SELECT id, display_name, is_archived FROM workspace_people WHERE workspace_id = ? ORDER BY id').bind(workspace.id).all<{ id: number; display_name: string; is_archived: number }>();
    const nameOf = new Map<number, string>(); for (const entry of roster.results) nameOf.set(entry.id, personLabel(entry));
    // outgoing = this person fronted the money or is owed it; incoming = a counterparty fronted it for them.
    type PersonTotals = { currency_code: string; paid_for_minor: number; covered_for_them_minor: number; settled_out_minor: number; settled_in_minor: number; net_minor: number; entries: number };
    type PersonPair = { counterparty_id: number; counterparty: string; currency_code: string; paid_for_minor: number; covered_minor: number; settled_out_minor: number; settled_in_minor: number; net_minor: number; records: number ; archived_records: number };
    const totals = new Map<string, PersonTotals>(); const pairs = new Map<string, PersonPair>();
    let activeRecords = 0; let archivedRecords = 0;
    type SummaryRecord = { id: number; occurred_on: string; entry_kind: string; topic: string; category: string; currency_code: string; amount_minor: number; direction: string; counterparty_id: number; counterparty: string; notes: string | null; is_deleted: number };
    const recent: SummaryRecord[] = [];
    // These are the full per-person history, deliberately separate from the 25-row Recent activity window.
    // A traveller asking for "all payments" must not silently lose older repayments or offset rows.
    const breakdown: { paid_for: SummaryRecord[]; covered_for_them: SummaryRecord[]; settlements: SummaryRecord[] } = { paid_for: [], covered_for_them: [], settlements: [] };
    for (const row of rows.results) {
      const outgoing = row.creditor_person_id === person.id;
      const counterpartyId = outgoing ? row.debtor_person_id : row.creditor_person_id;
      // A repayment is stored positive with entry_kind 'payment' (that is what the page posts) while an
      // offset row carries its own negative sign: both are settlements. Reading a repayment as
      // 'paid_for' made a person's net grow every time somebody paid them back.
      const settled = row.amount_minor < 0 || row.entry_kind === 'payment';
      const direction = settled ? (outgoing ? 'settled_in' : 'settled_out') : outgoing ? 'paid_for' : 'covered_for_them';
      if (row.is_deleted === 1) archivedRecords += 1; else activeRecords += 1;
      if (row.is_deleted === 1) {
        // Archived rows stay out of the money, but the pair still reports that they exist.
        const archivedKey = `${row.currency_code}:${counterpartyId}`;
        const archivedPair = pairs.get(archivedKey) ?? { counterparty_id: counterpartyId, counterparty: nameOf.get(counterpartyId) ?? 'Unknown', currency_code: row.currency_code, paid_for_minor: 0, covered_minor: 0, settled_out_minor: 0, settled_in_minor: 0, net_minor: 0, records: 0, archived_records: 0 };
        archivedPair.archived_records += 1;
        pairs.set(archivedKey, archivedPair);
      }
      const record: SummaryRecord = { id: row.id, occurred_on: row.occurred_on, entry_kind: row.entry_kind, topic: row.topic, category: row.category, currency_code: row.currency_code, amount_minor: row.amount_minor, direction, counterparty_id: counterpartyId, counterparty: nameOf.get(counterpartyId) ?? 'Unknown', notes: row.notes, is_deleted: row.is_deleted };
      if (direction === 'paid_for') breakdown.paid_for.push(record); else if (direction === 'covered_for_them') breakdown.covered_for_them.push(record); else breakdown.settlements.push(record);
      if (recent.length < 25) recent.push(record);
      if (row.is_deleted === 1) continue; // archived rows stay visible as history but never move a balance
      const total = totals.get(row.currency_code) ?? { currency_code: row.currency_code, paid_for_minor: 0, covered_for_them_minor: 0, settled_out_minor: 0, settled_in_minor: 0, net_minor: 0, entries: 0 };
      total.entries += 1;
      if (direction === 'paid_for') total.paid_for_minor += row.amount_minor; else if (direction === 'covered_for_them') total.covered_for_them_minor += row.amount_minor; else if (direction === 'settled_out') total.settled_out_minor += Math.abs(row.amount_minor); else total.settled_in_minor += Math.abs(row.amount_minor);
      // Net is what is still outstanding after repayments, the same figure the ledger's outstanding
      // tile and the Balances cards report: money received back lowers what is owed to this person,
      // money handed over lowers what they owe.
      total.net_minor = total.paid_for_minor - total.covered_for_them_minor - total.settled_in_minor + total.settled_out_minor;
      totals.set(row.currency_code, total);
      const pairKey = `${row.currency_code}:${counterpartyId}`;
      const pair = pairs.get(pairKey) ?? { counterparty_id: counterpartyId, counterparty: nameOf.get(counterpartyId) ?? 'Unknown', currency_code: row.currency_code, paid_for_minor: 0, covered_minor: 0, settled_out_minor: 0, settled_in_minor: 0, net_minor: 0, records: 0, archived_records: 0 };
      if (direction === 'paid_for') pair.paid_for_minor += row.amount_minor; else if (direction === 'covered_for_them') pair.covered_minor += row.amount_minor; else if (direction === 'settled_out') pair.settled_out_minor += Math.abs(row.amount_minor); else pair.settled_in_minor += Math.abs(row.amount_minor);
      pair.net_minor = pair.paid_for_minor - pair.covered_minor - pair.settled_in_minor + pair.settled_out_minor; pair.records += 1; pairs.set(pairKey, pair);
    }
    const activePartners = roster.results.filter((entry) => entry.id !== person.id && entry.is_archived === 0);
    const currencies = await env.DB.prepare('SELECT code FROM workspace_currencies WHERE workspace_id = ? AND is_archived = 0 ORDER BY code').bind(workspace.id).all<{ code: string }>();
    const suggestions: { counterparty_id: number; counterparty: string; currency_code: string; offset_amount_minor: number; they_owe_minor: number; owed_to_them_minor: number }[] = [];
    for (const currency of currencies.results) for (const partner of activePartners) {
      const balance = await reciprocalBalance(env.DB, workspace.id, person.id, partner.id, currency.code);
      const owedToThem = Math.max(balance.second_owes_first_minor, 0); const theyOwe = Math.max(balance.first_owes_second_minor, 0);
      const offset = Math.min(owedToThem, theyOwe);
      if (offset > 0) suggestions.push({ counterparty_id: partner.id, counterparty: partner.display_name, currency_code: currency.code, offset_amount_minor: offset, they_owe_minor: theyOwe, owed_to_them_minor: owedToThem });
    }
    return secretResponse({ person, totals: [...totals.values()].sort((a, b) => a.currency_code.localeCompare(b.currency_code)), counterparties: [...pairs.values()].sort((a, b) => b.net_minor - a.net_minor || a.counterparty.localeCompare(b.counterparty)), suggestions, recent, breakdown, recent_limit: 25, records: { active: activeRecords, archived: archivedRecords, total: activeRecords + archivedRecords } });
  }
  if (tail === 'offset-suggestions' && request.method === 'GET') {
    const people = await env.DB.prepare('SELECT id FROM workspace_people WHERE workspace_id = ? AND is_archived = 0 ORDER BY id').bind(workspace.id).all<{ id: number }>();
    const currencies = await env.DB.prepare('SELECT code FROM workspace_currencies WHERE workspace_id = ? AND is_archived = 0 ORDER BY code').bind(workspace.id).all<{ code: string }>();
    const suggestions: { first_person_id: number; second_person_id: number; first_owes_second_minor: number; second_owes_first_minor: number; offset_amount_minor: number; currency_code: string }[] = [];
    for (const currency of currencies.results) {
      for (let first = 0; first < people.results.length; first += 1) {
        for (let second = first + 1; second < people.results.length; second += 1) {
          const firstId = people.results[first].id; const secondId = people.results[second].id;
          const balance = await reciprocalBalance(env.DB, workspace.id, firstId, secondId, currency.code);
          const offset = Math.min(Math.max(balance.first_owes_second_minor, 0), Math.max(balance.second_owes_first_minor, 0));
          if (offset > 0) suggestions.push({ first_person_id: firstId, second_person_id: secondId, first_owes_second_minor: balance.first_owes_second_minor, second_owes_first_minor: balance.second_owes_first_minor, offset_amount_minor: offset, currency_code: currency.code });
        }
      }
    }
    return secretResponse({ suggestions });
  }
  if ((tail === 'offsets/preview' || tail === 'offsets') && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    const firstId = input.first_person_id; const secondId = input.second_person_id; const currencyCode = input.currency_code;
    if (!Number.isSafeInteger(firstId) || !Number.isSafeInteger(secondId) || firstId === secondId || typeof currencyCode !== 'string' || !currencyPattern.test(currencyCode)) return secretResponse({ error: 'Invalid offset draft' }, 400);
    const currency = await ownedCurrency(env.DB, workspace.id, currencyCode, true); if (!currency) return secretResponse({ error: 'Offset currency must belong to this workspace and be active' }, 400);
    for (const personId of [firstId, secondId] as number[]) if (!(await ownedPerson(env.DB, workspace.id, personId, true))) return secretResponse({ error: 'Offset people must belong to this workspace and be active' }, 400);
    const balance = await reciprocalBalance(env.DB, workspace.id, firstId as number, secondId as number, currencyCode as string);
    const amount = Math.min(Math.max(balance.first_owes_second_minor, 0), Math.max(balance.second_owes_first_minor, 0));
    if (tail === 'offsets/preview') {
      if (amount <= 0) return secretResponse({ error: 'No reciprocal balance to offset between these people in this currency' }, 409);
      return secretResponse({ offset_amount_minor: amount, transactions: offsetTransactions(workspace.id, { occurred_on: validDateValue(input.occurred_on) ? input.occurred_on : new Date().toISOString().slice(0, 10), topic: 'Offset', category: 'Offset', notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null }, firstId as number, secondId as number, amount, currencyCode as string) });
    }
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validIdempotencyKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const loadOffset = async (): Promise<{ draft_hash: string; transactions: WorkflowTransaction[] } | null> => {
      const commit = await env.DB.prepare("SELECT draft_hash FROM workflow_commits WHERE workspace_id = ? AND kind = 'offset' AND idempotency_key = ?").bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `offset:${idempotencyKey}`).all<WorkflowTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadOffset();
    if (existing) return existing.draft_hash === (await hashJson({ first_person_id: firstId, second_person_id: secondId, currency_code: currencyCode })) ? secretResponse({ offset_amount_minor: amount, transactions: existing.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different offset draft' }, 409);
    if (amount <= 0) return secretResponse({ error: 'The recalculated reciprocal balance is no longer positive' }, 409);
    const occurredOn = typeof input.occurred_on === 'string' && validDateValue(input.occurred_on) ? input.occurred_on : new Date().toISOString().slice(0, 10);
    const transactions = offsetTransactions(workspace.id, { occurred_on: occurredOn, topic: 'Offset', category: 'Offset', notes: typeof input.notes === 'string' ? input.notes.slice(0, 4000) : null }, firstId as number, secondId as number, amount, currencyCode as string);
    const groupId = `offset:${idempotencyKey}`;
    const draftHash = await hashJson({ first_person_id: firstId, second_person_id: secondId, currency_code: currencyCode });
    const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO workflow_commits (workspace_id, kind, idempotency_key, draft_hash) VALUES (?, 'offset', ?, ?)").bind(workspace.id, idempotencyKey, draftHash)];
    for (const transaction of transactions) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(transaction.workspace_id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, groupId));
    try { await commitLedger(env, workspace.id, statements); } catch {
      const raced = await loadOffset();
      if (!raced) return secretResponse({ error: 'Unable to commit offset' }, 500);
      return raced.draft_hash === draftHash ? secretResponse({ offset_amount_minor: amount, transactions: raced.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different offset draft' }, 409);
    }
    const committed = await loadOffset();
    if (!committed) return secretResponse({ error: 'Unable to load committed offset' }, 500);
    return secretResponse({ offset_amount_minor: amount, transactions: committed.transactions }, 201);
  }
  if ((tail === 'batches/preview' || tail === 'batches') && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > maxWorkflowRows) return secretResponse({ error: 'Batch must include 1-200 rows' }, 400);
    const cleaned: Omit<WorkflowTransaction, 'workspace_id' | 'import_group_id'>[] = [];
    for (const raw of input.rows) {
      const item = asObject(raw); if (!item) return secretResponse({ error: 'Invalid batch row' }, 400);
      const validated = await validateWorkflowRow(env.DB, workspace.id, item); if (validated.problem || !validated.row) return secretResponse({ error: validated.problem ?? 'Invalid batch row' }, 400);
      cleaned.push(validated.row);
    }
    if (tail === 'batches/preview') return secretResponse({ rows: cleaned });
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validIdempotencyKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const draftHash = await hashJson(cleaned);
    const loadBatch = async (): Promise<{ draft_hash: string; transactions: WorkflowTransaction[] } | null> => {
      const commit = await env.DB.prepare("SELECT draft_hash FROM workflow_commits WHERE workspace_id = ? AND kind = 'batch' AND idempotency_key = ?").bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `batch:${idempotencyKey}`).all<WorkflowTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadBatch();
    if (existing) return existing.draft_hash === draftHash ? secretResponse({ transactions: existing.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different batch draft' }, 409);
    const groupId = `batch:${idempotencyKey}`;
    const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO workflow_commits (workspace_id, kind, idempotency_key, draft_hash) VALUES (?, 'batch', ?, ?)").bind(workspace.id, idempotencyKey, draftHash)];
    for (const transaction of cleaned) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(workspace.id, transaction.occurred_on, transaction.entry_kind, transaction.topic, transaction.category, transaction.creditor_person_id, transaction.debtor_person_id, transaction.amount_minor, transaction.currency_code, transaction.notes, groupId));
    statements.push(...await autoNettingStatements(env.DB, workspace.id, cleaned));
    try { await commitLedger(env, workspace.id, statements); } catch {
      const raced = await loadBatch();
      if (!raced) return secretResponse({ error: 'Unable to commit batch' }, 500);
      return raced.draft_hash === draftHash ? secretResponse({ transactions: raced.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different batch draft' }, 409);
    }
    const committed = await loadBatch();
    if (!committed) return secretResponse({ error: 'Unable to load committed batch' }, 500);
    return secretResponse({ transactions: committed.transactions }, 201);
  }
  if (tail === 'imports/preview' || tail === 'imports') {
    if (request.method !== 'POST') return new Response('Not found', { status: 404, headers: secretHeaders() });
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxJsonBytes) return secretResponse({ error: 'Request body too large' }, 413);
    const raw = await request.text(); if (raw.length > maxJsonBytes) return secretResponse({ error: 'Request body too large' }, 413);
    const peopleRows = await env.DB.prepare('SELECT id, display_name, is_archived FROM workspace_people WHERE workspace_id = ?').bind(workspace.id).all<{ id: number; display_name: string; is_archived: number }>();
    const peopleByName = new Map<string, { id: number; display_name: string; is_archived: number }>();
    for (const person of peopleRows.results) {
      peopleByName.set(person.display_name.toLocaleLowerCase(), person);
      const canonical = canonicalName(person.display_name);
      if (canonical && !peopleByName.has(canonical)) peopleByName.set(canonical, person);
    }
    const currencyRows = await env.DB.prepare('SELECT code FROM workspace_currencies WHERE workspace_id = ? AND is_archived = 0').bind(workspace.id).all<{ code: string }>();
    const currencyCodes = new Set(currencyRows.results.map((currency) => currency.code));
    const parsed = parseImportCsv(raw, peopleByName, currencyCodes);
    if (parsed.errors.length || parsed.rows.length < 1) return secretResponse({ errors: parsed.errors.length ? parsed.errors : ['CSV contained no valid rows'] }, 400);
    if (parsed.rows.length > maxWorkflowRows) return secretResponse({ error: 'Import must include 1-200 rows' }, 400);
    if (tail === 'imports/preview') return secretResponse({ rows: parsed.rows, errors: [] });
    const idempotencyKey = request.headers.get('idempotency-key'); if (!validIdempotencyKey(idempotencyKey)) return secretResponse({ error: 'A valid Idempotency-Key header is required' }, 400);
    const draftHash = await hashJson(parsed.rows);
    const loadImport = async (): Promise<{ draft_hash: string; transactions: WorkflowTransaction[] } | null> => {
      const commit = await env.DB.prepare("SELECT draft_hash FROM workflow_commits WHERE workspace_id = ? AND kind = 'import' AND idempotency_key = ?").bind(workspace.id, idempotencyKey).first<{ draft_hash: string }>();
      if (!commit) return null;
      const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND import_group_id = ? ORDER BY id').bind(workspace.id, `import:${idempotencyKey}`).all<WorkflowTransaction>();
      return { draft_hash: commit.draft_hash, transactions: transactions.results };
    };
    const existing = await loadImport();
    if (existing) return existing.draft_hash === draftHash ? secretResponse({ transactions: existing.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different import draft' }, 409);
    const groupId = `import:${idempotencyKey}`;
    const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO workflow_commits (workspace_id, kind, idempotency_key, draft_hash) VALUES (?, 'import', ?, ?)").bind(workspace.id, idempotencyKey, draftHash)];
    for (const row of parsed.rows as ImportPlanRow[]) statements.push(env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(workspace.id, row.occurred_on, row.entry_kind, row.topic, row.category, row.creditor_person_id, row.debtor_person_id, row.amount_minor, row.currency_code, row.notes, groupId));
    statements.push(...await autoNettingStatements(env.DB, workspace.id, parsed.rows as ImportPlanRow[]));
    try { await commitLedger(env, workspace.id, statements); } catch {
      const raced = await loadImport();
      if (!raced) return secretResponse({ error: 'Unable to commit import' }, 500);
      return raced.draft_hash === draftHash ? secretResponse({ transactions: raced.transactions }) : secretResponse({ error: 'Idempotency key was already used for a different import draft' }, 409);
    }
    const committed = await loadImport();
    if (!committed) return secretResponse({ error: 'Unable to load committed import' }, 500);
    return secretResponse({ transactions: committed.transactions }, 201);
  }
  if (tail === 'backups' && request.method === 'GET') {
    return secretResponse({ status: await backupStatus(env.DB, workspace.id), backups: await listBackups(env.DB, workspace.id), keep: KEEP_BACKUPS, configured: Boolean(env.BACKUPS) });
  }
  if (tail === 'backups' && request.method === 'POST') {
    const result = await createBackup(env, workspace.id, workspace.name, 'manual');
    if ('error' in result) return secretResponse({ error: result.error }, 503);
    return secretResponse({ backup: result.backup, status: result.status }, 201);
  }
  route = tail.match(/^backups\/(\d+)(?:\/(restore))?$/);
  if (route) {
    const [, value, action] = route; const sequence = Number(value);
    if (!action && request.method === 'GET') {
      const body = await readBackup(env, workspace.id, sequence);
      if (body === null) return secretResponse({ error: 'Backup not found' }, 404);
      const headers = new Headers(secretHeaders());
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('content-disposition', `attachment; filename="trip-finance-workspace-${workspace.id}-backup-${sequence}.json"`);
      return new Response(body, { status: 200, headers });
    }
    if (action === 'restore' && request.method === 'POST') {
      const body = await readBackup(env, workspace.id, sequence);
      if (body === null) return secretResponse({ error: 'Backup not found' }, 404);
      let snapshot: unknown; try { snapshot = JSON.parse(body); } catch { return secretResponse({ error: 'Backup file is unreadable' }, 500); }
      const problem = snapshotProblem(snapshot); if (problem) return secretResponse({ error: problem }, 400);
      const secret = createSecret();
      const result = await restoreSnapshot(env, await sha256(secret), snapshot, restoreName((snapshot as { workspace?: { name?: unknown } }).workspace?.name));
      return secretResponse({ workspace: await requireWorkspace(env.DB, secret), workspace_url: `/w/${secret}`, restored: result.restored }, 201);
    }
  }
  if (tail === 'transactions' && request.method === 'GET') { const transactions = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE workspace_id = ? AND is_deleted = 0 ORDER BY occurred_on DESC, id DESC').bind(workspace.id).all<Transaction>(); return secretResponse({ transactions: transactions.results }); }
  if (tail === 'transactions' && request.method === 'POST') {
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400); const problem = await validateTransaction(env.DB, workspace.id, input); if (problem) return secretResponse({ error: problem }, 400);
    const statements: D1PreparedStatement[] = [env.DB.prepare('INSERT INTO transactions (workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at').bind(workspace.id, input.occurred_on, input.entry_kind, cleanText(input.topic, 200), cleanText(input.category, 80), input.creditor_person_id, input.debtor_person_id, input.amount_minor, input.currency_code, input.notes ?? null, input.import_group_id ?? null)];
    // Automatic bilateral netting rides in the same atomic batch as the entry that triggered it.
    const netting = await autoNettingStatements(env.DB, workspace.id, [{ creditor_person_id: input.creditor_person_id as number, debtor_person_id: input.debtor_person_id as number, amount_minor: input.amount_minor as number, currency_code: input.currency_code as string, occurred_on: input.occurred_on as string }]);
    statements.push(...netting);
    const results = await env.DB.batch(statements);
    await tickBackups(env, workspace.id);
    const created = ((results[0]?.results ?? [])[0] ?? null) as Transaction | null;
    return secretResponse({ transaction: created, netted_pairs: netting.length / 2 }, 201);
  }
  route = tail.match(/^transactions\/(\d+)(?:\/(delete|restore))?$/);
  if (route) {
    const [, value, action] = route; const transaction = await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE id = ? AND workspace_id = ?').bind(Number(value), workspace.id).first<Transaction>(); if (!transaction) return secretResponse({ error: 'Transaction not found' }, 404);
    if (!action && request.method === 'PATCH') { if (transaction.is_deleted) return secretResponse({ error: 'Restore the transaction before editing it' }, 400); const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400); const updated = { ...transaction, ...input }; const problem = await validateTransaction(env.DB, workspace.id, updated); if (problem) return secretResponse({ error: problem }, 400); await env.DB.prepare(`UPDATE transactions SET occurred_on = ?, entry_kind = ?, topic = ?, category = ?, creditor_person_id = ?, debtor_person_id = ?, amount_minor = ?, currency_code = ?, notes = ?, import_group_id = ?, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(updated.occurred_on, updated.entry_kind, cleanText(updated.topic, 200), cleanText(updated.category, 80), updated.creditor_person_id, updated.debtor_person_id, updated.amount_minor, updated.currency_code, updated.notes ?? null, updated.import_group_id ?? null, transaction.id, workspace.id).run(); }
    else if ((action === 'delete' && request.method === 'POST') || (!action && request.method === 'DELETE')) await env.DB.prepare(`UPDATE transactions SET is_deleted = 1, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(transaction.id, workspace.id).run();
    else if (action === 'restore' && request.method === 'POST') await env.DB.prepare(`UPDATE transactions SET is_deleted = 0, updated_at = ${now} WHERE id = ? AND workspace_id = ?`).bind(transaction.id, workspace.id).run(); else return secretResponse({ error: 'Not found' }, 404);
    return secretResponse({ transaction: await env.DB.prepare('SELECT id, workspace_id, occurred_on, entry_kind, topic, category, creditor_person_id, debtor_person_id, amount_minor, currency_code, notes, import_group_id, is_deleted, created_at, updated_at FROM transactions WHERE id = ? AND workspace_id = ?').bind(transaction.id, workspace.id).first<Transaction>() });
  }
  // --- Telegram notifications. Anyone holding the capability link manages these, exactly like the
  // rest of the workspace: the link is the authorization, and these routes can only ever touch a chat
  // link, never a ledger row.
  if (tail === 'telegram' && request.method === 'GET') return secretResponse(await telegramStatus(env, workspace.id, true));
  if (tail === 'telegram/pair' && request.method === 'POST') {
    const pairing = await createPairing(env, workspace.id);
    // Nothing to hand out until the deployment carries a bot token and a webhook secret.
    if (!pairing) return secretResponse({ error: 'Telegram is not configured on this deployment' }, 503);
    return secretResponse({ pairing }, 201);
  }
  const telegramConnection = tail.match(/^telegram\/connections\/([0-9]{1,12})$/);
  if (telegramConnection && (request.method === 'PATCH' || request.method === 'DELETE')) {
    const connectionId = Number(telegramConnection[1]);
    if (request.method === 'DELETE') {
      const removed = await removeConnection(env, workspace.id, connectionId);
      return removed ? secretResponse({ removed: connectionId }) : secretResponse({ error: 'Not found' }, 404);
    }
    const input = await body(request); if (input === bodyTooLarge) return secretResponse({ error: 'Request body too large' }, 413); if (!input) return secretResponse({ error: 'Invalid JSON' }, 400);
    if (typeof input.enabled !== 'boolean') return secretResponse({ error: 'Invalid connection update' }, 400);
    const connection = await setConnectionEnabled(env, workspace.id, connectionId, input.enabled);
    return connection ? secretResponse({ connection }) : secretResponse({ error: 'Not found' }, 404);
  }
  return new Response('Not found', { status: 404, headers: secretHeaders() });
}

const auditEntities = ['workspace', 'person', 'currency', 'workspace_settings', 'transaction', 'workspace_backup', 'receipt', 'receipt_attachment'];
const auditActions = ['create', 'update', 'archive', 'restore', 'delete'];

// 180x180 PNG, generated from the same artwork as FAVICON_SVG (see the icon section below)
const APPLE_TOUCH_ICON_PNG = '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';
// The install icons are the same artwork as FAVICON_SVG, pre-rendered at the sizes a manifest
// asks for (192, 512, and a maskable 512 with the art inside the 80% safe zone). There is no
// image toolchain in this repo, so they ship as base64 and are decoded per request.
const ICON_192_PNG = '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';
const ICON_512_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAsaElEQVR42u3deYhe5bkA8G/25ZuZxGgSM8kkYzaLW2MwVg2hYopaxhgXLMRa6xIuuX9E/yluhaAWpLQI0YJoSysFLfSCRCm0pUKCXLChCG6XYiUtin80pEUqBWuKcO55xqUaZyazfN9Zfwd+EDSZTN5z3ud55jvv+7yNhiv3q6OjY3FnZ9eXu7t7dvT09O3p6+t/oL9/8PGBgeYzg4NDh5rN4ZebzZEjQ0OLjqbeGx5e/EHqw1QCkLOIRR9EbIoYFbEqYlbErohhEcsipkVsixgXsS5insjvqlmi7xxLJ8BEb2/fXemkeDKdIC+mE+aYAALUTcS+iIERCyMmRmyMGClTuKrwU/2SeKCj8k2r4F9HZWzSA5y0MDgaMTNi50dFQccSGcVV+I/x04f12r6+gUfi4y8TGaA1IqZGbI0Y6/WBqxBXV1fX5t7e/vsGB4deMEkBshExN2JvxGCZyJVh0u/ellaiDzebI2+aiAB5fzow8mbE5IjNMpSrLT/ppw/Y92N1qwkHUNhi4EjEap8MuBb8Tr+3t2/v4ODwYRMLoGyvCYYPRwy3ZsA1l4/4t/b3D/7UPnuAavQpiJgesV2Gc0159fT0ftNiPoBqLx6MWC/jueLq7O3tu9OCPoB6LRyM2B85QBqs39XX29t/j+Y8APVuOhS5IHKCtFiDK1pOar8LwGfbEkdukCEr+46/b0+zOfK2hx2AaV4NvB25QsasyNXd3bNzcHD4JQ83ALPcQvhS5A4ZtKyr+zq7zo6jKD3MAMxH5JDIJTJqmVb49fU/4OEFoBUip8isxf+4f6LZHH7dAwtAa9cHDL8eOUamLdzVMdDfP/CYhxSAdopcEzlH3i3GT/07HNIDQIa7BY5E7pGBc33XP/CwhxGAfNYGDDwsE2d8xVGPTukDoABbBg87fjizhj69/+WhA6BIIjfJ0G28LPQDoNgLBF0tburTudZRvQAU/5XA0AuRs2Tulqzy777cqX0AlEXkrMhdMrj3/QBYF+DSzheA+mwV1EZ4jov9Bh/34ABQjcWBg4/L7LO4Bgaa/+OBAaBKIrfJ8DP08x8YGPqtBwWAahYBQ791jsCJqb+jY7FtfgDUYZtg5DyZ/6PkvyQdkBc9GADUpAh4MXKfn/wlfwDqWQQsru07fx/7A1Dn1wG1XBNgwR8AFgbGwkBb/QDAFkFNfgBAsyDtfQGgwirbNtjBPgAws8odIBTHIrqxAHBylTlKuLOzc22cjeymAsDJRc6M3Fn6AsBefwCYT4+AUq/4H3jMjQSA+ewMGHjMoj8AsCiw+FdXV9dmNw4AFi5yaone+w8fdtMAoBXrAYYPl6TZz8DDbhgAtE7k1oLv9+/Z4UYBQDv6A/TsKOzxvs3myBE3CQBaL3JsIY8PtuUPAGq2NbC7u2fCjQGATF4FTBSmAGg2h193UwAgi1cBw6874hcAarkrIOejgzs7u852IwAge5GDcysABgaaz7gJAJC9yMF5Lfzb6QYAQK4LAnfm0e73JYMPAPmJXJzxSX99eww8AOQvcnKG2/5G3jboAFCEbYEjb2eS/Ht7++4y4ABQHJGb277tf2ho0TGDDQDFEbk5cnQbf/rvv8dAA0ARPwXov6dtfX/SCuOoQQaAQn4KcDRydTve/d9pgAGg0GsB7mzHyv83DS4AFHpHwJst3vff+00DCwBl6AvQ+80Wdv0besGgAkDxRc5uSfLv6ureakABoDwidy+4AOjvH/ypwQSA8ojcvaDk39HRsTj9Qh8aTAAolQ8jhy9k699egwgApdwSuHchR/4eNogAUMbFgMOH57n4r2uzAQSAMi8G7No891N/+ga+b/AAoLwil8+n898RgwcA5RW5fK57/7cZOACoRE+AbXP5+P9hgwYAlXgN8LCDfwCgfq8B3rT6HwDsBpiu+U//fQYLimtk0bJk8ennJEvGL0uWfumGZPmmPcmKC+9NRrf9IFm1/Ylk7MpfJGt2/CoZv/ZgcsYNh5O1u15N1t30RrL+5r8k6295J9lw61+TDbcdSzbc/rePxK/T/xb/L35P/N74M/Fn42vE14qvGV87/o74u+LvjL87vof4XuJ7cm+guCK3O/kPSuCU0U3JaRt3Jss3751MumNXPp2MX3doMjl/mrgLJr63+B7je43vOb73+DfEv8U9hXyd9ITAj3v/GyzIKtGvvCBZetaNyYqL70/Grngq/an79+lP5EcLm+TnLf03xb8t/o3xb41/c/zbPQOQnRnPBuju7rnWIEGbkv3YRcmy83YnK7+6Pxm/5ncffRxftUQ/RzEGMRYxJjE2MUaeFWiPyPEzbf97xCBBC97Tn7IyOW3D1ZM/7a656tlk/bffqn2yn3VRkI5VjFmMXYxhjKVnClqyHfCRGbb/Db9skGAeCX/x8sn33aNbH0p/on1eIm+xGNMY2xjjGGvPHMxnO+Dwy9O9/19igGD2lqzempy+5e70p9XnJOmMxZjH2Mc98CzCnNYBLJnq/f+EwYEZjCxJTjvz+mTlpY9ObpOTiIsh7kXck7g3cY88qzDjOoCJKd7/9z9gcODEd/mjybJzbk7GLv+5RXslWVQY9yruWdw7zzCcuA6g/4EvFAADA81fGxyIRjtLk6Vnf2tyy9rnGuZQsq2HxybvYdzLuKeebVicRK7/QgEwNLToqMGhzmKB2artP/aTfkU/GYh7G/fYs06dRa4/YQFg55iBoZZ781dtSUYv+Z53+jVbMxD3PO69OUA9FwJ2jlkASG0tO/dWq/eZfAbiWTAnqO1CwN7evrsMCpX/aX/0/Mm95Otu+pPkxwnnGPxp8tmIZ8Rcoeoi539aAPT3Dz5pUKjsu/0NV08eUCPRMRvxrMQzY+5QVZHzP3sC4IsGhcp9zH/e7snjbCU15tV9MH124hkyl6iayPmf3QFwzKBQiS18i5cnp1/wHYv6aOmiwXimtCCmQjsBjjkCmMpYdOqaZMVF+5J1N/9Z0qI96wTSZyuesXjWzDnKvxOgY3Gjs7PrywaD8ib+8WT0kgft3SfTngLxzMWzZw5SVpH7YwvgDoNB+Vr0rpw8LlbiJ89CIJ5BxxVT0q2AOxo9PX17DAZlEqfA+aifIr0aiGfS3KRMIvc7BIjSWL5pj8V9FHqxYDyj5iplMHkoUH//4OMGg0Lv4z/zetv5KNX2wcmjic1dit0L4PE4BfAZg0EhO/eNXaSBD6VuKBTPsLlMEUXujyZAhwwGhVrgt2jZZFtWSYQqiGc5nmlzm4I1AzrUaDaHXzYYFKZ737m3Jmt3vSZxULH1Aa85dIhCidyfFgAjRwwGuX/cv2pLsvrrv5QsqLR4xh1DTDEKgJEj0Qb4qMEgTysuvFdyoFbimTf3ybkd8NEoAN4zGOTh1DO+loxf87yEQD13C6TPfswBsYCcCoD3GukvPjAYZC1aqUoC8LfJuSAmkIMPogD40ECQ3U/92+3phyl6B8TcECPI0IcNg0Bm7/q/8l3BHmZaG5DOEbGCrCgAaP8K/9HzkzVXPSvAwyzEXIk5I3agAKDc+/rPu92JfTCPkwZj7oghKAAopZWXPiqYwwLEHBJLUABQGktWb03GrzskgEMrFgimcynmlNiCAoCCf+S/O9lw2zGBG1opnVMxt8QYFAAUc2//th8K1NDOngHpHBNrUABQGIuWbUxWTxwQoCGL8wTSuRZzTuxBAUC+jX3WXp6s3fWqwAyZni746uTcE4NQAJDf+37BGHJjXQAKALLv6nfx/QIwFKF7YDoXxSQUAGRi1fYnBF4okJiTYhMKANq32O/UNRb7QZEXB6ZzVKxCAUDL+/mfcf3/CrRQYDFHnSOAAoDWdfYbvyxZd+P/CbBQAjFXY86KXSgAWJDTNu50mA+U8DChmLtiGAoA5mXpWTcKplBiMYfFMhQAzHGP/+0CKFSiV4BjhVEAMEvLN/23wAkVEnNabEMBwMzJf/NeAROqWASkc1uMQwHANMn/DoESKl0E3CHWoQDAT/7gkwAUAHjnLzCCNQEoALDaH7A7AAUA9vkD+gSgAKAqHf4EQEDHQAUANevtr70v8EnbYGcHKACoyal+DvYBTjxAyCmCCgAqLM4Kd6QvMN1RwhEjxEoFABW0euKAQAdMK2KEWKkAoGJWbX9CgCN3F9zx9+QbD72b7H3sH8m9P3tvUvw6/lv8P2OUv4gVYqYCgIpYcfH9Ahu5ieT+k9/8M/njW/9K/v3vf88ofk/83vgzxi4/ETPETgUApW/0s1tAIxfxk/0f3jh50p9O/Nn4GsYyr0ZBu8VQBQBlderaywUyMjex793k4Cvvzzvxnyi+VnxNY5u9iCFiqQKAsq34X7YxWbvrVUGMTMU7/eMtSvyfFV8zvrYxzlbEkIglYqoCACv+YVr7D/yz5Yn/RPF3GGs7A1AAMI3RbT8UuKhc8v/Ej55TBGQtYorYqgDAoj/4wsf+WSV/RYBFgSgAmKrH/+qtyYbbjglWZLrg73jGyV8RkJM0tkSMEWsVABTQ+HWHBCky1crV/oqA4osYI9YqACiYlZc+KkCR+T7/PJO/IiAfEWvEXAUAhXnvf7vAROYW0uRHEVD29QC3i70KAIpwvG+c5y0okXV736Ikf0VA9iLmOD5YAUDO1lz1rIBE5qJff9EKAEVAtiL2iMEKAPI65Ocr3xWIyMVsDvZRBNTg0KA0BonFCgCy7vN/xnYBiNyO9C1q8lcE5HBeQBqLxGQFAFlu+bv2oOCD9/+KgPy3BqaxSExWAJBVq99LHhR4qP32P0VAgVoFpzFJbFYA0PaP/r8m4FC71r+KgDK8CviaGK0AoK0f/V/zvGCDAkARULxXAWlsEqMVALRr1f+F9wo0eAWgCCjuroA0RonVCgBa3fBn1RYBBosAFQGFF7FKzFYA0EKrv/5LwQXbABUBhRexSsxWANCqXv/n3iqwoBGQIqA8ZwWkMUvsVgCwQCOLliVrd70mqKAVsCKgNCJmRewSwxUALGTP/9aHBBSsA1AElK83QBq7xHAFAPNd+Dd2kUCC44AVAeVdEJjGMLFcAcA8jF35tCCC7YCKgNKKGCaWKwCYo9POvF4AofAOvvK+IoAZRSwT0xUAOOyHipnY925yvCIFgCLAYUEKAHK3fNMegQOtgRUBlRExTWxXADALa3e9KmhQKvsP/FMRwAzbAl8V2xUAnMzpW+4WMCilSJqKAKYTsU2MVwAwXdOfU1Ym627+s2CBIkARUDkR2yLGifUKAKY67e/i+wUKFAGKgOqeFpjGOLFeAcAJFp06nqy/5R1BAkWAIqCyIsZFrBPzFQB8tuXvJQ8KECgCFAHVbxGcxjoxXwHApz/9r/HTP4oARUCNPgVYI/YrAJh893/RPoEBRYAioD5rAdKYJ/YrAKz8X7zcyn8UAYqA+u0ISGOfHKAAqPe+/wu+IyCgCFAE1K8vQBr75AAFgK5/ggGKAEWA7oAoAOpj2Xm7BQIUAYqA2ooYKBcoAJz4B4oARYCTAlEAVN9pG64WAFAEKAJqL2KhnKAAqJWxK582+VEEKAJqL2KhnKAAqI1TRs838UERwMciJsoNCoB6tP3d+pBJD4oAPmkPnMZEuUEBUAvrbvqTST+NC+74e/KNh95N9j72j+Ten72X3PckdaEIqHFjoDQmyg0KgOpv/Tv3VhP+BJHwf/KbfyZ/fOtflUoAoAiYw5bANDbKEQqASltz1XMm+8fip/w/vCHpowjgb5OxUY5QAFR38d+qLSZ6amLfu8nBV96XHFAE8PnFgGmMlCsUANVc/HfJ92o/weO9/nEJAUUAUy0GTGOkXKEA0Pe/gvYf+KdEgCJAonc+gAKgZp3/Nu6U/CUAmJwLkv0MnQHTWClnKAAqZdX2H9f6Y3+BH/4j5oRkP7WIlXKGAqAyRhYtTdbf8k5tF/x55w+fF3Mi5oaE/0URKyNmyh0KgEpYeva3ajuZrfaHqcXckPCnFjFT7lAAVOPgnyuequ0+f4EephdzRMKf4oCgNGbKHQqA8n/8f8posuG2Y7WcxJr8wMxijkj4U0hjZsROOUQBUO7Wv+fcXNv2vgI8nFzMFUl/itbAaeyUQxQA5f74//Kf13LyRm9/wR1OLuaKhD/Fa4A0dsohCoDyGllS29X/DvaB2Ym5IuFPvRsgYqhcogAoZ/OfM6+v7ZG+AjvMXswZSX+KpkBpDJVLFACltPLSR73/B6wDmKeIoXKJAkDvf9v/wHZAZwOgACi+Jau3av0LaA28QBFL5RQFQKmcvuVuBQCgAFigiKVyigKgVNZc9VxtJ6xXAOAVQKtELJVTFADl6f63eHmtJ6xFgGARYCtFTJVbFADl2P63cWetJ6ttgGAbYEu3A6YxVW5RAJTC6NaHaj9hNQICjYBaJWKq3KIAKIXxa56v/YTVChi0Am6ViKlyiwKgBKf/rTRhrQMA7/9bvQ4gja1yjAKg2O//N1xtsjoOGBwH3Op1AGlslWMUAIW24uL7TVbbAcH2vxaL2CrHKAAKvv//WZP1Mw6+8r5AD1OIuSFGzKUfwLNyjAKg2NZ/+y2T9TMm9r2bHBfs4XNiTsTcECPmcDxwGlvlGAVAYZ0ydpGJqjUwaP3bJhFj5RoFQCEtO2+3STqN/QdsC4QQc0FMmJ+IsXKNAqCQVn51v0mqCIBp/eg5yX8hIsbKNQqAgjYA+p1JOovXAdYEIPkzv4ZAv5NrFAAFXQB4yzsm6SwXBtodgOTPnBcCpjFWrlEAFG8B4MoLTNB59AnQLAjJnzktBExjrZyjACiUpWfdaHIuoG1w9EN3gBCSPycTsVbOUQDoAFjRo4SjIIhPB2K9wH1PUheRLCV/dARUAJTO2BVPmZwwT5I/sxWxVs5RABTKGTf83uQEyV/yb7OItXKOAqBQNtx21OQEyd99bbc01so5CoDi7AAY3WRSguTvvma1EyCNuXKPAqAQTtu406QEyZ+MRMyVexQAhbB8816TEiR/MhIxV+5RABTC6LYfmJQg+ZORiLlyjwKgGFsAr3zapATJn6y2AqYxV+5RABTjEKDrDpmUIPmT1aFAacyVexQAhbDupjdMSpD8yUjEXLlHAZC7kUXLTEjm3eo4xK/jv8X/k/wlf2YnYq8cpADI1eLTzzEZadlhR/F74vfGn5H8JX+mF7FXDlIA5GrJ+GUmI2057jj+bHwNyV/y54si9spBCoB8jwH+0g0mI58zse/d5OAr77cs+cTXiq8p+Uv+/EfEXjlIAZBvE6BNe0xGPhXv9I+3IQnF14yvLflL/nzcDCiNvXKQAiBXKy6812Rk0v4D7U9+8XdI/pI/f5uMvXKQAkAXQGqV/IpYBGRR/Ej+6AaoACiUVdufMBkl/8wTVJFeB8T3IvmTtYi9cpACIOc2wL8wGSX/zMWagCIsDIzv4bjkTy7tgH8hBykA8rVmx69MRsk/F7E7IO8xaOVuB8mfuYjYKwcpAPI9B+Dagyaj5J+bPPsExN8t+ZPbeQBp7JWDFAC5OuOGwyaj5J+baBaU1zgspMmR5M9CReyVgxQAuVq761WTUfLPVR5tg+PvlPzJU8ReOUgB4CRAar3PPc4OyHos4u+U/HEioAKg1tbf/BeTUfLPVRwglPV4zOZgI8mfdorYKwcpAPItAG55x2SU/HOX5VHC8XdJ/uReAKSxVw5SAORqw61/NRkl/1qtAyjz+3/Jv0LS2CsHKQDyLQBuO2YiSv612g5Y1u1/kn/FpLFXDlIA5FsAmIiSfwFk2Rq4jK1/Jf9qkoMUAAoAan+qnQJA8lcAoADwCoAaHmnrFYDk7xUACgCLAKlZ8rcIUPK3CBAFgG2A1DD52wYo+dsGiAJAIyBqmPw1ApL8NQJCAaAVMDVL/loBS/5aAaMAcBgQNUz+DgOS/B0GhALAccDUMPk7DljydxwwCoCcjF970GSU/Gux/a+o2wEl/3qK2CsHKQBytWbHr0xGyT8XB195P/fxjO9B8icPEXvlIAVArsau/IXJKPln7nhqYt+7uY9pfA/HJX9yELFXDlIA5GrV9idMRsm/0q1/i9gaWPInYq8cpADI1ei2H5iMkn+m9h8oXvKL70nyJ0sRe+UgBUCuVlx4r8ko+Ut+GRUBRSx+yEfEXjlIAZCr5Zv2mIySv598P/M64Hib1jwU6bUH+YvYKwcpAHK19Es3mIySv+R/wsLAVu4OiK9VhAWPFEvEXjlIAZCrJeOXmYySv+Q/TZ+AhTQLij+bZ58Dii1irxykAMjV4tPPMRklf8n/JG2D4+yA2RwgFL8nfm8e7Y0pl4i9cpACIFcji5aZjJK/5D+Ho4QjucdP9vFOP8Sv479leaQx5RexVw5SADgREMkfnASIAiCH8wCuO2RSSv6SP2R1DkAac+UeBUBB2gE/bVJK/pI/ZNYG+Gm5RwGgG6DkL/mDLoAoAPJqBrR5r0kp+Uv+kFUToDTmyj0KgEI4beNOk1Lyl/whIxFz5R4FQCGcMrrJpJT8JX/ISMRcuUcBUBgbbjtqYkr+kj+0Wxpr5RwFQKGcccPvTUzJX/KHNotYK+coAIq1FfCKp0xOyV/yh3ZvAUxjrZyjACiUFRffb3JK/rNK/vc9+R41odVx60WslXMUAMU6FvisG01OyR8cdtRmEWvlHAVAsXYCrLzA5JT8wXHH7d4BkMZaOUcBUDjrb3nHBJX8YU4OvvJ+MrHPJwKzETFWrlEAFPNQoGt+Z5JK/jBnx1OxXkAMOMkhQGmMlWsUAIW08qv7TVLJH+Zt/wE7RGYSMVauUQAU0rLzdpuk8xSBTwIARcBMIsbKNQqAYi4EHLvIJJ2H+OhT4If/8DpgmgWAaYyVaxQAxV0I+O23TNQ5iMVPxwV8+MKaAAsDT1gAmMZWOUYBUGhrrnrWZJ2DWAEt4MPUuwPEiP+I2CrHKAB0BKyI2AMt0MP09AnQAVABUCKnbbjaZJ2laIQiyMPMzYLEio9EbJVjFACFNnLKSpN1FqIVqgAPJ6dt8EcitsoxCoASNAR63oQ9ieiHLrjDycVc0QDoeblFAVAOo1sfkuRPIg5FEdxhdgcI1T1eREyVWxQA5VgHsHGnJD+DOBZVYIfZq/tRwhFT5RYFQDnWASxeLtF7/w/WAbTq/X8aU+UWBUCJ+gE8J9nb/ge2Ay54//9zcooCoFxO33K3ZK/1L2gNvEARS+UUBUCpLFm9VbJXAIACYIEilsopCoDSWbvrVQnfKwDwCmCeIobKJQqAUlp56aMSvkWAYBHgPEUMlUsUAOXcDnjm9RK+bYBgG+B8t/+lMVQuUQCU08iSZP0t70j6GgGBRkBzPf43jZ0RQ+USBUBpjV3+cwlfK2DQCniOInbKIQqAUlt2zs0SvnUA4P3/HEXslEMUACU/HXA02XDbMUnfccDgOODZSmNmxE45RAFQ/tcAVzwl4dsOCLb/zfbj/zRmyh0KgEpYeva3JPxpHHzlfYEephBzo65xIWKm3KEAqMZrgEVL7QaYxsS+d5Pjgj18TsyJmBt1Xf0fMVPuUABUxqrtP5bwtQYGrX9PImKlnKEAqFZToI07JfsZ7D9gWyCEmAt1jgURK+UMBYCzAWrmR88pApD86xwD9P5XAFTW6CXfk+gVATDlO/86f+z/iYiRcoUCoJJOWbVFklcEwBdW+9d1wd+JIkbKFQqAylpz1XMmuiIAJpv81HWf/1QiNsoRCoBqtwY+91aTXRFAjQ/2id7+dW3vO2Pr3zQ2yhEKgMpbd9OfTPiaFgHx77nvyfeoiXivHz/lR8Kv65G+sxExUW5QANRjMeDWh0z6mhcB7it8ZvFfGhPlBgVAPRYDjp5v0isC3Ff4ZPFfGhPlBgVAfQ4IuvJpE18R4L5SexEL5QQFQL06A2642uRXBCgCqL2IhXKCAqB2xq89KAAoAhQB1FbEQLlAAVDPLYHn7RYEFAGKAOq79S+NgXKBAsD5ACgCFAHo+48CoD5Ov+A7goEiQBFA7UTskwMUALU2snh5su7mPwsIigBFAPVp/JPGvIh9coACoPZWXLRPUFAEKAKojYh5Yr8CgNSiU9ck6295R2BQBCgCqLyIdRHzxH4FAJ+0B77kQcFBEaAIoPptf9NYJ+YrAPjcpwDjPgVQBCgCqMFP/+NivgKAL6wFuPh+QUIRoAiguu/+0xgn1isAmGpHwCkr7QhQBCgCqO7K/zTGifUKAKbrC7DlbsFCEaAIoHr7/tPYJsYrANAdUBGwAPsPKALQ9Q8FQCUt37RH0FAEzOjen73nvlIaEdPEdgUATgpUBLTA8dTEvnfdV5z4hwKgak4783rBQxEwo4OvvO+eUngRy8R0BQBzNHbl0wKIImBGex/7h3tKYUUME8sVAMzDKWMXCSKKgBn94Y1/uZ8UVsQwsVwBwHxbBG99SCBRBMzoGw9ZC0ABW/6msUsMVwCwkOZAi5Yla3e9JqAoAqb1k9/YFkjRtv29Nhm7xHAFAAu07NxbBRVFwLT++JbXABRLxCyxWwFAi6z++i8FFkXAtC644+/uI4UQsUrMVgDQygWBq7YILooA6wAo/sK/NFaJ2QoAWn1a4IX3CjCKANsBKe5pf2mMEqsVALSrQ+A1zws0igCtgSlex780NonRCgDa6NQzvibYKAIUABROxCYxWgFAu3sDXPKggKMI8AqA4uz5T2OS2KwAwGFBigCLAHHYDwoA2vcqYLvgowiwDZACfPS/XUxWAJD5roCvfFcAUgRoBER+q/7TGCQWKwDIyZqrnhWIal4EaAVMHiL2iMEKAPJsEDR6frL+lncEpBoXAd7/k7WIORF7xGAFAHmfFXDe7YJSTYsAxwGTS6//NOaIvQoACmLlpY8KTDUsAmz/I2sRa8RcBQBF2xp43SEBqkZFwMFX3ncfyHbLXxpjxFoFAAW0ZPXWZMNtxwSqGhQBx1MT+7z7J0NpbIkYI9YqACjseoDdAlUNigCtf8n+vf9uMVYBQOFbBW/7oYBV4SJg/wHb/si41W8aU8RWBQAlsXrigMCVsUjMkj9VE7FETFUAUCKLlm1M1u56VQDLWHw0f7xN7/x97E/WIoZELBFTFQCU7byAtZcLYjmIxXmxQr+Vq/0t+COXPv9pDBFLFQBYFMgcxR79aNSzkCY/9vlj0R8KAOZ/aNDF9wtoOYpWvdGvPw7tmc3BPvF7tfcl10N+0pghdioAqIhV258Q2Aogju2N5B4/2cc7/RC/jv/mSF+KIGKFmKkAwM4AwIp/FACUfmfAqWuSM67/X4EO+IKIDREjxEoFABU+Pnjdjf8n4AGfipjgeF8FAHU4M2D8ssnzvAU+IGJBxASxUQFATZy2cafgB0zGAjFRAUDNLD3rRgEQaixigFioAKC2jYJuFwihlo1+bhcDFQAGoe6Wb/pvARFqJOa82IcCgI+KgM17BUaoQ/JP57qYhwKAE4qAOwRIqHTyv0OsQwGATwLAT/4oAMCaAPDOHwUA2B0AVvujAECfAMA+fxQA1K1joLbBUL72vjr8oQCgJWcHOEAIynOwj97+KABo6SmCjhKG4h/p61Q/FAC0XJwVvnrigEALBRRzM+aoWIUCgLZZtf0JARcKJOak2IQCgEysuPh+gRcKIOaimIQCgIx7BewWgCHXPf67xSIUAOTj1LWXJ2t3vSoYQ4ZizsXcE4NQAJDv4sBlGy0OhCwX+6VzTuxBAUBhjG77oQANbRRzTKxBAUBx1wXcdkywhlZK55T3/SgAKH7nwNVbk/HrDgna0AIxl2JOiS0oACiNlZc+KoDDAsQcEktQAFDSVwK3O0wI5nGYj2N8UQBQiXME1lz1rMAOsxBzRT9/FABUq3vgV74rwMNMXf3SOSJWkGUB8KGBILPGQWdsT8avPSjYw2cX+qVzIuaGGEGGPowC4AMDQeY9Ay55UOCH2NufzgUxgRx80BgaWvSegSCfTwO+loxf87wkQD1/6k+f/ZgDYgF5iNwfBcBRg0GuawMuvFdCoF7v+tNn3twn5wLgaKPZHDliMMh9p8CqLcnqr/9ScqDaffzTZzyedXOevEXuTwuA4ZcNBoXpG3DurcnaXa9JFlTs9L7XJp9tc5ziFADDLzcGB4cOGQyKZGTRsmR060MSB9VY5Jc+y/FMm9sUSeT+xsBA8xmDQSFfC4xdlIxd+bQkQinFsxvPsLlMEUXub/T3Dz5uMCiy0868Xu8ASrWnP55Zc5cii9zf6Ovrf8BgUAbLN+1J1u56VZKhoO/5X518Rs1VyiByf6Onp2+PwaBMTt9yd7Lu5j9LOhRCPIvxTJqblEnk/kZ3d88Og0HpFgqesjJZcfH9Thok1xP74hmMZ9GcpGwi9zc6O7u+bDAoq0Wnjk+2UlUIkGXij2cunj1zkLKK3N/o6OhYbDAofyGwJllx0T6vBmjrR/3xjMWzZs5RdpH7G3ENDS06ZkCoxKuBxcuT0y/4jsWCtHRxXzxT8WyZY1SkDfCxxifX4ODQiwaFynUVPG+37YMsaDtfPEPmEhVsAvTipwVAf//gkwaFyvYR2HC1hkLMqYFPPDPmDhXuAfDkpwVAb2/fXQaFyncWHD1/si3rupv+JNHx+ff76TMRz0Y8I+YKVRc5/9MCoLu7Z8KgUKvXA+femqy56jnJr+biGXBIDzXcAjjxaQHQ0dE5ZlCo5acCq7Yko5d8z6LBmi3qi3vuWF7quwOgc6zx2WtoaNFRA0Ot1wps3Jms2v5jPQUqunc/7m3cY886Nd8BcLRx4jUw0Py1wYE4jnhpsvTsbyVjVzyVbLjtmARaVum9i3sY9zLuqWcbJk8B/PUXCgCHAsFULYdHk2Xn3JyMXf5znwyU5Cf9uFdxz+LeeYbh8yYPATrxshAQTmJkyeQxrysvfdSagYK90497MnkEb3qPPKswywWA/1kI2LHE4MDsLVm9dfIUOLsJ8lm9H2Mf98CzCHNZANixpDHV1WwOv2yAYB6vChYvn1xgFnvJx695XpJudVe+dExjbGOMteSF+Ykc35ju6usbeMQgQSvWDqyc7CYXx8WuuerZZP2335LIZ/sePx2rGLMYuxhDx+1Cq97/DzwybQHQ3d1zrUGCNvUcGLtosrf8yq/uT3+i/Z1FhR8v2ouxiDGJsYkx8qxA297/XzttAeBoYMi4KFh5QbL0rBsnf9qNLWtn3PD7ZMNtRyu4Je/o5L8t/o3xb41/c/zbPQOQ6fv/xY2ZrsHBoRcMFORcGIxumnzfvXzz3mR02w8mD6gZv+5Qsu6mNwrcT/+Nye8xvtf4nuN7j39D/FvcU8hX5PbGya7e3v77DBYUuVHRsmTx6eckS8YvS5Z+6YZk+aY9yYoL751Muqu2P5Em4F8ka3b8avI42zNuODy5TS6S8/qb//LRa4db//r5Bkfx6/S/xf+L3xO/N/5M/Nn4GvG14mvG146/I/6u+Dvj747vIb6X+J7cGyiuyO0nLQC6uro2GywAqI7I7Y3ZXM3myJsGDACqsP1v5M3GbK++voGHDRoAVGL738OzLgC6urq3GTQAqMLH/93bGnO5ms2RIwYOAEr98f+Rxlyvvr6B7xs8ACj1x//fn3MBYDcAANRk9f8XmwINHzaAAFA+kcMb8716e/v2GkQAKJ/I4fMuAD4+G+BDAwkApfLhSXv/n+zq7x/8qYEEgPKI3N1Y6NXV1b3VYAJAqfb+b2204nJCIACUZfHfLE7+m+3V09P7TYMKAMUXObvRyssBQQBQbHM6+GcOWwLvNLgAUOitf3c22nB1Dg0tOmqAAaB4IkdHrm5HAdDo7e2/xyADQBF/+u+/p9HGqy+tMI4ZaAAo1E//xyJHt7MAiLUAdxlsACjUu/+7GllczebI2wYcAAqx8v/tRlZXT0/fHoMOAEXY99+3p5HlNTg4/JKBB4D8RC5uZH11d/fsNPgAkJ/IxY08roGB5jNuAABkL3JwI6+rs7PrbDcBALIXObiR59XX1/+AGwEA2Ync2yjC1WwOv+6GAEAW2/6GX28U5eru7plwUwAgk4V/E40iXf39A4+5MQDQPpFrG8W7OgaazZEjbhAAtOOj/5EjkWsbRby6u3t2uEkA0JaP/nc0inz19Q087EYBQCtX/Q883CjDNTg4fNgNA4CFi5zaKMvV1dW12U0DgIWLnNoo09XT0/tfbhwAzF/k0kYZL1sDAaBSW/7msh5g6AU3EgDm8t5/6IVG2a/Ozs61Q0OLjrqhAHBykTMjdzaqcHV3d1/upgLAbPb7d1/eqNJlUSAAVHTRn6ODAWB+CnPEb/t2Bgw+7kYDwGdX/A8+3qjDNTDQ/B83HAAWJ5ETG3W6BgaGfuvGA1Dv5D/020b9ro4BPQIAqPde/4Ie79v2EqCjY3E6AC96EACoWfJ/MXJgo85XOgBLFAEA1Cz5L2m4Pv0kwOsAACr/sX/tf/Kfak2AhYEAVHvBX03f+dsiCICtfi7NggDQ5MelbTAA1VL59r4OEAKAz6vswT5ZHiUcZyN7mAAog8hZlTvSN6+rs7NzrW2CAJRhm1/kLJm75YsDBx7zgAFQzMV+A4/J1NYFAOB9v6vVV1dX1+bBweHDHjoA8v3If/hw5CSZOfOtggMPewAByGeL38DDMnGuuwR6djSbI0c8jABkIXJO5B4ZuCDnCFggCEA2C/308y/ipwETzebw6x5SAFr7U//w65FjZFpthAGozbt+7XxL1jyo6+yBgeYzHl4A5iNySOQSGbW8rwV2Dg4Ov+RhBmCWW/teitwhg1amgVDfnmZz5G0PNwDTrO5/O3KFjFnRq7e3766hoUXHPOwAhMgJkRtkyJqsE+zt7b/HKYMAtU78RyMXRE6QFmu4VjCt+u5sNkfeNBkAavNR/5sR+yMHSIOuOGTom44cBqjy4r6hFyLWy3iuKa+uru6t/f2DP00flg9NGIDS+zBiesR2Gc41q6ujo2Nxb2/fXqcOApRyK9/hiOERy2U01wI+Feja3Nc38H2HDgEU+t3+kYjVjud1tesVwbY4AtLCQYBiLOiLmByxWYZyZfrJQG9v/30WDwJku5gvYq+f9F2FWTPQ3d1zbVqJPtJsDr9skgK06qf84ZcjtkaM9U7fVYaCYEkcHRmnSA0MNH+t6RDA7JrzRMyM2BkxNGKpjOKqQFHQORYPdLSc7O8ffHJwcOhFbYmBurbfjRgYsTBi4kfJvnNMpnDV7vVBZ2fXl9MJsCMOoojKN50Uj8dRlOkEORQff8Xq1qiMU++lk+cDfQqAouyzj5gUsSliVMSqiFkRuyKGRSyLmBaxLWJcxDof4xfj+n+y1ws9YDgk1AAAAABJRU5ErkJggg==';
const ICON_MASKABLE_512_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAATzUlEQVR42u3d/Wtd9R3A8f0DmmivpElJXVJLoYJQoaCtBIXKWnAd2s4KreDYxnwYBcWiIqOjmqmsU+gc3dxDYaMWJ+ovVthwFOyoKKUwBNduVNGiiLVpHkyb9pez8ynraKWLSe65955zvq8fXr+m6b3f7/m8c+95+MZll3VnAEBavuFFAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAAAQAF4IABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAAASAFwEABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIACAIlzRtyy7aunGrHfFtqx/9e5sYP2B7Jp7jmWLv3+8KfEz4mfFz4yfHf9G/FtecxAAQBs1Fq/NFgxtPzeUmx3uRYnfJX6n+N28RyAAgCbNG1yVLbh5R7bo7qOlGfYzFb9z/O7xf/BeggAAvmbg99+6q3LDfqbi/yYIQAAAufnLt2SLNh2p7dD/v58Q5P/n+L9bAyAAIA1djaxv5XByA//rxGsSr401AgIAaveXvkE/Mz4ZAAEAlf9Ov0xn61dNvHbOGQABAJXRe8NWA7xg8ZpaWyAAoHQu7+7JFq55ybBusXiN47W25kAAQEd191ybDazbbzi3++uB/DWP194aBAEA7R38vddlgxsOGsYdFu9BvBfWJAgAaKmuxoAT+0p6wmC8N9YoCAAo3MLbXjNsy36OQP4eWasgAKAQfTc9bbhW7cZC+Xtm7YIAgDlpLLndMK24eA+tZRAAMGO+56/X+QHWNAgAmJZb9rrFMAgASElXI8mn8qX4FEIPHQIBAOf0XL/ZcExMvOfWPgLAi0DK3/W7i1/SdxO0BxAAkJgrrx4yBDkn1oI9gQCABPSu2GbwcfHTBvM1YW8gAKDGvnnHPgOPS4q1YY8gAKBm4hGyhhwz4XHDCACoiXmDqww2ZiXWjL2DAIAqX+K37AEDjbldKpivHXsIAQAVtGBou0FGU2IN2UsIAKiQ/tW7DTAKEWvJnkIAQBXO9P/OXwwuir1CIF9T9hYCAMp8Zz9P8cNTBUEAkJbBDQcNKloq1pi9hgAAwx8RAAIAfOyPrwNAAIAT/nBiIAgAcKkfLhEEAQBu8oObBYEAALf3xW2DQQDA/+XBPuXy6B/GskP/Pp2dPXv2f6amzmZ735nM7vzZiAcIgQCA5nmkb3m8+vfJi4b+dB7bNeZRwiAAYO4M3s5b+9ORGQ/+C33w6VQyr5G9igCAIi/3u2OfAdxh33v25JyG/4WSuDwwX6v2LAIACtC7YpsB3GE3PvhF08M/pQiINWvvIgCgCVdePWQAl0BRwz+lCIi1aw8jAMD3/pU+07/oAEglAuxhBADMwcC6/QZwDf/6TykCYg3bywgAmM3Nfq7fbPgmEAApRECsZXsaAQAz0dUweEvix78abXkApBABsabtbQQAfI1Fm44YviXx670TbQmAukdArGl7GwEA05i/fIvBWyJ79n3ZtgCoewTE2rbHEQDgrP9K2Pn6RFsDoO4RYI8jAOBSZ/2vP2Dolsz9z4+2PQDqHAGxxu11BABcoLHkdgM30asAUouAWOv2PAIAfPQvABKMAHseAQC5vpueNmhL7KEXRkVAwWLN2/sIAPz1b8iW3uTpsyLApwAIACjOwtteM2ArYNkDX3Q0AOoYAbH2HQMQACSpqzFguFbIXU+dFAEFiz3gWIAAwGV/iIDEIsBlgQgAktPde52BKgJEQC72gmMCAoBkDG44aJiKABGQi73gmIAAII2//nuuNURFgAi48FOAfE84NiAAqP93/+v2G6AiQARceC5AviccGxAA1Nrl3T0GpwgQAZcQe8MxAgFAfa/7X/OSoSkCRMCl7guQ7w3HCAQA7vqHCEgwAhwjEADUUu8NWw1KESACphF7xLECAYC//hEBCUaAYwUCgFqZN7iqMgfg4T3j2YmxMx0fYqQZAbFXHDMQALjtbxs99+q4wSkC3B4YAQApffz/yfEpA1ME+BoAAQBFmr98S6kPtoakCCib2DOOHQgA/PXfQoc/9pd/Co59PuVTABAAtFVXo7QH2Ed+P2Y4JuSJF8erFQD53nEMQQBQWX0rh330j68C5iD2jmMIAgAf/xds4zMnDcQE3btj1NcAIABIOQDePHTKQEzQu4dPCwAQAKR89r9h6GsAVwMgALwItMiiTUcEAAKgCbGHHEsQAPj4XwCQ4D0BHEsQALj3vwAgwQDwbAAEAJXSf+uuUh9UP/rMDYBSNDJ+pnIBEHvJMQUBgI//C/KLVzz4J0UvvDHh2QAgAEg5AHwNkKalPzouAEAAkOr3/+e9/b57AaTkvQ9PV3L4Ow8AAUBlLLh5R2UOrAZjOpb84HhlAyD2lGMLAoDyX/9/99HKHFjvf37UcEzAlt+NVXb4n7sfQL6nHFsQAPj+v2Bb/+ipgHX2zJ/HKz38nQeAAEAAtNCGpzwcyPAXAAgAmLPG4rWVPsjufH3C4DT8Syn2lmMMAoDyngA4tL0WB9tbHjlxboDsfWcye+u9U8zSPz+aMvyLPhEw31uOMQgASmtg/YHaHXiZHcO/NWJvOcYgAPD9P4Z/QsPfeQAIAAQAhn+iw18AIAAQABj+CQ5/AYAAoLSu6FtmGBr+hn8LxR5zrEEAUDpXLd1oIBr+hn8LxR5zrEEAUDq9K7YZii3yrcdPZPf9cjTbvHM0++7wiOGf4PAPscccaxAAlE7/6t2GdYEe/u1YNjF5ZtohuOuvXxr+CYk95liDAMA9AGrq21tHZj0Qf/7yuOGfAPcCQABQStfcc8wAb9KTL47PeTAe/Ndpw7/mYo851iAAcAlgzcRwa3ZA/uNo6yIgfrbh71JABAAIgJIN//N+88ZE4b9f/EzDXwAgAEAAlHT4n7fkh8X9fvGzDH8BgAAAAVDy4R/+duhUYb9j/CzDXwAgAEAAlHz4n1fU72n4CwAEAAiAigz/sOYnzd8wKH6G4S8AEAAgACoy/MPwnuaHaPwMw18AIABAAFRk+Ic/vdn8XQLjZxj+AgABAAKgIsO/igFg+AsABAACwPBP7CsAw18AIAAQAIZ/YicBGv4CAAGAADD8E7sM0PAXAAgABIDhn9iNgAx/AYAAQAAY/ondCtjwFwAIAASA4V+wsj8MyPAXAAgABIDhX7CyPw7Y8BcACABq6Jp7jhn+HRz+//xoquX/x4P/mnsEPPmi4d+s2GOONQgASmdg/QHDv8bD/7yfvzz7/+u3t44Y4AWIPeZYgwCgdPpX7zb8az78L7Trr9PfJXBi8kz28G/HDO4CxR5zrEEAUDq9K7YZ/okM/6/67vBItnnnaHbfL0ezbz1+wrBukdhjjjUIAErnqqUbDf8Ehz/tE3vMsQYBQOlc0bfM8Df8aaHYY441CABcCmj44xJAEAAIAMMfAQACAAFg+CMAQADgXgCGP+4BAAKAllkwtN3wb8Hwf+u9U8zS3ncmz713tzxSj8sSY285xiAAKK3G4rWGP6W08/WJSq/F2FuOMQgAnAdg+DNHG5466ft/EAAIAMM/RVv/OCYAEABeBIq26O6jlR7+W343Zkgm4P7nRyuzJmNPObYgACj/iYA376js8F/yg+OGY0IqcwJgvqccWxAAlN68wVWVDYD3PjxtMCbk7fdPVWJdxp5ybEEA4DyAFln6I3/9+xTA9/8IAEguAF54Y8JATNAvXhkXAAgAKEr/rbsqFwAj42cMxAR99Fm577IYe8kxBQGA8wBayDD0NYDv/xEAkODXAAahAPDxPwIAirgfwKYjAgAB0Mz1//kecixBAFA585dvEQAIgCbEHnIsQQDga4AWe/ewewCk6M1Dp3z8jwCAlAPg3h2jBmKCNj5zUgAgAKBofSuHfQ2Aj//nIPaOYwgCgOrqalQqAJ540VMAU/LI78v7VMDYO44hCAB8DdBGxz6fMhwTcPjjKZf/IQDA1QC+CvDRv7P/EQDg2QAioLY+OT7l3v8gAGiXgfUHRAAd99yr5X/wT+wVxwwEAJ4NIAJo0omxM9nwnvHKrDf3/kcA4GsAEfA/dz11stKvHz7+RwCQsN4btooAEcA0Yo84ViAA8CmACBAB/voHAUA9LFzzkggQAVxC7A3HCAQAtXV5d08tDtYigKLF3nCMQABQ70sC1+0XASKACy/9y/eEYwMCgNrr7rm2NgduEUARYk84NiAASMLghoMiQASQi73gmIAAIJ1PAXqvq9VBXAQw57/+873gmIAAwO2BRYAISOm7f7f9RQCQoq7GQO0O6CKA2Yg94FiAACDN+wLc9poIKNiyB74wXKtw3X++9h0DEAC4O6AIKMzk6bMGrLv+gQCg/PpueloEFOyhF0YN2RKLNW/vIwCgpp8CdDoCDFp//YMAoPQaS24XAQIgCbHW7XkEANT4ssBOR8D9z/sawGV/IADwVUByEbDz9QlD10f/IACohvnLt4iAguzZ96WhWyKxtu1xBABMY9GmIyKgAL/e6xOAsog1bW8jAODrdDVqPxDaEQA//pVzAErz0X++pu1tBADMQM/1m0WAqwBqIdayPY0AgNlcFbBuvwgQANU+6z9fw/YyAgBcFdC2CHj0D2MGsLP+QQBQXVdePSQC/PVfSbF27WEEADShd8U2ETALNz7oaYCdFmvW3kUAQAG+ecc+ETAD33v2pAHcYbFW7VkEADgfYNY++HRqTsN/7U9HDGDf+4MAoH4u7+5JZog8tmtsxoP/1b9PGrwlEWvUXkUAQAvMG1yV1EC582cj2d53JrOpqYuH/qF/n3amf8nE2rRHEQDQypsELXvAwKFcN/vJ16S9iQCANlgwtN3goRRiLdqTCABoo/7Vuw0gOirWoL2IAIBOXB74nb8YRHTmcr987dmDCADooIH1Bwwk2nuP/3zN2XsIACiBwQ0HDSbaItaaPYcAABGA4Q8CAHwdgI/9QQCAEwNxwh8IAHCJIC71AwEAbhaEm/yAAAC3DcbtfUEAQGFSe4AQHuwDAgD+K6VHCeORviAA4KtXCNyxz5Dj0mf652vDHkEAQI31rthm4HGRWBP2BgIAEnDl1UMGH+fEWrAnEACQ2p0D1+03BFO9s1/+3tsDCABI+VLB6zcbiKld4pe/59Y+AsCLANllXY1s0aYjhmPNxXsc77U1DwIALjJ/+RaDsqbivbXGQQDA9OcGeKqgp/iBAIA0NZbcboBWXLyH1jIIAJiTvpueNkwrJt4zaxcEABRi4W2vGa4lF++RtQoCAArX1RhwfkBJv+eP98YaBQEALdXde102uOGg4dth8R7Ee2FNggCA9oZAz7XuJtihu/jFa28NggCAjopHyC5c85Lh3Orv+PPX2ON6QQBAKfXesNWwLvppfflram2BAIBKmDe4ygmDTZ7YF6+htQQCACrLLYbdshcEAKSsq5H1rRw26L964578NfGQHhAAkNQnAyk+hTD+z/7SBwEA/Pecgf5bd9V26Mf/zXf6IACAGQTBgpt3ZIvuPlq9v/Dz3zl+dwMfBABQgMbitdmCoe2lurogfpf4neJ38x6BAADa6Iq+ZdlVSzdmvSu2Zf2rd58bytfcc6zp4R4/I35W/Mz42fFvxL/lNQcBAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAIAC8CAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAAAsALAQACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAIAA8CIAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAACAOfkPkOTDB951adIAAAAASUVORK5CYII=';

function pngBody(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const pngResponse = (encoded: string) => new Response(pngBody(encoded), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' } });

// A manifest is served per workspace, so an installed icon opens this trip and nothing else. The
// capability secret is the whole of the identity, so start_url and scope stay inside its path.
function manifestResponse(workspace: Workspace, secret: string): Response {
  const name = workspace.name || 'Trip finance';
  const body = JSON.stringify({
    name,
    short_name: name.length > 24 ? name.slice(0, 24) : name,
    description: 'Shared trip ledger - one link, no accounts, every change audited.',
    start_url: `/w/${secret}`,
    scope: `/w/${secret}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b0d',
    theme_color: '#0b0b0d',
    lang: 'en',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
  const headers = new Headers(secretHeaders());
  headers.set('content-type', 'application/manifest+json; charset=utf-8');
  headers.set('cache-control', 'no-store, private');
  return new Response(body, { status: 200, headers });
}
// A service worker exists so the browser will offer "Add to Home Screen". It deliberately caches
// nothing: the app is one audited page, and a cached copy would hide every deploy.
const SERVICE_WORKER = [
  "self.addEventListener('install', function () { self.skipWaiting() });",
  "self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()) });",
  "self.addEventListener('fetch', function () {});",
].join('\n');
function serviceWorkerResponse(secret: string): Response {
  const headers = new Headers(secretHeaders());
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('service-worker-allowed', `/w/${secret}/`);
  headers.set('cache-control', 'no-cache');
  return new Response(SERVICE_WORKER, { status: 200, headers });
}

/* ---------------- receipt backlog (the user's own tracker, never an importer) ---------------- */
const RECEIPT_COLUMNS = 'id, workspace_id, title, note, link, transaction_id, is_added, added_at, created_at, updated_at';
const ATTACHMENT_COLUMNS = 'id, workspace_id, receipt_id, label, image_key, image_type, image_bytes, created_at';
const RECEIPT_MAX_ATTACHMENTS = 6;
const RECEIPT_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const RECEIPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'];
type Receipt = { id: number; workspace_id: number; title: string; note: string; link: string; transaction_id: number | null; is_added: number; added_at: string | null; created_at: string; updated_at: string };
type ReceiptAttachment = { id: number; workspace_id: number; receipt_id: number; label: string; image_key: string; image_type: string; image_bytes: number; created_at: string };
// Storage keys stay server-side: the client only learns that an attachment exists, its
// label, type, and size.
function publicAttachment(row: ReceiptAttachment) {
  return { id: row.id, receipt_id: row.receipt_id, label: row.label, image_type: row.image_type, image_bytes: row.image_bytes, created_at: row.created_at };
}
async function listAttachments(db: D1Database, workspaceId: number, receiptId?: number) {
  const statement = receiptId === undefined
    ? db.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM receipt_attachments WHERE workspace_id = ? ORDER BY id`).bind(workspaceId)
    : db.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM receipt_attachments WHERE workspace_id = ? AND receipt_id = ? ORDER BY id`).bind(workspaceId, receiptId);
  const rows = await statement.all<ReceiptAttachment>();
  return rows.results.map(publicAttachment);
}
// The board groups attachments onto their card, so a card arrives with everything it shows.
function groupAttachments(rows: ReceiptAttachment[]) {
  const grouped: Record<number, ReturnType<typeof publicAttachment>[]> = {};
  for (const row of rows) { const bucket = grouped[row.receipt_id] ?? (grouped[row.receipt_id] = []); bucket.push(publicAttachment(row)); }
  return grouped;
}
function boardReceipts(receipts: Receipt[], attachments: ReceiptAttachment[]) {
  const grouped = groupAttachments(attachments);
  return receipts.map((row) => ({ id: row.id, title: row.title, note: row.note, link: row.link, transaction_id: row.transaction_id, is_added: row.is_added, added_at: row.added_at, created_at: row.created_at, updated_at: row.updated_at, attachments: grouped[row.id] ?? [], attachment_count: (grouped[row.id] ?? []).length }));
}
async function listReceipts(db: D1Database, workspaceId: number) {
  const [receipts, attachments] = await Promise.all([
    db.prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE workspace_id = ? ORDER BY is_added ASC, id DESC`).bind(workspaceId).all<Receipt>(),
    db.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM receipt_attachments WHERE workspace_id = ? ORDER BY id`).bind(workspaceId).all<ReceiptAttachment>(),
  ]);
  return boardReceipts(receipts.results, attachments.results);
}
// '' means "no value", null means "rejected" - the callers turn null into a 400.
function receiptNote(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  return trimmed.length > 2000 ? null : trimmed;
}
function receiptLink(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length > 1000) return null;
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}
function receiptState(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}


// The secret in a workspace API path, but only for a request that would have committed something:
// notifications are announced after the write they describe, never before it.
function notificationSecret(request: Request): string | null {
  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') return null;
  const match = new URL(request.url).pathname.match(/^\/w\/([^/]+)\/api(?:\/|$)/);
  return match ? match[1] : null;
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const response = await handle(request, env);
    // The ledger never waits on Telegram: the write has already committed and answered by the time
    // this runs, and a delivery problem can only ever leave a message queued in the outbox.
    const secret = response.status < 400 ? notificationSecret(request) : null;
    if (secret && telegramConfigured(env) && ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          const workspace = await resolveWorkspace(env.DB, secret);
          if (workspace) await dispatchWorkspaceNotifications(env, workspace.id);
        })().catch(() => {}),
      );
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
