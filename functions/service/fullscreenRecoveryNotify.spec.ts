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

const FORGE_APP = '8ad26115-211f-4216-971b-0540f606303d';
/** Fake D1: `rows` maps a table name found in the SQL to the first() result, or an Error to throw. */
function fakeDb(rows: Record<string, { clientDomain: string } | null | Error>) {
  return {
    prepare(sql: string) {
      const table = sql.includes('AtlassianInstance') ? 'AtlassianInstance' : 'ForgeInstallation';
      return { bind() { return { first: async () => {
        const row = rows[table];
        if (row instanceof Error) throw row;
        return row ?? null;
      } }; } };
    },
  } as never;
}
const withApp = { ...details, forgeAppId: FORGE_APP };
const okFetch = () => vi.fn(async () => new Response('{"id":"r"}', { status: 200 }));
const sent = (f: ReturnType<typeof okFetch>) => JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));

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

describe('renderRequestNotification with a site name', () => {
  it('puts the site name in the subject and body and keeps the cloudId in the body', () => {
    const mail = renderRequestNotification({ ...details, siteName: 'example-site' });
    expect(mail.subject).toBe('Fullscreen recovery request — example-site / ENG (11111111)');
    expect(mail.text).toContain('Site: example-site');
    expect(mail.text).toContain('cloud-abc-123');
    expect(mail.subject).not.toContain('cloud-abc-123');
  });
  it('HTML-escapes the site name', () => {
    const mail = renderRequestNotification({ ...details, siteName: '<b>x</b>' });
    expect(mail.html).not.toContain('<b>x</b>');
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('notifyFullscreenRecoveryRequest site name lookup', () => {
  it('uses the normalized AtlassianInstance clientDomain for the cloudId', async () => {
    const fetchImpl = okFetch();
    await notifyFullscreenRecoveryRequest({ ...env, DB: fakeDb({ AtlassianInstance: { clientDomain: 'Example-Site.atlassian.net' } }) },
      withApp, fetchImpl as never);
    const mail = sent(fetchImpl);
    expect(mail.subject).toBe('Fullscreen recovery request — example-site / ENG (11111111)');
    expect(mail.text).toContain('Site: example-site');
    expect(mail.text).toContain('cloud-abc-123');
  });
  it('falls back to the ForgeInstallation domain when AtlassianInstance has no row', async () => {
    const fetchImpl = okFetch();
    await notifyFullscreenRecoveryRequest({ ...env, DB: fakeDb({ AtlassianInstance: null, ForgeInstallation: { clientDomain: 'other-site.atlassian.net' } }) },
      withApp, fetchImpl as never);
    expect(sent(fetchImpl).subject).toContain('other-site / ENG');
  });
  it('keeps the cloudId subject and still sends when no row is found', async () => {
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyFullscreenRecoveryRequest({ ...env, DB: fakeDb({}) }, withApp, fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sent(fetchImpl).subject).toBe('Fullscreen recovery request — cloud-abc-123 / ENG (11111111)');
    expect(warn).not.toHaveBeenCalled();
  });
  it('keeps the cloudId subject and still sends when there is no DB binding', async () => {
    const fetchImpl = okFetch();
    await notifyFullscreenRecoveryRequest(env, withApp, fetchImpl as never);
    expect(sent(fetchImpl).subject).toContain('cloud-abc-123 / ENG');
  });
  it('falls back to the cloudId, still sends, and warns once without personal data when the lookup throws', async () => {
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyFullscreenRecoveryRequest({ ...env, DB: fakeDb({ AtlassianInstance: new Error('D1 down example-site') }) },
      withApp, fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sent(fetchImpl).subject).toContain('cloud-abc-123 / ENG');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain('site_lookup_failed');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example-site|support@example\.test/);
  });
  it('ignores a malformed stored domain instead of putting it in the mail', async () => {
    const fetchImpl = okFetch();
    await notifyFullscreenRecoveryRequest({ ...env, DB: fakeDb({ AtlassianInstance: { clientDomain: '<b>x</b>.atlassian.net' } }) },
      withApp, fetchImpl as never);
    const mail = sent(fetchImpl);
    expect(mail.subject + mail.text + mail.html).not.toContain('<b>x</b>');
    expect(mail.subject).toContain('cloud-abc-123');
  });
  it('does not look up the site when mail is not configured', async () => {
    const prepare = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyFullscreenRecoveryRequest({ ...env, RESEND_API_KEY: undefined, DB: { prepare } as never }, withApp, vi.fn() as never);
    expect(prepare).not.toHaveBeenCalled();
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
