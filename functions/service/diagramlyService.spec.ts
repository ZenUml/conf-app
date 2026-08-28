import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callDiagramly,
  ensureDiagramlyDiagram,
  modifyDiagram,
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

  it('rejects a request when cloudId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callDiagramly(makeContext(), '/api/chat/messages', { messages: [] }),
    ).rejects.toThrow('Missing cloudId in Diagramly request context');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
