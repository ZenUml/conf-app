import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { VIEW_MARKER } from '../../../functions/agent-link/oauth/mcpApps';
import { createLocalServer, DEFAULT_VIEW_ORIGIN, resolveViewOrigin, serveStdio } from './server';

const VIEW_HTML = `<!doctype html><html><head>${VIEW_MARKER}<script type="module" src="./assets/view-x.js"></script></head></html>`;

function viewFetch() {
  return vi.fn(async (_url: string) => new Response(VIEW_HTML, { status: 200 }));
}

describe('local render MCP server', () => {
  it('declares the MCP Apps extension and names itself local', async () => {
    const handle = createLocalServer({ fetchImpl: viewFetch(), version: '9.9.9' });
    const res = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(res?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
      serverInfo: { name: 'zenuml-render-local', version: '9.9.9' },
    });
    expect((res?.result as { instructions: string }).instructions).toContain('not sent to ZenUML');
  });

  it('answers render_diagram without any network call', async () => {
    const fetchImpl = viewFetch();
    const handle = createLocalServer({ fetchImpl });
    const res = await handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'render_diagram', arguments: { source: 'A.call() {\n  B.reply()\n}' } },
    });
    expect(res?.result).toMatchObject({
      structuredContent: { diagramType: 'sequence', source: 'A.call() {\n  B.reply()\n}', valid: true, detected: true },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('carries the same attempt chain as the public server', async () => {
    const handle = createLocalServer({ fetchImpl: viewFetch() });
    const call = (id: number, args: Record<string, unknown>) =>
      handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'render_diagram', arguments: args } });
    const first = (await call(6, { source: 'A->B: msg' }))?.result as { structuredContent: { attempt: number; revision: string } };
    expect(first.structuredContent.attempt).toBe(1);
    const second = (await call(7, { source: 'A->B: msg', revision: first.structuredContent.revision }))?.result as {
      structuredContent: { attempt: number };
      content: Array<{ text: string }>;
    };
    expect(second.structuredContent.attempt).toBe(2);
    expect(second.content[0].text).toContain('offer_to_save');
  });

  it('reports bad params as a tool error the model can read', async () => {
    const handle = createLocalServer({ fetchImpl: viewFetch() });
    const res = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'render_diagram', arguments: {} } });
    expect(res?.result).toMatchObject({ isError: true });
  });

  it('links the tool to the view and serves the view with absolute URLs and a CSP on the view origin', async () => {
    const fetchImpl = viewFetch();
    const handle = createLocalServer({ fetchImpl });
    const list = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect((list?.result as { tools: Array<{ _meta: unknown }> }).tools[0]._meta).toEqual({ ui: { resourceUri: 'ui://zenuml/diagram' } });

    const read = await handle({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'ui://zenuml/diagram' } });
    expect(fetchImpl).toHaveBeenCalledWith(`${DEFAULT_VIEW_ORIGIN}/mcp-app/view.html`);
    const content = (read?.result as { contents: Array<{ text: string; _meta: { ui: { csp: Record<string, string[]> } } }> }).contents[0];
    expect(content.text).toContain('src="https://zenuml.com/mcp-app/assets/view-x.js"');
    expect(content._meta.ui.csp.resourceDomains).toEqual(['https://zenuml.com']);
    expect(content._meta.ui.csp.connectDomains).toEqual(['https://zenuml.com']);
  });

  it('fails closed when the fetched page is not the view', async () => {
    const handle = createLocalServer({ fetchImpl: async () => new Response('<html>spa</html>', { status: 200 }) });
    const read = await handle({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'ui://zenuml/diagram' } });
    expect(read?.error).toMatchObject({ message: 'fetch_failed' });
  });

  it('serves the DSL guides and refuses unknown resources', async () => {
    const handle = createLocalServer({ fetchImpl: viewFetch() });
    const guide = await handle({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'zenuml://dsl-guide' } });
    expect((guide?.result as { contents: Array<{ mimeType: string }> }).contents[0].mimeType).toBe('text/markdown');
    const unknown = await handle({ jsonrpc: '2.0', id: 8, method: 'resources/read', params: { uri: 'file:///etc/passwd' } });
    expect(unknown?.error?.code).toBe(-32602);
  });

  it('does not answer notifications', async () => {
    const handle = createLocalServer({ fetchImpl: viewFetch() });
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
});

describe('resolveViewOrigin', () => {
  it('defaults to zenuml.com and accepts https or loopback http', () => {
    expect(resolveViewOrigin(undefined)).toBe('https://zenuml.com');
    expect(resolveViewOrigin('https://zenuml-render-mcp-preview.zenuml.workers.dev/x')).toBe(
      'https://zenuml-render-mcp-preview.zenuml.workers.dev',
    );
    expect(resolveViewOrigin('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('refuses plain http to a remote host', () => {
    expect(() => resolveViewOrigin('http://example.com')).toThrow(/https/);
  });
});

describe('stdio transport', () => {
  it('answers one line per request, in order, and reports bad JSON', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
    const done = serveStdio(createLocalServer({ fetchImpl: viewFetch() }), input, output);
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\nnot json\n');
    input.end('{"jsonrpc":"2.0","id":2,"method":"ping"}');
    await done;
    const messages = lines.map((l) => JSON.parse(l));
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON' } },
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, result: {} },
    ]);
  });
});
