export const RESEND_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type ResendLifecycleEvent = 'email.sent' | 'email.delivered' | 'email.clicked' | 'email.failed';

export class ResendWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResendWebhookError';
  }
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

interface VerifySvixOptions {
  rawBody: string;
  eventId: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
  now?: Date;
}

/** Verify the official Svix signing envelope over the untouched request body. */
export async function verifyResendWebhookSignature(options: VerifySvixOptions): Promise<{ eventId: string }> {
  if (!options.eventId || !options.timestamp || !options.signature || !options.secret) {
    throw new ResendWebhookError('Webhook signature headers are incomplete');
  }
  const timestampSeconds = Number(options.timestamp);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > RESEND_WEBHOOK_TOLERANCE_SECONDS) {
    throw new ResendWebhookError('Webhook timestamp is outside the accepted window');
  }
  const encodedSecret = options.secret.startsWith('whsec_') ? options.secret.slice(6) : options.secret;
  const secretBytes = base64Bytes(encodedSecret);
  if (!secretBytes?.byteLength) throw new ResendWebhookError('Webhook signing secret is invalid');
  const keyMaterial = new ArrayBuffer(secretBytes.byteLength);
  new Uint8Array(keyMaterial).set(secretBytes);
  const key = await crypto.subtle.importKey(
    'raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = `${options.eventId}.${options.timestamp}.${options.rawBody}`;
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)));
  const candidates = options.signature.split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => base64Bytes(part.slice(3)))
    .filter((part): part is Uint8Array => part !== null);
  if (!candidates.some((candidate) => constantTimeEqual(candidate, expected))) {
    throw new ResendWebhookError('Webhook signature is invalid');
  }
  return { eventId: options.eventId };
}

export function parseResendLifecycleEvent(payload: unknown): {
  eventType: ResendLifecycleEvent;
  providerMessageId: string;
} | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const { type, data } = payload as { type?: unknown; data?: unknown };
  if (!['email.sent', 'email.delivered', 'email.clicked', 'email.failed'].includes(String(type))) return null;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const providerMessageId = (data as { email_id?: unknown }).email_id;
  if (typeof providerMessageId !== 'string' || !providerMessageId.trim()) return null;
  return { eventType: type as ResendLifecycleEvent, providerMessageId };
}

export async function recordResendLifecycleEvent(
  db: D1Database,
  input: { eventId: string; eventType: ResendLifecycleEvent; providerMessageId: string },
  now: Date = new Date(),
): Promise<{ replay: boolean }> {
  const receivedAt = now.toISOString();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO PaywallAdminNotificationEvent
       (eventId, providerMessageId, eventType, receivedAt)
     VALUES (?1, ?2, ?3, ?4)`,
  ).bind(input.eventId, input.providerMessageId, input.eventType, receivedAt).run();
  if ((inserted.meta?.changes ?? 0) === 0) return { replay: true };

  if (input.eventType === 'email.sent') {
    await db.prepare(
      `UPDATE PaywallAdminNotification
          SET sentAt = COALESCE(sentAt, ?1), updatedAt = ?1
        WHERE providerMessageId = ?2`,
    ).bind(receivedAt, input.providerMessageId).run();
  } else if (input.eventType === 'email.delivered') {
    await db.prepare(
      `UPDATE PaywallAdminNotification
          SET deliveredAt = COALESCE(deliveredAt, ?1),
              state = CASE WHEN state = 'clicked' THEN 'clicked' ELSE 'delivered' END,
              updatedAt = ?1
        WHERE providerMessageId = ?2`,
    ).bind(receivedAt, input.providerMessageId).run();
  } else if (input.eventType === 'email.clicked') {
    await db.prepare(
      `UPDATE PaywallAdminNotification
          SET clickedAt = COALESCE(clickedAt, ?1), state = 'clicked', updatedAt = ?1
        WHERE providerMessageId = ?2`,
    ).bind(receivedAt, input.providerMessageId).run();
  } else {
    await db.prepare(
      `UPDATE PaywallAdminNotification
          SET failedAt = COALESCE(failedAt, ?1),
              state = CASE WHEN state IN ('delivered', 'clicked') THEN state ELSE 'failed' END,
              updatedAt = ?1
        WHERE providerMessageId = ?2`,
    ).bind(receivedAt, input.providerMessageId).run();
  }
  return { replay: false };
}
