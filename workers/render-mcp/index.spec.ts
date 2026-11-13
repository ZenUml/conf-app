// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import * as renderer from '../../functions/agent-link/renderMcp';
import { DIAGRAM_VIEW_URI, VIEW_MARKER } from '../../functions/agent-link/oauth/mcpApps';

const ORIGIN = 'https://zenuml.com';
const VIEW = `<!doctype html>${VIEW_MARKER}<script type="module" src="./assets/view-test.js"></script>`;
const BUILD = {
  version: '1.1.0', commit: 'a'.repeat(40), dirty: false,
  builtAt: '2026-11-04T03:00:00Z', viewSha256: 'b'.repeat(64),
};
const ctx = { waitUntil: vi.fn() };
function environment(fetcher = vi.fn(async () => new Response(VIEW))): Env {
  return { CANONICAL_ORIGIN: ORIGIN, ASSETS: { fetch: fetcher } };
}
function post(url = `${ORIGIN}/mcp`, method = 'initialize', params?: unknown, headers?: HeadersInit) {
  return new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
  });
}
async function rpc(url: string, method: string, env = environment(), params?: unknown) {
  return (await worker.fetch(post(url, method, params), env, ctx)).json() as Promise<any>;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); ctx.waitUntil.mockClear(); });

describe('independent render MCP routing and protocol', () => {
  it.each(['https://zenuml.com', 'https://conf-lite.zenuml.com'])('takes the view report on %s, where /mcp* never reaches Pages', async (host) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const report = () => new Request(`${host}/mcp/view-event`, {
      method: 'POST', body: JSON.stringify({ macro_type: 'plantuml', render_outcome: 'rendered', plantuml_renderer: 'local' }),
    });
    const response = await worker.fetch(report(), environment(), ctx);
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(upstream).not.toHaveBeenCalled();
    const get = await worker.fetch(new Request(`${host}/mcp/view-event`), environment(), ctx);
    expect(get.status).toBe(405);
  });

  it.each(['/mcp', '/mcp/', '/mcp/render', '/mcp/render/'])('serves %s with the unchanged public handshake', async (path) => {
    const response = await worker.fetch(post(`${ORIGIN}${path}`, 'initialize', { protocolVersion: '2025-06-18' }), environment(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body: any = await response.json();
    expect(body.id).toBe(7);
    expect(body.result.serverInfo.name).toBe('zenuml-render');
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('makes both production hosts and aliases return the same resource HTML and CSP', async () => {
    const assets = vi.fn(async () => new Response(VIEW));
    const env = environment(assets);
    const bodies = await Promise.all([
      rpc(`${ORIGIN}/mcp`, 'resources/read', env, { uri: DIAGRAM_VIEW_URI }),
      rpc('https://conf-lite.zenuml.com/mcp', 'resources/read', env, { uri: DIAGRAM_VIEW_URI }),
      rpc('https://conf-lite.zenuml.com/mcp/render', 'resources/read', env, { uri: DIAGRAM_VIEW_URI }),
    ]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    const resource = bodies[0].result.contents[0];
    expect(resource.text).toContain('src="https://zenuml.com/mcp-app/assets/view-test.js"');
    expect(resource._meta.ui.csp.resourceDomains).toEqual([ORIGIN]);
    expect(resource._meta.ui.csp.connectDomains).toEqual([ORIGIN]);
    expect(assets.mock.calls.map(([request]) => request.url)).toEqual(Array(3).fill(`${ORIGIN}/mcp-app/view.html`));
  });

  it('uses the preview origin for resource URLs and CSP when canonical origin is omitted', async () => {
    const env = environment(); delete env.CANONICAL_ORIGIN;
    const body = await rpc('https://preview.render-mcp.workers.dev/mcp', 'resources/read', env, { uri: DIAGRAM_VIEW_URI });
    expect(body.result.contents[0].text).toContain('https://preview.render-mcp.workers.dev/mcp-app/assets/view-test.js');
    expect(body.result.contents[0]._meta.ui.csp.connectDomains).toEqual(['https://preview.render-mcp.workers.dev']);
  });

  it.each(['https://evil.example', 'https://fakeworkers.dev', 'https://x.workers.dev.evil.example'])('refuses unknown host %s without fetching it', async (origin) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const env = environment(); delete env.CANONICAL_ORIGIN;
    expect((await worker.fetch(post(`${origin}/mcp`), env, ctx)).status).toBe(421);
    expect(fetcher).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('does not expose preview hosts when production canonical origin is set', async () => {
    const response = await worker.fetch(post('https://render.workers.dev/mcp'), environment(), ctx);
    expect(response.status).toBe(421);
  });

  it.each(['https://other.example', 'https://zenuml.com/', 'https://zenuml.com?target=evil', ''])('fails closed for invalid canonical origin %s', async (origin) => {
    const env = environment(); env.CANONICAL_ORIGIN = origin;
    const response = await worker.fetch(post(), env, ctx);
    expect(response.status).toBe(503);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD', 'DELETE', 'PUT'])('declines %s with protocol method/CORS headers', async (method) => {
    const response = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method }), environment(), ctx);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    if (method === 'HEAD') expect(await response.text()).toBe('');
  });

  it('preserves OPTIONS and empty notification acknowledgements', async () => {
    const options = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: 'OPTIONS' }), environment(), ctx);
    expect(options.status).toBe(200);
    expect(options.headers.get('Access-Control-Allow-Headers')).toBe(renderer.CORS['Access-Control-Allow-Headers']);
    expect(await options.text()).toBe('');
    const notification = await worker.fetch(post(undefined, 'notifications/initialized'), environment(), ctx);
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe('');
  });

  it('preserves parser/unknown-resource JSON-RPC errors', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: 'POST', body: 'invalid JSON' }), environment(), ctx);
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.code).toBe(-32700);
    const body = await rpc(`${ORIGIN}/mcp`, 'resources/read', environment(), { uri: 'https://attacker.example/secret' });
    expect(body.error.code).toBe(-32602);
  });

  it.each([404, 200])('refuses missing or SPA-fallback view assets with status %s rather than fetching a public origin', async (status) => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const env = environment(vi.fn(async () => new Response('<html>website shell</html>', { status })));
    const body = await rpc(`${ORIGIN}/mcp`, 'resources/read', env, { uri: DIAGRAM_VIEW_URI });
    expect(body.error.code).toBe(-32003);
    expect(network).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected backend failures without including secret exception text', async () => {
    vi.spyOn(renderer, 'handleRenderRequest').mockRejectedValueOnce(new Error('private internal detail'));
    const response = await worker.fetch(post(), environment(), ctx);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' } });
  });

  it('retains the shared per-address rate counter and only exposes render_diagram', async () => {
    const bind = vi.fn(() => ({ first: async () => ({ count: 31 }), run: async () => ({}) }));
    const env = { ...environment(), DB: { prepare: vi.fn(() => ({ bind })) }, OAUTH_GRANT_SECRET: 'unit-test-only' };
    const response = await worker.fetch(post(undefined, 'tools/call', {
      name: 'render_diagram', arguments: { diagramType: 'graph', source: '<mxfile/>' },
    }, { 'CF-Connecting-IP': '203.0.113.7' }), env, ctx);
    const body: any = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Rate limit');
    const bound = bind.mock.calls[0] as unknown[];
    expect(bound[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(bound)).not.toContain('203.0.113.7');
    expect(JSON.stringify(bound)).not.toContain('<mxfile/>');
    const listing = await rpc(`${ORIGIN}/mcp`, 'tools/list', env);
    expect(listing.result.tools.map((tool: any) => tool.name)).toEqual(['render_diagram']);
  });

  it('keeps render content in the response and writes only a hashed rate counter', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const bind = vi.fn(() => ({ first: async () => ({ count: 1 }), run: async () => ({}) }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { ...environment(), DB: { prepare }, OAUTH_GRANT_SECRET: 'unit-test-only' };
    const source = '<mxfile><diagram id="synthetic-test"/></mxfile>';
    const response = await worker.fetch(post(undefined, 'tools/call', {
      name: 'render_diagram', arguments: { diagramType: 'graph', source },
    }, { 'CF-Connecting-IP': '203.0.113.7' }), env, ctx);
    const body: any = await response.json();
    expect(body.result.structuredContent.source).toBe(source);
    expect(body.result.structuredContent.diagramType).toBe('graph');
    expect(prepare.mock.calls.every(([sql]) => String(sql).includes('McpRenderRate'))).toBe(true);
    expect(JSON.stringify(bind.mock.calls)).not.toContain(source);
    expect(network).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('preserves Mixpanel lifecycle dispatch using waitUntil without calling Confluence', async () => {
    const network = vi.fn(async () => new Response('1')); vi.stubGlobal('fetch', network);
    const env = { ...environment(), MIXPANEL_TOKEN: 'unit-test-token' };
    await worker.fetch(post(), env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalled();
    await Promise.all(ctx.waitUntil.mock.calls.map(([work]) => work));
    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0][0])).toBe('https://api.mixpanel.com/import');
    const payload = JSON.parse(network.mock.calls[0][1].body as string);
    expect(payload[0].event).toBe('agent_link_mcp_initialized');
  });
});

describe('static assets, origin isolation and health', () => {
  it.each(['/mcp-app/assets/view.js', '/drawio/js/viewer-static.min.js', '/drawio/stencils/aws.xml'])('serves canonical %s from independent ASSETS with public CORS', async (path) => {
    const env = environment(vi.fn(async () => new Response('independent bytes', { headers: { 'Content-Type': 'application/javascript' } })));
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`), env, ctx);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    expect(await response.text()).toBe('independent bytes');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves an independent asset 404 without website or SPA fallback', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const env = environment(vi.fn(async () => new Response('missing', { status: 404 })));
    const response = await worker.fetch(new Request(`${ORIGIN}/mcp-app/missing.js`), env, ctx);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('missing');
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    'https://conf-lite.zenuml.com/mcp-app/view.html',
    'https://conf-lite.zenuml.com/drawio/viewer.html',
    'https://zenuml.com/mcp/unknown?target=https://attacker.example',
    'https://zenuml.com/agent-link/mcp',
    'https://zenuml.com/mcp/health/',
  ])('passes %s unchanged to its original origin, never a query-selected destination', async (url) => {
    const network = vi.fn(async () => new Response('original', { status: 202 })); vi.stubGlobal('fetch', network);
    const request = new Request(url, { headers: { 'x-forwarded-host': 'attacker.example' } });
    const env = environment();
    const response = await worker.fetch(request, env, ctx);
    expect(network).toHaveBeenCalledWith(request);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('original');
  });

  it('does not recursively fetch a preview workers.dev URL outside owned routes', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const env = environment(); delete env.CANONICAL_ORIGIN;
    const response = await worker.fetch(new Request('https://preview.workers.dev/not-owned'), env, ctx);
    expect(response.status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['zenuml.com', 'conf-lite.zenuml.com'])('dispatches exact health on %s locally with only safe build fields', async (host) => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const env = environment(vi.fn(async () => Response.json({ ...BUILD, secret: 'never expose' })));
    const response = await worker.fetch(new Request(`https://${host}/mcp/health`), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: 'zenuml-render-mcp', ...BUILD });
    expect(network).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers health HEAD with no body and declines other health methods', async () => {
    const env = environment(vi.fn(async () => Response.json(BUILD)));
    const response = await worker.fetch(new Request(`${ORIGIN}/mcp/health`, { method: 'HEAD' }), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    const disallowed = await worker.fetch(post(`${ORIGIN}/mcp/health`), env, ctx);
    expect(disallowed.status).toBe(405);
    expect(disallowed.headers.get('Allow')).toBe('GET, HEAD');
  });

  it('never falls back to website health when independent build metadata is missing', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const env = environment(vi.fn(async () => new Response('missing', { status: 404 })));
    const response = await worker.fetch(new Request(`${ORIGIN}/mcp/health`), env, ctx);
    expect(response.status).toBe(503);
    expect(network).not.toHaveBeenCalled();
  });

  it('omits the body from a failed health HEAD response', async () => {
    const env = environment(vi.fn(async () => new Response('missing', { status: 404 })));
    const response = await worker.fetch(new Request(`${ORIGIN}/mcp/health`, { method: 'HEAD' }), env, ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });
});
