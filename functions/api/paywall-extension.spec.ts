import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/sentry', () => ({ captureError: vi.fn() }));
vi.mock('../utils/dbUtils', () => ({
  getAtlassianInstanceClientDomain: vi.fn().mockResolvedValue('example.atlassian.net'),
  getForgeInstallationClientDomain: vi.fn().mockResolvedValue(null),
}));
vi.mock('../service/paywallExtensionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service/paywallExtensionService')>();
  return { ...actual, createOrReplayPaywallExtension: vi.fn() };
});
vi.mock('../service/marketplaceContactResolution', () => ({
  resolveMarketplaceAdminRoute: vi.fn(),
}));

import { onRequest } from './paywall-extension';
import { createOrReplayPaywallExtension } from '../service/paywallExtensionService';
import { resolveMarketplaceAdminRoute } from '../service/marketplaceContactResolution';

const validBody = {
  spaceKey: 'ENG',
  macroCount: 123,
  idempotencyKey: 'request-key-00000001',
  answers: {
    currentTask: 'architecture_design',
    diagramAudience: 'development_team',
    aiAndDiagrams: { tools: ['github_copilot'], diagramUsage: 'mermaid' },
    workflowConstraints: { processRequirement: 'required_template', cloudAiPolicy: 'restricted' },
    unblockNeed: { scope: 'self', urgency: 'today' },
  },
};

function context(options: {
  method?: string;
  body?: unknown;
  forgeContext?: Record<string, unknown>;
  userToken?: string;
} = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.userToken !== '') headers['x-forge-oauth-user'] = options.userToken ?? 'user-token';
  return {
    request: new Request('https://backend.example/api/paywall-extension', {
      method: options.method ?? 'POST',
      headers,
      body: (options.method ?? 'POST') === 'POST'
        ? JSON.stringify(options.body ?? validBody)
        : undefined,
    }),
    env: {
      DB: {} as D1Database,
      MARKETPLACE_CONTACT_ENCRYPTION_KEY: 'test-only-secret-that-is-at-least-32-characters',
      confluence_plugin_features: {
        get: vi.fn().mockResolvedValue({
          domain: 'example',
          spaces: {
            ENG: {
              space: 'ENG', isLite: true, total: 123,
              sequence: 123, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0,
              lastUpdated: new Date().toISOString(),
            },
          },
        }),
      },
    },
    data: {
      forgeContext: options.forgeContext ?? {
        cloudId: 'cloud-from-fit',
        accountId: 'account-from-fit',
        apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-from-fit',
      },
    },
  } as any;
}

describe('paywall-extension API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      results: [{ id: 'space-123', key: 'ENG' }],
    }), { status: 200 })));
    vi.mocked(createOrReplayPaywallExtension).mockResolvedValue({
      status: 'granted',
      requestId: 'request-1',
      isReplay: false,
      grant: {
        grantId: 'grant-1',
        grantedAt: '2026-08-23T00:00:00.000Z',
        expiresAt: '2026-08-30T00:00:00.000Z',
        extensionDays: 7,
      },
    });
    vi.mocked(resolveMarketplaceAdminRoute).mockResolvedValue({
      routingOutcome: 'automatic', reasonCodes: ['technical_contact_unique'],
      overrideUsed: false, cacheAgeHours: 1,
    });
  });

  it('requires POST and a complete authenticated Forge user context', async () => {
    expect((await onRequest(context({ method: 'GET' }))).status).toBe(405);
    expect((await onRequest(context({ forgeContext: {} }))).status).toBe(401);
    expect((await onRequest(context({ userToken: '' }))).status).toBe(401);
  });

  it('rejects malformed and under-limit input before any write', async () => {
    const response = await onRequest(context({ body: { ...validBody, macroCount: 100 } }));
    expect(response.status).toBe(400);
    expect(createOrReplayPaywallExtension).not.toHaveBeenCalled();
  });

  it('rejects a client over-limit claim when the authoritative count is 100', async () => {
    const ctx = context();
    ctx.env.confluence_plugin_features.get.mockResolvedValueOnce({
      domain: 'example',
      spaces: {
        ENG: {
          space: 'ENG', isLite: true, total: 100,
          sequence: 100, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0,
          lastUpdated: new Date().toISOString(),
        },
      },
    });
    const response = await onRequest(ctx);
    expect(response.status).toBe(409);
    expect(createOrReplayPaywallExtension).not.toHaveBeenCalled();
  });

  it('rejects missing or stale authoritative metrics without granting', async () => {
    const missing = context();
    missing.env.confluence_plugin_features.get.mockResolvedValueOnce(null);
    expect((await onRequest(missing)).status).toBe(409);

    const stale = context();
    stale.env.confluence_plugin_features.get.mockResolvedValueOnce({
      domain: 'example',
      spaces: {
        ENG: {
          space: 'ENG', isLite: true, total: 123,
          sequence: 123, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    expect((await onRequest(stale)).status).toBe(409);
    expect(createOrReplayPaywallExtension).not.toHaveBeenCalled();
  });

  it('validates the Space with the Forge-injected user token', async () => {
    const response = await onRequest(context());
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/confluence/cloud-from-fit/api/v2/spaces?keys=ENG&limit=2',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer user-token' }),
      }),
    );
    expect(createOrReplayPaywallExtension).toHaveBeenCalledWith(
      expect.anything(),
      {
        cloudId: 'cloud-from-fit',
        accountId: 'account-from-fit',
        spaceId: 'space-123',
        spaceKey: 'ENG',
      },
      expect.objectContaining({ spaceKey: 'ENG' }),
    );
  });

  it('rejects a missing or mismatched accessible Space', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ id: 'space-999', key: 'OTHER' }],
    }), { status: 200 }));
    const response = await onRequest(context());
    expect(response.status).toBe(400);
    expect(createOrReplayPaywallExtension).not.toHaveBeenCalled();
  });

  it('returns the stable grant/replay contract as JSON', async () => {
    vi.mocked(createOrReplayPaywallExtension).mockResolvedValueOnce({
      status: 'granted',
      requestId: 'request-1',
      isReplay: true,
      grant: {
        grantId: 'grant-1',
        grantedAt: '2026-08-23T00:00:00.000Z',
        expiresAt: '2026-08-30T00:00:00.000Z',
        extensionDays: 7,
      },
    });
    const response = await onRequest(context());
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      status: 'granted', isReplay: true,
      adminContactRouting: {
        routingOutcome: 'automatic', reasonCodes: ['technical_contact_unique'],
        overrideUsed: false, cacheAgeHours: 1,
      },
    });
  });

  it('never blocks an eligible extension when contact routing fails', async () => {
    vi.mocked(resolveMarketplaceAdminRoute).mockRejectedValueOnce(new Error('fixture D1 read failure'));
    const response = await onRequest(context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'granted',
      adminContactRouting: {
        routingOutcome: 'manual', reasonCodes: ['contact_resolution_failed'],
        overrideUsed: false, cacheAgeHours: null,
      },
    });
  });
});
