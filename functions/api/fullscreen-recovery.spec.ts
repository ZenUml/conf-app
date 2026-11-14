import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../service/fullscreenRecoveryService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../service/fullscreenRecoveryService')>(),
  createRecoveryRequest: vi.fn(),
}));
import { createRecoveryRequest } from '../service/fullscreenRecoveryService';
import { onRequestPost } from './fullscreen-recovery';

const fit = { cloudId: 'cloud-abc-123', accountId: 'user-a', forgeAppId: '8ad26115-211f-4216-971b-0540f606303d' };
const body = {
  action: 'request', attemptId: '34307364-d627-453f-948f-3cf183955a81', scenarios: ['present', 'discuss'],
  note: 'private context for support', email: 'person@example.test', consent: true,
  consentVersion: 'fullscreen-contact-v1', spaceKey: 'ENG',
};
const requestId = '11111111-2222-4333-8444-555555555555';
const snapshot = {
  state: 'pending_activation', serverNow: '2026-11-13T07:08:10.000Z', policyVersion: 'fullscreen-contact-v1',
  request: { id: requestId, scenarios: ['present', 'discuss'], email: 'person@example.test',
    note: 'private context for support', createdAt: '2026-11-13T07:08:09.000Z' },
  grant: { id: 'grant-1', activatedAt: null, expiresAt: null },
};
const resendEnv = { RESEND_API_KEY: 're_test_key', RESEND_FROM: 'ZenUML Support <support@example.test>', RESEND_REPLY_TO: 'support@example.test' };

function call(env: object, waited: Promise<unknown>[]) {
  return onRequestPost({
    request: new Request('https://example.test/api/fullscreen-recovery', { method: 'POST', body: JSON.stringify(body) }),
    env, data: { forgeContext: fit }, waitUntil: (p: Promise<unknown>) => { waited.push(p); },
  } as never);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('POST /api/fullscreen-recovery request notification', () => {
  it('queues one internal email through waitUntil and does not make the customer wait for it', async () => {
    vi.mocked(createRecoveryRequest).mockResolvedValue({ outcome: 'created', snapshot } as never);
    let release!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const waited: Promise<unknown>[] = [];
    const response = await call(resendEnv, waited); // resolves while Resend has not answered
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'created', snapshot });
    expect(waited.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const mail = JSON.parse(String(init.body));
    expect(mail.to).toEqual(['support@example.test']);
    const content = mail.subject + mail.text + mail.html;
    for (const part of ['cloud-abc-123', 'ENG', requestId, 'present', 'discuss', '2026-11-13 07:08:09 UTC',
      'node scripts/fullscreen-recovery-support.mjs list']) expect(content).toContain(part);
    expect(content).not.toContain('person@example.test');
    expect(content).not.toContain('private context for support');
    release(new Response('{"id":"r1"}', { status: 200 }));
    await Promise.all(waited);
  });

  it('looks up the site name inside waitUntil: the response does not wait for the DB, the mail carries the name', async () => {
    vi.mocked(createRecoveryRequest).mockResolvedValue({ outcome: 'created', snapshot } as never);
    let resolveRow!: (row: { clientDomain: string }) => void;
    const first = vi.fn(() => new Promise((resolve) => { resolveRow = resolve as never; }));
    const DB = { prepare: () => ({ bind: () => ({ first }) }) };
    const fetchMock = vi.fn(async () => new Response('{"id":"r1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const waited: Promise<unknown>[] = [];
    const response = await call({ ...resendEnv, DB }, waited); // resolves while the lookup is still pending
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'created', snapshot });
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    expect(first).toHaveBeenCalledWith();
    resolveRow({ clientDomain: 'Example-Site.atlassian.net' });
    await Promise.all(waited);
    const mail = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(mail.subject).toBe('Fullscreen recovery request — example-site / ENG (11111111)');
    expect(mail.text).toContain('cloud-abc-123');
  });

  it.each(['reused', 'activated', 'already_active'])('sends no email when the outcome is %s', async (outcome) => {
    vi.mocked(createRecoveryRequest).mockResolvedValue({ outcome, snapshot } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const waited: Promise<unknown>[] = [];
    const response = await call(resendEnv, waited);
    await Promise.all(waited);
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Resend error status', () => vi.fn(async () => new Response('{}', { status: 500 }))],
    ['fetch throws', () => vi.fn(async () => { throw new Error('boom'); })],
  ])('keeps the customer response identical when %s', async (_name, makeFetch) => {
    vi.mocked(createRecoveryRequest).mockResolvedValue({ outcome: 'created', snapshot } as never);
    vi.stubGlobal('fetch', makeFetch());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const waited: Promise<unknown>[] = [];
    const response = await call(resendEnv, waited);
    await expect(Promise.all(waited)).resolves.toBeDefined();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'created', snapshot });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/person@example\.test|private context|support@example\.test/);
  });

  it('sends nothing, does not throw and warns once when the Resend sender is not configured', async () => {
    vi.mocked(createRecoveryRequest).mockResolvedValue({ outcome: 'created', snapshot } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const waited: Promise<unknown>[] = [];
    const response = await call({ RESEND_REPLY_TO: 'support@example.test' }, waited);
    await Promise.all(waited);
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
