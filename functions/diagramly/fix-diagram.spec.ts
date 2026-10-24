import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../service/diagramlyService', () => ({
  modifyDiagram: vi.fn(),
}));

import { modifyDiagram } from '../service/diagramlyService';
import { onRequest } from './fix-diagram';

const forgeData = {
  forgeContext: {
    accountId: 'verified-account-123',
    cloudId: 'verified-cloud-789',
  },
};

const makeRequest = (body: object) =>
  new Request('https://example.com/diagramly/fix-diagram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('diagramly fix-diagram route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards explicit model and disableReasoning configuration', async () => {
    vi.mocked(modifyDiagram).mockResolvedValue({ jobId: 'job-configured' });
    const env = { DIAGRAMLY_API_KEY: 'test-key' };

    const result = await onRequest({
      request: makeRequest({
        diagramCode: 'A -> B',
        errorMessage: 'Syntax error',
        diagramType: 'sequence',
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      }),
      env,
      data: forgeData,
    });

    expect(result.status).toBe(200);
    expect(modifyDiagram).toHaveBeenCalledWith(
      {
        accountId: 'verified-account-123',
        cloudId: 'verified-cloud-789',
        env,
      },
      'A -> B',
      'Syntax error',
      'sequence',
      {
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      },
    );
  });

  it('rejects a non-boolean disableReasoning value', async () => {
    const result = await onRequest({
      request: makeRequest({
        diagramCode: 'A -> B',
        errorMessage: 'Syntax error',
        diagramType: 'sequence',
        disableReasoning: 'false',
      }),
      env: {},
      data: forgeData,
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: 'disableReasoning must be a boolean',
    });
    expect(modifyDiagram).not.toHaveBeenCalled();
  });
});
