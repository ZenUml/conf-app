import { decryptRecoveryField, encryptRecoveryField, getRecoveryCase } from './fullscreenRecoveryService';

export const FULLSCREEN_RECOVERY_MAIL_TEMPLATE_VERSION = 'requester-first-reply-v1';
export type MailState = 'queued' | 'sending' | 'accepted' | 'delivered' | 'bounced' | 'failed' | 'delivery_unknown';

export interface MailOutboxRow {
  id: string;
  requestId: string;
  templateVersion: string;
  recipientCiphertext: string;
  snapshotCiphertext: string;
  snapshotHmacSha256: string;
  state: MailState;
  attemptCount: number;
  maxAttempts: number;
  claimId: string | null;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  providerMessageId: string | null;
  providerOccurredAt: string | null;
  lastErrorCode: string | null;
  retryable: number;
  createdBy: string;
  lastManualAction: string | null;
  lastManualActor: string | null;
  lastManualAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrozenReply {
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  timeZone: string;
}

export interface MailEnv {
  DB: D1Database;
  FULLSCREEN_RECOVERY_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
}

export class RecoveryMailError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function validEmail(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value));
}

function validSender(value: string | undefined): value is string {
  return Boolean(value && (validEmail(value) || /^[^<>\r\n]{1,100} <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(value)));
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const SCENE_COPY: Record<string, string> = {
  inspect_details: 'inspect diagram details',
  present: 'present a diagram',
  discuss: 'discuss a diagram with others',
  other: 'use Fullscreen for your work',
};

export function renderFirstReply(input: {
  requestId: string;
  scenarios: string[];
  activatedAt: string | null;
  expiresAt: string | null;
  now: Date;
  timeZone: string;
  from: string;
  replyTo: string;
}): FrozenReply {
  if (!validSender(input.from) || !validEmail(input.replyTo)) throw new RecoveryMailError('mail_configuration_missing', 503);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: input.timeZone, year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'long', hour12: false,
    });
    formatter.format(input.now);
  } catch { throw new RecoveryMailError('invalid_time_zone'); }
  const scenarios = [...new Set(input.scenarios)].filter((scene) => SCENE_COPY[scene]);
  if (!scenarios.length) throw new RecoveryMailError('invalid_scenarios');
  const sceneText = scenarios.map((scene) => SCENE_COPY[scene]).join(', ');
  const expiry = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiry && !Number.isFinite(expiry.getTime())) throw new RecoveryMailError('invalid_expiry', 503);
  if (input.activatedAt && !expiry) throw new RecoveryMailError('invalid_expiry', 503);
  const status = !input.activatedAt
    ? 'Your seven days of Fullscreen access begin when you first open and successfully view a diagram in Fullscreen.'
    : expiry && expiry.getTime() > input.now.getTime()
      ? `Your Fullscreen access is active until ${formatter.format(expiry!)} (${input.timeZone}).`
      : `Your temporary Fullscreen access expired at ${formatter.format(expiry!)} (${input.timeZone}). We can continue the conversation about what you need.`;
  const paragraphs = [
    'Hello,',
    `Thanks for contacting ZenUML support about request ${input.requestId}. We understand you want to ${sceneText}.`,
    status,
    'Reply to this email if you want to continue the conversation or share what would help. You do not need to reply just to confirm receipt.',
    'ZenUML Support',
  ];
  const text = paragraphs.join('\n\n');
  const html = `<!doctype html><html lang="en"><body>${paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}</body></html>`;
  return { from: input.from, replyTo: input.replyTo, subject: `ZenUML Fullscreen support — request ${input.requestId}`, text, html, timeZone: input.timeZone };
}

async function snapshotDigest(value: string, base64Key: string): Promise<string> {
  let secret: Uint8Array;
  try { secret = Uint8Array.from(atob(base64Key), (character) => character.charCodeAt(0)); }
  catch { throw new RecoveryMailError('encryption_configuration_missing', 503); }
  if (secret.length !== 32) throw new RecoveryMailError('encryption_configuration_missing', 503);
  const keyBytes = new ArrayBuffer(secret.length);
  new Uint8Array(keyBytes).set(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function outbox(db: D1Database, requestId: string): Promise<MailOutboxRow | null> {
  return db.prepare('SELECT * FROM FullscreenRecoveryMailOutbox WHERE requestId = ?1 AND templateVersion = ?2 LIMIT 1')
    .bind(requestId, FULLSCREEN_RECOVERY_MAIL_TEMPLATE_VERSION).first<MailOutboxRow>();
}

export function publicMailStatus(row: MailOutboxRow | null) {
  if (!row) return { state: 'awaiting_support' as const };
  return {
    id: row.id, state: row.state, attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts, providerMessageId: row.providerMessageId,
    lastErrorCode: row.lastErrorCode, retryable: Boolean(row.retryable),
    firstAttemptAt: row.firstAttemptAt, updatedAt: row.updatedAt,
  };
}

export async function getMailStatus(db: D1Database, requestId: string): Promise<MailOutboxRow | null> {
  return outbox(db, requestId);
}

export async function previewFirstReply(env: MailEnv, requestId: string, timeZone: string, now = new Date()) {
  if (!env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY) throw new RecoveryMailError('encryption_configuration_missing', 503);
  const request = await getRecoveryCase(env.DB, requestId);
  if (!request) throw new RecoveryMailError('request_not_found', 404);
  const recipient = await decryptRecoveryField(request.emailCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY);
  if (!validEmail(recipient)) throw new RecoveryMailError('recipient_invalid', 409);
  const existing = await outbox(env.DB, requestId);
  if (existing) {
    const frozenRecipient = await decryptRecoveryField(existing.recipientCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY);
    const snapshot = JSON.parse(await decryptRecoveryField(existing.snapshotCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY)) as FrozenReply;
    return { recipient: frozenRecipient, email: snapshot, previewHash: existing.snapshotHmacSha256, frozen: true, status: publicMailStatus(existing) };
  }
  const email = renderFirstReply({ requestId, scenarios: JSON.parse(request.scenariosJson) as string[],
    activatedAt: request.activatedAt, expiresAt: request.expiresAt, now, timeZone,
    from: env.RESEND_FROM ?? '', replyTo: env.RESEND_REPLY_TO ?? '' });
  const previewHash = await snapshotDigest(JSON.stringify({ recipient, email }), env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY);
  return { recipient, email, previewHash, frozen: false, status: { state: 'awaiting_support' as const } };
}

/** The operator confirms the exact preview hash. Unique request+template prevents two sends. */
export async function prepareFirstReply(env: MailEnv, requestId: string, timeZone: string, previewHash: string, actorId: string, now = new Date()) {
  const preview = await previewFirstReply(env, requestId, timeZone, now);
  if (preview.previewHash !== previewHash) throw new RecoveryMailError('preview_changed', 409);
  if (preview.frozen) return outbox(env.DB, requestId) as Promise<MailOutboxRow>;
  const id = crypto.randomUUID();
  const key = env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY!;
  const recipientCiphertext = await encryptRecoveryField(preview.recipient, key);
  const snapshotCiphertext = await encryptRecoveryField(JSON.stringify(preview.email), key);
  const timestamp = now.toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO FullscreenRecoveryMailOutbox
    (id,requestId,templateVersion,recipientCiphertext,snapshotCiphertext,snapshotHmacSha256,state,createdBy,createdAt,updatedAt)
    VALUES (?1,?2,?3,?4,?5,?6,'queued',?7,?8,?8)`)
    .bind(id, requestId, FULLSCREEN_RECOVERY_MAIL_TEMPLATE_VERSION, recipientCiphertext,
      snapshotCiphertext, previewHash, actorId, timestamp).run();
  const row = await outbox(env.DB, requestId);
  if (!row) throw new RecoveryMailError('outbox_persist_failed', 503);
  if (row.snapshotHmacSha256 !== previewHash) throw new RecoveryMailError('preview_changed', 409);
  return row;
}

export class ResendDispatchError extends Error {
  constructor(public readonly code: string, public readonly resultUnknown: boolean, public readonly retryable: boolean) { super(code); }
}

/** Reuses #547's single-recipient Resend request and provider idempotency key. */
export async function sendResendFirstReply(input: {
  apiKey: string; recipient: string; id: string; email: FrozenReply; fetchImpl?: typeof fetch;
}): Promise<string> {
  if (!input.apiKey || !validEmail(input.recipient) || !validSender(input.email.from)
    || !validEmail(input.email.replyTo)) throw new ResendDispatchError('resend_configuration_missing', false, false);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.id },
      body: JSON.stringify({ from: input.email.from, to: [input.recipient], reply_to: input.email.replyTo,
        subject: input.email.subject, text: input.email.text, html: input.email.html }),
    });
  } catch { throw new ResendDispatchError('resend_network_unknown', true, false); }
  if (!response.ok) throw new ResendDispatchError(`resend_http_${response.status}`, response.status >= 500, response.status === 429);
  let id: unknown;
  try { id = (await response.json() as { id?: unknown }).id; }
  catch { throw new ResendDispatchError('resend_response_unknown', true, false); }
  if (typeof id !== 'string' || !id.trim()) throw new ResendDispatchError('resend_response_unknown', true, false);
  return id;
}

/** A failed or unknown email outcome is isolated from the Fullscreen grant. */
export async function dispatchFirstReply(env: MailEnv, requestId: string,
  options: { now?: Date; fetchImpl?: typeof fetch; actorId?: string } = {}) {
  const now = options.now ?? new Date();
  let row = await outbox(env.DB, requestId);
  if (!row) throw new RecoveryMailError('outbox_missing', 404);
  if (row.state !== 'queued' && !(row.state === 'failed' && row.retryable)) return row;
  if (row.attemptCount >= row.maxAttempts) return row;
  const claimId = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE FullscreenRecoveryMailOutbox SET state='sending', claimId=?1,
      attemptCount=attemptCount+1, firstAttemptAt=COALESCE(firstAttemptAt,?2), lastAttemptAt=?2, updatedAt=?2,
      lastManualAction=CASE WHEN state='failed' THEN 'retry' ELSE lastManualAction END,
      lastManualActor=CASE WHEN state='failed' THEN ?4 ELSE lastManualActor END,
      lastManualAt=CASE WHEN state='failed' THEN ?2 ELSE lastManualAt END
    WHERE id=?3 AND (state='queued' OR (state='failed' AND retryable=1 AND ?4 IS NOT NULL))
      AND attemptCount<maxAttempts`)
    .bind(claimId, now.toISOString(), row.id, options.actorId ?? null).run();
  if ((claim.meta?.changes ?? 0) !== 1) return (await outbox(env.DB, requestId))!;
  row = (await outbox(env.DB, requestId))!;
  try {
    if (!env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY) throw new ResendDispatchError('encryption_configuration_missing', false, false);
    const [recipient, email] = await Promise.all([
      decryptRecoveryField(row.recipientCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY),
      decryptRecoveryField(row.snapshotCiphertext, env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY),
    ]);
    const providerId = await sendResendFirstReply({ apiKey: env.RESEND_API_KEY ?? '', recipient, id: row.id,
      email: JSON.parse(email) as FrozenReply, fetchImpl: options.fetchImpl });
    // A signed delivery callback can precede this response. Link and apply any
    // pending receipt in the same D1 transaction that records the provider ID.
    await env.DB.batch([
      env.DB.prepare(`UPDATE FullscreenRecoveryMailOutbox SET state='accepted',providerMessageId=?1,
        claimId=NULL,lastErrorCode=NULL,retryable=0,updatedAt=?2
        WHERE id=?3 AND state='sending' AND claimId=?4`)
        .bind(providerId, now.toISOString(), row.id, claimId),
      env.DB.prepare(`WITH latest AS (
        SELECT eventType, occurredAt FROM FullscreenRecoveryMailWebhookReceipt
        WHERE providerMessageId=?1 ORDER BY occurredAt DESC,
          CASE eventType WHEN 'email.sent' THEN 1 WHEN 'email.delivered' THEN 2
            WHEN 'email.failed' THEN 3 WHEN 'email.bounced' THEN 4 ELSE 0 END DESC LIMIT 1
      ) UPDATE FullscreenRecoveryMailOutbox SET
        state=(SELECT CASE eventType WHEN 'email.sent' THEN 'accepted' WHEN 'email.delivered' THEN 'delivered'
          WHEN 'email.bounced' THEN 'bounced' ELSE 'failed' END FROM latest),
        providerOccurredAt=(SELECT occurredAt FROM latest),
        lastErrorCode=(SELECT CASE WHEN eventType IN ('email.bounced','email.failed')
          THEN 'provider_delivery_failure' ELSE NULL END FROM latest),
        retryable=0,updatedAt=?2
        WHERE id=?3 AND providerMessageId=?1 AND EXISTS (SELECT 1 FROM latest)`)
        .bind(providerId, now.toISOString(), row.id),
      env.DB.prepare(`UPDATE FullscreenRecoveryMailWebhookReceipt SET outboxId=?2
        WHERE providerMessageId=?1 AND outboxId IS NULL
          AND EXISTS (SELECT 1 FROM FullscreenRecoveryMailOutbox WHERE id=?2 AND providerMessageId=?1)`)
        .bind(providerId, row.id),
    ]);
  } catch (error) {
    const reason = error instanceof ResendDispatchError ? error : new ResendDispatchError('dispatch_unknown', true, false);
    const state = reason.resultUnknown ? 'delivery_unknown' : 'failed';
    await env.DB.prepare(`UPDATE FullscreenRecoveryMailOutbox SET state=?1,claimId=NULL,lastErrorCode=?2,
        retryable=?3,updatedAt=?4 WHERE id=?5 AND state='sending' AND claimId=?6`)
      .bind(state, reason.code, reason.retryable ? 1 : 0, now.toISOString(), row.id, claimId).run();
  }
  return (await outbox(env.DB, requestId))!;
}
