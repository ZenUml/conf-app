import { describe, expect, it } from 'vitest';
import { onRequestPost } from './token';

describe('OAuth token route configuration', () => {
  it('returns a clean 503 for a refresh request when D1 is not bound', async () => {
    const request = new Request('https://example.zenuml.com/agent-link/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'opaque', client_id: 'client-A' }),
    });
    const response = await onRequestPost({ request, env: {
      OAUTH_GRANT_KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
      OAUTH_GRANT_SECRET: 'never-echo-this-secret',
    }, waitUntil: () => undefined } as never);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"temporarily_unavailable"}');
  });
});
