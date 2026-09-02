import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../service/diagramlyService', () => ({
  callDiagramly: vi.fn(),
}));

import { callDiagramly } from '../service/diagramlyService';
import { onRequest } from './job-status';

const forgeData = {
  forgeContext: {
    accountId: 'verified-account-123',
    cloudId: 'verified-cloud-789',
  },
};

const makeRequest = () =>
  new Request('https://example.com/diagramly/job-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-123' }),
  });

describe('diagramly job-status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries one transient upstream network failure', async () => {
    vi.mocked(callDiagramly)
      .mockRejectedValueOnce(new Error('Network connection lost.'))
      .mockResolvedValueOnce({
        id: 'job-123',
        status: 'COMPLETED',
        output: { diagramCode: 'A -> B' },
      });

    const result = await onRequest({
      request: makeRequest(),
      env: { DIAGRAMLY_API_KEY: 'test-key' },
      data: forgeData,
    });

    expect(result.status).toBe(200);
    expect(callDiagramly).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-network upstream failure', async () => {
    vi.mocked(callDiagramly).mockRejectedValueOnce(
      new Error('Diagramly API request failed with status 403'),
    );

    const result = await onRequest({
      request: makeRequest(),
      env: { DIAGRAMLY_API_KEY: 'test-key' },
      data: forgeData,
    });

    expect(result.status).toBe(500);
    expect(callDiagramly).toHaveBeenCalledOnce();
  });
});
