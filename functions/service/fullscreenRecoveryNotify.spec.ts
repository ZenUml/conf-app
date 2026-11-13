import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notifyFullscreenRecoveryRequest, renderRequestNotification, type RequestNotification,
} from './fullscreenRecoveryNotify';

const details: RequestNotification = {
  requestId: '11111111-2222-4333-8444-555555555555',
  cloudId: 'cloud-abc-123',
  spaceKey: 'ENG',
  scenarios: ['present', 'discuss'],
  hasNote: true,
  createdAt: '2026-11-13T07:08:09.000Z',
};
const env = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'ZenUML Support <support@example.test>',
  RESEND_REPLY_TO: 'support@example.test',
};

afterEach(() => vi.restoreAllMocks());

describe('renderRequestNotification', () => {
  it('names the site, space, request, scenarios, note flag, UTC time and the list command', () => {
    const mail = renderRequestNotification(details);
    for (const part of ['cloud-abc-123', 'ENG', details.requestId, 'present', 'discuss',
      '2026-11-13 07:08:09 UTC', 'node scripts/fullscreen-recovery-support.mjs list']) {
      expect(mail.subject + mail.text).toContain(part);
    }
    expect(mail.subject).toContain('cloud-abc-123');
    expect(mail.text).toMatch(/note: yes/i);
    expect(mail.html).toContain('node scripts/fullscreen-recovery-support.mjs list');
  });

  it('says when no note was given and never takes requester email or note text as input', () => {
    const mail = renderRequestNotification({ ...details, hasNote: false });
    expect(mail.text).toMatch(/note: no/i);
    // The type has no email or note field; extra runtime fields must not leak either.
    const leaky = renderRequestNotification({ ...details, email: 'person@example.test', note: 'secret note text' } as never);
    expect(leaky.subject + leaky.text + leaky.html).not.toMatch(/person@example\.test|secret note text/);
  });

  it('escapes markup in html', () => {
    const mail = renderRequestNotification({ ...details, spaceKey: '<b>x</b>' });
    expect(mail.html).not.toContain('<b>x</b>');
  });
});

describe('notifyFullscreenRecoveryRequest', () => {
  it('sends one Resend email to RESEND_REPLY_TO with an idempotency key from the request id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }));
    await notifyFullscreenRecoveryRequest(env, details, fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Idempotency-Key']).toBe(`fullscreen-recovery-notify:${details.requestId}`);
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['support@example.test']);
    expect(body.from).toBe(env.RESEND_FROM);
    expect(body.subject).toContain(details.requestId.slice(0, 8));
  });

  it('prefers FULLSCREEN_RECOVERY_NOTIFY_TO over RESEND_REPLY_TO', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"r"}', { status: 200 }));
    await notifyFullscreenRecoveryRequest({ ...env, FULLSCREEN_RECOVERY_NOTIFY_TO: 'owner@example.test' }, details, fetchImpl as never);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).to).toEqual(['owner@example.test']);
  });

  it.each([
    ['RESEND_API_KEY', { ...env, RESEND_API_KEY: undefined }],
    ['RESEND_FROM', { ...env, RESEND_FROM: undefined }],
    ['recipient', { ...env, RESEND_REPLY_TO: undefined }],
    ['invalid recipient', { ...env, RESEND_REPLY_TO: 'not-an-email' }],
  ])('sends nothing and warns once when %s is missing', async (_name, config) => {
    const fetchImpl = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(notifyFullscreenRecoveryRequest(config as never, details, fetchImpl as never)).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns without personal data and does not throw when Resend returns an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('{"message":"bad"}', { status: 422 }));
    await expect(notifyFullscreenRecoveryRequest(env, details, fetchImpl as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('resend_http_422');
    expect(logged).not.toContain('support@example.test');
    expect(logged).not.toContain('re_test_key');
  });

  it('warns and does not throw when fetch throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => { throw new Error('network down support@example.test'); });
    await expect(notifyFullscreenRecoveryRequest(env, details, fetchImpl as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('support@example.test');
  });
});
