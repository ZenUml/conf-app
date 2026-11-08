// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { handleChunk } from './chunk';
import { handleClaim } from './claim';
import { sha256Hex } from './common';
import { data, makeEnv, request } from './test-helpers';

describe('snapshot chunk', () => {
  it('rejects a chunk whose payload hash does not match', async () => {
    const { env } = makeEnv();
    const claimed = await handleClaim(request('/metrics-cache/snapshot/claim', {}), env, data);
    const { runId } = await claimed.json() as { runId: string };
    const payload = { schemaVersion: 1, runId, rows: [] };
    const response = await handleChunk(request('/metrics-cache/snapshot/chunk', {
      runId,
      kind: 'aggregate',
      index: 0,
      rowCount: 0,
      sha256: await sha256Hex('something else'),
      payload,
    }), env, data);
    expect(response.status).toBe(400);
  });
});
