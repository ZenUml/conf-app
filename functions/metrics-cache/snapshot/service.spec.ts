// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleChunk, handleClaim, handleCommit } from './service';
import { latestPointerKey, sha256Hex, type SnapshotEnv } from './common';
import type { ForgeRequestData } from '../../utils/authenticate';

class MemoryR2 {
  objects = new Map<string, { text: string; etag: string }>();
  sequence = 0;

  async put(key: string, value: unknown, options: { onlyIf?: R2Conditional } = {}) {
    const existing = this.objects.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && existing) return null;
    if (options.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
    const text = typeof value === 'string' ? value : String(value);
    const etag = `etag-${++this.sequence}`;
    this.objects.set(key, { text, etag });
    return { key, etag };
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      key,
      etag: stored.etag,
      text: async () => stored.text,
      json: async <T>() => JSON.parse(stored.text) as T,
    };
  }
}

class MemoryKV {
  values = new Map<string, string>();
  put = vi.fn(async (key: string, value: string) => {
    this.values.set(key, value);
  });

  async get(key: string, type?: string) {
    const value = this.values.get(key) ?? null;
    return type === 'json' && value ? JSON.parse(value) : value;
  }
}

const data: ForgeRequestData = {
  forgeContext: {
    cloudId: 'cloud-1',
    forgeAppId: '8ad26115-211f-4216-971b-0540f606303d',
    forgeAppAri: 'ari:cloud:ecosystem::app/8ad26115-211f-4216-971b-0540f606303d',
    installationId: 'installation-1',
    environmentType: 'STAGING',
    invocationSource: 'backend',
  },
};

function request(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer verified-in-middleware',
      'Content-Type': 'application/json',
      'x-forge-oauth-system': 'opaque',
    },
    body: JSON.stringify(body),
  });
}

function makeEnv() {
  const r2 = new MemoryR2();
  const metrics = new MemoryKV();
  const flags = new MemoryKV();
  flags.values.set('CUSTOMER_SUCCESS_SERVICE', JSON.stringify({ tenant: true }));
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ clientDomain: 'tenant.atlassian.net' })),
      })),
    })),
  };
  return {
    env: {
      ALLOWED_FORGE_APP_IDS: data.forgeContext?.forgeAppId,
      EXPECTED_FORGE_ENVIRONMENT_TYPE: 'STAGING',
      DB: db as unknown as D1Database,
      MACRO_COUNT_SNAPSHOT_BUCKET: r2 as unknown as R2Bucket,
      confluence_plugin_features: metrics as unknown as KVNamespace,
      KV_FEATURE_FLAGS: flags as unknown as KVNamespace,
    } satisfies SnapshotEnv,
    r2,
    metrics,
  };
}

async function upload(
  env: SnapshotEnv,
  runId: string,
  body: { kind: 'content' | 'space' | 'aggregate'; spaceId?: string; index?: number; rowCount: number; payload: unknown },
) {
  const serialized = JSON.stringify(body.payload);
  const sha256 = await sha256Hex(serialized);
  const response = await handleChunk(request('/metrics-cache/snapshot/chunk', {
    runId,
    ...body,
    sha256,
  }), env, data);
  expect(response.status).toBe(201);
  return response.json() as Promise<{ key: string; rowCount: number; sha256: string }>;
}

describe('macro snapshot service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('publishes one complete compatible KV object and zeroes a missing prior space', async () => {
    const { env, r2, metrics } = makeEnv();
    metrics.values.set('metrics:tenant:lite', JSON.stringify({
      domain: 'tenant',
      spaces: {
        OLD: {
          space: 'OLD', total: 2, sequence: 2, graph: 0, openapi: 0,
          mermaid: 0, plantuml: 0, unknown: 0, isLite: true,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      },
    }));

    const claimResponse = await handleClaim(
      request('/metrics-cache/snapshot/claim', {}),
      env,
      data,
    );
    expect(claimResponse.status).toBe(201);
    const claim = await claimResponse.json() as { runId: string; capturedAt: string };
    const counts = {
      total: 1, sequence: 1, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0,
    };
    const content = await upload(env, claim.runId, {
      kind: 'content',
      spaceId: '100',
      index: 0,
      rowCount: 1,
      payload: {
        schemaVersion: 1,
        runId: claim.runId,
        spaceId: '100',
        rows: [{
          contentId: '200', pageId: '300', type: 'ac:test:type', status: 'current',
          versionNumber: 1, versionCreatedAt: claim.capturedAt, diagramType: 'sequence',
          logicalIdHash: 'a'.repeat(64), parseStatus: 'parsed',
        }],
      },
    });
    await upload(env, claim.runId, {
      kind: 'space',
      spaceId: '100',
      rowCount: 1,
      payload: {
        schemaVersion: 1,
        runId: claim.runId,
        capturedAt: claim.capturedAt,
        spaceId: '100',
        spaceKey: 'ENG',
        metrics: counts,
        contentChunks: [content],
      },
    });
    const aggregate = await upload(env, claim.runId, {
      kind: 'aggregate',
      index: 0,
      rowCount: 1,
      payload: {
        schemaVersion: 1,
        runId: claim.runId,
        rows: [{ spaceId: '100', spaceKey: 'ENG', metrics: counts }],
      },
    });

    const commit = await handleCommit(request('/metrics-cache/snapshot/commit', {
      runId: claim.runId,
      expectedTypes: ['ac:test:sequence', 'ac:test:graph'],
      completedTypes: ['ac:test:sequence', 'ac:test:graph'],
      spaceCount: 1,
      contentCount: 1,
      chunkCount: 3,
      aggregateMetrics: counts,
      aggregateChunks: [aggregate],
      durationMs: 100,
    }), env, data);

    expect(commit.status).toBe(200);
    expect(metrics.put).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(metrics.values.get('metrics:tenant:lite') || '{}');
    expect(stored.spaces.ENG).toMatchObject({ total: 1, sequence: 1, isLite: true });
    expect(stored.spaces.OLD).toMatchObject({ total: 0, sequence: 0, isLite: true });
    const latest = r2.objects.get(latestPointerKey('lite', 'cloud-1'));
    expect(JSON.parse(latest?.text || '{}')).toMatchObject({ runId: claim.runId, state: 'completed' });
  });

  it('does not publish KV or latest when commit references a missing chunk', async () => {
    const { env, r2, metrics } = makeEnv();
    const claimed = await handleClaim(request('/metrics-cache/snapshot/claim', {}), env, data);
    const claim = await claimed.json() as { runId: string };
    const zero = { total: 0, sequence: 0, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0 };

    const response = await handleCommit(request('/metrics-cache/snapshot/commit', {
      runId: claim.runId,
      expectedTypes: ['type'],
      completedTypes: ['type'],
      spaceCount: 0,
      contentCount: 0,
      chunkCount: 1,
      aggregateMetrics: zero,
      aggregateChunks: [{ key: 'wrong-prefix', rowCount: 0, sha256: 'a'.repeat(64) }],
    }), env, data);

    expect(response.status).toBe(400);
    expect(metrics.put).not.toHaveBeenCalled();
    expect(r2.objects.has(latestPointerKey('lite', 'cloud-1'))).toBe(false);
  });
});
