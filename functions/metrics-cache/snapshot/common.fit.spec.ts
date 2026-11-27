// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

const APP_ID = '8ad26115-211f-4216-971b-0540f606303d';

// Signature checks are covered in authenticate.spec.ts. Here the verified
// payload is fixed so the test exercises how common.ts classifies it.
vi.mock('../../utils/authenticate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/authenticate')>();
  return {
    ...actual,
    validateContextToken: vi.fn(async () => ({
      payload: {
        app: { id: `ari:cloud:ecosystem::app/${APP_ID}`, module: { type: 'core:endpoint', key: 'connect' } },
        context: { cloudId: 'cloud-1' },
      },
      cloudId: 'cloud-1',
      apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1',
      forgeAppId: APP_ID,
      forgeAppAri: `ari:cloud:ecosystem::app/${APP_ID}`,
      installationId: 'ari:cloud:ecosystem::installation/install-1',
      environmentId: 'environment-1',
      environmentType: 'PRODUCTION',
    })),
  };
});

const { authenticateMetricsRequest, errorResponse } = await import('./common');

describe('snapshot claim from a scheduled trigger', () => {
  it('accepts a backend FIT whose context carries only cloudId', async () => {
    const request = new Request('https://example.test/metrics-cache/snapshot/claim', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fit',
        'x-forge-oauth-system': 'opaque-system-token',
      },
    });
    const first = vi.fn(async () => ({ clientDomain: 'tenant.atlassian.net' }));
    const env = {
      ALLOWED_FORGE_APP_IDS: APP_ID,
      EXPECTED_FORGE_ENVIRONMENT_TYPE: 'PRODUCTION',
      DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })) },
    };

    await expect(authenticateMetricsRequest(request, env as never, { backendOnly: true }))
      .resolves.toMatchObject({ clientDomain: 'tenant', productType: 'lite' });
  });
});

describe('snapshot 403 diagnostics', () => {
  it('logs which check rejected the call and the FIT shape, without secrets', async () => {
    const request = new Request('https://example.test/metrics-cache/snapshot/claim', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fit',
        'x-forge-oauth-system': 'opaque-system-token',
        'x-forge-oauth-user': 'opaque-user-token',
      },
    });
    const env = { ALLOWED_FORGE_APP_IDS: APP_ID, DB: {} };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const error = await authenticateMetricsRequest(request, env as never, { backendOnly: true })
        .catch((caught: unknown) => caught);
      const response = errorResponse(error);

      expect(response.status).toBe(403);
      expect(warn).toHaveBeenCalledWith('[macro-count:snapshot] rejected', {
        status: 403,
        reason: 'Snapshot writes require a backend Forge invocation',
        detail: {
          invocationSource: 'backend',
          hasSystemToken: true,
          hasUserToken: true,
          fitContextKeys: ['cloudId'],
          fitModuleType: 'core:endpoint',
          fitHasPrincipal: false,
        },
      });
      const logged = JSON.stringify(warn.mock.calls);
      for (const secret of ['opaque-system-token', 'opaque-user-token', 'cloud-1']) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      warn.mockRestore();
    }
  });
});
