import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../functions/utils/requestUtils', () => ({
  getAuthorizationHeader: vi.fn(),
}));
vi.mock('../../functions/utils/authenticate', () => ({
  validateContextToken: vi.fn(),
}));
vi.mock('../../functions/utils/sentry', () => ({
  captureError: vi.fn(),
}));

import { onRequest } from '../../functions/api/notify-admin';
import { getAuthorizationHeader } from '../../functions/utils/requestUtils';
import { validateContextToken } from '../../functions/utils/authenticate';

class MockKV {
  store = new Map<string, string>();
  get = vi.fn(async (k: string) => this.store.get(k) ?? null);
  put = vi.fn(async (k: string, v: string, _opts?: { expirationTtl?: number }) => {
    this.store.set(k, v);
  });
}

function createMockContext(overrides: { method?: string; body?: any; headers?: Record<string, string>; env?: any }) {
  const headers = overrides.headers ?? {};
  const request = new Request('https://example.com/api/notify-admin', {
    method: overrides.method ?? 'POST',
    body: overrides.body !== undefined ? JSON.stringify(overrides.body) : undefined,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  return { request, env: overrides.env ?? {} } as any;
}

const fetchMock = vi.fn();

describe('POST /api/notify-admin', () => {
  let kv: MockKV;
  beforeEach(() => {
    kv = new MockKV();
    vi.clearAllMocks();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as any;
    (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
    (validateContextToken as any).mockResolvedValue({
      payload: { context: { cloudId: 'cloud-1', accountId: 'requester-1' } },
    });
  });

  function makeEnv(extra: any = {}) {
    return {
      MACRO_AUTHORSHIP_KV: kv as unknown as KVNamespace,
      ALLOWED_FORGE_APP_IDS: 'test-app-id',
      ...extra,
    };
  }

  it('rejects non-POST requests with 405', async () => {
    const ctx = createMockContext({ method: 'GET', env: makeEnv() });
    const res = await onRequest(ctx);
    expect(res.status).toBe(405);
  });

  it('rejects requests without Authorization header with 401', async () => {
    (getAuthorizationHeader as any).mockReturnValue(null);
    const ctx = createMockContext({ body: { spaceKey: 'ENG' }, env: makeEnv() });
    const res = await onRequest(ctx);
    expect(res.status).toBe(401);
  });

  it('rejects when ALLOWED_FORGE_APP_IDS is not set', async () => {
    const ctx = createMockContext({
      body: { spaceKey: 'ENG' },
      env: { MACRO_AUTHORSHIP_KV: kv as unknown as KVNamespace },
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(401);
  });

  it('rejects when token validation throws with 401', async () => {
    (validateContextToken as any).mockRejectedValue(new Error('bad token'));
    const ctx = createMockContext({ body: { spaceKey: 'ENG' }, env: makeEnv() });
    const res = await onRequest(ctx);
    expect(res.status).toBe(401);
  });

  it('rejects when spaceKey is missing with 400', async () => {
    const ctx = createMockContext({ body: {}, env: makeEnv() });
    const res = await onRequest(ctx);
    expect(res.status).toBe(400);
  });

  it('rejects when JSON body is malformed with 400', async () => {
    const request = new Request('https://example.com/api/notify-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    });
    const res = await onRequest({ request, env: makeEnv() } as any);
    expect(res.status).toBe(400);
  });

  it('returns notified=true on first successful call (admins resolved + send attempted)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        results: [{ operation: { operation: 'administer' }, subjects: { user: { accountId: 'admin-1' } } }],
      }), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 })); // notification post

    const ctx = createMockContext({
      body: { spaceKey: 'ENG', requesterDisplayName: 'Alice' },
      env: makeEnv(),
    });
    const res = await onRequest(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(true);
    expect(body.adminCount).toBe(1);
  });

  it('rate-limits a second call within the 7-day window', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        results: [{ operation: { operation: 'administer' }, subjects: { user: { accountId: 'admin-1' } } }],
      }), { status: 200 })
    );
    const env = makeEnv();
    await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env }));
    const res = await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(false);
    expect(body.reason).toBe('rate_limited');
  });

  it('writes a 7-day TTL on the rate-limit key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        results: [{ operation: { operation: 'administer' }, subjects: { user: { accountId: 'admin-1' } } }],
      }), { status: 200 })
    );
    await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env: makeEnv() }));
    const putCalls = (kv.put as any).mock.calls;
    const rlCall = putCalls.find((c: any[]) => c[0]?.startsWith('notify_rl:'));
    expect(rlCall).toBeDefined();
    expect(rlCall[2]).toEqual({ expirationTtl: 7 * 24 * 60 * 60 });
  });

  it('returns notified=false reason=no_admins when admin lookup yields no admins', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const res = await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env: makeEnv() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(false);
    expect(body.reason).toBe('no_admins');
    expect(body.adminCount).toBe(0);
  });

  it('returns notified=false reason=no_admins when admin lookup throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const res = await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env: makeEnv() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(false);
    expect(body.reason).toBe('no_admins');
  });

  it('survives notification-send failures and still reports notified=true', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        results: [{ operation: { operation: 'administer' }, subjects: { user: { accountId: 'admin-1' } } }],
      }), { status: 200 })
    );
    fetchMock.mockRejectedValueOnce(new Error('notify failed'));
    const res = await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env: makeEnv() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(true);
  });

  it('still rate-limits even if the first call had no admins (so we do not retry endlessly)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const env = makeEnv();
    await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env }));
    const res = await onRequest(createMockContext({ body: { spaceKey: 'ENG' }, env }));
    const body = await res.json();
    expect(body.reason).toBe('rate_limited');
  });
});
