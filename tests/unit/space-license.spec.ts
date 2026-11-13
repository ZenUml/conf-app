import { describe, expect, it, vi, beforeEach } from 'vitest';

// We test the handler logic by importing the module and calling onRequest directly.
// Since Cloudflare Pages Functions export onRequest, we import it and call with mocked context.

// Mock KV namespace
class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Mirrors Workers KV: lexicographic keys, at most `limit` (default and max
  // 1000) per call, an opaque cursor, and list_complete on the last page.
  async list(options: { prefix?: string; cursor?: string | null; limit?: number } = {}) {
    const limit = Math.min(options.limit ?? 1000, 1000);
    const all = [...this.store.keys()]
      .filter((k) => k.startsWith(options.prefix ?? ''))
      .sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = all.slice(start, start + limit);
    const end = start + page.length;
    const complete = end >= all.length;
    return {
      keys: page.map((name) => ({ name })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(end) }),
    };
  }

  // Helper for tests
  _getStore() {
    return this.store;
  }
}

function createMockContext(overrides: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  env?: any;
}) {
  const method = overrides.method || 'GET';
  const url = overrides.url || 'https://example.com/api/space-license';
  const headers = new Headers(overrides.headers || {});

  const request = {
    method,
    url,
    headers,
    json: async () => overrides.body,
  } as unknown as Request;

  const env = overrides.env || {};

  return { request, env } as any;
}

// Import the module
import { onRequest } from '../../functions/api/space-license';

describe('space-license API', () => {
  let kv: MockKV;
  const ADMIN_SECRET = 'test-admin-secret-123';

  beforeEach(() => {
    kv = new MockKV();
  });

  function makeEnv() {
    return {
      SPACE_LICENSE_KV: kv as unknown as KVNamespace,
      ADMIN_API_SECRET: ADMIN_SECRET,
    };
  }

  function authHeaders() {
    return { Authorization: `Bearer ${ADMIN_SECRET}` };
  }

  describe('authentication', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const ctx = createMockContext({
        method: 'GET',
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 when Bearer token is incorrect', async () => {
      const ctx = createMockContext({
        method: 'GET',
        headers: { Authorization: 'Bearer wrong-secret' },
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(401);
    });

    it('returns 401 when Authorization header has wrong format', async () => {
      const ctx = createMockContext({
        method: 'GET',
        headers: { Authorization: 'Basic abc123' },
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(401);
    });

    it('returns 500 when ADMIN_API_SECRET is not configured', async () => {
      const ctx = createMockContext({
        method: 'GET',
        headers: authHeaders(),
        env: { SPACE_LICENSE_KV: kv, ADMIN_API_SECRET: '' },
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('server_configuration');
    });
  });

  describe('POST /api/space-license', () => {
    it('creates a new license record', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENGINEERING',
          expiresAt: '2027-04-06T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });

      const response = await onRequest(ctx);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.cloudId).toBe('cloud-123');
      expect(body.spaceKey).toBe('ENGINEERING');
      expect(body.status).toBe('active');
      expect(body.activatedBy).toBe('ops-jane');
      expect(body.expiresAt).toBe('2027-04-06T00:00:00Z');
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it('creates a license with optional paymentReference', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-04-06T00:00:00Z',
          activatedBy: 'stripe-webhook',
          paymentReference: 'pi_3abc123',
        },
      });

      const response = await onRequest(ctx);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.paymentReference).toBe('pi_3abc123');
    });

    it('upserts an existing license (reactivates)', async () => {
      // Create initial
      const ctx1 = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });
      await onRequest(ctx1);

      // Upsert with new expiry
      const ctx2 = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2028-01-01T00:00:00Z',
          activatedBy: 'ops-bob',
        },
      });
      const response = await onRequest(ctx2);
      expect(response.status).toBe(200); // existing record updated

      const body = await response.json();
      expect(body.expiresAt).toBe('2028-01-01T00:00:00Z');
      expect(body.activatedBy).toBe('ops-bob');
      expect(body.status).toBe('active');
    });

    it('returns 400 when required fields are missing', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: { cloudId: 'cloud-123' },
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('missing_fields');
    });

    it('returns 400 when expiresAt is invalid', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: 'not-a-date',
          activatedBy: 'ops-jane',
        },
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('invalid_date');
    });

    it('updates the index on creation', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });
      await onRequest(ctx);

      expect(await kv.get('license-index')).toBeNull();
      expect(await kv.get('license:cloud-123:ENG')).not.toBeNull();
    });

    it('upserting twice writes one record and still no license-index', async () => {
      const makeCtx = () =>
        createMockContext({
          method: 'POST',
          headers: authHeaders(),
          env: makeEnv(),
          body: {
            cloudId: 'cloud-123',
            spaceKey: 'ENG',
            expiresAt: '2027-01-01T00:00:00Z',
            activatedBy: 'ops-jane',
          },
        });

      await onRequest(makeCtx());
      await onRequest(makeCtx());

      expect(await kv.get('license-index')).toBeNull();
      expect([...kv._getStore().keys()]).toEqual(['license:cloud-123:ENG']);
    });
  });

  describe('POST /api/space-license — user-scoped extension', () => {
    it('writes a user-scoped key when userAccountId is provided', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-04-06T00:00:00Z',
          activatedBy: 'support:temp-14d-extension',
          userAccountId: 'user-abc',
        },
      });

      const response = await onRequest(ctx);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.userAccountId).toBe('user-abc');

      const raw = await kv.get('license:cloud-123:ENG:user-abc');
      expect(raw).not.toBeNull();
      // The bare space-level key must NOT be written by a user-scoped grant.
      const spaceRaw = await kv.get('license:cloud-123:ENG');
      expect(spaceRaw).toBeNull();
    });

    it('writes a user-scoped record under its own key and no license-index', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-04-06T00:00:00Z',
          activatedBy: 'ops-jane',
          userAccountId: 'user-abc',
        },
      });
      await onRequest(ctx);

      expect(await kv.get('license-index')).toBeNull();
      expect(await kv.get('license:cloud-123:ENG:user-abc')).not.toBeNull();
    });

    it('rejects an empty-string userAccountId (security invariant — never a placeholder grant)', async () => {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-04-06T00:00:00Z',
          activatedBy: 'ops-jane',
          userAccountId: '   ',
        },
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('invalid_user_account_id');

      const raw = await kv.get('license:cloud-123:ENG:   ');
      expect(raw).toBeNull();
    });

    it('a user-scoped grant and a space-level grant for the same space coexist independently', async () => {
      const spaceCtx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });
      await onRequest(spaceCtx);

      const userCtx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
          userAccountId: 'user-abc',
        },
      });
      await onRequest(userCtx);

      expect(await kv.get('license:cloud-123:ENG')).not.toBeNull();
      expect(await kv.get('license:cloud-123:ENG:user-abc')).not.toBeNull();

      expect(await kv.get('license-index')).toBeNull();
    });
  });

  describe('GET /api/space-license', () => {
    async function createLicense(cloudId: string, spaceKey: string, status = 'active') {
      const ctx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId,
          spaceKey,
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });
      await onRequest(ctx);

      if (status === 'inactive') {
        const delCtx = createMockContext({
          method: 'DELETE',
          url: `https://example.com/api/space-license?cloudId=${cloudId}&spaceKey=${spaceKey}`,
          headers: authHeaders(),
          env: makeEnv(),
        });
        await onRequest(delCtx);
      }
    }

    it('returns all licenses', async () => {
      await createLicense('cloud-1', 'ENG');
      await createLicense('cloud-1', 'SALES');
      await createLicense('cloud-2', 'MARKETING');

      const ctx = createMockContext({
        method: 'GET',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.total).toBe(3);
      expect(body.licenses).toHaveLength(3);
    });

    it('filters by cloudId', async () => {
      await createLicense('cloud-1', 'ENG');
      await createLicense('cloud-2', 'SALES');

      const ctx = createMockContext({
        method: 'GET',
        url: 'https://example.com/api/space-license?cloudId=cloud-1',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.licenses[0].cloudId).toBe('cloud-1');
    });

    it('filters by status', async () => {
      await createLicense('cloud-1', 'ENG', 'active');
      await createLicense('cloud-1', 'SALES', 'inactive');

      const ctx = createMockContext({
        method: 'GET',
        url: 'https://example.com/api/space-license?status=active',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.licenses[0].spaceKey).toBe('ENG');
    });

    it('lists a user-scoped license alongside a space-level license for the same space', async () => {
      await createLicense('cloud-1', 'ENG');

      const userCtx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-1',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
          userAccountId: 'user-abc',
        },
      });
      await onRequest(userCtx);

      const ctx = createMockContext({
        method: 'GET',
        url: 'https://example.com/api/space-license?cloudId=cloud-1',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.total).toBe(2);
      expect(body.licenses.some((l: any) => l.userAccountId === 'user-abc')).toBe(true);
      expect(body.licenses.some((l: any) => l.userAccountId === undefined)).toBe(true);
    });

    describe('built from license: keys (#1075)', () => {
      const ACTIVE_FUTURE = '2099-01-01T00:00:00Z';
      const PAST = '2020-01-01T00:00:00Z';

      function seed(key: string, record: Record<string, unknown>) {
        return kv.put(key, JSON.stringify(record));
      }

      function record(spaceKey: string, over: Record<string, unknown> = {}) {
        return {
          cloudId: 'cloud-1',
          spaceKey,
          status: 'active',
          activatedBy: 'ops-jane',
          expiresAt: ACTIVE_FUTURE,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          ...over,
        };
      }

      async function list(query = '') {
        const response = await onRequest(
          createMockContext({
            method: 'GET',
            url: `https://example.com/api/space-license${query}`,
            headers: authHeaders(),
            env: makeEnv(),
          })
        );
        return response.json() as Promise<{ licenses: any[]; total: number }>;
      }

      it('lists two licences created at the same moment (no lost index entry)', async () => {
        const post = (spaceKey: string) =>
          onRequest(
            createMockContext({
              method: 'POST',
              headers: authHeaders(),
              env: makeEnv(),
              body: { cloudId: 'cloud-1', spaceKey, expiresAt: ACTIVE_FUTURE, activatedBy: 'ops-jane' },
            })
          );
        await Promise.all([post('ENG'), post('SALES')]);

        const body = await list();
        expect(body.licenses.map((l) => l.spaceKey).sort()).toEqual(['ENG', 'SALES']);
      });

      it('lists a licence that no license-index ever pointed at', async () => {
        await seed('license:cloud-1:ENG', record('ENG'));
        await kv.put('license-index', JSON.stringify([]));

        const body = await list();
        expect(body.total).toBe(1);
        expect(body.licenses[0].spaceKey).toBe('ENG');
      });

      it('?status=active excludes a record that is active but past expiresAt', async () => {
        // Written through the API so the pre-fix code indexes it too; the only
        // thing left to exclude it is the expiry rule.
        await onRequest(
          createMockContext({
            method: 'POST',
            headers: authHeaders(),
            env: makeEnv(),
            body: { cloudId: 'cloud-1', spaceKey: 'EXPIRED', expiresAt: PAST, activatedBy: 'ops-jane' },
          })
        );
        expect(await kv.get('license:cloud-1:EXPIRED')).not.toBeNull();

        const body = await list('?status=active');
        expect(body.total).toBe(0);
      });

      it('?status=active includes a record that is active and not expired', async () => {
        await seed('license:cloud-1:LIVE', record('LIVE'));
        await seed('license:cloud-1:EXPIRED', record('EXPIRED', { expiresAt: PAST }));

        const body = await list('?status=active');
        expect(body.licenses.map((l) => l.spaceKey)).toEqual(['LIVE']);
      });

      it('?status=active keeps a record with no expiresAt (same rule as space-status)', async () => {
        const { expiresAt: _omit, ...noExpiry } = record('NOEXP');
        await seed('license:cloud-1:NOEXP', noExpiry);

        const body = await list('?status=active');
        expect(body.licenses.map((l) => l.spaceKey)).toEqual(['NOEXP']);
      });

      it('?status=inactive still filters on the stored status', async () => {
        await seed('license:cloud-1:OFF', record('OFF', { status: 'inactive' }));
        await seed('license:cloud-1:LIVE', record('LIVE'));

        const body = await list('?status=inactive');
        expect(body.licenses.map((l) => l.spaceKey)).toEqual(['OFF']);
      });

      it('unfiltered list still shows an expired record with its stored status', async () => {
        await seed('license:cloud-1:EXPIRED', record('EXPIRED', { expiresAt: PAST }));

        const body = await list();
        expect(body.licenses).toHaveLength(1);
        expect(body.licenses[0].status).toBe('active');
      });

      it('ignores keys that are not licence records, including the stale license-index', async () => {
        await seed('license:cloud-1:ENG', record('ENG'));
        await kv.put('license-index', JSON.stringify([{ cloudId: 'cloud-1', spaceKey: 'GHOST' }]));
        await kv.put('cohort:user:abc', JSON.stringify({ cohorts: ['x'] }));
        await kv.put('targeted-survey:active', JSON.stringify({ id: 's1' }));

        const body = await list();
        expect(body.licenses.map((l) => l.spaceKey)).toEqual(['ENG']);
      });

      it('skips a record that is not valid JSON instead of failing the whole list', async () => {
        await seed('license:cloud-1:ENG', record('ENG'));
        await kv.put('license:cloud-1:BROKEN', '{not json');

        const body = await list();
        expect(body.licenses.map((l) => l.spaceKey)).toEqual(['ENG']);
      });

      it('filters by cloudId', async () => {
        await seed('license:cloud-1:ENG', record('ENG'));
        await seed('license:cloud-2:ENG', record('ENG', { cloudId: 'cloud-2' }));

        const body = await list('?cloudId=cloud-2');
        expect(body.licenses.map((l) => l.cloudId)).toEqual(['cloud-2']);
      });

      it('follows the KV cursor past the first 1000-key page', async () => {
        for (let i = 0; i < 1001; i++) {
          const spaceKey = `S${String(i).padStart(4, '0')}`;
          await seed(`license:cloud-1:${spaceKey}`, record(spaceKey));
        }

        const body = await list();
        expect(body.total).toBe(1001);
        expect(new Set(body.licenses.map((l) => l.spaceKey)).size).toBe(1001);
      });
    });

    it('returns empty list when no licenses exist', async () => {
      const ctx = createMockContext({
        method: 'GET',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.total).toBe(0);
      expect(body.licenses).toEqual([]);
    });
  });

  describe('DELETE /api/space-license', () => {
    it('soft-deletes a license (sets status to inactive)', async () => {
      // Create first
      const createCtx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });
      await onRequest(createCtx);

      // Delete
      const delCtx = createMockContext({
        method: 'DELETE',
        url: 'https://example.com/api/space-license?cloudId=cloud-123&spaceKey=ENG',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(delCtx);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe('inactive');
      expect(body.cloudId).toBe('cloud-123');
      expect(body.spaceKey).toBe('ENG');

      // Verify the record is still in KV (audit trail)
      const raw = await kv.get('license:cloud-123:ENG');
      expect(raw).not.toBeNull();
      const record = JSON.parse(raw!);
      expect(record.status).toBe('inactive');
    });

    it('returns 404 when license does not exist', async () => {
      const ctx = createMockContext({
        method: 'DELETE',
        url: 'https://example.com/api/space-license?cloudId=nonexistent&spaceKey=NOPE',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(404);
    });

    it('returns 400 when required params are missing', async () => {
      const ctx = createMockContext({
        method: 'DELETE',
        url: 'https://example.com/api/space-license?cloudId=cloud-123',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(400);
    });

    it('soft-deletes only the user-scoped record when userAccountId is provided, leaving the space-level record untouched', async () => {
      const spaceCtx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
        },
      });
      await onRequest(spaceCtx);

      const userCtx = createMockContext({
        method: 'POST',
        headers: authHeaders(),
        env: makeEnv(),
        body: {
          cloudId: 'cloud-123',
          spaceKey: 'ENG',
          expiresAt: '2027-01-01T00:00:00Z',
          activatedBy: 'ops-jane',
          userAccountId: 'user-abc',
        },
      });
      await onRequest(userCtx);

      const delCtx = createMockContext({
        method: 'DELETE',
        url: 'https://example.com/api/space-license?cloudId=cloud-123&spaceKey=ENG&userAccountId=user-abc',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(delCtx);
      expect(response.status).toBe(200);

      const userRaw = JSON.parse((await kv.get('license:cloud-123:ENG:user-abc'))!);
      expect(userRaw.status).toBe('inactive');

      const spaceRaw = JSON.parse((await kv.get('license:cloud-123:ENG'))!);
      expect(spaceRaw.status).toBe('active');
    });
  });

  describe('unsupported methods', () => {
    it('returns 405 for PUT', async () => {
      const ctx = createMockContext({
        method: 'PUT',
        headers: authHeaders(),
        env: makeEnv(),
      });
      const response = await onRequest(ctx);
      expect(response.status).toBe(405);
    });
  });
});
