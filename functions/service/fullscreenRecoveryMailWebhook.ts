/** Adapted from PR #547's Svix raw-body verifier for Fullscreen recovery. */
export class MailWebhookError extends Error {}

function decodeBase64(value: string): Uint8Array | null {
  try { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
  catch { return null; }
}

function equalConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i];
  return result === 0;
}

export async function verifyMailWebhook(input: {
  rawBody: string; id: string | null; timestamp: string | null;
  signature: string | null; secret: string | undefined; now?: Date;
}): Promise<string> {
  if (!input.id || !input.timestamp || !input.signature || !input.secret) throw new MailWebhookError('missing_signature');
  const timestamp = Number(input.timestamp);
  const current = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(current - timestamp) > 300) throw new MailWebhookError('stale_signature');
  const secret = decodeBase64(input.secret.startsWith('whsec_') ? input.secret.slice(6) : input.secret);
  if (!secret?.length) throw new MailWebhookError('invalid_secret');
  const keyBytes = new ArrayBuffer(secret.byteLength);
  new Uint8Array(keyBytes).set(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.rawBody}`)));
  const signatures = input.signature.split(' ').filter((part) => part.startsWith('v1,'));
  if (!signatures.some((part) => {
    const candidate = decodeBase64(part.slice(3));
    return candidate && equalConstantTime(candidate, expected);
  })) throw new MailWebhookError('invalid_signature');
  return input.id;
}

export type MailProviderEvent = 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.failed';

export function parseMailWebhook(payload: unknown): { type: MailProviderEvent; providerMessageId: string; occurredAt: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = payload as { type?: unknown; data?: unknown; created_at?: unknown };
  if (!['email.sent', 'email.delivered', 'email.bounced', 'email.failed'].includes(String(event.type))) return null;
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  const providerMessageId = (event.data as { email_id?: unknown }).email_id;
  if (typeof providerMessageId !== 'string' || !providerMessageId.trim()) return null;
  if (typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at))) return null;
  return { type: event.type as MailProviderEvent, providerMessageId, occurredAt: new Date(event.created_at).toISOString() };
}

export async function recordMailWebhook(db: D1Database, input: {
  eventId: string; type: MailProviderEvent; providerMessageId: string; occurredAt: string;
}, now = new Date()): Promise<{ ignored: boolean; pending: boolean; replay: boolean; changed: boolean;
  outboxId?: string; requestId?: string; state?: string }> {
  const state = input.type === 'email.sent' ? 'accepted' : input.type === 'email.delivered' ? 'delivered'
    : input.type === 'email.bounced' ? 'bounced' : 'failed';
  const statements = [db.prepare(`INSERT OR IGNORE INTO FullscreenRecoveryMailWebhookReceipt
    (eventId,outboxId,providerMessageId,eventType,occurredAt,receivedAt)
    VALUES (?1,(SELECT id FROM FullscreenRecoveryMailOutbox WHERE providerMessageId=?2),?2,?3,?4,?5)`)
    .bind(input.eventId, input.providerMessageId, input.type, input.occurredAt, now.toISOString()),
    db.prepare(`UPDATE FullscreenRecoveryMailOutbox SET state=?1,providerOccurredAt=?2,
      lastErrorCode=CASE WHEN ?1 IN ('bounced','failed') THEN 'provider_delivery_failure' ELSE NULL END,
      retryable=0,updatedAt=?3
    WHERE providerMessageId=?4 AND state IN ('accepted','delivered','bounced','failed','delivery_unknown')
      AND EXISTS (SELECT 1 FROM FullscreenRecoveryMailWebhookReceipt
        WHERE eventId=?5 AND providerMessageId=?4 AND eventType=?6 AND occurredAt=?2)
      AND (providerOccurredAt IS NULL OR providerOccurredAt < ?2
        OR (providerOccurredAt = ?2 AND CASE state WHEN 'accepted' THEN 1 WHEN 'delivered' THEN 2
          WHEN 'failed' THEN 3 WHEN 'bounced' THEN 4 ELSE 0 END <
          CASE ?1 WHEN 'accepted' THEN 1 WHEN 'delivered' THEN 2 WHEN 'failed' THEN 3 WHEN 'bounced' THEN 4 ELSE 0 END))`)
    .bind(state, input.occurredAt, now.toISOString(), input.providerMessageId, input.eventId, input.type),
    db.prepare(`UPDATE FullscreenRecoveryMailWebhookReceipt SET
      outboxId=(SELECT id FROM FullscreenRecoveryMailOutbox WHERE providerMessageId=?1)
      WHERE eventId=?2 AND providerMessageId=?1 AND outboxId IS NULL
        AND EXISTS (SELECT 1 FROM FullscreenRecoveryMailOutbox WHERE providerMessageId=?1)`)
      .bind(input.providerMessageId, input.eventId)];
  // D1 batch is transactional: a failed status update cannot consume the event ID.
  const [inserted, updated] = await db.batch(statements);
  const row = await db.prepare('SELECT id,requestId FROM FullscreenRecoveryMailOutbox WHERE providerMessageId=?1 LIMIT 1')
    .bind(input.providerMessageId).first<{ id: string; requestId: string }>();
  return { ignored: false, pending: !row, replay: (inserted.meta?.changes ?? 0) === 0,
    changed: (updated.meta?.changes ?? 0) === 1,
    outboxId: row?.id, requestId: row?.requestId, state };
}
