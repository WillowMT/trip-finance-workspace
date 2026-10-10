import { aiInstructions, appHtml, homeHtml, linkRetiredHtml, isValidTimeZone, DEFAULT_TIME_ZONE, zonedParts } from './pages';
import { planSplit, splitDraftHash, splitResponse, type SplitTransaction, validIdempotencyKey as validSplitKey } from './splits';
import { autoNettingStatements } from './netting';
import { backupEveryValue, backupStatus, createBackup, listBackups, readBackup, restoreName, restoreSnapshot, snapshotProblem, tickBackups, DEFAULT_BACKUP_EVERY, KEEP_BACKUPS } from './backups';
import { canonicalName, hashJson, maxWorkflowRows, offsetTransactions, parseImportCsv, reciprocalBalance, validDate as validDateValue, validIdempotencyKey, validateWorkflowRow, type ImportPlanRow, type WorkflowTransaction } from './workflows';

export interface Env {
  DB: D1Database;
  // Automatic snapshots. Optional so a bare local environment can still serve the ledger.
  BACKUPS?: R2Bucket;
  RECEIPTS?: R2Bucket;
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
function pageHeaders(): HeadersInit {
  return {
    'cache-control': 'no-store, private',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
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
  return { workspace, people: people.results, currencies: currencies.results, receipts: boardReceipts(receipts.results, attachments.results), settings: settings && { categories: JSON.parse(settings.categories_json), small_amount_guard: JSON.parse(settings.small_amount_guard_json), timezone: settings.timezone, auto_offset: settings.auto_offset, backup_every: backupEveryValue(settings.backup_every) ?? DEFAULT_BACKUP_EVERY, created_at: settings.created_at, updated_at: settings.updated_at }, backups: { status: backups, entries: await listBackups(db, workspace.id), configured: Boolean(env.BACKUPS), keep: KEEP_BACKUPS } };
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
  if (request.method === 'GET' && pathname === '/apple-touch-icon.png') {
    const binary = atob(APPLE_TOUCH_ICON_PNG);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' } });
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
  const recRoute = tail.match(/^receipts\/(\d+)(?:\/(attachments|delete)(?:\/(\d+))?)?$/);
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
    const requestedLimit = Number(params.get('limit') ?? 300);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 300;
    if (entity && !auditEntities.includes(entity)) return secretResponse({ error: 'Invalid entity filter' }, 400);
    if (actions.some((value) => !auditActions.includes(value))) return secretResponse({ error: 'Invalid action filter' }, 400);
    if (entityId && !/^[1-9][0-9]{0,11}$/.test(entityId)) return secretResponse({ error: 'Invalid entity id filter' }, 400);
    const clause = ['workspace_id = ?'];
    const values: unknown[] = [workspace.id];
    if (entity) { clause.push('entity_type = ?'); values.push(entity); }
    if (actions.length) { clause.push(`action IN (${actions.map(() => '?').join(', ')})`); values.push(...actions); }
    if (entityId) { clause.push('entity_id = ?'); values.push(entityId); } // audit_log.entity_id is TEXT
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
    return secretResponse({ audit: rows, total: total?.count ?? 0, matched: matchedCount, limit, truncated: matchedCount > entries.results.length });
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
    const recent: { id: number; occurred_on: string; entry_kind: string; topic: string; category: string; currency_code: string; amount_minor: number; direction: string; counterparty_id: number; counterparty: string; notes: string | null; is_deleted: number }[] = [];
    for (const row of rows.results) {
      const outgoing = row.creditor_person_id === person.id;
      const counterpartyId = outgoing ? row.debtor_person_id : row.creditor_person_id;
      const direction = row.amount_minor > 0 ? (outgoing ? 'paid_for' : 'covered_for_them') : outgoing ? 'settled_in' : 'settled_out';
      if (row.is_deleted === 1) archivedRecords += 1; else activeRecords += 1;
      if (row.is_deleted === 1) {
        // Archived rows stay out of the money, but the pair still reports that they exist.
        const archivedKey = `${row.currency_code}:${counterpartyId}`;
        const archivedPair = pairs.get(archivedKey) ?? { counterparty_id: counterpartyId, counterparty: nameOf.get(counterpartyId) ?? 'Unknown', currency_code: row.currency_code, paid_for_minor: 0, covered_minor: 0, settled_out_minor: 0, settled_in_minor: 0, net_minor: 0, records: 0, archived_records: 0 };
        archivedPair.archived_records += 1;
        pairs.set(archivedKey, archivedPair);
      }
      if (recent.length < 25) recent.push({ id: row.id, occurred_on: row.occurred_on, entry_kind: row.entry_kind, topic: row.topic, category: row.category, currency_code: row.currency_code, amount_minor: row.amount_minor, direction, counterparty_id: counterpartyId, counterparty: nameOf.get(counterpartyId) ?? 'Unknown', notes: row.notes, is_deleted: row.is_deleted });
      if (row.is_deleted === 1) continue; // archived rows stay visible as history but never move a balance
      const total = totals.get(row.currency_code) ?? { currency_code: row.currency_code, paid_for_minor: 0, covered_for_them_minor: 0, settled_out_minor: 0, settled_in_minor: 0, net_minor: 0, entries: 0 };
      total.entries += 1;
      if (direction === 'paid_for') total.paid_for_minor += row.amount_minor; else if (direction === 'covered_for_them') total.covered_for_them_minor += row.amount_minor; else if (direction === 'settled_out') total.settled_out_minor += -row.amount_minor; else total.settled_in_minor += -row.amount_minor;
      total.net_minor = total.paid_for_minor - total.covered_for_them_minor; totals.set(row.currency_code, total);
      const pairKey = `${row.currency_code}:${counterpartyId}`;
      const pair = pairs.get(pairKey) ?? { counterparty_id: counterpartyId, counterparty: nameOf.get(counterpartyId) ?? 'Unknown', currency_code: row.currency_code, paid_for_minor: 0, covered_minor: 0, settled_out_minor: 0, settled_in_minor: 0, net_minor: 0, records: 0, archived_records: 0 };
      if (direction === 'paid_for') pair.paid_for_minor += row.amount_minor; else if (direction === 'covered_for_them') pair.covered_minor += row.amount_minor; else if (direction === 'settled_out') pair.settled_out_minor += -row.amount_minor; else pair.settled_in_minor += -row.amount_minor;
      pair.net_minor = pair.paid_for_minor - pair.covered_minor; pair.records += 1; pairs.set(pairKey, pair);
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
    return secretResponse({ person, totals: [...totals.values()].sort((a, b) => a.currency_code.localeCompare(b.currency_code)), counterparties: [...pairs.values()].sort((a, b) => b.net_minor - a.net_minor || a.counterparty.localeCompare(b.counterparty)), suggestions, recent, recent_limit: 25, records: { active: activeRecords, archived: archivedRecords, total: activeRecords + archivedRecords } });
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
  return new Response('Not found', { status: 404, headers: secretHeaders() });
}

const auditEntities = ['workspace', 'person', 'currency', 'workspace_settings', 'transaction', 'workspace_backup', 'receipt', 'receipt_attachment'];
const auditActions = ['create', 'update', 'archive', 'restore', 'delete'];

// 180x180 PNG, generated from the same artwork as FAVICON_SVG (see the icon section below)
const APPLE_TOUCH_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAH9UlEQVR42u2dv4tVRxTH5x8wmCguikvChmARbLYyhQgWi4VpgkUIpDGFTWAbLUWwClgIVoJptbCwCmwtpLIJhLSSMkXWuBrNj1flwIWX59v37p1775xzz8x8hm8juP5483lnvmfOmZlw5MhRhFYq8BEg4EDAgYADAQcCDgQcCDgQcCDgQMCBEHAg4EDAgYADAQcCDgQcCDgQcCDgQAg4EHAg4EDAgYADAQcCDlc6uvHpsa2dje3dk+dunr54/8PPf1jUR188Xfzl5qVH8ttE8iPvb34GHAXScOLs1VPn78hkf/LN7yMl9AhSwlYNrJQJx3sfbB4/c0VmcevLn8YDsU4ff/1cQouQJ/wBRwaSqZIJ0wOiJaJIOBEogcOdJMhLnJCvsj0WSxI0JWgBh5dQkcRMpJUsZwUEkpA1FqqWIokpkUwnX0QCWIBIIXAc29pxuIhELjTCNHBoZaenzt/JEYtFCdkZ5b15wCH+30MmkkqyygBHmoAhOWoxWCzui/gPIcH57oV8iOWRMTeqzndEgueUpKSlZJ3ESAFHPxXgPXu5VJ+JbnBoMiYpjkxuQRyWeYM3Mgo2GZ0WxBsfATLS6vHTN8XwESAjrWaz2Y+//LX9bQl8BMhIDoeMX3/75/KtF7nzESBDAw4Z+wf/Xn9wkDUf08NRWG4ye3d8v/fn4ELd5PltYD9DFY4xFkQCar1wnDh7tbyMdLZqDLYgpy/erxEOWVOL3B2frRliQa7dezngD5ywCyRgQm3gaMbdJ68zMqfTwFFkFT4GDhl7z972tSDyRZrEnE4Ax/EzVwreBZ9FjJ+f/93XgkxSvA32C0rZhfhZ3BhgQY5t7RQOR/G1+Fmf0cuC2Ge2pnAI+8UXV2c9x+Onb+ItiHHzqSkcmZ4qUIWjsSAXbuxHZi6WzjSw5TU5HI0F+eq7P7xti9nBkdEZNXs4mnH74auYv8KsbT0QNvzAEWlBzIJHMA4bM0YKC2ITPIJx2GDuIy1I+y6ZTfAIxkkKEx8/WnqFbNKWYFB9Tbgk1zZa2pU3tnezh2OpxsZ8D7AgKy2q2Ljs4ViqpDDZCS2Idik/GGewzHRCC6JtS3XhONw8zBwn3AKRqJwrHGKnk+8RVTvWbZ6qXuKgCMfKph6mOW3ZRbUJKJjlKcChsVuqmrME40ob85281UNvK10LDvkXa9SlMBmWZxeCcRmWWY8xGb3aS/USWi04qrq3KSH9AxrT9XpLg0GxDTgix4AjLY0yg6NOMsbAMeAwnPaphWDpRoEjickw86QqcNRwBCEVHANMhtmRBRU4NrZ3gSNmjLk9bOl5qGzgEJCBo3MMvvRn5TW32cBR8CH6JHCMuS7MchM9FJPHyhcx8lzQtHCMuWjQOJstAQ5ZtmXxls/dPxypTAZwREm+hfJdbD5653AkNBnA0S1ZuWX9nn/6nuFIazKAo9tkLE2ATzg6TyjVBYf2ZXBzk+EfjnUHC5JL44xTfpFDvoXyia8M3d7gGPOCAstKb12793LRZHiGQ9tkAMc7uvvkdXui6AQOG5MBHP+bjL1nbzv3lzzAYWYycoUj7UMILSbDIRxTPQFWY+Gt3WQAR36Ft1Rw3H74qlcFHDiqaPaRZVvywL6NM9XCkVOzz9KFLX114cZ+pMkADtWLXNw1GMsEx5sM4MivwXjwDnpfkwEcenvninD0bQYbZjKAQ/UstRYcvXqMhYxhJqO2YdldrAhHvCe9fOvFYJMBHKrXCipewRDz6M71BwdM+Ug49K6NU4SjcxN9vMkADtVrwRThaLkMH5ORCg7VCwUV4Vh3YhaTkRAO1Vdnda+aPLzbgclIC4fqDei6cBxOaPEZCeHQS2It4Fh5FenIbVDgsLmE1OLu85U5y5gCCnDYXF9sAce696cHl16Bw+yNaovHeNY9/ZeknlItHAYveVnA0V5nwYIMgEPbitrB0fl+PRakLxw279obvQ7Z2VUa32LeMiop2St1jE4GR2fwiD+cAhw2YcP0RerIlvTOY22Vw2EWNkzhkOAR+WJ5r7MqtcGh/a7bNHD0erR8mAUpHg6zh8ongKPXMdoBFqRsOGweGp4Sjr43Xx++vqdaOFSr8y7gGHBYcunirzrhsPShU8Ix4FTL4pWBFcIhC4rBZrkXOOS/GtN+HHMPWA1waJfmfcHRUq0dY0GKhMOg+uoOjsFPfbVYkPLg0Huiyzscgy+IWteiXBgc9rmrLzjkPz/syPXKww0lwSFkWG6GeoSjOTjZ15yua1cuCQ77XQ2PcIzkY/GsQzFweCDDCxwj+ZhbkDLgcEKGIzhG8tFYkALg8EOGLzhG8kHMKByOho/Ito/CslZvZHiEY0x+S9ZaPhxVPTEpX4Npd7qyhKPpHCvbgkxYN8kejsaCFLnECPRT1VrLgaOxIMNKdJ47dybpzygQjvl96gWEEJ9ZSfZwzFsM83UhYrHdes8S4GhWmewSGVlHfCarpcExbzTMAhHBwuz0InCsQMTnQrN56VG+WJQAx3yh2djedbLpLqRKbpVFMlIFHIubIhMGEgkV/rcu6oVjsbVdvr4GsURAFBwlO80rDakajkVTIjMn85dwj0SYkyAhC1mOCQhwtO2kCSsnz92U2ZU8ojO0SGCQ3yaSHxEa5MeLjBDAEett+RCAAwEHAg4EHAg4EHAg4EDAgYADAQdCwIGAAwEHAg4EHAg4EHAg4EDAgYADAQdCwIGAAwEHAg4EHAg4UC76DzvpoM3TQfYdAAAAAElFTkSuQmCC';

/* ---------------- receipt backlog (the user's own tracker, never an importer) ---------------- */
const RECEIPT_COLUMNS = 'id, workspace_id, title, note, link, is_added, added_at, created_at, updated_at';
const ATTACHMENT_COLUMNS = 'id, workspace_id, receipt_id, label, image_key, image_type, image_bytes, created_at';
const RECEIPT_MAX_ATTACHMENTS = 6;
const RECEIPT_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const RECEIPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'];
type Receipt = { id: number; workspace_id: number; title: string; note: string; link: string; is_added: number; added_at: string | null; created_at: string; updated_at: string };
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
  return receipts.map((row) => ({ id: row.id, title: row.title, note: row.note, link: row.link, is_added: row.is_added, added_at: row.added_at, created_at: row.created_at, updated_at: row.updated_at, attachments: grouped[row.id] ?? [], attachment_count: (grouped[row.id] ?? []).length }));
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


export default { fetch: handle } satisfies ExportedHandler<Env>;
