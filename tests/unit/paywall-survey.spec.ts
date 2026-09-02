import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Same three modules space-status.spec.ts stubs: the endpoint's auth is a real
// Forge token verification against Atlassian's JWKS, which a unit test cannot
// and should not reach.
vi.mock('../../functions/utils/requestUtils', () => ({
  getAuthorizationHeader: vi.fn(),
}));

vi.mock('../../functions/utils/authenticate', () => ({
  validateContextToken: vi.fn(),
}));

vi.mock('../../functions/utils/sentry', () => ({
  captureError: vi.fn(),
}));

import { onRequest, rewardExpiresAt } from '../../functions/api/paywall-survey';
import { getAuthorizationHeader } from '../../functions/utils/requestUtils';
import { validateContextToken } from '../../functions/utils/authenticate';

const RESPONSE_ID = '2f1c8b6a-9d31-4e0b-8c77-1a2b3c4d5e6f';
const OTHER_RESPONSE_ID = '3a2b1c0d-4e5f-4a6b-9c8d-7e6f5a4b3c2d';
const CLOUD_ID = 'cloud-abc';
const ACCOUNT_ID = 'user-abc';
const SPACE_KEY = 'ENG';
const SITE_URL = 'https://example-tenant.atlassian.net';

type Row = Record<string, unknown>;

/**
 * Minimal in-memory D1. It interprets the two statements this endpoint issues
 * (the answers UPSERT and the grant-outcome UPDATE) by reading their column
 * lists out of the SQL, so a column added to the endpoint without a matching
 * migration shows up as a wrong row rather than a silently passing test.
 */
class FakeD1 {
  rows = new Map<string, Row>();
  statements: Array<{ sql: string; params: unknown[] }> = [];
  failOnUpdate = false;

  prepare(sql: string) {
    const self = this;
    return {
      bind(...params: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            self.statements.push({ sql, params });
            return (self.rows.get(String(params[0])) as T) ?? null;
          },
          async run() {
            self.statements.push({ sql, params });
            self.apply(sql, params);
            return { success: true };
          },
        };
      },
    };
  }

  private apply(sql: string, params: unknown[]): void {
    if (/^\s*INSERT INTO PaywallSurveyResponse/.test(sql)) {
      const columns = (sql.match(/PaywallSurveyResponse\s*\(([\s\S]*?)\)/) as RegExpMatchArray)[1]
        .split(',')
        .map((c) => c.trim());
      const incoming: Row = {};
      columns.forEach((column, i) => {
        incoming[column] = params[i];
      });
      const responseId = String(incoming.responseId);
      const existing = this.rows.get(responseId);
      if (!existing) {
        this.rows.set(responseId, { grantStatus: null, grantExpiresAt: null, ...incoming });
        return;
      }
      // Only the columns named in DO UPDATE SET are refreshed — identity and
      // createdAt stay put, exactly as the statement says.
      for (const [, column] of sql.matchAll(/(\w+) = excluded\.\w+/g)) {
        existing[column] = incoming[column];
      }
      return;
    }

    if (/^\s*UPDATE PaywallSurveyResponse/.test(sql)) {
      if (this.failOnUpdate) throw new Error('D1 unavailable');
      const where = sql.match(/WHERE (\w+) = \?(\d+)/) as RegExpMatchArray;
      const row = this.rows.get(String(params[Number(where[2]) - 1]));
      if (!row) return;
      const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
      for (const match of setClause.matchAll(/(\w+) = \?(\d+)/g)) {
        row[match[1] as string] = params[Number(match[2]) - 1];
      }
      return;
    }

    throw new Error(`FakeD1 does not know this statement: ${sql}`);
  }
}

class MockKV {
  store = new Map<string, string>();
  putCalls: string[] = [];
  failOnGet = false;

  async get(key: string): Promise<string | null> {
    if (this.failOnGet) throw new Error('KV unavailable');
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.putCalls.push(key);
    this.store.set(key, value);
  }

  _set(key: string, value: unknown): void {
    this.store.set(key, JSON.stringify(value));
  }
}

function completeAnswers(overrides: Record<string, unknown> = {}) {
  return {
    role: 'space_admin',
    priceTooCheap: 50,
    priceBargain: 150,
    priceExpensive: 400,
    priceTooExpensive: 900,
    unitMost: 'per_space_year',
    unitLeast: 'per_diagram',
    blocker: 'admin_approval',
    ...overrides,
  };
}

function createContext(opts: {
  method?: string;
  body?: unknown;
  bodyThrows?: boolean;
  env?: Record<string, unknown>;
}) {
  const request = {
    method: opts.method || 'POST',
    url: 'https://example.com/api/paywall-survey',
    headers: { get: () => null },
    json: async () => {
      if (opts.bodyThrows) throw new Error('not json');
      return opts.body;
    },
  } as unknown as Request;

  return { request, env: opts.env || {} } as never;
}

describe('paywall-survey API', () => {
  let db: FakeD1;
  let kv: MockKV;

  beforeEach(() => {
    db = new FakeD1();
    kv = new MockKV();
    vi.clearAllMocks();
    (getAuthorizationHeader as never as ReturnType<typeof vi.fn>).mockReturnValue('forge-jwt');
    (validateContextToken as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      payload: {
        context: { cloudId: CLOUD_ID, siteUrl: SITE_URL },
        principal: ACCOUNT_ID,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeEnv(extra: Record<string, unknown> = {}) {
    return {
      DB: db as unknown as D1Database,
      SPACE_LICENSE_KV: kv as unknown as KVNamespace,
      ALLOWED_FORGE_APP_IDS: 'test-app-id',
      ...extra,
    };
  }

  function post(body: unknown, env = makeEnv()) {
    return onRequest(createContext({ body, env }));
  }

  function partialBody(overrides: Record<string, unknown> = {}) {
    return {
      responseId: RESPONSE_ID,
      spaceKey: SPACE_KEY,
      macroCount: 137,
      appVersion: 'v2026.09.021030-lite',
      answers: { role: 'editor' },
      submitted: false,
      ...overrides,
    };
  }

  function submitBody(overrides: Record<string, unknown> = {}) {
    return {
      responseId: RESPONSE_ID,
      spaceKey: SPACE_KEY,
      macroCount: 137,
      answers: completeAnswers(),
      submitted: true,
      ...overrides,
    };
  }

  describe('method and auth', () => {
    it('returns 405 for GET', async () => {
      const response = await onRequest(createContext({ method: 'GET', env: makeEnv() }));
      expect(response.status).toBe(405);
      await expect(response.json()).resolves.toMatchObject({ error: 'method_not_allowed' });
    });

    it('returns 401 when no token is presented', async () => {
      (getAuthorizationHeader as never as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const response = await post(partialBody());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: 'unauthorized' });
    });

    it('returns 401 when the verified token carries no principal', async () => {
      (validateContextToken as never as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: { context: { cloudId: CLOUD_ID } },
      });
      const response = await post(partialBody());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: 'missing_principal' });
    });

    it('returns 400 when the verified token carries no cloudId', async () => {
      (validateContextToken as never as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: { context: {}, principal: ACCOUNT_ID },
      });
      const response = await post(partialBody());
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'missing_context' });
    });

    it('returns 500 when a binding is missing', async () => {
      const noDb = await post(partialBody(), makeEnv({ DB: undefined }));
      expect(noDb.status).toBe(500);
      await expect(noDb.json()).resolves.toMatchObject({ error: 'server_configuration' });

      const noKv = await post(partialBody(), makeEnv({ SPACE_LICENSE_KV: undefined }));
      expect(noKv.status).toBe(500);
      await expect(noKv.json()).resolves.toMatchObject({ error: 'server_configuration' });
    });

    it('is allowlisted as a Cloudflare Pages Function route', () => {
      const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8')) as { include: string[] };
      expect(routes.include).toContain('/api/paywall-survey');
    });
  });

  describe('body validation', () => {
    async function expectInvalid(body: unknown, field: string) {
      const response = await post(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid_body', field });
    }

    it('rejects a responseId that is not a lowercase UUID v4', async () => {
      await expectInvalid(partialBody({ responseId: 'not-a-uuid' }), 'responseId');
      await expectInvalid(
        partialBody({ responseId: RESPONSE_ID.toUpperCase() }),
        'responseId'
      );
    });

    it('rejects an empty or oversized spaceKey', async () => {
      await expectInvalid(partialBody({ spaceKey: '' }), 'spaceKey');
      await expectInvalid(partialBody({ spaceKey: 'S'.repeat(256) }), 'spaceKey');
    });

    it('rejects an unknown enum answer', async () => {
      await expectInvalid(partialBody({ answers: { role: 'ceo' } }), 'answers.role');
      await expectInvalid(partialBody({ answers: { unitMost: 'per_seat' } }), 'answers.unitMost');
      await expectInvalid(partialBody({ answers: { blocker: 'vibes' } }), 'answers.blocker');
    });

    it('rejects a price outside 0..1,000,000 or one that is not a whole number', async () => {
      await expectInvalid(partialBody({ answers: { priceBargain: -1 } }), 'answers.priceBargain');
      await expectInvalid(
        partialBody({ answers: { priceTooExpensive: 1_000_001 } }),
        'answers.priceTooExpensive'
      );
      await expectInvalid(partialBody({ answers: { priceExpensive: 12.5 } }), 'answers.priceExpensive');
    });

    it('rejects a comment over 500 characters', async () => {
      await expectInvalid(partialBody({ answers: { comment: 'x'.repeat(501) } }), 'answers.comment');
    });

    it('rejects a macroCount, appVersion, answers block or submitted flag of the wrong shape', async () => {
      await expectInvalid(partialBody({ macroCount: 'lots' }), 'macroCount');
      await expectInvalid(partialBody({ appVersion: 'v'.repeat(65) }), 'appVersion');
      await expectInvalid(partialBody({ answers: 'role=editor' }), 'answers');
      await expectInvalid(partialBody({ submitted: 'yes' }), 'submitted');
    });

    it('rejects a body that is not JSON at all', async () => {
      const response = await onRequest(createContext({ bodyThrows: true, env: makeEnv() }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid_body' });
    });

    it('does not write a row when validation fails', async () => {
      await post(partialBody({ answers: { role: 'ceo' } }));
      expect(db.rows.size).toBe(0);
    });
  });

  describe('partial save', () => {
    it('stores the answers given, nulls the rest, and grants nothing', async () => {
      const response = await post(partialBody());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        responseId: RESPONSE_ID,
        submitted: false,
        grant: 'none',
      });

      const row = db.rows.get(RESPONSE_ID) as Row;
      expect(row.submitted).toBe(0);
      expect(row.role).toBe('editor');
      expect(row.macroCount).toBe(137);
      expect(row.appVersion).toBe('v2026.09.021030-lite');
      expect(row.priceBargain).toBeNull();
      expect(row.unitMost).toBeNull();
      expect(row.blocker).toBeNull();
      expect(row.comment).toBeNull();
      expect(row.grantStatus).toBeNull();
      expect(kv.putCalls).toEqual([]);
    });

    it('overwrites a cleared answer with NULL on the next save', async () => {
      await post(partialBody({ answers: { role: 'editor', priceTooCheap: 40 } }));
      await post(partialBody({ answers: { role: 'editor' } }));

      const row = db.rows.get(RESPONSE_ID) as Row;
      expect(row.priceTooCheap).toBeNull();
      expect(db.rows.size).toBe(1);
    });

    it('derives clientDomain as the bare subdomain of the token siteUrl', async () => {
      await post(partialBody());
      expect((db.rows.get(RESPONSE_ID) as Row).clientDomain).toBe('example-tenant');
    });

    it('stores a null clientDomain when the token carries no siteUrl', async () => {
      (validateContextToken as never as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: { context: { cloudId: CLOUD_ID }, principal: ACCOUNT_ID },
      });
      await post(partialBody());
      expect((db.rows.get(RESPONSE_ID) as Row).clientDomain).toBeNull();
    });

    it('takes cloudId and userAccountId from the token, never the body', async () => {
      await post(
        partialBody({ cloudId: 'cloud-attacker', userAccountId: 'user-attacker' } as never)
      );
      const row = db.rows.get(RESPONSE_ID) as Row;
      expect(row.cloudId).toBe(CLOUD_ID);
      expect(row.userAccountId).toBe(ACCOUNT_ID);
    });
  });

  describe('ownership and immutability', () => {
    it('returns 403 for a responseId owned by another user', async () => {
      db.rows.set(OTHER_RESPONSE_ID, {
        responseId: OTHER_RESPONSE_ID,
        cloudId: CLOUD_ID,
        userAccountId: 'user-someone-else',
        submitted: 0,
      });

      const response = await post(partialBody({ responseId: OTHER_RESPONSE_ID }));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: 'forbidden' });
      expect((db.rows.get(OTHER_RESPONSE_ID) as Row).userAccountId).toBe('user-someone-else');
    });

    it('returns 403 for a responseId owned by another tenant', async () => {
      db.rows.set(OTHER_RESPONSE_ID, {
        responseId: OTHER_RESPONSE_ID,
        cloudId: 'cloud-other',
        userAccountId: ACCOUNT_ID,
        submitted: 0,
      });

      const response = await post(partialBody({ responseId: OTHER_RESPONSE_ID }));
      expect(response.status).toBe(403);
    });

    it('returns 409 on a resubmit and leaves the stored answers alone', async () => {
      await post(submitBody());
      const first = { ...(db.rows.get(RESPONSE_ID) as Row) };

      const response = await post(submitBody({ answers: completeAnswers({ priceBargain: 999 }) }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: 'already_submitted' });
      expect((db.rows.get(RESPONSE_ID) as Row).priceBargain).toBe(first.priceBargain);
    });

    it('returns 409 on a partial save that follows a submit', async () => {
      await post(submitBody());
      const response = await post(partialBody());
      expect(response.status).toBe(409);
    });
  });

  describe('completeness on submit', () => {
    async function expectIncomplete(answers: Record<string, unknown>, fields: string[]) {
      const response = await post(submitBody({ answers }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; fields: string[] };
      expect(body.error).toBe('incomplete');
      expect(body.fields).toEqual(fields);
      // Nothing is stored as submitted, and no license is issued.
      expect(db.rows.get(RESPONSE_ID)).toBeUndefined();
      expect(kv.putCalls).toEqual([]);
    }

    it('lists every missing answer at once', async () => {
      await expectIncomplete(
        { priceTooCheap: 50, priceBargain: 150, priceExpensive: 400, priceTooExpensive: 900 },
        ['role', 'unitMost', 'unitLeast', 'blocker']
      );
    });

    it('lists a missing price', async () => {
      await expectIncomplete(completeAnswers({ priceExpensive: undefined }), ['priceExpensive']);
    });

    it('rejects a non-monotonic price battery', async () => {
      await expectIncomplete(completeAnswers({ priceBargain: 20 }), ['priceBargain']);
      await expectIncomplete(completeAnswers({ priceTooExpensive: 100 }), ['priceTooExpensive']);
    });

    it('rejects the same unit for most and least preferred', async () => {
      await expectIncomplete(completeAnswers({ unitLeast: 'per_space_year' }), ['unitLeast']);
    });
  });

  describe('the 15-day grant', () => {
    const NOW = new Date('2026-09-02T04:15:00.000Z');
    const EXPECTED_EXPIRY = '2026-09-17T23:59:59.000Z';
    const LICENSE_KEY = `license:${CLOUD_ID}:${SPACE_KEY}:${ACCOUNT_ID}`;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    function licenseRecord(overrides: Record<string, unknown> = {}) {
      return {
        cloudId: CLOUD_ID,
        spaceKey: SPACE_KEY,
        userAccountId: ACCOUNT_ID,
        status: 'active',
        activatedBy: 'support:temp-7d-extension',
        expiresAt: '2026-09-05T23:59:59.000Z',
        createdAt: '2026-08-29T00:00:00.000Z',
        updatedAt: '2026-08-29T00:00:00.000Z',
        ...overrides,
      };
    }

    it('(c) writes a user-scoped 15-day license when nothing is in the way', async () => {
      const response = await post(submitBody());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        responseId: RESPONSE_ID,
        submitted: true,
        grant: 'granted',
        expiresAt: EXPECTED_EXPIRY,
      });

      const record = JSON.parse(kv.store.get(LICENSE_KEY) as string);
      expect(record.status).toBe('active');
      expect(record.userAccountId).toBe(ACCOUNT_ID);
      expect(record.expiresAt).toBe(EXPECTED_EXPIRY);
      expect(record.activatedBy).toBe(`survey:pricing-15d:${RESPONSE_ID}`);
      // The space-wide key must never be touched — one user's survey cannot
      // unlock the whole space.
      expect(kv.store.get(`license:${CLOUD_ID}:${SPACE_KEY}`)).toBeUndefined();

      const row = db.rows.get(RESPONSE_ID) as Row;
      expect(row.submitted).toBe(1);
      expect(row.grantStatus).toBe('granted');
      expect(row.grantExpiresAt).toBe(EXPECTED_EXPIRY);
    });

    it('(c) updates the license index exactly once', async () => {
      await post(submitBody());
      expect(kv.putCalls.filter((k) => k === 'license-index')).toHaveLength(1);
      expect(JSON.parse(kv.store.get('license-index') as string)).toEqual([
        { cloudId: CLOUD_ID, spaceKey: SPACE_KEY, userAccountId: ACCOUNT_ID },
      ]);
    });

    it('(c) still grants when an existing grant is shorter than 15 days', async () => {
      kv._set(LICENSE_KEY, licenseRecord({ expiresAt: '2026-09-05T23:59:59.000Z' }));

      const response = await post(submitBody());
      await expect(response.json()).resolves.toMatchObject({ grant: 'granted', expiresAt: EXPECTED_EXPIRY });
      expect(JSON.parse(kv.store.get(LICENSE_KEY) as string).createdAt).toBe('2026-08-29T00:00:00.000Z');
    });

    it('(c) grants over an inactive record that would otherwise run longer', async () => {
      kv._set(LICENSE_KEY, licenseRecord({ status: 'inactive', expiresAt: '2027-01-01T23:59:59.000Z' }));

      const response = await post(submitBody());
      await expect(response.json()).resolves.toMatchObject({ grant: 'granted' });
    });

    it('(b) never shortens a longer active grant', async () => {
      kv._set(LICENSE_KEY, licenseRecord({ expiresAt: '2026-11-01T23:59:59.000Z' }));

      const response = await post(submitBody());
      await expect(response.json()).resolves.toMatchObject({
        grant: 'existing',
        expiresAt: '2026-11-01T23:59:59.000Z',
      });
      expect(kv.putCalls).toEqual([]);
      expect(JSON.parse(kv.store.get(LICENSE_KEY) as string).activatedBy).toBe('support:temp-7d-extension');

      const row = db.rows.get(RESPONSE_ID) as Row;
      expect(row.submitted).toBe(1);
      expect(row.grantStatus).toBe('existing');
      expect(row.grantExpiresAt).toBe('2026-11-01T23:59:59.000Z');
    });

    it('(a) refuses a second survey grant for the same user and space, even once it has lapsed', async () => {
      kv._set(
        LICENSE_KEY,
        licenseRecord({
          status: 'inactive',
          activatedBy: `survey:pricing-15d:${OTHER_RESPONSE_ID}`,
          expiresAt: '2026-08-20T23:59:59.000Z',
        })
      );

      const response = await post(submitBody());
      await expect(response.json()).resolves.toMatchObject({
        grant: 'already_granted',
        expiresAt: '2026-08-20T23:59:59.000Z',
      });
      expect(kv.putCalls).toEqual([]);
      expect((db.rows.get(RESPONSE_ID) as Row).grantStatus).toBe('already_granted');
    });

    it('(a) beats (b): an active survey grant is still once-only', async () => {
      kv._set(
        LICENSE_KEY,
        licenseRecord({
          activatedBy: `survey:pricing-15d:${OTHER_RESPONSE_ID}`,
          expiresAt: '2026-09-10T23:59:59.000Z',
        })
      );

      const response = await post(submitBody());
      await expect(response.json()).resolves.toMatchObject({ grant: 'already_granted' });
    });

    it('records grantStatus error and returns 500 when the license write fails', async () => {
      kv.failOnGet = true;

      const response = await post(submitBody());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ error: 'internal_error' });

      const row = db.rows.get(RESPONSE_ID) as Row;
      expect(row.submitted).toBe(1);
      expect(row.grantStatus).toBe('error');
      expect(row.grantExpiresAt).toBeNull();
    });

    it('rewardExpiresAt lands on the end of the Nth UTC day', () => {
      expect(rewardExpiresAt(new Date('2026-09-02T23:59:59.999Z'), 15)).toBe(EXPECTED_EXPIRY);
      expect(rewardExpiresAt(new Date('2026-12-25T00:00:00.000Z'), 15)).toBe('2027-01-09T23:59:59.000Z');
    });
  });

  describe('free-text handling', () => {
    it('stores the comment on the row but never writes it to the console', async () => {
      const secret = 'we would pay if procurement stopped blocking it';
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {})
      );

      try {
        await post(submitBody({ answers: completeAnswers({ comment: secret }) }));
        // And again on a path that logs: an ownership rejection.
        db.rows.set(OTHER_RESPONSE_ID, {
          responseId: OTHER_RESPONSE_ID,
          cloudId: CLOUD_ID,
          userAccountId: 'user-someone-else',
          submitted: 0,
        });
        await post(
          partialBody({
            responseId: OTHER_RESPONSE_ID,
            answers: { comment: secret },
          })
        );

        expect((db.rows.get(RESPONSE_ID) as Row).comment).toBe(secret);
        const logged = spies.flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args)));
        expect(logged.some((line) => line.includes(secret))).toBe(false);
        expect(logged.some((line) => line.includes(ACCOUNT_ID))).toBe(false);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});
