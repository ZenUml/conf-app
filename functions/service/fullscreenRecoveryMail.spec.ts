import { describe, expect, it, vi } from 'vitest';
import { renderFirstReply, sendResendFirstReply } from './fullscreenRecoveryMail';
import { parseMailWebhook, recordMailWebhook, verifyMailWebhook } from './fullscreenRecoveryMailWebhook';

const common = {
  requestId: 'e8fb9193-a89a-423c-8394-cb8a44fc2660',
  scenarios: ['inspect_details', 'present'],
  timeZone: 'Australia/Melbourne',
  from: 'ZenUML Support <support@example.com>',
  replyTo: 'support@example.com',
  now: new Date('2026-10-24T04:00:00.000Z'),
};

describe('requester first reply', () => {
  it('acknowledges chosen scenes and pending activation without repeating form questions', () => {
    const reply = renderFirstReply({ ...common, activatedAt: null, expiresAt: null });
    expect(reply.text).toContain('inspect diagram details, present a diagram');
    expect(reply.text).toContain('begin when you first open');
    expect(reply.text).toContain('do not need to reply just to confirm receipt');
    expect(reply.text).not.toMatch(/pricing|Enterprise Bundle|administrator|opened|clicked/i);
    expect(reply.html).not.toMatch(/<img|tracking|<script/i);
    const htmlParagraphs = Array.from(new DOMParser().parseFromString(reply.html, 'text/html').querySelectorAll('p'),
      paragraph => paragraph.textContent);
    expect(htmlParagraphs).toEqual(reply.text.split('\n\n'));
  });

  it('states an exact local expiry for active and expired access', () => {
    const active = renderFirstReply({ ...common, activatedAt: '2026-10-23T04:00:00.000Z',
      expiresAt: '2026-10-30T04:00:00.000Z' });
    expect(active.text).toMatch(/active until .*2026.*Australia\/Melbourne/);
    const expired = renderFirstReply({ ...common, activatedAt: '2026-10-16T04:00:00.000Z',
      expiresAt: '2026-10-23T04:00:00.000Z' });
    expect(expired.text).toContain('expired at');
    expect(expired.text).not.toContain('active until');
  });

  it('escapes untrusted identifiers and rejects an invalid zone', () => {
    const reply = renderFirstReply({ ...common, requestId: '<script>x</script>', activatedAt: null, expiresAt: null });
    expect(reply.html).not.toContain('<script>');
    expect(reply.html).toContain('&lt;script&gt;');
    expect(() => renderFirstReply({ ...common, timeZone: 'invalid/zone', activatedAt: null, expiresAt: null }))
      .toThrow('invalid_time_zone');
  });
});

describe('Resend sender', () => {
  const email = renderFirstReply({ ...common, activatedAt: null, expiresAt: null });
  it('sends only the consented recipient with frozen text and a stable provider key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }));
    await expect(sendResendFirstReply({ apiKey: 'test-key', recipient: 'requester@example.com',
      id: 'outbox-1', email, fetchImpl })).resolves.toBe('provider-1');
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(request.headers['Idempotency-Key']).toBe('outbox-1');
    expect(JSON.parse(request.body)).toEqual({ from: email.from, to: ['requester@example.com'],
      reply_to: email.replyTo, subject: email.subject, text: email.text, html: email.html });
  });

  it('classifies unknown outcomes separately from definite rate limits', async () => {
    await expect(sendResendFirstReply({ apiKey: 'test-key', recipient: 'requester@example.com',
      id: 'outbox-1', email, fetchImpl: vi.fn().mockRejectedValue(new Error('network')) }))
      .rejects.toMatchObject({ code: 'resend_network_unknown', resultUnknown: true, retryable: false });
    await expect(sendResendFirstReply({ apiKey: 'test-key', recipient: 'requester@example.com',
      id: 'outbox-1', email, fetchImpl: vi.fn().mockResolvedValue(new Response('rate limit', { status: 429 })) }))
      .rejects.toMatchObject({ code: 'resend_http_429', resultUnknown: false, retryable: true });
    await expect(sendResendFirstReply({ apiKey: 'test-key', recipient: 'requester@example.com',
      id: 'outbox-1', email, fetchImpl: vi.fn().mockResolvedValue(new Response('unknown', { status: 503 })) }))
      .rejects.toMatchObject({ code: 'resend_http_503', resultUnknown: true, retryable: false });
  });
});

describe('signed lifecycle webhook', () => {
  const secret = `whsec_${btoa('test-secret-with-at-least-24-bytes')}`;
  const rawBody = JSON.stringify({ type: 'email.delivered', created_at: '2026-10-24T04:00:00.000Z',
    data: { email_id: 'provider-1', to: ['requester@example.com'] } });
  it('verifies the untouched body and rejects replay with an old timestamp', async () => {
    const timestamp = String(Math.floor(Date.parse('2026-10-24T04:00:00.000Z') / 1000));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret-with-at-least-24-bytes'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`event-1.${timestamp}.${rawBody}`));
    const signature = `v1,${btoa(String.fromCharCode(...new Uint8Array(signed)))}`;
    const options = { rawBody, id: 'event-1', timestamp, signature, secret,
      now: new Date('2026-10-24T04:00:00.000Z') };
    await expect(verifyMailWebhook(options)).resolves.toBe('event-1');
    await expect(verifyMailWebhook({ ...options, rawBody: rawBody + ' ' })).rejects.toThrow('invalid_signature');
    await expect(verifyMailWebhook({ ...options, now: new Date('2026-10-24T04:10:00.000Z') }))
      .rejects.toThrow('stale_signature');
  });

  it('ignores clicks and reads only known delivery states', () => {
    expect(parseMailWebhook(JSON.parse(rawBody))).toMatchObject({ type: 'email.delivered', providerMessageId: 'provider-1' });
    expect(parseMailWebhook({ type: 'email.clicked', created_at: '2026-10-24T04:00:00Z',
      data: { email_id: 'provider-1' } })).toBeNull();
  });

  it('deduplicates provider events and never touches the grant table', async () => {
    const receipts = new Set<string>();
    let state = 'accepted';
    const sqlUsed: string[] = [];
    const db = {
      prepare(sql: string) {
        sqlUsed.push(sql);
        return { bind: (...args: unknown[]) => ({
          first: async () => sql.includes('WHERE providerMessageId') ? { id: 'outbox-1', requestId: common.requestId } : null,
          sql, args,
        }) };
      },
      async batch(statements: Array<{ sql: string; args: unknown[] }>) {
        const id = String(statements[0].args[0]);
        const replay = receipts.has(id);
        if (!replay) { receipts.add(id); state = String(statements[1].args[0]); }
        return [{ meta: { changes: replay ? 0 : 1 } }, { meta: { changes: replay ? 0 : 1 } }];
      },
    } as unknown as D1Database;
    const event = parseMailWebhook(JSON.parse(rawBody))!;
    const first = await recordMailWebhook(db, { ...event, eventId: 'event-1' });
    const duplicate = await recordMailWebhook(db, { ...event, eventId: 'event-1' });
    expect(first).toMatchObject({ changed: true, state: 'delivered' });
    expect(duplicate).toMatchObject({ replay: true, changed: false });
    expect(state).toBe('delivered');
    expect(sqlUsed.join(' ')).not.toContain('FullscreenRecoveryRequest');
  });
});
