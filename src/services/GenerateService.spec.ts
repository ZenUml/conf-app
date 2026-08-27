import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn(),
}));

import { callRemote } from '@/utils/requestUtil';
import {
  diagramlyChat,
  getFixDiagramStatus,
  startFixDiagram,
} from './GenerateService';

describe('GenerateService Diagramly requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends no client identity when starting chat (identity is derived server-side)', async () => {
    vi.mocked(callRemote).mockResolvedValue({ messages: [] });

    await diagramlyChat([{ role: 'user', content: 'hello' }]);

    expect(callRemote).toHaveBeenCalledWith('/diagramly/chat', 'POST', {
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('sends only the payload for repair start and polling — no accountId/cloudId', async () => {
    vi.mocked(callRemote)
      .mockResolvedValueOnce({ jobId: 'job-123' })
      .mockResolvedValueOnce({
        id: 'job-123',
        status: 'PROCESSING',
        progress: 25,
        message: 'Working',
      });

    await startFixDiagram('A -> B', 'syntax error', 'Sequence' as any);
    await getFixDiagramStatus('job-123');

    expect(callRemote).toHaveBeenNthCalledWith(
      1,
      '/diagramly/fix-diagram',
      'POST',
      {
        diagramCode: 'A -> B',
        errorMessage: 'syntax error',
        diagramType: 'Sequence',
      },
    );
    expect(callRemote).toHaveBeenNthCalledWith(
      2,
      '/diagramly/job-status',
      'POST',
      {
        jobId: 'job-123',
      },
    );
  });

  it('forwards explicit AI repair model and reasoning options', async () => {
    vi.mocked(callRemote).mockResolvedValue({ jobId: 'job-configured' });

    await startFixDiagram(
      'A -> B',
      'syntax error',
      'Sequence' as any,
      {
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      },
    );

    expect(callRemote).toHaveBeenCalledWith(
      '/diagramly/fix-diagram',
      'POST',
      {
        diagramCode: 'A -> B',
        errorMessage: 'syntax error',
        diagramType: 'Sequence',
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      },
    );
  });
});
