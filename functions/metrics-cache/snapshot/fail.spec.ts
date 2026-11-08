// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { handleClaim } from './claim';
import { handleFail } from './fail';
import { data, makeEnv, request } from './test-helpers';

describe('snapshot fail', () => {
  it('marks the claim failed and falls back to unknown for out-of-list values', async () => {
    const { env, r2 } = makeEnv();
    const claimed = await handleClaim(request('/metrics-cache/snapshot/claim', {}), env, data);
    const { runId } = await claimed.json() as { runId: string };
    const response = await handleFail(request('/metrics-cache/snapshot/fail', {
      runId,
      failureStage: 'chunk_upload',
      failureReason: 'not-a-reason',
    }), env, data);
    expect(response.status).toBe(200);
    const stored = [...r2.objects.values()].map((o) => JSON.parse(o.text))
      .find((o) => o.runId === runId && o.state === 'failed' && o.failureStage);
    expect(stored).toMatchObject({ failureStage: 'chunk_upload', failureReason: 'unknown' });
  });
});
