// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleClaim } from './claim';
import { handleCommit } from './commit';
import { latestPointerKey } from './common';
import { data, makeEnv, request, upload } from './test-helpers';

describe('macro snapshot commit', () => {
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
