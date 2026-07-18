// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  authenticateMetricsRequest,
  claimKey,
  isSnapshotEnrolled,
  latestPointerKey,
  tenantSnapshotPrefix,
  type SnapshotEnv,
} from './common';
import type { ForgeRequestContext } from '../../utils/authenticate';

const backendContext: ForgeRequestContext = {
  cloudId: 'cloud-1',
  forgeAppId: '8ad26115-211f-4216-971b-0540f606303d',
  forgeAppAri: 'ari:cloud:ecosystem::app/8ad26115-211f-4216-971b-0540f606303d',
  installationId: 'ari:cloud:ecosystem::installation/install-1',
  environmentId: 'environment-1',
  environmentType: 'STAGING',
  invocationSource: 'backend',
};

function request(options: {
  url?: string;
  system?: boolean;
  user?: boolean;
} = {}): Request {
  const headers = new Headers({ Authorization: 'Bearer already-verified-by-middleware' });
  if (options.system !== false) headers.set('x-forge-oauth-system', 'opaque-system-token');
  if (options.user) headers.set('x-forge-oauth-user', 'opaque-user-token');
  return new Request(options.url || 'https://example.test/metrics-cache/snapshot/claim', {
    method: 'POST',
    headers,
  });
}

function env(flagValue: unknown = { tenant: { plan: 'managed' } }) {
  const first = vi.fn(async () => ({ clientDomain: 'tenant.atlassian.net' }));
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first })),
    })),
  };
  return {
    ALLOWED_FORGE_APP_IDS: backendContext.forgeAppId,
    EXPECTED_FORGE_ENVIRONMENT_TYPE: 'STAGING',
    DB: db as unknown as D1Database,
    KV_FEATURE_FLAGS: {
      get: vi.fn(async () => JSON.stringify(flagValue)),
    } as unknown as KVNamespace,
    confluence_plugin_features: {} as KVNamespace,
    MACRO_COUNT_SNAPSHOT_BUCKET: {} as R2Bucket,
    _db: db,
  } as SnapshotEnv & { _db: typeof db };
}

describe('snapshot authenticated context', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('accepts only a verified backend invocation and derives tenant/product from FIT', async () => {
    const result = await authenticateMetricsRequest(request(), env(), {
      backendOnly: true,
      forgeContext: backendContext,
    });

    expect(result).toMatchObject({
      appId: backendContext.forgeAppId,
      cloudId: 'cloud-1',
      clientDomain: 'tenant',
      productType: 'lite',
      environment: 'STAGING',
    });
  });

  it.each([
    ['frontend FIT context', { ...backendContext, invocationSource: 'frontend' }, request()],
    ['missing system OAuth', backendContext, request({ system: false })],
    ['present user OAuth', backendContext, request({ user: true })],
  ])('rejects %s before resolving tenant data', async (_name, forgeContext, incoming) => {
    const testEnv = env();
    await expect(authenticateMetricsRequest(incoming, testEnv, {
      backendOnly: true,
      forgeContext: forgeContext as ForgeRequestContext,
    })).rejects.toMatchObject({ status: 403 } satisfies Partial<HttpError>);
    expect(testEnv._db.prepare).not.toHaveBeenCalled();
  });

  it('rejects spoofed compatibility identity hints', async () => {
    await expect(authenticateMetricsRequest(
      request({ url: 'https://example.test/metrics-cache/query?domain=other&addonKey=unknown' }),
      env(),
      { forgeContext: backendContext },
    )).rejects.toMatchObject({ status: 403 } satisfies Partial<HttpError>);
  });

  it('rejects a FIT from the wrong Forge environment', async () => {
    await expect(authenticateMetricsRequest(request(), env(), {
      forgeContext: { ...backendContext, environmentType: 'PRODUCTION' },
    })).rejects.toMatchObject({ status: 403 } satisfies Partial<HttpError>);
  });

  it('uses the normalized authenticated domain for enrollment', async () => {
    const testEnv = env();
    const context = await authenticateMetricsRequest(request(), testEnv, {
      forgeContext: backendContext,
    });
    await expect(isSnapshotEnrolled(testEnv, context)).resolves.toBe(true);
    expect(testEnv.KV_FEATURE_FLAGS.get).toHaveBeenCalledWith('CUSTOMER_SUCCESS_SERVICE');
  });
});

describe('snapshot R2 key scope', () => {
  it('keeps every lifecycle-managed object under the isolated prefix', () => {
    const prefix = tenantSnapshotPrefix('lite', 'cloud-1');
    expect(prefix).toBe('macro-count/v1/lite/cloud-1');
    expect(latestPointerKey('lite', 'cloud-1')).toBe(`${prefix}/latest.json`);
    expect(claimKey('lite', 'cloud-1', '2026-07-18T00:00:00.000Z'))
      .toBe(`${prefix}/2026/07/18/claim.json`);
  });
});
