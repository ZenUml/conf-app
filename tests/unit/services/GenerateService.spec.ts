import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn().mockResolvedValue({ dsl: '', diagramId: '', diagramTitle: '', updatedCode: '' }),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      _getCurrentUser: vi.fn().mockResolvedValue({ atlassianAccountId: 'acc-1' }),
    },
  },
}));

import { callRemote } from '@/utils/requestUtil';
import {
  diagramlyChat,
  getDiagramlyJobStatus,
  startDiagramChatModification,
  startFixDiagram,
} from '@/services/GenerateService';
import { DiagramType } from '@/model/Diagram/Diagram';

describe('GenerateService URLs are Forge-clean (no xdm_e, no addonKey)', () => {
  beforeEach(() => {
    vi.mocked(callRemote).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('diagramlyChat does not include xdm_e or addonKey query params', async () => {
    await diagramlyChat([]).catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });

  it('startFixDiagram does not include xdm_e or addonKey query params', async () => {
    await startFixDiagram('content', 'error', DiagramType.Sequence).catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });

  it('starts AI Chat diagram modification through the async job endpoint', async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({ jobId: 'job-1' });

    await expect(
      startDiagramChatModification({
        diagramCode: 'A->B: hello',
        prompt: 'Add an error path',
        diagramType: DiagramType.Sequence,
      }),
    ).resolves.toEqual({ jobId: 'job-1' });

    expect(vi.mocked(callRemote)).toHaveBeenCalledWith('/diagramly/chat-modify', 'POST', {
      accountId: 'acc-1',
      diagramCode: 'A->B: hello',
      command: 'Add an error path',
      errorMessage: undefined,
      diagramType: DiagramType.Sequence,
    });
  });

  it('rejects Graph diagrams before starting an AI Chat job', async () => {
    await expect(
      startDiagramChatModification({
        diagramCode: '<mxfile />',
        prompt: 'Update the diagram',
        diagramType: DiagramType.Graph,
      }),
    ).rejects.toThrow('Graph diagrams are not supported');

    expect(vi.mocked(callRemote)).not.toHaveBeenCalled();
  });

  it('gets AI Chat job status through the shared Diagramly job endpoint', async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({
      id: 'job-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'Complete',
      output: { diagramCode: 'A->B: updated' },
    });

    await expect(getDiagramlyJobStatus('job-1')).resolves.toMatchObject({
      id: 'job-1',
      status: 'COMPLETED',
    });

    expect(vi.mocked(callRemote)).toHaveBeenCalledWith('/diagramly/job-status', 'POST', {
      jobId: 'job-1',
      accountId: 'acc-1',
    });
  });

  it('uses the local Diagramly API directly for standalone Diagramly dev repair', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('PRODUCT_TYPE', 'diagramly');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, jobId: 'local-job-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      startFixDiagram('A->B: hello', 'Syntax error', DiagramType.Sequence),
    ).resolves.toEqual({ jobId: 'local-job-1' });

    expect(vi.mocked(callRemote)).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/modify-async', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-external-id': 'acc-1',
      }),
      body: JSON.stringify({
        diagramCode: 'A->B: hello',
        diagramType: 'sequence',
        command: 'Please resolve the issue with minimal code modifications. Preserve the original style and comments. Only address the errors; if the code lacks clarity, use the fewest words possible to improve it.',
        errorMessage: 'Syntax error',
        subTypeKey: 'GENERAL',
      }),
    }));
  });

  it('uses configured local Diagramly base URL and API key for direct status polling', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('PRODUCT_TYPE', 'diagramly');
    vi.stubEnv('VITE_DIAGRAMLY_LOCAL_API_BASE_URL', 'http://127.0.0.1:3000/');
    vi.stubEnv('VITE_DIAGRAMLY_LOCAL_API_KEY', 'dev-key');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'local-job-1',
        status: 'COMPLETED',
        progress: 100,
        message: 'Complete',
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDiagramlyJobStatus('local-job-1')).resolves.toMatchObject({
      id: 'local-job-1',
      status: 'COMPLETED',
    });

    expect(vi.mocked(callRemote)).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/api/chat/job-status', expect.objectContaining({
      headers: expect.objectContaining({
        'x-api-key': 'dev-key',
        'x-external-id': 'acc-1',
      }),
      body: JSON.stringify({ jobId: 'local-job-1' }),
    }));
  });
});
