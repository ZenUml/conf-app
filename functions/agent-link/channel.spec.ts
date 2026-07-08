import { describe, it, expect } from 'vitest';
import { onRequestGet, onRequestOptions } from './channel';

function makeRequest(query: string): Request {
  return new Request(`https://example.com/agent-link/channel${query}`, {
    headers: { Upgrade: 'websocket' },
  });
}

describe('GET /agent-link/channel', () => {
  it('returns 400 when token is missing', async () => {
    const res = await onRequestGet({ request: makeRequest(''), env: {} } as any);
    expect(res.status).toBe(400);
  });

  it('returns 501 when the AGENT_LINK Durable Object binding is not wired (current state of this repo)', async () => {
    const res = await onRequestGet({ request: makeRequest('?token=CL-0000-0000'), env: {} } as any);
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/AGENT_LINK/);
  });

  it('forwards to the Durable Object stub when the binding is present', async () => {
    // jsdom's Response polyfill rejects status 101 (WHATWG-spec range check
    // that the real Workers runtime relaxes for WebSocket upgrades) — 200 is
    // enough to prove channel.ts forwards the stub's response untouched.
    const forwardedResponse = new Response('ok', { status: 200 });
    const stub = { fetch: async () => forwardedResponse };
    const env = {
      AGENT_LINK: {
        idFromName: (name: string) => ({ name }),
        get: () => stub,
      },
    };

    const res = await onRequestGet({ request: makeRequest('?token=CL-0000-0000'), env } as any);
    expect(res).toBe(forwardedResponse);
  });

  it('onRequestOptions returns CORS headers for preflight', async () => {
    const res = await onRequestOptions();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});
