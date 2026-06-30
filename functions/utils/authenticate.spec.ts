import { afterEach, describe, expect, it, vi } from 'vitest';
import authenticate from './authenticate';

describe('authenticate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 when ALLOWED_FORGE_APP_IDS is not configured', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('https://example.com/diagramly/chat', {
      headers: {
        Authorization: 'Bearer test-token',
      },
    });

    const result = await authenticate({
      request,
      env: {},
      data: {},
    });

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      error: 'Server configuration error: ALLOWED_FORGE_APP_IDS not configured',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'ALLOWED_FORGE_APP_IDS environment variable is not set',
    );
  });
});
