import { describe, it, expect } from 'vitest';
import * as root from './index';
import * as render from './render';

// /mcp is the render server's published address; /mcp/render stays as an
// alias for clients already configured with it. Both must be the same server.
describe('/mcp', () => {
  it('serves the same handlers as /mcp/render', () => {
    expect(root.onRequestPost).toBe(render.onRequestPost);
    expect(root.onRequestOptions).toBe(render.onRequestOptions);
    expect(root.onRequestGet).toBe(render.onRequestGet);
    expect(root.onRequestDelete).toBe(render.onRequestDelete);
  });

  it('answers initialize at /mcp with no Authorization header', async () => {
    const request = new Request('https://conf-lite.zenuml.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
    });
    const res = await (root.onRequestPost as (ctx: unknown) => Promise<Response>)({
      request,
      env: {},
      waitUntil: () => undefined,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { instructions: string } };
    expect(body.result.instructions).toMatch(/render_diagram/);
  });
});
