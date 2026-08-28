import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callDiagramly,
  ensureDiagramlyDiagram,
  modifyDiagram,
  modifyDiagramWithCommand,
} from './diagramlyService';

function makeContext(cloudId?: string) {
  return {
    accountId: 'client-account-123',
    cloudId,
    env: {
      DIAGRAMLY_BACKEND_API_BASE_URL: 'https://diagramly.example',
      DIAGRAMLY_API_KEY: 'test-api-key',
    },
  };
}

describe('callDiagramly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the resolved cloudId for x-team-id while preserving the client accountId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"ok":true}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callDiagramly(makeContext('verified-cloud-789'), '/api/chat/messages', {
      messages: [],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      'x-external-id': 'client-account-123',
      'x-team-id': 'verified-cloud-789',
    });
  });

  it('forwards the explicit OpenAPI language key for AI repair', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"jobId":"openapi-repair-job"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await modifyDiagram(
      makeContext('verified-cloud-789'),
      'openapi: 3.0.0\ninfo:',
      'Missing required field: info',
      'OpenAPI',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      diagramType: 'openapi',
      languageKey: 'LANG_OPENAPI',
    });
  });

  it('forwards explicit AI repair model and disableReasoning options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"jobId":"configured-repair-job"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await modifyDiagram(
      makeContext('verified-cloud-789'),
      'A -> B',
      'Syntax error',
      'sequence',
      {
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'anthropic/claude-sonnet-5',
      disableReasoning: false,
    });
  });

  it('ensures a diagram using the verified identity headers and language mapping', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(
        '{"diagramId":"diagram-1","versionId":"version-1"}',
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await ensureDiagramlyDiagram(
      makeContext('verified-cloud-789'),
      'A -> B',
      'sequence',
      'Checkout',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://diagramly.example/api/chat/ensure-diagram');
    expect(init.headers).toMatchObject({
      'x-external-id': 'client-account-123',
      'x-team-id': 'verified-cloud-789',
    });
    expect(JSON.parse(init.body)).toEqual({
      diagramCode: 'A -> B',
      title: 'Checkout',
      languageKey: 'LANG_ZENUML',
      subTypeKey: 'GENERAL',
    });
  });

  it('rejects an ensure response without a diagramId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"versionId":"version-1"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      ensureDiagramlyDiagram(
        makeContext('verified-cloud-789'),
        'A -> B',
        'sequence',
      ),
    ).rejects.toThrow('No diagramId returned from Diagramly API');
  });

  it('always sends AI Chat changes to the versioned modification endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"jobId":"job-versioned-1"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      modifyDiagramWithCommand(makeContext('verified-cloud-789'), {
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        command: 'Add payment',
        errorMessage: 'Unexpected token',
        diagramType: 'sequence',
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      }),
    ).resolves.toEqual({ jobId: 'job-versioned-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://diagramly.example/api/chat/modify-version-async',
    );
    expect(JSON.parse(init.body)).toEqual({
      diagramId: 'diagram-1',
      diagramCode: 'A -> B',
      diagramType: 'sequence',
      languageKey: 'LANG_ZENUML',
      command: 'Add payment',
      subTypeKey: 'GENERAL',
      errorMessage: 'Unexpected token',
      model: 'anthropic/claude-sonnet-5',
      disableReasoning: false,
    });
  });

  it('creates a version for a normal AI Chat modification without repair context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"jobId":"job-versioned-2"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await modifyDiagramWithCommand(makeContext('verified-cloud-789'), {
      diagramId: 'diagram-1',
      diagramCode: 'A -> B',
      command: 'Add payment',
      diagramType: 'sequence',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://diagramly.example/api/chat/modify-version-async',
    );
    expect(JSON.parse(init.body)).not.toHaveProperty('errorMessage');
  });

  it('does not start an AI Chat modification without a diagramId', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      modifyDiagramWithCommand(makeContext('verified-cloud-789'), {
        diagramCode: 'A -> B',
        command: 'Add payment',
        diagramType: 'sequence',
      }),
    ).rejects.toThrow('Missing diagramId');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request when cloudId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callDiagramly(makeContext(), '/api/chat/messages', { messages: [] }),
    ).rejects.toThrow('Missing cloudId in Diagramly request context');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
