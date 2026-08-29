import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn(),
}));

import { callRemote } from '@/utils/requestUtil';
import { DiagramType } from '@/model/Diagram/Diagram';
import {
  diagramlyChat,
  ensureDiagramlyDiagram,
  getDiagramlyJobStatus,
  getDiagramlyVersions,
  getFixDiagramStatus,
  restoreDiagramlyVersion,
  startDiagramChatModification,
  startFixDiagram,
} from './GenerateService';

describe('GenerateService Diagramly requests', () => {
  beforeEach(() => {
    vi.mocked(callRemote).mockReset();
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

  it('starts only versioned AI Chat modifications without client identity', async () => {
    vi.mocked(callRemote).mockResolvedValue({ jobId: 'job-versioned-1' });

    await expect(
      startDiagramChatModification({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        prompt: 'Add payment',
        diagramType: DiagramType.Sequence,
        errorMessage: 'Unexpected token',
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      }),
    ).resolves.toEqual({ jobId: 'job-versioned-1' });

    expect(callRemote).toHaveBeenCalledWith('/diagramly/chat-modify', 'POST', {
      diagramId: 'diagram-1',
      diagramCode: 'A -> B',
      command: 'Add payment',
      diagramType: DiagramType.Sequence,
      errorMessage: 'Unexpected token',
      model: 'anthropic/claude-sonnet-5',
      disableReasoning: false,
    });
  });

  it('rejects unbound and unsupported diagrams before starting AI Chat', async () => {
    await expect(
      startDiagramChatModification({
        diagramId: '',
        diagramCode: 'A -> B',
        prompt: 'Add payment',
        diagramType: DiagramType.Sequence,
      }),
    ).rejects.toThrow('requires a Diagramly diagramId');

    await expect(
      startDiagramChatModification({
        diagramId: 'diagram-1',
        diagramCode: '<mxfile />',
        prompt: 'Add payment',
        diagramType: DiagramType.Graph,
      }),
    ).rejects.toThrow('not supported by AI Chat');

    await expect(
      startDiagramChatModification({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        prompt: 'Add payment',
        diagramType: 'unknown',
      }),
    ).rejects.toThrow('not supported by AI Chat');
    expect(callRemote).not.toHaveBeenCalled();
  });

  it('proxies diagram initialization, history, and restore without client identity', async () => {
    vi.mocked(callRemote)
      .mockResolvedValueOnce({ diagramId: 'diagram-1', versionId: 'version-1' })
      .mockResolvedValueOnce({ versions: [{ id: 'version-1', versionNumber: 1 }] })
      .mockResolvedValueOnce({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        version: { id: 'version-2', diagramId: 'diagram-1', versionNumber: 2 },
      });

    await ensureDiagramlyDiagram({
      diagramCode: 'A -> B',
      diagramType: DiagramType.Sequence,
      title: 'Checkout',
    });
    await getDiagramlyVersions('diagram-1');
    await restoreDiagramlyVersion('diagram-1', 'version-1');

    expect(callRemote).toHaveBeenNthCalledWith(
      1,
      '/diagramly/ensure-diagram',
      'POST',
      {
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        title: 'Checkout',
      },
    );
    expect(callRemote).toHaveBeenNthCalledWith(
      2,
      '/diagramly/versions',
      'POST',
      { diagramId: 'diagram-1' },
    );
    expect(callRemote).toHaveBeenNthCalledWith(
      3,
      '/diagramly/restore-version',
      'POST',
      { diagramId: 'diagram-1', versionId: 'version-1' },
    );
  });

  it('shares the existing job-status endpoint with AI Chat polling', async () => {
    vi.mocked(callRemote).mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'Complete',
      output: {
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        versionId: 'version-2',
        versionNumber: 2,
      },
    });

    await expect(getDiagramlyJobStatus('job-1')).resolves.toMatchObject({
      status: 'COMPLETED',
      output: { versionId: 'version-2' },
    });

    expect(callRemote).toHaveBeenCalledWith('/diagramly/job-status', 'POST', {
      jobId: 'job-1',
    });
  });
});
