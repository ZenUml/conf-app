import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      _getCurrentUser: vi.fn(),
    },
  },
}));
vi.mock('@/model/globals/forgeGlobal', () => ({
  getContext: vi.fn(),
}));
vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn(),
}));

import globals from '@/model/globals';
import { getContext } from '@/model/globals/forgeGlobal';
import { callRemote } from '@/utils/requestUtil';
import {
  diagramlyChat,
  getFixDiagramStatus,
  startFixDiagram,
} from './GenerateService';

describe('GenerateService Diagramly identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(globals.apWrapper._getCurrentUser).mockResolvedValue({
      atlassianAccountId: 'account-123',
    } as any);
    vi.mocked(getContext).mockResolvedValue({
      cloudId: 'client-cloud-456',
    } as any);
  });

  it('sends the client cloudId when starting chat', async () => {
    vi.mocked(callRemote).mockResolvedValue({ messages: [] });

    await diagramlyChat([{ role: 'user', content: 'hello' }]);

    expect(callRemote).toHaveBeenCalledWith('/diagramly/chat', 'POST', {
      accountId: 'account-123',
      cloudId: 'client-cloud-456',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('sends the same client identity for repair start and polling', async () => {
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
        accountId: 'account-123',
        cloudId: 'client-cloud-456',
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
        accountId: 'account-123',
        cloudId: 'client-cloud-456',
      },
    );
  });
});
