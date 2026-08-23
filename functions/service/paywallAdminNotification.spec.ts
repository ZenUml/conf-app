import { describe, expect, it, vi } from 'vitest';
import {
  createPaywallAdminNotification,
  dispatchPaywallAdminNotification,
  failPaywallAdminNotificationBeforeDispatch,
  renderPaywallAdminAdoptionEmail,
  sendResendEmail,
  type PaywallAdminNotificationRow,
} from './paywallAdminNotification';

const content = {
  spaceKey: 'ENG',
  macroCount: 137,
  requestedScope: 'space' as const,
  urgency: 'today' as const,
  grantedAt: '2026-08-23T01:00:00.000Z',
  expiresAt: '2026-08-30T01:00:00.000Z',
  upgradeUrl: 'https://example.com/enterprise-bundle',
};

class NotificationDb {
  row: PaywallAdminNotificationRow | null = null;

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR IGNORE INTO PaywallAdminNotification')) {
            if (this.row) return { success: true, meta: { changes: 0 } };
            this.row = {
              notificationId: String(args[0]), requestId: String(args[1]), grantId: String(args[2]),
              cloudId: String(args[3]), templateVersion: String(args[4]),
              routingOutcome: args[5] as PaywallAdminNotificationRow['routingOutcome'],
              routingReasonCodes: String(args[6]), state: args[7] as PaywallAdminNotificationRow['state'],
              providerMessageId: null, attemptCount: 0, maxAttempts: Number(args[8]),
              lastErrorCode: null, nextAttemptAt: null, sentAt: null,
              deliveredAt: null, clickedAt: null, failedAt: null,
              createdAt: String(args[9]), updatedAt: String(args[9]),
            };
            return { success: true, meta: { changes: 1 } };
          }
          if (!this.row) throw new Error('Notification row missing');
          if (sql.includes("SET state = 'sending'")) {
            if (!['queued', 'retry_pending'].includes(this.row.state)) return { success: true, meta: { changes: 0 } };
            this.row.state = 'sending';
            this.row.attemptCount += 1;
            this.row.updatedAt = String(args[0]);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET state = 'sent'")) {
            this.row.state = 'sent'; this.row.providerMessageId = String(args[0]);
            this.row.sentAt = String(args[1]); this.row.updatedAt = String(args[1]);
            this.row.lastErrorCode = null; this.row.nextAttemptAt = null;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET state = 'failed'")) {
            this.row.state = 'failed'; this.row.lastErrorCode = String(args[0]);
            this.row.failedAt = String(args[1]); this.row.updatedAt = String(args[1]);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('SET state = ?1')) {
            this.row.state = args[0] as PaywallAdminNotificationRow['state'];
            this.row.lastErrorCode = String(args[1]);
            this.row.nextAttemptAt = args[2] == null ? null : String(args[2]);
            this.row.failedAt = args[3] == null ? null : String(args[3]);
            this.row.updatedAt = String(args[4]);
            return { success: true, meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        first: async () => this.row,
      }),
    };
  }
}

describe('renderPaywallAdminAdoptionEmail', () => {
  it('frames sustained adoption and excludes private questionnaire details', () => {
    const email = renderPaywallAdminAdoptionEmail(content);

    expect(email.subject).toContain('ZenUML adoption');
    for (const expected of ['137', 'ENG', '7-day', '30 Aug 2026', 'USD 299/year/Space', content.upgradeUrl]) {
      expect(`${email.html}\n${email.text}`).toContain(expected);
    }
    expect(email.text).toContain('today');
    expect(email.text).toContain('Space');
    expect(`${email.subject}\n${email.html}\n${email.text}`).not.toMatch(
      /violation|breach|AI tool|cloud AI|diagram audience|workflow requirement/i,
    );
  });

  it('escapes customer-controlled display values in HTML', () => {
    const email = renderPaywallAdminAdoptionEmail({ ...content, spaceKey: '<script>alert(1)</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('sendResendEmail', () => {
  it('uses native fetch, Reply-To, and the stable internal idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-message-1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

    await expect(sendResendEmail({
      apiKey: 'test-api-key', from: 'ZenUML <notifications@zenuml.com>',
      replyTo: 'support@zenuml.com', recipient: 'admin@example.com',
      notificationId: 'notification-1', email: renderPaywallAdminAdoptionEmail(content), fetchImpl,
    })).resolves.toEqual({ providerMessageId: 'provider-message-1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-api-key', 'Idempotency-Key': 'notification-1',
    });
    expect(JSON.parse(init.body)).toMatchObject({
      to: ['admin@example.com'], reply_to: 'support@zenuml.com',
    });
  });

  it('returns stable redacted errors without recipient or provider response text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('contact admin@example.com: invalid', { status: 422 }));
    await expect(sendResendEmail({
      apiKey: 'test-api-key', from: 'notifications@zenuml.com', replyTo: 'support@zenuml.com',
      recipient: 'admin@example.com', notificationId: 'notification-1',
      email: renderPaywallAdminAdoptionEmail(content), fetchImpl,
    })).rejects.toMatchObject({ code: 'resend_http_422', retryable: false });
    await expect(sendResendEmail({
      apiKey: '', from: 'notifications@zenuml.com', replyTo: 'support@zenuml.com',
      recipient: 'admin@example.com', notificationId: 'notification-1',
      email: renderPaywallAdminAdoptionEmail(content), fetchImpl,
    })).rejects.toMatchObject({ code: 'resend_configuration_missing', retryable: false });
  });
});

describe('notification outbox and bounded dispatch', () => {
  const base = {
    requestId: 'request-1', grantId: 'grant-1', cloudId: 'cloud-1',
    route: { routingOutcome: 'automatic' as const, reasonCodes: ['technical_contact_unique'] },
  };

  it('queues only automatic routes and replays the same grant/template record', async () => {
    const db = new NotificationDb();
    const first = await createPaywallAdminNotification(db as unknown as D1Database, base, {
      now: new Date('2026-08-23T02:00:00.000Z'), randomUUID: () => 'notification-1',
    });
    const replay = await createPaywallAdminNotification(db as unknown as D1Database, base, {
      now: new Date('2026-08-23T03:00:00.000Z'), randomUUID: () => 'notification-2',
    });
    expect(first).toMatchObject({ notificationId: 'notification-1', state: 'queued' });
    expect(replay).toMatchObject({ notificationId: 'notification-1', state: 'queued' });

    const manualDb = new NotificationDb();
    await expect(createPaywallAdminNotification(manualDb as unknown as D1Database, {
      ...base, route: { routingOutcome: 'manual', reasonCodes: ['source_stale'] },
    }, { randomUUID: () => 'manual-1' })).resolves.toMatchObject({ state: 'manual' });
  });

  it('persists provider acceptance and never calls fetch for manual routing', async () => {
    const db = new NotificationDb();
    const row = await createPaywallAdminNotification(db as unknown as D1Database, base, {
      randomUUID: () => 'notification-1', now: new Date('2026-08-23T02:00:00.000Z'),
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }));
    await expect(dispatchPaywallAdminNotification(db as unknown as D1Database, row, {
      apiKey: 'key', from: 'notifications@zenuml.com', replyTo: 'support@zenuml.com',
      recipient: 'admin@example.com', content, fetchImpl,
      now: new Date('2026-08-23T02:01:00.000Z'),
    })).resolves.toMatchObject({ state: 'sent', providerMessageId: 'provider-1', attemptCount: 1 });

    const manualDb = new NotificationDb();
    const manual = await createPaywallAdminNotification(manualDb as unknown as D1Database, {
      ...base, route: { routingOutcome: 'manual', reasonCodes: ['known_reseller_domain'] },
    });
    await expect(dispatchPaywallAdminNotification(manualDb as unknown as D1Database, manual, {
      apiKey: 'key', from: 'notifications@zenuml.com', replyTo: 'support@zenuml.com',
      recipient: 'reseller@example.com', content, fetchImpl,
    })).resolves.toMatchObject({ state: 'manual' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('records a bounded retry without leaking recipient data', async () => {
    const db = new NotificationDb();
    const row = await createPaywallAdminNotification(db as unknown as D1Database, base, {
      randomUUID: () => 'notification-1', now: new Date('2026-08-23T02:00:00.000Z'),
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('admin@example.com', { status: 503 }));
    const result = await dispatchPaywallAdminNotification(db as unknown as D1Database, row, {
      apiKey: 'key', from: 'notifications@zenuml.com', replyTo: 'support@zenuml.com',
      recipient: 'admin@example.com', content, fetchImpl,
      now: new Date('2026-08-23T02:01:00.000Z'),
    });
    expect(result).toMatchObject({ state: 'retry_pending', attemptCount: 1, lastErrorCode: 'resend_http_503' });
    expect(JSON.stringify(result)).not.toContain('admin@example.com');
  });

  it('records missing runtime configuration without invoking the provider', async () => {
    const db = new NotificationDb();
    const row = await createPaywallAdminNotification(db as unknown as D1Database, base, {
      randomUUID: () => 'notification-1', now: new Date('2026-08-23T02:00:00.000Z'),
    });
    await expect(failPaywallAdminNotificationBeforeDispatch(
      db as unknown as D1Database, row, 'resend_configuration_missing',
      new Date('2026-08-23T02:01:00.000Z'),
    )).resolves.toMatchObject({ state: 'failed', lastErrorCode: 'resend_configuration_missing', attemptCount: 0 });
  });

  it('does not send when another dispatcher already claimed the notification', async () => {
    const db = new NotificationDb();
    const persistedQueuedRow = await createPaywallAdminNotification(db as unknown as D1Database, base, {
      randomUUID: () => 'notification-1', now: new Date('2026-08-23T02:00:00.000Z'),
    });
    const staleQueuedRow = { ...persistedQueuedRow };
    if (!db.row) throw new Error('Notification row missing');
    db.row.state = 'sending';
    db.row.attemptCount = 1;
    const fetchImpl = vi.fn();

    await expect(dispatchPaywallAdminNotification(db as unknown as D1Database, staleQueuedRow, {
      apiKey: 'key', from: 'notifications@zenuml.com', replyTo: 'support@zenuml.com',
      recipient: 'admin@example.com', content, fetchImpl,
      now: new Date('2026-08-23T02:01:00.000Z'),
    })).resolves.toMatchObject({ state: 'sending', attemptCount: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
