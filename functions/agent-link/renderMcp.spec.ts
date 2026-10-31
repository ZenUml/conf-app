import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleRenderRequest, MAX_SOURCE_CHARS, RENDER_TOOL } from './renderMcp';
import { DIAGRAM_VIEW_URI, UI_MIME_TYPE } from './oauth/mcpApps';
import { RENDER_LIMIT } from './renderRateLimit';

const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const URL_ = `${ORIGIN}/mcp/render`;
const VIEW_HTML = '<!doctype html><html><head><meta name="mcp-app" content="zenuml-diagram"><script type="module" src="./assets/view-abc.js"></script></head><body></body></html>';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function rpc(method: string, params?: unknown, env: Record<string, unknown> = {}, deps = {}) {
  const res = await handleRenderRequest(post({ jsonrpc: '2.0', id: 1, method, params }), env, deps);
  return { status: res.status, body: (await res.json()) as any };
}

function call(args: Record<string, unknown>, env: Record<string, unknown> = {}) {
  return rpc('tools/call', { name: 'render_diagram', arguments: args }, env);
}

/** mixpanelService posts with the GLOBAL fetch, so that is where an emit is observable. */
function captureEvents() {
  const events: Array<Record<string, any>> = [];
  vi.stubGlobal('fetch', async (url: any, init: any) => {
    if (String(url).includes('mixpanel.com')) {
      for (const e of JSON.parse(String(init?.body ?? '[]'))) events.push(e);
      return new Response('1', { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  });
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /mcp/render', () => {
  it('answers initialize with no Authorization header at all', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } },
      clientInfo: { name: 'claude-ai', version: '1' },
    });
    expect(status).toBe(200);
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.capabilities.extensions['io.modelcontextprotocol/ui'].mimeTypes).toEqual([UI_MIME_TYPE]);
    expect(body.result.instructions).toMatch(/render_diagram/);
  });

  it('acknowledges notifications with 202 and no body', async () => {
    const res = await handleRenderRequest(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), {});
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('lists only render_diagram, linked to the view', async () => {
    const { body } = await rpc('tools/list');
    expect(body.result.tools.map((t: any) => t.name)).toEqual(['render_diagram']);
    expect(body.result.tools[0]._meta.ui.resourceUri).toBe(DIAGRAM_VIEW_URI);
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it('lists the view and the DSL guides as resources', async () => {
    const { body } = await rpc('resources/list');
    const uris = body.result.resources.map((r: any) => r.uri);
    expect(uris).toContain(DIAGRAM_VIEW_URI);
    expect(uris).toContain('zenuml://dsl-guide');
  });

  it('serves a DSL guide', async () => {
    const { body } = await rpc('resources/read', { uri: 'zenuml://dsl-guide' });
    expect(body.result.contents[0].text.length).toBeGreaterThan(100);
  });

  it('serves the view from its own origin, with absolute asset URLs', async () => {
    const fetchImpl = vi.fn(async () => new Response(VIEW_HTML, { status: 200 }));
    const { body } = await rpc('resources/read', { uri: DIAGRAM_VIEW_URI }, {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}/mcp-app/view.html`);
    expect(body.result.contents[0].mimeType).toBe(UI_MIME_TYPE);
    expect(body.result.contents[0].text).toContain(`src="${ORIGIN}/mcp-app/assets/view-abc.js"`);
  });

  it('refuses an unknown resource', async () => {
    const { status, body } = await rpc('resources/read', { uri: 'file:///etc/passwd' });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32602);
  });

  it('returns valid source in the shape the view extracts', async () => {
    const { body } = await call({ diagramType: 'sequence', source: 'A->B: hello', title: 'Greeting' });
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual({
      diagramType: 'sequence',
      source: 'A->B: hello',
      title: 'Greeting',
      valid: true,
    });
    expect(body.result.content[0].text).toMatch(/parsed/);
  });

  it('normalises the type name, so "Mermaid" is drawn as mermaid', async () => {
    const { body } = await call({ diagramType: 'Mermaid', source: 'flowchart TD\n  A --> B' });
    expect(body.result.structuredContent.diagramType).toBe('mermaid');
    expect(body.result.structuredContent.valid).toBe(true);
  });

  it('still returns the diagram, plus line/column errors, when the source does not parse', async () => {
    const { body } = await call({ diagramType: 'openapi', source: 'openapi: 3.0.0\ninfo:\n  title: x\n  title: y\n' });
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.valid).toBe(false);
    expect(body.result.structuredContent.errors[0]).toEqual(expect.objectContaining({ line: expect.any(Number) }));
    expect(body.result.content[0].text).toMatch(/did not parse/);
  });

  it('marks graph as unvalidated rather than valid-by-parse', async () => {
    const { body } = await call({ diagramType: 'graph', source: '<mxGraphModel><root/></mxGraphModel>' });
    expect(body.result.structuredContent).toEqual(expect.objectContaining({ valid: true, unvalidated: true }));
  });

  it('rejects an unsupported type as a tool error the model can read', async () => {
    const { status, body } = await call({ diagramType: 'asyncapi', source: 'asyncapi: 2.6.0' });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/sequence, mermaid, plantuml, graph, openapi/);
  });

  it('rejects empty and oversized source', async () => {
    expect((await call({ diagramType: 'mermaid', source: '  ' })).body.result.isError).toBe(true);
    const big = await call({ diagramType: 'mermaid', source: 'x'.repeat(MAX_SOURCE_CHARS + 1) });
    expect(big.body.result.isError).toBe(true);
  });

  it('answers an unknown tool with method-not-found', async () => {
    const { body } = await rpc('tools/call', { name: 'update_diagram', arguments: {} });
    expect(body.error.code).toBe(-32601);
  });

  it('answers a bad body with a parse error', async () => {
    const res = await handleRenderRequest(post('{nope'), {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32700);
  });

  it('declares the input schema the description promises', () => {
    expect(RENDER_TOOL.inputSchema.properties.diagramType.enum).toEqual(['sequence', 'mermaid', 'plantuml', 'graph', 'openapi']);
  });

  describe('rate limit', () => {
    /** A D1 stand-in that counts every UPSERT under one key. */
    function countingDb() {
      let count = 0;
      return {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ count: ++count }),
            run: async () => ({}),
          }),
        }),
      };
    }
    const renderFrom = (env: Record<string, unknown>) =>
      handleRenderRequest(
        post(
          { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_diagram', arguments: { diagramType: 'sequence', source: 'A->B: hi' } } },
          { 'CF-Connecting-IP': '203.0.113.7' },
        ),
        env,
      ).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

    it('refuses the call past the limit with a message the model can read', async () => {
      const env = { DB: countingDb() };
      for (let i = 0; i < RENDER_LIMIT; i++) expect((await renderFrom(env)).body.result.isError).toBeUndefined();
      const refused = await renderFrom(env);
      expect(refused.status).toBe(200);
      expect(refused.body.result.isError).toBe(true);
      expect(refused.body.result.content[0].text).toMatch(/Rate limit reached.*Try again in \d+ seconds/);
      expect(refused.body.result.structuredContent).toBeUndefined();
    });

    it('does not count handshakes', async () => {
      const db = countingDb();
      const spy = vi.spyOn(db, 'prepare');
      await rpc('initialize', {}, { DB: db });
      await rpc('tools/list', undefined, { DB: db });
      expect(spy).not.toHaveBeenCalled();
    });

    it('reports a refusal as rate_limited and a fail-open call as rate_limit_unavailable', async () => {
      const events = captureEvents();
      const env = { DB: countingDb(), MIXPANEL_TOKEN: 't' };
      for (let i = 0; i <= RENDER_LIMIT; i++) await renderFrom(env);
      expect(events.filter((e) => e.properties.mcp_tool_outcome === 'rate_limited')).toHaveLength(1);

      await renderFrom({ MIXPANEL_TOKEN: 't' }); // no DB bound
      expect(events.at(-1)?.properties).toEqual(expect.objectContaining({ mcp_tool_outcome: 'success', reason: 'rate_limit_unavailable' }));
    });
  });

  describe('analytics', () => {
    it('tags render calls with mcp_mode render, type and validation, never the source', async () => {
      const events = captureEvents();
      await call({ diagramType: 'sequence', source: 'A->B: secret-text' }, { MIXPANEL_TOKEN: 't' });
      const e = events.find((x) => x.event === 'agent_link_mcp_tool_called');
      expect(e?.properties).toEqual(
        expect.objectContaining({
          mcp_mode: 'render',
          mcp_tool: 'render_diagram',
          mcp_tool_outcome: 'success',
          macro_type: 'sequence',
          render_validation: 'valid',
        }),
      );
      expect(JSON.stringify(events)).not.toContain('secret-text');
    });

    it('records a refusal with its code', async () => {
      const events = captureEvents();
      await call({ diagramType: 'nope', source: 'x' }, { MIXPANEL_TOKEN: 't' });
      const e = events.find((x) => x.event === 'agent_link_mcp_tool_called');
      expect(e?.properties).toEqual(expect.objectContaining({ mcp_tool_outcome: 'tool_error', reason: 'bad_params' }));
    });

    it('records the handshake with the client name', async () => {
      const events = captureEvents();
      await rpc('initialize', { clientInfo: { name: 'claude-ai' } }, { MIXPANEL_TOKEN: 't' });
      const e = events.find((x) => x.event === 'agent_link_mcp_initialized');
      expect(e?.properties).toEqual(expect.objectContaining({ mcp_mode: 'render', mcp_client_name: 'claude-ai' }));
    });
  });
});
