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

  it('uses the verified Forge context identity and ignores body-supplied identity', async () => {
    vi.mocked(chat).mockResolvedValue({ messages: [] });
    const env = { DIAGRAMLY_API_KEY: 'test-key' };
    const messages = [{ role: 'user', content: 'hello' }];
    const request = new Request('https://example.com/diagramly/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Spoofed identity in the body must be ignored entirely.
        accountId: 'attacker-account',
        cloudId: 'attacker-cloud',
        messages,
      }),
    });

    const result = await onRequest({
      request,
      env,
      data: {
        forgeContext: {
          accountId: 'verified-account-123',
          cloudId: 'verified-cloud-789',
        },
      },
    });

    expect(result.status).toBe(200);
    expect(chat).toHaveBeenCalledWith(
      {
        accountId: 'verified-account-123',
        cloudId: 'verified-cloud-789',
        env,
      },
      messages,
    );
  });

  it('returns 400 (not 500) with a readable message when the context has no cloudId', async () => {
    const request = new Request('https://example.com/diagramly/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });

    const result = await onRequest({
      request,
      env: {},
      data: { forgeContext: { accountId: 'verified-account-123' } },
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: 'Missing cloudId in Forge context',
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('returns 400 when the context has no accountId', async () => {
    const request = new Request('https://example.com/diagramly/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });

    const result = await onRequest({
      request,
      env: {},
      data: { forgeContext: { cloudId: 'verified-cloud-789' } },
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: 'Missing accountId in Forge context',
    });
    expect(chat).not.toHaveBeenCalled();
  });
});
