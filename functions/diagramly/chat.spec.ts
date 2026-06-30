import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../service/diagramlyService', () => ({
  chat: vi.fn(),
}));

import { chat } from '../service/diagramlyService';
import { onRequest } from './chat';

describe('diagramly chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps client teamId/accountId and prefers the verified cloudId', async () => {
    vi.mocked(chat).mockResolvedValue({ messages: [] });
    const env = { DIAGRAMLY_API_KEY: 'test-key' };
    const messages = [{ role: 'user', content: 'hello' }];
    const request = new Request('https://example.com/diagramly/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'client-account-123',
        teamId: 'client-team-456',
        cloudId: 'client-cloud-456',
        messages,
      }),
    });

    const result = await onRequest({
      request,
      env,
      data: {
        forgeContext: {
          cloudId: 'verified-cloud-789',
        },
      },
    });

    expect(result.status).toBe(200);
    expect(chat).toHaveBeenCalledWith(
      {
        accountId: 'client-account-123',
        teamId: 'client-team-456',
        cloudId: 'verified-cloud-789',
        env,
      },
      messages,
    );
  });

  it('uses the client cloudId when the verified Forge context has none', async () => {
    vi.mocked(chat).mockResolvedValue({ messages: [] });
    const env = { DIAGRAMLY_API_KEY: 'test-key' };
    const messages = [{ role: 'user', content: 'hello' }];
    const request = new Request('https://example.com/diagramly/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'client-account-123',
        cloudId: 'client-cloud-456',
        messages,
      }),
    });

    const result = await onRequest({
      request,
      env,
      data: {},
    });

    expect(result.status).toBe(200);
    expect(chat).toHaveBeenCalledWith(
      {
        accountId: 'client-account-123',
        teamId: undefined,
        cloudId: 'client-cloud-456',
        env,
      },
      messages,
    );
  });
});
