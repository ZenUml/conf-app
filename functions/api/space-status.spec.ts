import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/requestUtils', () => ({ getAuthorizationHeader: vi.fn(() => 'valid-fit') }));
vi.mock('../utils/authenticate', () => ({ validateContextToken: vi.fn() }));
vi.mock('../utils/sentry', () => ({ captureError: vi.fn() }));

import { validateContextToken } from '../utils/authenticate';
import { onRequest } from './space-status';

const future = '2035-01-01T00:00:00.000Z';
const active = JSON.stringify({ status: 'active', expiresAt: future });
const fit = (cloudId: string | undefined = 'site-a', forgeAppId = 'lite-id') => ({
  cloudId,
  forgeAppId,
  payload: { principal: 'user-a', context: { cloudId } },
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
  client?: string;
  kv?: Record<string, string | null> | null;
  kvFails?: boolean;
  featureFlagsKv?: Record<string, string | null> | null;
  featureFlagsKvFails?: boolean;
  database?: any;
} = {}) {
  const {
    spaceKey = 'ENG',
    client,
    kv = {},
    kvFails = false,
    featureFlagsKv = null,
    featureFlagsKvFails = false,
    database = db(),
  } = options;
  const kvBinding = kv === null ? undefined : {
    get: vi.fn(async (key: string) => {
      if (kvFails) throw new Error('KV unavailable');
      return kv[key] ?? null;
    }),
  };
  const featureFlagsBinding = featureFlagsKv === null ? undefined : {
    get: vi.fn(async (key: string) => {
      if (featureFlagsKvFails) throw new Error('Feature flags KV unavailable');
      return featureFlagsKv[key] ?? null;
    }),
  };
  const url = new URL('https://api.example.test/api/space-status');
  if (spaceKey) url.searchParams.set('spaceKey', spaceKey);
  if (client) url.searchParams.set('client', client);
  return {
    request: new Request(url, { headers: { Authorization: 'Bearer valid-fit' } }),
    env: {
      ALLOWED_FORGE_APP_IDS: 'lite-id',
      SPACE_LICENSE_KV: kvBinding,
      KV_FEATURE_FLAGS: featureFlagsBinding,
      DB: database ?? undefined,
    },
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

  describe('server-derived paywallExempt (#1164)', () => {
    function domainDb(options: {
      instanceDomain?: string | null;
      installDomain?: string | null;
      paidRail?: boolean;
    } = {}) {
      return {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              if (sql.includes('FROM AtlassianInstance')) {
                return options.instanceDomain ? { clientDomain: options.instanceDomain } : null;
              }
              if (sql.includes('SELECT clientDomain')) {
                return options.installDomain ? { clientDomain: options.installDomain } : null;
              }
              if (sql.includes('SELECT 1 FROM ForgeInstallation')) {
                return options.paidRail ? { 1: 1 } : null;
              }
              return null;
            }),
          })),
        })),
      };
    }

    it('resolves paywallExempt from FIT cloudId -> AtlassianInstance domain and ignores ?client= spoofing', async () => {
      const database = domainDb({ instanceDomain: 'real-tenant.atlassian.net' });
      const { body } = await read({
        client: 'exempt-tenant',
        database,
        featureFlagsKv: {
          PAYWALL_EXEMPTIONS: JSON.stringify({ 'exempt-tenant': true, 'real-tenant': false }),
        },
      });
      expect(body).toEqual({ isPaid: false, decisionKnown: true, paywallExempt: false });
    });

    it('falls back to ForgeInstallation clientDomain when AtlassianInstance has no row', async () => {
      const database = domainDb({ instanceDomain: null, installDomain: 'https://exempt-tenant.atlassian.net' });
      const { body } = await read({
        database,
        featureFlagsKv: {
          PAYWALL_EXEMPTIONS: JSON.stringify({ 'exempt-tenant': true }),
        },
      });
      expect(body).toEqual({ isPaid: false, decisionKnown: true, paywallExempt: true });
    });

    it('honors wildcard "*": true when the trusted clientDomain is resolved', async () => {
      const database = domainDb({ instanceDomain: 'example-tenant' });
      const { body } = await read({
        database,
        featureFlagsKv: {
          PAYWALL_EXEMPTIONS: JSON.stringify({ '*': true }),
        },
      });
      expect(body).toEqual({ isPaid: false, decisionKnown: true, paywallExempt: true });
    });

    it('omits paywallExempt (fail-open) when domain cannot be resolved or PAYWALL_EXEMPTIONS is missing/malformed', async () => {
      const unmappedDb = domainDb({ instanceDomain: null, installDomain: null });
      expect((await read({
        database: unmappedDb,
        featureFlagsKv: { PAYWALL_EXEMPTIONS: JSON.stringify({ '*': false }) },
      })).body).toEqual({ isPaid: false, decisionKnown: true });

      const mappedDb = domainDb({ instanceDomain: 'example-tenant' });
      expect((await read({
        database: mappedDb,
        featureFlagsKv: {},
      })).body).toEqual({ isPaid: false, decisionKnown: true });

      expect((await read({
        database: mappedDb,
        featureFlagsKv: { PAYWALL_EXEMPTIONS: '{"bad": "not-a-boolean"}' },
      })).body).toEqual({ isPaid: false, decisionKnown: true });

      expect((await read({
        database: mappedDb,
        featureFlagsKv: { PAYWALL_EXEMPTIONS: JSON.stringify({ '*': false }) },
        featureFlagsKvFails: true,
      })).body).toEqual({ isPaid: false, decisionKnown: true });
    });
  });
});
