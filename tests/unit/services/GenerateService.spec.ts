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
  ensureDiagramlyDiagram,
  getDiagramlyJobStatus,
  getDiagramlyVersions,
  restoreDiagramlyVersion,
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
      diagramId: undefined,
      diagramCode: 'A->B: hello',
      command: 'Add an error path',
      errorMessage: undefined,
      diagramType: DiagramType.Sequence,
    });
  });

  it('starts versioned AI Chat modification when a Diagramly diagramId is bound', async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({ jobId: 'job-version-1' });

    await expect(
      startDiagramChatModification({
        diagramId: 'diagram-1',
        diagramCode: 'A->B: hello',
        prompt: 'Add an error path',
        diagramType: DiagramType.Sequence,
      }),
    ).resolves.toEqual({ jobId: 'job-version-1' });

    expect(vi.mocked(callRemote)).toHaveBeenCalledWith('/diagramly/chat-modify', 'POST', {
      accountId: 'acc-1',
      diagramId: 'diagram-1',
      diagramCode: 'A->B: hello',
      command: 'Add an error path',
      errorMessage: undefined,
      diagramType: DiagramType.Sequence,
    });
  });

  it('proxies Diagramly version management calls with the current account', async () => {
    vi.mocked(callRemote)
      .mockResolvedValueOnce({ diagramId: 'diagram-1', versionId: 'version-1' })
      .mockResolvedValueOnce({ versions: [{ id: 'version-1', versionNumber: 1 }] })
      .mockResolvedValueOnce({ diagramId: 'diagram-1', diagramCode: 'A->B: restored' });

    await expect(ensureDiagramlyDiagram({
      diagramCode: 'A->B: hello',
      diagramType: DiagramType.Sequence,
      title: 'My diagram',
    })).resolves.toEqual({ diagramId: 'diagram-1', versionId: 'version-1' });

    await expect(getDiagramlyVersions('diagram-1')).resolves.toEqual({
      versions: [{ id: 'version-1', versionNumber: 1 }],
    });

    await expect(restoreDiagramlyVersion('diagram-1', 'version-1')).resolves.toEqual({
      diagramId: 'diagram-1',
      diagramCode: 'A->B: restored',
    });

    expect(vi.mocked(callRemote)).toHaveBeenNthCalledWith(1, '/diagramly/ensure-diagram', 'POST', {
      accountId: 'acc-1',
      diagramId: undefined,
      diagramCode: 'A->B: hello',
      diagramType: DiagramType.Sequence,
      title: 'My diagram',
      languageKey: 'LANG_ZENUML',
      subTypeKey: 'GENERAL',
    });
    expect(vi.mocked(callRemote)).toHaveBeenNthCalledWith(2, '/diagramly/versions', 'POST', {
      accountId: 'acc-1',
      diagramId: 'diagram-1',
    });
    expect(vi.mocked(callRemote)).toHaveBeenNthCalledWith(3, '/diagramly/restore-version', 'POST', {
      accountId: 'acc-1',
      diagramId: 'diagram-1',
      versionId: 'version-1',
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

  it('uses the local versioned modification endpoint when a Diagramly diagramId is bound', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('PRODUCT_TYPE', 'diagramly');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, jobId: 'local-versioned-job-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      startDiagramChatModification({
        diagramId: 'diagram-1',
        diagramCode: 'A->B: hello',
        prompt: 'Add an error path',
        diagramType: DiagramType.Sequence,
      }),
    ).resolves.toEqual({ jobId: 'local-versioned-job-1' });

    expect(vi.mocked(callRemote)).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/modify-version-async', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-external-id': 'acc-1',
      }),
      body: JSON.stringify({
        diagramId: 'diagram-1',
        diagramCode: 'A->B: hello',
        diagramType: 'sequence',
        command: 'Add an error path',
        subTypeKey: 'GENERAL',
      }),
    }));
  });
});
