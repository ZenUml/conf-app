import { describe, expect, it } from 'vitest';
import {
  parseResendLifecycleEvent,
  recordResendLifecycleEvent,
  verifyResendWebhookSignature,
  type ResendLifecycleEvent,
} from './resendWebhook';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signature(secret: Uint8Array, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${base64(new Uint8Array(value))}`;
}

describe('Resend/Svix webhook verification', () => {
  it('verifies the raw body and rejects tampering or stale timestamps', async () => {
    const secretBytes = new Uint8Array(32).fill(7);
    const secret = `whsec_${base64(secretBytes)}`;
    const eventId = 'event-1';
    const timestamp = '1787457600';
    const rawBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'provider-1' } });
    const svixSignature = await signature(secretBytes, eventId, timestamp, rawBody);
    const now = new Date(Number(timestamp) * 1000);

    await expect(verifyResendWebhookSignature({
      rawBody, eventId, timestamp, signature: svixSignature, secret, now,
    })).resolves.toEqual({ eventId });
    await expect(verifyResendWebhookSignature({
      rawBody: `${rawBody} `, eventId, timestamp, signature: svixSignature, secret, now,
    })).rejects.toThrow('signature is invalid');
    await expect(verifyResendWebhookSignature({
      rawBody, eventId, timestamp, signature: svixSignature, secret,
      now: new Date(now.getTime() + 10 * 60 * 1000),
    })).rejects.toThrow('outside the accepted window');
  });

  it('accepts only lifecycle events with a provider message id', () => {
    expect(parseResendLifecycleEvent({
      type: 'email.clicked', data: { email_id: 'provider-1', click: { link: 'https://example.com' } },
    })).toEqual({ eventType: 'email.clicked', providerMessageId: 'provider-1' });
    expect(parseResendLifecycleEvent({ type: 'email.opened', data: { email_id: 'provider-1' } })).toBeNull();
    expect(parseResendLifecycleEvent({ type: 'email.failed', data: { to: ['admin@example.com'] } })).toBeNull();
  });
});

class LifecycleDb {
  events = new Set<string>();
  row = { state: 'sent', sentAt: '2026-08-23T00:00:00.000Z', deliveredAt: null as string | null,
    clickedAt: null as string | null, failedAt: null as string | null };

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR IGNORE INTO PaywallAdminNotificationEvent')) {
            const id = String(args[0]);
            if (this.events.has(id)) return { success: true, meta: { changes: 0 } };
            this.events.add(id);
            return { success: true, meta: { changes: 1 } };
          }
          const at = String(args[0]);
          if (sql.includes('deliveredAt')) {
            this.row.deliveredAt ??= at;
            if (this.row.state !== 'clicked') this.row.state = 'delivered';
          } else if (sql.includes('clickedAt')) {
            this.row.clickedAt ??= at; this.row.state = 'clicked';
          } else if (sql.includes('failedAt')) {
            this.row.failedAt ??= at;
            if (!['delivered', 'clicked'].includes(this.row.state)) this.row.state = 'failed';
          }
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };
  }
}

describe('Resend lifecycle persistence', () => {
  it('deduplicates event ids and does not regress clicked state under out-of-order events', async () => {
    const db = new LifecycleDb();
    const record = (eventId: string, eventType: ResendLifecycleEvent, minute: number) => (
      recordResendLifecycleEvent(db as unknown as D1Database, {
        eventId, eventType, providerMessageId: 'provider-1',
      }, new Date(`2026-08-23T00:${String(minute).padStart(2, '0')}:00.000Z`))
    );

    await expect(record('click-1', 'email.clicked', 3)).resolves.toEqual({ replay: false });
    await expect(record('click-1', 'email.clicked', 4)).resolves.toEqual({ replay: true });
    await record('delivered-late', 'email.delivered', 5);
    await record('failed-late', 'email.failed', 6);

    expect(db.events).toHaveLength(3);
    expect(db.row).toMatchObject({
      state: 'clicked', clickedAt: '2026-08-23T00:03:00.000Z',
      deliveredAt: '2026-08-23T00:05:00.000Z', failedAt: '2026-08-23T00:06:00.000Z',
    });
  });
});

