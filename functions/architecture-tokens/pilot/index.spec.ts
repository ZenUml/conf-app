import { describe, expect, it, vi } from 'vitest';

vi.mock('../openrouter-pilot', () => ({
  runOpenRouterPilot: vi.fn(),
}));

import { runOpenRouterPilot } from '../openrouter-pilot';
import { onRequestPost } from './index';

describe('internal Architecture Tokens pilot executor', () => {
  it('does not invoke the pilot unless the separate internal executor secret matches', async () => {
    const response = await onRequestPost({
      request: new Request('https://example.test/architecture-tokens/pilot', { method: 'POST' }),
      env: { ARCHITECTURE_TOKEN_INTERNAL_EXECUTOR_TOKEN: 'internal-test-secret' },
    } as never);

    expect(response.status).toBe(403);
    expect(runOpenRouterPilot).not.toHaveBeenCalled();
  });

  it('runs only the protected internal handler and returns the sanitised aggregate report', async () => {
    vi.mocked(runOpenRouterPilot).mockResolvedValueOnce({
      dryRun: false, corpusSourceCount: 117, calibration: [], selectedModel: null, fullRun: null,
    });
    const response = await onRequestPost({
      request: new Request('https://example.test/architecture-tokens/pilot', {
        method: 'POST', headers: { Authorization: 'Bearer internal-test-secret' },
      }),
      env: { ARCHITECTURE_TOKEN_INTERNAL_EXECUTOR_TOKEN: 'internal-test-secret' },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ corpusSourceCount: 117, calibration: [] });
    expect(runOpenRouterPilot).toHaveBeenCalledWith(expect.objectContaining({ ARCHITECTURE_TOKEN_INTERNAL_EXECUTOR_TOKEN: 'internal-test-secret' }));
  });
});
