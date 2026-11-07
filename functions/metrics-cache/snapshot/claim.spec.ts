// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { handleClaim } from './claim';
import { claimKey } from './common';
import { data, makeEnv, request } from './test-helpers';

describe('snapshot claim', () => {
  it('claims once and reports the running run as a duplicate on the second call', async () => {
    const { env, r2 } = makeEnv();
    const first = await handleClaim(request('/metrics-cache/snapshot/claim', {}), env, data);
    expect(first.status).toBe(201);
    const claim = await first.json() as { runId: string; capturedAt: string; claimed: boolean };
    expect(claim.claimed).toBe(true);
    expect(r2.objects.has(claimKey('lite', 'cloud-1', claim.capturedAt))).toBe(true);

    const second = await handleClaim(request('/metrics-cache/snapshot/claim', {}), env, data);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ eligible: true, duplicate: true, runId: claim.runId });
  });
});
