import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies that space-status.ts imports
vi.mock('../../functions/utils/requestUtils', () => ({
  getAuthorizationHeader: vi.fn(),
}));

vi.mock('../../functions/utils/authenticate', () => ({
  validateContextToken: vi.fn(),
}));

vi.mock('../../functions/utils/sentry', () => ({
  captureError: vi.fn(),
}));

import { onRequest } from '../../functions/api/space-status';
import { getAuthorizationHeader } from '../../functions/utils/requestUtils';
import { validateContextToken } from '../../functions/utils/authenticate';

// Mock KV namespace
class MockKV {
  private store = new Map<string, string>();
  getCalls: string[] = [];

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  _set(key: string, value: any): void {
    this.store.set(key, JSON.stringify(value));
  }
}

function createMockContext(overrides: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  env?: any;
}) {
  const method = overrides.method || 'GET';
  const url = overrides.url || 'https://example.com/api/space-status';
  const rawHeaders = overrides.headers || {};

  const request = {
    method,
    url,
    headers: {
      get: (name: string) => rawHeaders[name] || rawHeaders[name.toLowerCase()] || null,
    },
  } as unknown as Request;

  return { request, env: overrides.env || {} } as any;
}

describe('space-status API (KV-only)', () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = new MockKV();
    vi.clearAllMocks();
  });

  function makeEnv(extra: any = {}) {
    return {
      SPACE_LICENSE_KV: kv as unknown as KVNamespace,
      ALLOWED_FORGE_APP_IDS: 'test-app-id',
      ...extra,
    };
  }

  describe('method validation', () => {
    it('returns 405 for non-GET requests', async () => {
      const ctx = createMockContext({ method: 'POST', env: makeEnv() });
      const response = await onRequest(ctx);
      expect(response.status).toBe(405);
    });
  });

  describe('authentication', () => {
    it('returns 401 when no JWT is provided', async () => {
      (getAuthorizationHeader as any).mockReturnValue(null);

      const ctx = createMockContext({ env: makeEnv() });
      const response = await onRequest(ctx);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
    });
  });

  describe('Forge mode', () => {
    function forgeHeaders() {
      return { 'x-forge-oauth-user': 'user-123', Authorization: 'Bearer forge-jwt' };
    }

    it('returns isPaid: true for active non-expired license', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: { cloudId: 'cloud-abc' },
        },
      });

      kv._set('license:cloud-abc:ENG', {
        cloudId: 'cloud-abc',
        spaceKey: 'ENG',
        status: 'active',
        activatedBy: 'ops-jane',
        expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
      expect(body.source).toBe('space_license');
    });

    it('returns isPaid: false for expired license', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: { cloudId: 'cloud-abc' },
        },
      });

      kv._set('license:cloud-abc:ENG', {
        cloudId: 'cloud-abc',
        spaceKey: 'ENG',
        status: 'active',
        activatedBy: 'ops-jane',
        expiresAt: '2020-01-01T00:00:00Z', // expired
        createdAt: '2019-01-01T00:00:00Z',
        updatedAt: '2019-01-01T00:00:00Z',
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
      expect(body.source).toBeUndefined();
    });

    it('returns isPaid: false for inactive license', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: { cloudId: 'cloud-abc' },
        },
      });

      kv._set('license:cloud-abc:ENG', {
        cloudId: 'cloud-abc',
        spaceKey: 'ENG',
        status: 'inactive',
        activatedBy: 'ops-jane',
        expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
    });

    it('returns isPaid: false when no license exists', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: { cloudId: 'cloud-abc' },
        },
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
    });

    it('returns isPaid: false when spaceKey is missing', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: { cloudId: 'cloud-abc' },
        },
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
    });

    it('does NOT use Forge accountType — KV only', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: {
            cloudId: 'cloud-norecord',
            accountType: 'licensed', // should be IGNORED — KV only
          },
        },
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: { 'x-forge-oauth-user': 'user-123', Authorization: 'Bearer forge-jwt' },
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false); // No KV record = not paid, despite accountType=licensed
    });
  });

  describe('user-scoped license (hybrid extension)', () => {
    function forgeHeaders() {
      return { 'x-forge-oauth-user': 'user-123', Authorization: 'Bearer forge-jwt' };
    }

    function mockTokenWithPrincipal(principal?: string) {
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: { cloudId: 'cloud-abc' },
          ...(principal !== undefined ? { principal } : {}),
        },
      });
    }

    function activeRecord(overrides: Partial<Record<string, any>> = {}) {
      return {
        cloudId: 'cloud-abc',
        spaceKey: 'ENG',
        status: 'active',
        activatedBy: 'ops-jane',
        expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
      };
    }

    it('returns isPaid:true, source:user_license for a user-key match with no space-key record', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      mockTokenWithPrincipal('user-abc');

      kv._set('license:cloud-abc:ENG:user-abc', activeRecord({ userAccountId: 'user-abc' }));

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
      expect(body.source).toBe('user_license');
    });

    it('falls back to the space-level record when the requesting user has no user-key record (backward compat)', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      mockTokenWithPrincipal('user-abc');

      // Only a pre-existing space-level grant exists — this is the shape of
      // the ~10 live prod grants that predate user-scoped extensions.
      kv._set('license:cloud-abc:ENG', activeRecord());

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
      expect(body.source).toBe('space_license');
    });

    it('falls back to space-level when the user-key record is expired but the space-key record is active', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      mockTokenWithPrincipal('user-abc');

      kv._set('license:cloud-abc:ENG:user-abc', activeRecord({
        userAccountId: 'user-abc',
        expiresAt: '2020-01-01T00:00:00Z', // expired
      }));
      kv._set('license:cloud-abc:ENG', activeRecord());

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
      expect(body.source).toBe('space_license');
    });

    it('never constructs or queries a user-key when the token has no principal (security invariant)', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      mockTokenWithPrincipal(undefined);

      kv._set('license:cloud-abc:ENG', activeRecord());

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
      expect(body.source).toBe('space_license');
      expect(kv.getCalls.some((k) => k.includes(':undefined') || k.includes(':null'))).toBe(false);
      expect(kv.getCalls).not.toContain('license:cloud-abc:ENG:');
    });

    it('grants only the requesting user — a different user on the same space stays unpaid', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');

      kv._set('license:cloud-abc:ENG:user-granted', activeRecord({ userAccountId: 'user-granted' }));

      mockTokenWithPrincipal('user-granted');
      const grantedCtx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });
      const grantedResponse = await onRequest(grantedCtx);
      const grantedBody = await grantedResponse.json();
      expect(grantedBody.isPaid).toBe(true);
      expect(grantedBody.source).toBe('user_license');

      mockTokenWithPrincipal('user-other');
      const otherCtx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: forgeHeaders(),
        env: makeEnv(),
      });
      const otherResponse = await onRequest(otherCtx);
      const otherBody = await otherResponse.json();
      expect(otherBody.isPaid).toBe(false);
    });
  });

  describe('cache headers', () => {
    it('returns Cache-Control: max-age=300 for successful responses', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: { context: { cloudId: 'cloud-abc' } },
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: { 'x-forge-oauth-user': 'user-123', Authorization: 'Bearer forge-jwt' },
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      expect(response.headers.get('Cache-Control')).toBe('max-age=300');
    });
  });

  describe('SPACE_LICENSE_KV not configured', () => {
    it('returns isPaid: false gracefully when KV binding is missing', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: { context: { cloudId: 'cloud-abc' } },
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG',
        headers: { 'x-forge-oauth-user': 'user-123', Authorization: 'Bearer forge-jwt' },
        env: {
          ALLOWED_FORGE_APP_IDS: 'test-app-id',
          // No SPACE_LICENSE_KV binding
        },
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
    });
  });
});
