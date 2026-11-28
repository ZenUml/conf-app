import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleRenderRequest, MAX_SOURCE_CHARS, RENDER_TOOL } from './renderMcp';
import { ZENUML_RENDER_CHEAT_SHEET } from './zenumlDslGuide';
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

  it('serves guides and guide descriptions that name render_diagram, not the Confluence edit tools', async () => {
    const list = await rpc('resources/list');
    for (const r of list.body.result.resources) {
      if (!String(r.uri).endsWith('://dsl-guide')) continue;
      expect(r.description).not.toMatch(/update_diagram|read_diagram/);
      const read = await rpc('resources/read', { uri: r.uri });
      const text = read.body.result.contents[0].text;
      expect(text).not.toMatch(/update_diagram|read_diagram|bound diagram/);
      expect(text).toContain('render_diagram');
    }
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

  it('keeps the tool description to the tool itself; the DSL guides are named in the server instructions', async () => {
    expect(RENDER_TOOL.description).not.toMatch(/dsl-guide|zenuml:\/\/|resource/);
    const { body } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(body.result.instructions).toMatch(/zenuml:\/\/.*dsl-guide/);
  });

  describe('guidance for agents', () => {
    it('puts the trigger first in the server instructions, before anything a client might cut', async () => {
      const { body } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      const text: string = body.result.instructions;
      expect(text.slice(0, 260)).toMatch(/sequence diagram/i);
      expect(text.slice(0, 260)).toMatch(/ASCII/);
      expect(text.slice(0, 260)).toMatch(/render_diagram/);
      expect(text).toMatch(/No Atlassian site or sign-in/);
    });

    it('starts the tool description with when to use it, and carries the ZenUML cheat sheet', () => {
      const d: string = RENDER_TOOL.description;
      expect(d.slice(0, 200)).toMatch(/sequence diagram/i);
      expect(d.slice(0, 200)).toMatch(/ASCII/);
      expect(d).toContain(ZENUML_RENDER_CHEAT_SHEET);
      expect(d.length).toBeLessThan(1600);
    });

    it('appends the ZenUML cheat sheet to a failed sequence parse, and only then', async () => {
      const bad = await call({ diagramType: 'sequence', source: 'A->B: POST /x {\n  B->C: y\n}' });
      const text: string = bad.body.result.content[0].text;
      expect(text).toMatch(/line 3, column 0/);
      expect(text).toContain(ZENUML_RENDER_CHEAT_SHEET);

      const good = await call({ diagramType: 'sequence', source: 'A->B.m() { C.n() }' });
      expect(good.body.result.content[0].text).not.toContain(ZENUML_RENDER_CHEAT_SHEET);

      const other = await call({ diagramType: 'openapi', source: 'openapi: 3.0.0\ninfo:\n  title: x\n  title: y\n' });
      expect(other.body.result.content[0].text).not.toContain(ZENUML_RENDER_CHEAT_SHEET);
    });
  });

  describe('ZenUML mistakes', () => {
    it('returns lint warnings for a message inside a group, which parses', async () => {
      const { body } = await call({ diagramType: 'sequence', source: 'group "Backend" {\n  A->B: msg\n}\nB->C: z' });
      const r = body.result.structuredContent;
      expect(r.valid).toBe(true);
      expect(r.warnings).toEqual([expect.objectContaining({ code: 'group_with_messages', line: 1, col: 0 })]);
      const text: string = body.result.content[0].text;
      expect(text).toMatch(/parsed, but/);
      expect(text).toMatch(/line 1, column 0: /);
    });

    it('returns lint warnings for a one-line block after an async message', async () => {
      const { body } = await call({ diagramType: 'sequence', source: 'A->B: POST /orders { B->C: save() }' });
      expect(body.result.structuredContent.warnings).toEqual([expect.objectContaining({ code: 'block_in_async_message', line: 1 })]);
    });

    it('returns no warnings for a valid diagram without those patterns', async () => {
      const { body } = await call({ diagramType: 'sequence', source: 'group "Backend" {\n  B\n}\nA->B.m() {\n  B->C: x\n}' });
      expect(body.result.structuredContent.warnings).toBeUndefined();
      expect(body.result.content[0].text).toMatch(/^Rendered the sequence diagram\. The source parsed\.\n\nNext:\n- offer_to_save/);
    });

    it('puts a targeted fix before the parser errors and keeps the cheat sheet as fallback', async () => {
      const { body } = await call({ diagramType: 'sequence', source: 'A->B: POST /x {\n  B->C: y\n}' });
      expect(body.result.structuredContent.hints).toEqual([expect.objectContaining({ code: 'block_after_async_message', line: 1 })]);
      const text: string = body.result.content[0].text;
      const fix = text.indexOf('A->B.method() {');
      expect(fix).toBeGreaterThan(-1);
      expect(fix).toBeLessThan(text.indexOf('line 3, column 0'));
      expect(text).toContain(ZENUML_RENDER_CHEAT_SHEET);
    });

    it('suggests a rewritten source for a group mistake, as the next call to make', async () => {
      const src = 'A->B: msg\ngroup "x" {\n  B->C: y\n}';
      const { body } = await call({ diagramType: 'sequence', source: src });
      const r = body.result.structuredContent;
      expect(r.suggestedSource).toBe('group "x" {\n  B\n  C\n}\nA->B: msg\nB->C: y');
      expect(r.source).toBe(src);
      const text: string = body.result.content[0].text;
      expect(text).toContain('call render_diagram again with this source');
      expect(text).toContain(r.suggestedSource);
      expect(text.indexOf(r.suggestedSource)).toBeLessThan(text.indexOf('ZenUML syntax:'));

      const parsed = await call({ diagramType: 'sequence', source: 'group "B" {\n  A->B: m\n}' });
      expect(parsed.body.result.structuredContent.suggestedSource).toBe('group "B" {\n  A\n  B\n}\nA->B: m');
    });

    it('suggests no source when there is nothing safe to rewrite', async () => {
      const { body } = await call({ diagramType: 'sequence', source: 'A->B: POST /x {\n  B->C: y\n}' });
      expect(body.result.structuredContent.suggestedSource).toBeUndefined();
    });

    it('does not lint other diagram types', async () => {
      const { body } = await call({ diagramType: 'mermaid', source: 'sequenceDiagram\n  A->>B: x { y }' });
      expect(body.result.structuredContent.warnings).toBeUndefined();
    });
  });

  it('returns valid source in the shape the view extracts', async () => {
    const { body } = await call({ diagramType: 'sequence', source: 'A->B: hello', title: 'Greeting' });
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual({
      diagramType: 'sequence',
      source: 'A->B: hello',
      title: 'Greeting',
      valid: true,
      attempt: 1,
      revision: expect.stringMatching(/^r1\./),
      nextActions: [expect.objectContaining({ action: 'offer_to_save' })],
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

  it('detects the type when diagramType is left out, and says so', async () => {
    const { body } = await call({ source: '@startuml\nAlice -> Bob: hi\n@enduml' });
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual(expect.objectContaining({ diagramType: 'plantuml', detected: true, valid: true }));
    expect(body.result.content[0].text).toMatch(/detected from the source/);
  });

  it('reads headerless source as ZenUML when diagramType is left out', async () => {
    const { body } = await call({ source: 'A->B: hi' });
    expect(body.result.structuredContent).toEqual(expect.objectContaining({ diagramType: 'sequence', detected: true, valid: true }));
  });

  it('treats a blank diagramType as left out', async () => {
    const { body } = await call({ diagramType: ' ', source: 'flowchart TD\n  A --> B' });
    expect(body.result.structuredContent.diagramType).toBe('mermaid');
  });

  it('keeps a given diagramType even when the source looks like another language', async () => {
    const { body } = await call({ diagramType: 'sequence', source: 'flowchart TD\n  A --> B' });
    expect(body.result.structuredContent.diagramType).toBe('sequence');
    expect(body.result.structuredContent.detected).toBeUndefined();
  });

  describe('attempt chain and next actions', () => {
    const groupAfter = 'A->B: msg\ngroup "x" {\n  B->C: y\n}';

    it('starts a chain: attempt 1, a revision in the text and the result', async () => {
      const { body } = await call({ diagramType: 'sequence', source: 'A->B: hi' });
      const r = body.result.structuredContent;
      expect(r.attempt).toBe(1);
      expect(body.result.content[0].text).toContain(`revision ${r.revision}`);
    });

    it('counts the next attempt when the revision comes back', async () => {
      const first = (await call({ diagramType: 'sequence', source: 'A->B: hi' })).body.result.structuredContent;
      const second = (await call({ diagramType: 'sequence', source: 'A->B: ho', revision: first.revision })).body.result.structuredContent;
      expect(second.attempt).toBe(2);
    });

    it('tells the agent to apply the rewrite, and to confirm grouped participants with the user', async () => {
      const r = (await call({ diagramType: 'sequence', source: groupAfter })).body.result;
      expect(r.structuredContent.nextActions.map((a: any) => a.action)).toEqual(['apply_suggested_source', 'confirm_with_user']);
      expect(r.content[0].text).toMatch(/Next:\n- /);
    });

    it('says fix and retry when there is no rewrite', async () => {
      const r = (await call({ diagramType: 'sequence', source: 'A->B.m(' })).body.result.structuredContent;
      expect(r.nextActions.map((a: any) => a.action)).toEqual(['fix_and_retry']);
    });

    it('offers to save only a clean render', async () => {
      const r = (await call({ diagramType: 'mermaid', source: 'flowchart TD\n  A --> B' })).body.result.structuredContent;
      expect(r.nextActions).toEqual([expect.objectContaining({ action: 'offer_to_save', detail: expect.stringMatching(/saves nothing/) })]);
    });

    it('names a repeated mistake and points at the rewrite', async () => {
      const first = (await call({ diagramType: 'sequence', source: groupAfter })).body.result.structuredContent;
      const again = (await call({ diagramType: 'sequence', source: `${groupAfter}\n`, revision: first.revision })).body.result;
      expect(again.content[0].text).toMatch(/^Same mistake as the previous attempt/);
    });

    it('treats an unreadable revision as a first attempt and still renders', async () => {
      const r = (await call({ diagramType: 'sequence', source: 'A->B: hi', revision: 'garbage' })).body.result;
      expect(r.isError).toBeUndefined();
      expect(r.structuredContent.attempt).toBe(1);
    });

    it('declares revision as optional input', () => {
      expect((RENDER_TOOL.inputSchema.properties as any).revision.type).toBe('string');
      expect(RENDER_TOOL.inputSchema.required).toEqual(['source']);
    });
  });

  it('only requires source in the input schema', () => {
    expect(RENDER_TOOL.inputSchema.required).toEqual(['source']);
  });

  it('marks graph as unvalidated rather than valid-by-parse', async () => {
    const { body } = await call({ diagramType: 'graph', source: '<mxGraphModel><root/></mxGraphModel>' });
    expect(body.result.structuredContent).toEqual(expect.objectContaining({ valid: true, unvalidated: true }));
  });

  it('rejects an unsupported type as a tool error the model can read', async () => {
    const { status, body } = await call({ diagramType: 'visio', source: 'whatever' });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/sequence, mermaid, plantuml, markdown, graph, openapi, asyncapi/);
  });

  it('accepts and structurally checks an AsyncAPI spec', async () => {
    const ok = await call({ diagramType: 'asyncapi', source: 'asyncapi: 3.0.0\ninfo:\n  title: Orders\n  version: 1.0.0\n' });
    expect(ok.body.result.isError).toBeFalsy();
    expect(ok.body.result.structuredContent).toEqual(expect.objectContaining({ diagramType: 'asyncapi', valid: true }));
    const bad = await call({ diagramType: 'asyncapi', source: 'info:\n  title: Orders\n' });
    expect(bad.body.result.structuredContent).toEqual(expect.objectContaining({ valid: false }));
  });

  it('detects an AsyncAPI spec when diagramType is left out', async () => {
    const { body } = await call({ source: 'asyncapi: 2.6.0\ninfo:\n  title: Orders\n  version: 1.0.0\n' });
    expect(body.result.structuredContent).toEqual(expect.objectContaining({ diagramType: 'asyncapi', detected: true }));
  });

  it('accepts Markdown as an unvalidated type', async () => {
    const { body } = await call({ diagramType: 'markdown', source: '# Notes\n\nSome text.' });
    expect(body.result.structuredContent).toEqual(expect.objectContaining({ diagramType: 'markdown', valid: true, unvalidated: true }));
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
    expect(RENDER_TOOL.inputSchema.properties.diagramType.enum).toEqual(['sequence', 'mermaid', 'plantuml', 'markdown', 'graph', 'openapi', 'asyncapi']);
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
          render_type_source: 'given',
        }),
      );
      expect(JSON.stringify(events)).not.toContain('secret-text');
    });

    it('records the recognised ZenUML mistakes and whether warnings were returned', async () => {
      const events = captureEvents();
      const env = { MIXPANEL_TOKEN: 't' };
      await call({ diagramType: 'sequence', source: 'A->B: ok' }, env);
      await call({ diagramType: 'sequence', source: 'group "x" {\n  A->B: m\n}' }, env);
      await call({ diagramType: 'sequence', source: 'A->B: m\ngroup "x" { B }' }, env);
      await call({ diagramType: 'sequence', source: 'A->B.m(' }, env);
      await call({ diagramType: 'mermaid', source: 'flowchart TD\n  A --> B' }, env);
      const props = events.filter((e) => e.event === 'agent_link_mcp_tool_called').map((e) => e.properties);
      expect(props[0]).toEqual(expect.objectContaining({ render_warnings_returned: false, render_fix_suggested: false }));
      expect(props[1].render_fix_suggested).toBe(true);
      expect(props[2].render_fix_suggested).toBe(true);
      expect(props[3].render_fix_suggested).toBe(false);
      expect(props[0].render_issues).toBeUndefined();
      expect(props[1]).toEqual(expect.objectContaining({ render_warnings_returned: true, render_issues: ['group_with_messages'] }));
      expect(props[2]).toEqual(expect.objectContaining({ render_warnings_returned: false, render_issues: ['group_after_message'] }));
      expect(props[3]).toEqual(expect.objectContaining({ render_validation: 'invalid', render_issues: ['unrecognised'] }));
      expect(props[4].render_issues).toBeUndefined();
      expect(props[4].render_warnings_returned).toBeUndefined();
    });

    it('records the attempt chain, whether the rewrite was applied, and the next actions', async () => {
      const events = captureEvents();
      const env = { MIXPANEL_TOKEN: 't' };
      const first = (await call({ diagramType: 'sequence', source: 'A->B: m\ngroup "x" { B }' }, env)).body.result.structuredContent;
      await call({ diagramType: 'sequence', source: first.suggestedSource, revision: first.revision }, env);
      await call({ diagramType: 'sequence', source: 'A->B: m', revision: 'garbage' }, env);
      const props = events.filter((e) => e.event === 'agent_link_mcp_tool_called').map((e) => e.properties);
      expect(props[0]).toEqual(expect.objectContaining({
        render_attempt: 1, render_revision_state: 'none', render_next_actions: ['apply_suggested_source'],
      }));
      expect(props[0].render_fix_applied).toBeUndefined();
      expect(props[1]).toEqual(expect.objectContaining({
        render_attempt: 2, render_revision_state: 'valid', render_fix_applied: true, render_next_actions: ['offer_to_save'],
      }));
      expect(props[2]).toEqual(expect.objectContaining({ render_attempt: 1, render_revision_state: 'invalid' }));
      expect(JSON.stringify(events)).not.toContain(first.revision);
    });

    it('records a refusal with its code', async () => {
      const events = captureEvents();
      await call({ diagramType: 'nope', source: 'x' }, { MIXPANEL_TOKEN: 't' });
      const e = events.find((x) => x.event === 'agent_link_mcp_tool_called');
      expect(e?.properties).toEqual(expect.objectContaining({ mcp_tool_outcome: 'tool_error', reason: 'bad_params' }));
    });

    it('marks our own smoke checks, and only them, as internal', async () => {
      const events = captureEvents();
      const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_diagram', arguments: { diagramType: 'sequence', source: 'A->B: hi' } } };
      await handleRenderRequest(post(body, { 'x-zenuml-internal-probe': 'render-mcp-ci-smoke' }), { MIXPANEL_TOKEN: 't' }, {});
      await handleRenderRequest(post(body), { MIXPANEL_TOKEN: 't' }, {});
      const calls = events.filter((x) => x.event === 'agent_link_mcp_tool_called');
      expect(calls[0].properties.internal_probe).toBe(true);
      expect(calls[1].properties.internal_probe).toBeUndefined();
    });

    it.each([
      ['?via=docs', 'docs'],
      ['?via=plugin-claude', 'plugin-claude'],
      ['?via=claude-dir', 'claude-dir'],
      ['?via=somewhere-else', 'other'],
      ['?via=', 'none'],
      ['', 'none'],
    ])('records the published URL a connection came through (%s -> %s)', async (search, channel) => {
      const events = captureEvents();
      const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-ai' } } };
      const toolCall = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'render_diagram', arguments: { diagramType: 'sequence', source: 'A->B: hi' } } };
      for (const body of [init, toolCall]) {
        await handleRenderRequest(
          new Request(`${URL_}${search}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
          { MIXPANEL_TOKEN: 't' },
          {},
        );
      }
      expect(events.map((e) => [e.event, e.properties.mcp_channel])).toEqual([
        ['agent_link_mcp_initialized', channel],
        ['agent_link_mcp_tool_called', channel],
      ]);
      expect(JSON.stringify(events)).not.toContain('somewhere-else');
      expect(events.every((e) => e.properties.internal_probe === undefined)).toBe(true);
    });

    it('treats ?via=internal as our own traffic, like the probe header', async () => {
      const events = captureEvents();
      const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_diagram', arguments: { diagramType: 'sequence', source: 'A->B: hi' } } };
      const res = await handleRenderRequest(
        new Request(`${URL_}?via=internal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        { MIXPANEL_TOKEN: 't' },
        {},
      );
      expect(((await res.json()) as any).result.structuredContent.valid).toBe(true);
      expect(events[0].properties).toEqual(expect.objectContaining({ mcp_channel: 'internal', internal_probe: true }));
    });

    it('records the handshake with the client name', async () => {
      const events = captureEvents();
      await rpc('initialize', { clientInfo: { name: 'claude-ai' } }, { MIXPANEL_TOKEN: 't' });
      const e = events.find((x) => x.event === 'agent_link_mcp_initialized');
      expect(e?.properties).toEqual(expect.objectContaining({ mcp_mode: 'render', mcp_client_name: 'claude-ai' }));
    });
  });
});
