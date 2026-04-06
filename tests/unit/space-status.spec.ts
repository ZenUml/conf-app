import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies that space-status.ts imports
vi.mock('../../functions/utils/requestUtils', () => ({
  getAuthorizationHeader: vi.fn(),
}));

vi.mock('../../functions/utils/atlassian', () => ({
  decode: vi.fn(),
}));

vi.mock('../../functions/utils/installationUtils', () => ({
  getInstallationData: vi.fn(),
}));

vi.mock('../../functions/utils/authenticate', () => ({
  validateContextToken: vi.fn(),
}));

vi.mock('../../functions/utils/sentry', () => ({
  captureError: vi.fn(),
}));

import { onRequest } from '../../functions/api/space-status';
import { getAuthorizationHeader } from '../../functions/utils/requestUtils';
import { decode } from '../../functions/utils/atlassian';
import { getInstallationData } from '../../functions/utils/installationUtils';
import { validateContextToken } from '../../functions/utils/authenticate';

// Mock KV namespace
class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
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
      confluence_plugin_installations: {} as KVNamespace,
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
        status: 'inactive', // deactivated
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
  });

  describe('Connect mode', () => {
    it('returns isPaid: true for active non-expired license using clientKey as cloudId', async () => {
      (getAuthorizationHeader as any).mockReturnValue('connect-jwt');
      (getInstallationData as any).mockResolvedValue({
        sharedSecret: 'secret',
        clientKey: 'cloud-xyz',
      });
      (decode as any).mockReturnValue({});

      kv._set('license:cloud-xyz:SALES', {
        cloudId: 'cloud-xyz',
        spaceKey: 'SALES',
        status: 'active',
        activatedBy: 'ops-bob',
        expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=SALES&xdm_e=https://test.atlassian.net/wiki&addonKey=test-addon',
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
      expect(body.source).toBe('space_license');
    });

    it('uses explicit cloudId query param over clientKey', async () => {
      (getAuthorizationHeader as any).mockReturnValue('connect-jwt');
      (getInstallationData as any).mockResolvedValue({
        sharedSecret: 'secret',
        clientKey: 'client-key-123',
      });
      (decode as any).mockReturnValue({});

      kv._set('license:explicit-cloud:SALES', {
        cloudId: 'explicit-cloud',
        spaceKey: 'SALES',
        status: 'active',
        activatedBy: 'ops-bob',
        expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=SALES&cloudId=explicit-cloud&xdm_e=https://test.atlassian.net/wiki&addonKey=test-addon',
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(true);
    });
  });

  describe('no Atlassian fallback', () => {
    it('does NOT use lic param even when present — KV only', async () => {
      (getAuthorizationHeader as any).mockReturnValue('connect-jwt');
      (getInstallationData as any).mockResolvedValue({
        sharedSecret: 'secret',
        clientKey: 'cloud-nolicense',
      });
      (decode as any).mockReturnValue({});

      // lic=active is in URL but no KV record exists — should still return isPaid: false
      const ctx = createMockContext({
        url: 'https://example.com/api/space-status?spaceKey=ENG&lic=active&xdm_e=https://test.atlassian.net/wiki&addonKey=test-addon',
        env: makeEnv(),
      });

      const response = await onRequest(ctx);
      const body = await response.json();
      expect(body.isPaid).toBe(false);
      // Verify no 'lic_param' source — KV-only
      expect(body.source).toBeUndefined();
    });

    it('does NOT use Forge accountType — KV only', async () => {
      (getAuthorizationHeader as any).mockReturnValue('forge-jwt');
      (validateContextToken as any).mockResolvedValue({
        payload: {
          context: {
            cloudId: 'cloud-norecord',
            accountType: 'licensed', // This should be IGNORED
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
