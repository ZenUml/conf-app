import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/requestUtils', () => ({ getAuthorizationHeader: vi.fn(() => 'valid-fit') }));
vi.mock('../utils/authenticate', () => ({ validateContextToken: vi.fn() }));
vi.mock('../utils/sentry', () => ({ captureError: vi.fn() }));

import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { onRequest } from './space-status';

const future = '2035-01-01T00:00:00.000Z';
const active = JSON.stringify({ status: 'active', expiresAt: future });
const fit = (cloudId: string | undefined = 'site-a') => ({
  cloudId, payload: { principal: 'user-a', context: { cloudId } },
});
function db(result: object | null = null, fail = false) {
  const first = vi.fn(async () => {
    if (fail) throw new Error('D1 unavailable');
    return result;
  });
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })), first };
}
function context(options: {
  spaceKey?: string;
  kv?: Record<string, string | null> | null;
  kvFails?: boolean;
  database?: ReturnType<typeof db> | null;
} = {}) {
  const { spaceKey = 'ENG', kv = {}, kvFails = false, database = db() } = options;
  const kvBinding = kv === null ? undefined : {
    get: vi.fn(async (key: string) => {
      if (kvFails) throw new Error('KV unavailable');
      return kv[key] ?? null;
    }),
  };
  const url = new URL('https://api.example.test/api/space-status');
  if (spaceKey) url.searchParams.set('spaceKey', spaceKey);
  return {
    request: new Request(url, { headers: { Authorization: 'Bearer valid-fit' } }),
    env: { ALLOWED_FORGE_APP_IDS: 'lite-id', SPACE_LICENSE_KV: kvBinding, DB: database ?? undefined },
  } as any;
}
async function read(options: Parameters<typeof context>[0] = {}) {
  const response = await onRequest(context(options));
  return { response, body: await response.json() as Record<string, unknown> };
}

describe('space-status decisionKnown', () => {
  beforeEach(() => {
    vi.mocked(validateContextToken).mockResolvedValue(fit() as any);
  });

  it('rejects bulk requests without a trusted authorization token', async () => {
    const ctx = context()
    ctx.request = new Request('https://api.example.test/api/space-status?spaceKey=ENG&spaceKey=OPS')
    vi.mocked(getAuthorizationHeader).mockReturnValueOnce('')
    expect((await onRequest(ctx)).status).toBe(401)
    vi.mocked(validateContextToken).mockRejectedValueOnce(new Error('invalid signature'))
    expect((await onRequest(ctx)).status).toBe(500)
    expect(ctx.env.SPACE_LICENSE_KV.get).not.toHaveBeenCalled()
  })

  it.each([
    'spaceKey=ENG&spaceKey=bad%20key',
    'spaceKey=ENG&spaceKey=',
    Array.from({ length: 201 }, (_, i) => `spaceKey=S${i}`).join('&'),
  ])('rejects invalid or oversized batches before reading licensing data (%s)', async query => {
    const ctx = context()
    ctx.request = new Request(`https://api.example.test/api/space-status?${query}`, { headers: { Authorization: 'Bearer valid-fit' } })
    expect((await onRequest(ctx)).status).toBe(400)
    expect(ctx.env.SPACE_LICENSE_KV.get).not.toHaveBeenCalled()
  })

  it.each([undefined, { accountId: 'user-a' }])('ignores query identity when the FIT principal is absent or malformed (%s)', async principal => {
    vi.mocked(validateContextToken).mockResolvedValueOnce({ cloudId: 'site-a', payload: { principal, context: { cloudId: 'site-a' } } } as any)
    const ctx = context({ kv: { 'license:site-a:ENG:user-a': active } })
    ctx.request = new Request('https://api.example.test/api/space-status?spaceKey=ENG&spaceKey=OPS&accountId=user-a', { headers: { Authorization: 'Bearer valid-fit' } })
    expect(await (await onRequest(ctx)).json()).toEqual({ statuses: { ENG: { isPaid: false, decisionKnown: true }, OPS: { isPaid: false, decisionKnown: true } } })
    expect(ctx.env.SPACE_LICENSE_KV.get.mock.calls.map((args: string[]) => args[0])).toEqual(['license:site-a:ENG', 'license:site-a:OPS'])
  })

  it('batches space and viewer licenses using trusted FIT identity with one paid-rail read', async () => {
    const database = db(null)
    const ctx = context({ database, kv: { 'license:site-a:PAID': active, 'license:site-a:USER:user-a': active } })
    ctx.request = new Request('https://api.example.test/api/space-status?spaceKey=ENG&spaceKey=PAID&spaceKey=USER&accountId=foreign&cloudId=foreign', { headers: { Authorization: 'Bearer valid-fit' } })
    const response = await onRequest(ctx)
    expect(await response.json()).toEqual({ statuses: {
      ENG: { isPaid: false, decisionKnown: true },
      PAID: { isPaid: true, decisionKnown: true, source: 'space_license' },
      USER: { isPaid: true, decisionKnown: true, source: 'user_license' },
    } })
    expect(database.first).toHaveBeenCalledOnce()
    expect(validateContextToken).toHaveBeenCalledWith('valid-fit', 'lite-id')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps other batch decisions when a row cannot be read', async () => {
    const ctx = context()
    ctx.env.SPACE_LICENSE_KV.get.mockImplementation(async (key: string) => {
      if (key.includes(':BAD')) throw new Error('unreadable')
      return null
    })
    ctx.request = new Request('https://api.example.test/api/space-status?spaceKey=ENG&spaceKey=BAD', { headers: { Authorization: 'Bearer valid-fit' } })
    expect(await (await onRequest(ctx)).json()).toEqual({ statuses: {
      ENG: { isPaid: false, decisionKnown: true },
      BAD: { isPaid: false, decisionKnown: false, error: 'internal_error', message: 'Internal Server Error' },
    } })
  })

  it('reports a confirmed unpaid decision only after KV and D1 reads succeed', async () => {
    const database = db(null);
    const { response, body } = await read({ database });
    expect(response.status).toBe(200);
    expect(body).toEqual({ isPaid: false, decisionKnown: true });
    expect(database.first).toHaveBeenCalledOnce();
  });

  it('reports confirmed paid decisions from user, Space, and paid rail', async () => {
    const userDb = db(null);
    expect((await read({ database: userDb, kv: { 'license:site-a:ENG:user-a': active } })).body)
      .toEqual({ isPaid: true, decisionKnown: true, source: 'user_license' });
    expect(userDb.first).toHaveBeenCalledOnce();
    const spaceDb = db(null);
    expect((await read({ database: spaceDb, kv: { 'license:site-a:ENG': active } })).body)
      .toEqual({ isPaid: true, decisionKnown: true, source: 'space_license' });
    expect(spaceDb.first).toHaveBeenCalledOnce();
    expect((await read({ database: db({ 1: 1 }) })).body)
      .toEqual({ isPaid: true, decisionKnown: true, source: 'paid_rail' });
  });

  it('preserves legacy isPaid while flagging missing DB and D1 failures as unknown', async () => {
    expect((await read({ database: null })).body).toEqual({ isPaid: false, decisionKnown: false });
    expect((await read({ database: db(null, true) })).body).toEqual({ isPaid: false, decisionKnown: false });
    expect((await read({ database: null, kv: { 'license:site-a:ENG': active } })).body)
      .toEqual({ isPaid: true, decisionKnown: false, source: 'space_license' });
    expect((await read({ database: db(null, true), kv: { 'license:site-a:ENG:user-a': active } })).body)
      .toEqual({ isPaid: true, decisionKnown: false, source: 'user_license' });
  });

  it('reports missing cloudId, spaceKey, KV, and KV failures as unknown', async () => {
    vi.mocked(validateContextToken).mockResolvedValueOnce({
      cloudId: undefined, payload: { principal: 'user-a', context: {} },
    } as any);
    expect((await read()).body).toEqual({ isPaid: false, decisionKnown: false });
    expect((await read({ spaceKey: '' })).body).toEqual({ isPaid: false, decisionKnown: false });
    expect((await read({ kv: null })).body).toEqual({ isPaid: false, decisionKnown: false });
    const failed = await read({ kvFails: true });
    expect(failed.response.status).toBe(500);
    expect(failed.body).toEqual({
      isPaid: false, decisionKnown: false, error: 'internal_error', message: 'Internal Server Error',
    });
  });
});

describe('space-status enforcement', () => {
  const LITE = '8ad26115-211f-4216-971b-0540f606303d';
  const policy = JSON.stringify({ effects: { watermark: true }, effectiveAt: '2026-12-08T00:00:00Z' });
  const expired = JSON.stringify({ status: 'active', expiresAt: '2026-11-06T00:00:00.000Z' });

  // SQL-aware D1 fake: domain lookup returns the example tenant; paid-rail hit is switchable.
  function siteDb(paidRail = false) {
    return {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes('SELECT 1 FROM ForgeInstallation')) return paidRail ? { 1: 1 } : null;
            return { clientDomain: 'example-tenant.atlassian.net' };
          }),
        })),
      })),
    };
  }
  async function readEnforced(options: {
    policyRaw?: string | null; count?: number; kv?: Record<string, string>; paidRail?: boolean; now?: string;
    exemptions?: string | null;
  } = {}) {
    const { policyRaw = policy, count = 2282, kv = {}, paidRail = false, now = '2026-12-09T00:00:00Z',
      exemptions = '{}' } = options;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    try {
      const ctx = context({ kv, database: siteDb(paidRail) as any });
      ctx.env.KV_FEATURE_FLAGS = {
        get: vi.fn(async (key: string) => {
          if (key === 'paywall-enforcement:policy:site-a') return policyRaw;
          if (key === 'PAYWALL_EXEMPTIONS') return exemptions;
          return null;
        }),
      };
      ctx.env.confluence_plugin_features = {
        get: vi.fn(async () => ({ spaces: { ENG: { total: count } } })),
      };
      const response = await onRequest(ctx);
      return await response.json() as { enforcement?: any } & Record<string, unknown>;
    } finally { vi.useRealTimers(); }
  }

  beforeEach(() => {
    vi.mocked(validateContextToken).mockResolvedValue({ ...fit(), forgeAppId: LITE } as any);
  });

  it('no policy key: body has no enforcement key', async () => {
    const body = await readEnforced({ policyRaw: null });
    expect(body).toEqual({ isPaid: false, decisionKnown: true });
    expect('enforcement' in body).toBe(false);
  });
  it('watermark in force, count 2282, no licence: enforcement on', async () => {
    const body = await readEnforced();
    expect(body.enforcement.stage).toBe('watermark');
    expect(body.enforcement.effects.watermark).toBe(true);
  });
  it('count 150 on; count 149 and 100 absent', async () => {
    expect((await readEnforced({ count: 150 })).enforcement?.stage).toBe('watermark');
    expect((await readEnforced({ count: 149 })).enforcement).toBeUndefined();
    expect((await readEnforced({ count: 100 })).enforcement).toBeUndefined();
  });
  it('active space licence: absent', async () => {
    const body = await readEnforced({ kv: { 'license:site-a:ENG': active } });
    expect(body.enforcement).toBeUndefined();
    expect(body.isPaid).toBe(true);
  });
  it('expired space licence: present', async () => {
    expect((await readEnforced({ kv: { 'license:site-a:ENG': expired } })).enforcement?.stage).toBe('watermark');
  });
  it('paid-rail hit: absent', async () => {
    const body = await readEnforced({ paidRail: true });
    expect(body.enforcement).toBeUndefined();
    expect(body.source).toBe('paid_rail');
  });
  it('before effectiveAt: notice, watermark off', async () => {
    const body = await readEnforced({ now: '2026-12-01T00:00:00Z' });
    expect(body.enforcement.stage).toBe('notice');
    expect(body.enforcement.effects.watermark).toBe(false);
  });
  // Spec end-to-end examples 7, 9, 10 and 13 at the endpoint.
  it('example 7: user licence covers that viewer only', async () => {
    const kv = { 'license:site-a:ENG:user-a': active };
    const covered = await readEnforced({ kv });
    expect(covered.enforcement).toBeUndefined();
    expect(covered.isPaid).toBe(true);
    vi.mocked(validateContextToken).mockResolvedValue({
      cloudId: 'site-a', payload: { principal: 'user-b', context: { cloudId: 'site-a' } }, forgeAppId: LITE,
    } as any);
    expect((await readEnforced({ kv })).enforcement?.stage).toBe('watermark');
  });
  it('example 9: site domain or wildcard exempt: absent', async () => {
    expect((await readEnforced({ exemptions: '{"example-tenant":true}' })).enforcement).toBeUndefined();
    expect((await readEnforced({ exemptions: '{"*":true}' })).enforcement).toBeUndefined();
    expect((await readEnforced({ exemptions: '{"another-tenant":true}' })).enforcement?.stage).toBe('watermark');
  });
  it('example 10: exemption key absent or unreadable: absent, body otherwise unchanged', async () => {
    for (const exemptions of [null, 'not json']) {
      expect(await readEnforced({ exemptions })).toEqual({ isPaid: false, decisionKnown: true });
    }
  });
  it('example 13: not the Lite app: absent', async () => {
    vi.mocked(validateContextToken).mockResolvedValue({ ...fit(), forgeAppId: 'full-app-id' } as any);
    expect(await readEnforced()).toEqual({ isPaid: false, decisionKnown: true });
  });
});
