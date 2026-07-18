// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { onRequest as query } from './query';
import { onRequest as update } from './update';
import { latestPointerKey } from './snapshot/common';
import type { ForgeRequestData } from '../utils/authenticate';

const data: ForgeRequestData = {
  forgeContext: {
    cloudId: 'cloud-1',
    forgeAppId: '8ad26115-211f-4216-971b-0540f606303d',
    forgeAppAri: 'ari:cloud:ecosystem::app/8ad26115-211f-4216-971b-0540f606303d',
    installationId: 'installation-1',
    environmentType: 'STAGING',
    invocationSource: 'frontend',
  },
};

function env(options: { enrolled?: boolean; latest?: boolean } = {}) {
  const metricValues = new Map<string, string>();
  const metricsKv = {
    get: vi.fn(async (key: string, type?: string) => {
      const value = metricValues.get(key) ?? null;
      return type === 'json' && value ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => metricValues.set(key, value)),
  };
  const pointer = options.latest ? {
    schemaVersion: 1,
    runId: 'run-1',
    capturedAt: '2026-07-18T00:00:00.000Z',
    state: 'completed',
    cloudId: 'cloud-1',
    productType: 'lite',
    updatedAt: '2026-07-18T00:00:00.000Z',
  } : null;
  return {
    ALLOWED_FORGE_APP_IDS: data.forgeContext?.forgeAppId,
    EXPECTED_FORGE_ENVIRONMENT_TYPE: 'STAGING',
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn(async () => ({ clientDomain: 'tenant.atlassian.net' })) })),
      })),
    },
    KV_FEATURE_FLAGS: {
      get: vi.fn(async () => options.enrolled ? JSON.stringify({ tenant: true }) : null),
    },
    confluence_plugin_features: metricsKv,
    MACRO_COUNT_SNAPSHOT_BUCKET: {
      get: vi.fn(async (key: string) => (
        pointer && key === latestPointerKey('lite', 'cloud-1')
          ? { json: async () => pointer }
          : null
      )),
    },
    _values: metricValues,
    _metrics: metricsKv,
  } as any;
}

function context(request: Request, testEnv: ReturnType<typeof env>) {
  return { request, env: testEnv, data };
}

describe('metrics cache authenticated compatibility handlers', () => {
  it('returns contract-v2 snapshot mode from the FIT-derived KV key', async () => {
    const testEnv = env({ enrolled: true, latest: true });
    testEnv._values.set('metrics:tenant:lite', JSON.stringify({
      domain: 'tenant',
      spaces: { ENG: { space: 'ENG', total: 0 } },
    }));
    const request = new Request(
      'https://example.test/metrics-cache/query?contract=2&domain=tenant&addonKey=com.zenuml.confluence-addon-lite&space=ENG',
      { headers: { Authorization: 'Bearer verified' } },
    );

    const response = await query(context(request, testEnv));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: 'snapshot', metrics: { space: 'ENG' } });
    expect(testEnv._metrics.get).toHaveBeenCalledWith('metrics:tenant:lite', 'json');
  });

  it('rejects a cross-tenant query hint before reading metrics KV', async () => {
    const testEnv = env();
    const request = new Request(
      'https://example.test/metrics-cache/query?contract=2&domain=other&space=ENG',
      { headers: { Authorization: 'Bearer verified' } },
    );

    const response = await query(context(request, testEnv));

    expect(response.status).toBe(403);
    expect(testEnv._metrics.get).not.toHaveBeenCalled();
  });

  it('ignores legacy browser writes once snapshot-managed mode is active', async () => {
    const testEnv = env({ enrolled: true, latest: true });
    const request = new Request(
      'https://example.test/metrics-cache/update?addonKey=com.zenuml.confluence-addon-lite',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer verified', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'tenant',
          space: 'ENG',
          metrics: {
            total: 1, sequence: 1, graph: 0, openapi: 0,
            mermaid: 0, plantuml: 0, unknown: 0,
          },
        }),
      },
    );

    const response = await update(context(request, testEnv));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ignored: 'snapshot-managed' });
    expect(testEnv._metrics.put).not.toHaveBeenCalled();
  });
});
