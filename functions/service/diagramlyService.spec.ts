import { afterEach, describe, expect, it, vi } from 'vitest';
import { callDiagramly } from './diagramlyService';

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

  it('rejects a request when cloudId is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callDiagramly(makeContext(), '/api/chat/messages', { messages: [] }),
    ).rejects.toThrow('Missing cloudId in Diagramly request context');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
