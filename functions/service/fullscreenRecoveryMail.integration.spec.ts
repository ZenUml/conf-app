import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { encryptRecoveryField } from './fullscreenRecoveryService';
import { dispatchFirstReply, getMailStatus, prepareFirstReply, previewFirstReply } from './fullscreenRecoveryMail';
import { recordMailWebhook } from './fullscreenRecoveryMailWebhook';
import { onRequest as receiveWebhook } from '../api/fullscreen-recovery-webhook';

const requestId = 'e8fb9193-a89a-423c-8394-cb8a44fc2660';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function testDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('functions/migrations/0033_fullscreen_recovery.sql', 'utf8'));
  sqlite.exec(readFileSync('functions/migrations/0034_fullscreen_recovery_mail.sql', 'utf8'));
  const adapter = {
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => {
        const statement = sqlite.prepare(sql);
        const params = args as Array<string | number | null>;
        return {
          first: async () => statement.get(...params) ?? null,
          run: async () => ({ meta: { changes: Number(statement.run(...params).changes) } }),
          statement, params,
        };
      } };
    },
    async batch(statements: Array<{ statement: ReturnType<DatabaseSync['prepare']>; params: Array<string | number | null> }>) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ statement, params }) => ({ meta: { changes: Number(statement.run(...params).changes) } }));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, adapter };
}

const open: DatabaseSync[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });

async function seeded() {
  const { sqlite, adapter } = testDb();
  open.push(sqlite);
  const emailCiphertext = await encryptRecoveryField('requester@example.com', key);
  sqlite.prepare(`INSERT INTO FullscreenRecoveryRequest
    (id,cloudId,accountId,scenariosJson,noteCiphertext,emailCiphertext,consentVersion,consentAt,createdAt,grantId)
    VALUES (?1,'cloud-1','user-1',?2,?3,?4,'fullscreen-contact-v1','2026-10-24T00:00:00Z','2026-10-24T00:00:00Z','grant-1')`)
    .run(requestId, JSON.stringify(['inspect_details']), await encryptRecoveryField('', key), emailCiphertext);
  const env = { DB: adapter, FULLSCREEN_RECOVERY_ENCRYPTION_KEY: key,
    RESEND_API_KEY: 'test-key', RESEND_FROM: 'ZenUML Support <support@example.com>',
    RESEND_REPLY_TO: 'support@example.com' };
  return { sqlite, env };
}

describe('mail outbox SQLite integration', () => {
  it('requires exact preview confirmation, encrypts the frozen reply, and sends once under duplicate calls', async () => {
    const { sqlite, env } = await seeded();
    const preview = await previewFirstReply(env, requestId, 'Australia/Melbourne');
    await expect(prepareFirstReply(env, requestId, 'Australia/Melbourne', '0'.repeat(64), 'operator-1'))
      .rejects.toMatchObject({ code: 'preview_changed' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM FullscreenRecoveryMailOutbox').get()).toMatchObject({ count: 0 });
    const first = await prepareFirstReply(env, requestId, 'Australia/Melbourne', preview.previewHash, 'operator-1');
    const again = await prepareFirstReply(env, requestId, 'Australia/Melbourne', preview.previewHash, 'operator-2');
    expect(again.id).toBe(first.id);
    expect(first.recipientCiphertext).not.toContain('requester@example.com');
    expect(first.snapshotCiphertext).not.toContain('Fullscreen access');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }));
    const results = await Promise.all([
      dispatchFirstReply(env, requestId, { fetchImpl }), dispatchFirstReply(env, requestId, { fetchImpl }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results.some((result) => result.state === 'accepted')).toBe(true);
    expect((await getMailStatus(env.DB, requestId))?.providerMessageId).toBe('provider-1');
    expect(sqlite.prepare('SELECT activatedAt, expiresAt FROM FullscreenRecoveryRequest WHERE id=?1').get(requestId))
      .toMatchObject({ activatedAt: null, expiresAt: null });
  });

  it('keeps unknown provider outcomes for manual review and never retries them', async () => {
    const { env } = await seeded();
    const preview = await previewFirstReply(env, requestId, 'UTC');
    await prepareFirstReply(env, requestId, 'UTC', preview.previewHash, 'operator-1');
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection dropped'));
    const first = await dispatchFirstReply(env, requestId, { fetchImpl });
    expect(first).toMatchObject({ state: 'delivery_unknown', attemptCount: 1, retryable: 0 });
    await dispatchFirstReply(env, requestId, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds an explicitly rejected 429 retry and reuses the same snapshot', async () => {
    const { env } = await seeded();
    const preview = await previewFirstReply(env, requestId, 'UTC');
    const prepared = await prepareFirstReply(env, requestId, 'UTC', preview.previewHash, 'operator-1');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    for (let attempt = 0; attempt < 4; attempt += 1)
      await dispatchFirstReply(env, requestId, { fetchImpl, actorId: 'operator-1' });
    const result = await getMailStatus(env.DB, requestId);
    expect(result).toMatchObject({ state: 'failed', attemptCount: 3, maxAttempts: 3,
      lastManualAction: 'retry', lastManualActor: 'operator-1' });
    expect(result?.snapshotCiphertext).toBe(prepared.snapshotCiphertext);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('deduplicates and orders signed provider lifecycle receipts independently of the grant', async () => {
    const { sqlite, env } = await seeded();
    const preview = await previewFirstReply(env, requestId, 'UTC');
    await prepareFirstReply(env, requestId, 'UTC', preview.previewHash, 'operator-1');
    await dispatchFirstReply(env, requestId, { fetchImpl: vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 'provider-1' }), { status: 200 })) });
    const delivered = { eventId: 'event-delivered', type: 'email.delivered' as const,
      providerMessageId: 'provider-1', occurredAt: '2026-10-24T04:00:00.000Z' };
    expect(await recordMailWebhook(env.DB, delivered)).toMatchObject({ changed: true, state: 'delivered' });
    expect(await recordMailWebhook(env.DB, delivered)).toMatchObject({ replay: true, changed: false });
    expect(await recordMailWebhook(env.DB, { ...delivered, eventId: 'event-old', type: 'email.sent',
      occurredAt: '2026-10-24T03:00:00.000Z' })).toMatchObject({ changed: false });
    expect((await getMailStatus(env.DB, requestId))?.state).toBe('delivered');
    expect(await recordMailWebhook(env.DB, { ...delivered, eventId: 'event-bounced', type: 'email.bounced',
      occurredAt: '2026-10-24T05:00:00.000Z' })).toMatchObject({ changed: true, state: 'bounced' });
    expect((await getMailStatus(env.DB, requestId))?.state).toBe('bounced');
    expect(sqlite.prepare('SELECT activatedAt,expiresAt FROM FullscreenRecoveryRequest WHERE id=?1').get(requestId))
      .toMatchObject({ activatedAt: null, expiresAt: null });
  });

  it('reconciles a signed delivery callback received before the send response supplies its provider ID', async () => {
    const { sqlite, env } = await seeded();
    const preview = await previewFirstReply(env, requestId, 'UTC');
    const prepared = await prepareFirstReply(env, requestId, 'UTC', preview.previewHash, 'operator-1');
    const secretText = 'test-webhook-signing-secret-32-bytes';
    const webhookSecret = `whsec_${btoa(secretText)}`;
    const fetchImpl = vi.fn(async () => {
      const occurredAt = new Date().toISOString();
      const rawBody = JSON.stringify({ type: 'email.delivered', created_at: occurredAt,
        data: { email_id: 'provider-before-response' } });
      const eventId = 'callback-before-send-response';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretText),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key,
        new TextEncoder().encode(`${eventId}.${timestamp}.${rawBody}`)));
      const signature = `v1,${btoa(String.fromCharCode(...bytes))}`;
      const callback = await receiveWebhook({
        request: new Request('https://example.com/api/fullscreen-recovery-webhook', {
          method: 'POST', headers: { 'svix-id': eventId, 'svix-timestamp': timestamp,
            'svix-signature': signature }, body: rawBody,
        }),
        env: { DB: env.DB, RESEND_WEBHOOK_SECRET: webhookSecret },
      } as never);
      expect(callback.status).toBe(200);
      await expect(callback.json()).resolves.toMatchObject({ accepted: true, pending: true });
      expect(sqlite.prepare('SELECT outboxId FROM FullscreenRecoveryMailWebhookReceipt WHERE eventId=?1')
        .get(eventId)).toMatchObject({ outboxId: null });
      return new Response(JSON.stringify({ id: 'provider-before-response' }), { status: 200 });
    });
    const result = await dispatchFirstReply(env, requestId, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: prepared.id, state: 'delivered', providerMessageId: 'provider-before-response' });
    expect(sqlite.prepare('SELECT outboxId FROM FullscreenRecoveryMailWebhookReceipt WHERE eventId=?1')
      .get('callback-before-send-response')).toMatchObject({ outboxId: prepared.id });
    expect(sqlite.prepare('SELECT activatedAt,expiresAt FROM FullscreenRecoveryRequest WHERE id=?1').get(requestId))
      .toMatchObject({ activatedAt: null, expiresAt: null });
  });
});
