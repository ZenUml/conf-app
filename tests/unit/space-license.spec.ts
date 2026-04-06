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

      const indexRaw = await kv.get('license-index');
      const index = JSON.parse(indexRaw!);
      expect(index).toEqual([{ cloudId: 'cloud-123', spaceKey: 'ENG' }]);
    });

    it('does not duplicate index entries on upsert', async () => {
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

      const indexRaw = await kv.get('license-index');
      const index = JSON.parse(indexRaw!);
      expect(index).toHaveLength(1);
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
