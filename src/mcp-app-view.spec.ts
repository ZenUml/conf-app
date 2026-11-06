import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractDiagram, onHostMessage, start, UI_PROTOCOL_VERSION } from './mcp-app-view';
import { compress } from '@/utils/compress';

const drawio = vi.hoisted(() => ({
  ensureDrawioViewerLoaded: vi.fn(async (_base?: string) => {}),
  ensureDrawioMathForDocument: vi.fn(),
}));
vi.mock('@/utils/drawio/loadDrawioViewer', () => drawio);

// The real engine needs a canvas, which jsdom lacks (engine.ts).
const { renderPlantUmlLocally, preloadPlantUmlEngine } = vi.hoisted(() => ({
  renderPlantUmlLocally: vi.fn<(code: string) => Promise<string>>(),
  preloadPlantUmlEngine: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/utils/plantuml/engine', () => ({ renderPlantUmlLocally, preloadPlantUmlEngine }));

const swagger = vi.hoisted(() => {
  const updateSpec = vi.fn();
  const SwaggerUI = Object.assign(vi.fn((_config: Record<string, unknown>) => ({ specActions: { updateSpec } })), {
    presets: { apis: 'apis-preset' },
  });
  return { SwaggerUI, updateSpec };
});
vi.mock('swagger-ui', () => ({ default: swagger.SwaggerUI }));
vi.mock('swagger-ui/dist/swagger-ui.css', () => ({}));

const sequence = vi.hoisted(() => ({ setDiagramFontUrl: vi.fn(), render: vi.fn(async () => {}) }));
vi.mock('@zenuml/core', () => ({
  default: Object.assign(vi.fn(function () { return { render: sequence.render }; }), {
    setDiagramFontUrl: sequence.setDiagramFontUrl,
  }),
}));
vi.mock('@zenuml/core/fonts/IBMPlexSans-Regular-Latin1.woff2?url', () => ({ default: 'https://view.example/mcp-app/assets/plex.woff2' }));
vi.mock('@zenuml/core/fonts/MS-Sans-Serif.ttf?url', () => ({ default: 'https://view.example/mcp-app/assets/mssans.ttf' }));

describe('extractDiagram', () => {
  // The host decides which of these shapes it hands us, and the answer has
  // differed per host in practice, so all three are supported deliberately
  // rather than by accident.
  it('reads structuredContent when the host provides it', () => {
    expect(extractDiagram({ structuredContent: { diagramType: 'mermaid', dsl: 'graph TD;A-->B;' } }))
      .toEqual({ diagramType: 'mermaid', dsl: 'graph TD;A-->B;', title: undefined });
  });

  it('reads a JSON text block when structuredContent is absent', () => {
    const payload = { diagramType: 'sequence', dsl: 'A->B: hi', title: 'Login' };
    expect(extractDiagram({ content: [{ type: 'text', text: JSON.stringify(payload) }] }))
      .toEqual(payload);
  });

  it('reads a bare payload passed straight through', () => {
    expect(extractDiagram({ diagramType: 'sequence', dsl: 'A->B: hi' }))
      .toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: undefined });
  });

  it('accepts `code` as well as `dsl`, so stored custom content renders', () => {
    // `dsl` is what the tools return; `code` is the field Confluence stores.
    expect(extractDiagram({ structuredContent: { diagramType: 'sequence', code: 'A->B: hi' } }))
      .toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: undefined });
  });

  it('unwraps the stored body that read_diagram actually returns', () => {
    // The real shape, as Codex hands it to the view: the diagram lives in
    // `source`, a JSON string, not at the top level.
    const read = {
      contentId: '11698177',
      title: 'Order Service',
      type: 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
      version: 5,
      source: JSON.stringify({ title: 'Order Service', code: 'A->B: hi', diagramType: 'sequence' }),
    };
    const result = { content: [{ type: 'text', text: JSON.stringify(read) }], structuredContent: read };
    expect(extractDiagram(result)).toEqual({ diagramType: 'sequence', dsl: 'A->B: hi', title: 'Order Service' });
  });

  it('takes the source field that matches the stored type, not the stale tabs', () => {
    const stored = {
      title: 'Flow',
      diagramType: 'mermaid',
      code: 'A->B: stale zenuml draft',
      mermaidCode: 'graph TD; A-->B;',
      plantUmlCode: '@startuml\nA -> B\n@enduml',
    };
    expect(extractDiagram({ structuredContent: { source: JSON.stringify(stored) } })?.dsl).toBe('graph TD; A-->B;');
    expect(
      extractDiagram({ structuredContent: { source: JSON.stringify({ ...stored, diagramType: 'plantuml' }) } }),
    ).toEqual({ diagramType: 'plantuml', dsl: '@startuml\nA -> B\n@enduml', title: 'Flow' });
  });

  it('reads read_diagram\'s unwrapped shape: DSL in `source`, type alongside', () => {
    // Since 95920e6d read_diagram returns the DSL itself, not the stored envelope.
    const result = {
      structuredContent: { contentId: '1', title: 'Flow', diagramType: 'mermaid', source: 'graph TD; A-->B;' },
    };
    expect(extractDiagram(result)).toEqual({ diagramType: 'mermaid', dsl: 'graph TD; A-->B;', title: 'Flow' });
  });

  it('keeps a JSON OpenAPI spec in `source`: it is JSON, but not the stored envelope', () => {
    const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Pets', version: '1' }, paths: {} });
    expect(
      extractDiagram({ structuredContent: { contentId: '1', title: 'Pets', diagramType: 'OpenAPI', source: spec } }),
    ).toEqual({ diagramType: 'OpenAPI', dsl: spec, title: 'Pets' });
  });

  it('takes a Board\'s boardGraphXml from the stored envelope, not the stale graphXml', () => {
    const stored = {
      title: 'Board',
      diagramType: 'graph',
      graphEditorMode: 'board',
      graphXml: '<mxGraphModel>stale</mxGraphModel>',
      boardGraphXml: '<mxfile>board</mxfile>',
    };
    expect(extractDiagram({ structuredContent: { source: JSON.stringify(stored) } })).toEqual({
      diagramType: 'graph',
      dsl: '<mxfile>board</mxfile>',
      title: 'Board',
    });
    const plain = { ...stored, graphEditorMode: undefined };
    expect(extractDiagram({ structuredContent: { source: JSON.stringify(plain) } })?.dsl).toBe(
      '<mxGraphModel>stale</mxGraphModel>',
    );
  });

  it('takes a Markdown record\'s markdownCode, not the stale code draft (#918)', () => {
    const stored = { title: 'Notes', diagramType: 'markdown', code: 'A->B: stale zenuml draft', markdownCode: '# Notes' };
    expect(extractDiagram({ structuredContent: { source: JSON.stringify(stored) } })?.dsl).toBe('# Notes');
  });

  it('skips a read_diagram source that is bare DSL with no type', () => {
    expect(extractDiagram({ structuredContent: { title: 'x', source: 'A->B: hi' } })).toBeNull();
  });

  it('prefers structuredContent over a text block that disagrees', () => {
    const result = {
      structuredContent: { diagramType: 'mermaid', dsl: 'from-structured' },
      content: [{ type: 'text', text: JSON.stringify({ diagramType: 'sequence', dsl: 'from-text' }) }],
    };
    expect(extractDiagram(result)?.dsl).toBe('from-structured');
  });

  it('skips a text block that is not JSON rather than giving up', () => {
    const result = {
      content: [
        { type: 'text', text: 'Updated the diagram.' },
        { type: 'text', text: JSON.stringify({ diagramType: 'mermaid', dsl: 'graph TD;A-->B;' }) },
      ],
    };
    expect(extractDiagram(result)?.dsl).toBe('graph TD;A-->B;');
  });

  it('returns null when there is no diagram, so the view can say so', () => {
    // A blank iframe is the worst outcome; null is what drives the message.
    for (const empty of [
      undefined,
      null,
      {},
      { content: [] },
      { content: [{ type: 'text', text: 'not json' }] },
      { structuredContent: { diagramType: 'mermaid' } },       // no dsl
      { structuredContent: { dsl: 'graph TD;A-->B;' } },        // no type
      { structuredContent: { diagramType: 42, dsl: 'x' } },
    ]) {
      expect(extractDiagram(empty)).toBeNull();
    }
  });

  it('ignores non-text content blocks', () => {
    expect(extractDiagram({ content: [{ type: 'image', data: 'base64' }] })).toBeNull();
  });
});

/**
 * The handshake, which is what actually decides whether anything renders.
 *
 * Claude Desktop fetched the view and drew nothing (2026-10-03) because the
 * View never answered the host's initialize response with
 * `ui/notifications/initialized`, and the host therefore never sent
 * tool-result. These tests exist so that cannot regress silently: the previous
 * spec covered only extractDiagram, so the whole transport was untested.
 */
describe('the host handshake', () => {
  let posted: Array<Record<string, unknown>>;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    posted = [];
    spy = vi.spyOn(window, 'postMessage').mockImplementation(((msg: unknown) => {
      posted.push(msg as Record<string, unknown>);
    }) as typeof window.postMessage);
  });

  afterEach(() => spy.mockRestore());

  function fire(data: unknown): void {
    onHostMessage({ data } as MessageEvent);
  }

  it('opens with a conformant ui/initialize request', () => {
    start();
    const init = posted.find((m) => m.method === 'ui/initialize');
    expect(init).toBeDefined();
    expect(typeof init!.id).toBe('number');
    const params = init!.params as Record<string, unknown>;
    // Empty params are what the first version sent; the host needs these.
    expect(params.protocolVersion).toBe(UI_PROTOCOL_VERSION);
    // The schema's names, not the spec example's clientInfo/capabilities,
    // which claude.ai refuses.
    expect(params.appInfo).toMatchObject({ name: expect.any(String), version: expect.any(String) });
    expect(params.appCapabilities).toBeDefined();
    expect(params).not.toHaveProperty('clientInfo');
    expect(params).not.toHaveProperty('capabilities');
  });

  it('answers the initialize response with ui/notifications/initialized', () => {
    start();
    const id = posted.find((m) => m.method === 'ui/initialize')!.id;
    posted.length = 0;
    fire({ jsonrpc: '2.0', id, result: { protocolVersion: UI_PROTOCOL_VERSION, hostInfo: {} } });
    expect(posted.map((m) => m.method)).toContain('ui/notifications/initialized');
  });

  it('does not acknowledge a response that is not ours', () => {
    start();
    posted.length = 0;
    fire({ jsonrpc: '2.0', id: 9999, result: {} });
    expect(posted.map((m) => m.method)).not.toContain('ui/notifications/initialized');
  });

  it('says so rather than hanging when the host refuses the view', () => {
    start();
    const id = posted.find((m) => m.method === 'ui/initialize')!.id;
    posted.length = 0;
    fire({ jsonrpc: '2.0', id, error: { code: -32000, message: 'nope' } });
    expect(posted.map((m) => m.method)).not.toContain('ui/notifications/initialized');
  });
});

describe('drawing a PlantUML result', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>hi</text></svg>';
  const beacon = vi.fn((_url: string, _body: string) => true);
  const reports = () => beacon.mock.calls.map(([url, body]) => ({ path: new URL(url).pathname, body: JSON.parse(body) }));
  const result = (structuredContent: Record<string, unknown>) =>
    onHostMessage({
      data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent } },
    } as MessageEvent);

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    beacon.mockClear();
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    renderPlantUmlLocally.mockReset();
    renderPlantUmlLocally.mockResolvedValue(svg);
    preloadPlantUmlEngine.mockReset();
    preloadPlantUmlEngine.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('draws with the local engine, as an image, and asks no server', async () => {
    const dsl = '@startuml\nAlice -> Bob: hi\n@enduml';
    result({ diagramType: 'PlantUml', dsl, title: 'Greeting' });

    await vi.waitFor(() => expect(document.querySelector('#app img')).not.toBeNull());
    const img = document.querySelector('#app img') as HTMLImageElement;
    expect(renderPlantUmlLocally).toHaveBeenCalledWith(dsl);
    // A data URL, so nothing in the drawing can run or reach the network.
    expect(img.getAttribute('src')).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect(img.alt).toBe('Greeting');

    img.onload?.(new Event('load'));
    await vi.waitFor(() => expect(beacon).toHaveBeenCalledOnce());
    expect(reports()).toEqual([{
      path: '/mcp/view-event',
      body: { macro_type: 'plantuml', render_outcome: 'rendered', plantuml_renderer: 'local' },
    }]);
  });

  it('shows the error and reports why when the engine cannot draw it, with no fallback', async () => {
    const dsl = '@startuml\n!include <azure/Foo>\n@enduml';
    const failure = Object.assign(new Error('This diagram uses an !include library that is not available yet'), { reason: 'include' });
    renderPlantUmlLocally.mockRejectedValue(failure);
    result({ diagramType: 'plantuml', dsl });

    await vi.waitFor(() =>
      expect(document.querySelector('#app')?.textContent).toMatch(/!include library that is not available/),
    );
    expect(document.querySelector('#app img')).toBeNull();
    expect(reports()[0].body).toEqual({
      macro_type: 'plantuml', render_outcome: 'failed', plantuml_renderer: 'failed', plantuml_failure_reason: 'include',
    });
    expect(JSON.stringify(reports())).not.toContain('azure');
  });

  it('never lets a failed report break the drawing', async () => {
    beacon.mockImplementation(() => { throw new Error('blocked'); });
    result({ diagramType: 'plantuml', dsl: '@startuml\n@enduml' });
    await vi.waitFor(() => expect(document.querySelector('#app img')).not.toBeNull());
    (document.querySelector('#app img') as HTMLImageElement).onload?.(new Event('load'));
    await vi.waitFor(() => expect(beacon).toHaveBeenCalled());
    expect(document.querySelector('#app img')).not.toBeNull();
  });
});

function deliver(structuredContent: Record<string, unknown>): void {
  onHostMessage({
    data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent } },
  } as MessageEvent);
}

describe('drawing a Sequence result', () => {
  it('configures hosted fonts before the first render in the host sandbox', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    sequence.setDiagramFontUrl.mockClear();
    sequence.render.mockClear();
    sequence.render.mockImplementationOnce(async () => {
      // Check at render time: configuring after render still attempts the
      // embedded data: font, which strict MCP host CSP refuses.
      expect(sequence.setDiagramFontUrl.mock.calls).toEqual([
        ['https://view.example/mcp-app/assets/plex.woff2'],
        ['https://view.example/mcp-app/assets/mssans.ttf', 'MS Sans Serif'],
      ]);
    });

    deliver({ diagramType: 'Sequence', dsl: 'Alice->Bob.hello()' });

    await vi.waitFor(() => expect(sequence.render).toHaveBeenCalledWith(
      'Alice->Bob.hello()', { theme: 'theme-default', stickyOffset: false },
    ));
    await vi.waitFor(() => expect(document.querySelector('#app')?.textContent).toBe(''));
  });
});

describe('drawing a Graph result', () => {
  const GraphViewer = vi.fn();
  const parseXml = vi.fn((xml: string) => new DOMParser().parseFromString(xml, 'text/xml'));

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    GraphViewer.mockClear();
    drawio.ensureDrawioViewerLoaded.mockClear();
    drawio.ensureDrawioMathForDocument.mockClear();
    vi.stubGlobal('GraphViewer', GraphViewer);
    vi.stubGlobal('mxUtils', { parseXml });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the DrawIO viewer from our origin and draws the XML, with no link-out lightbox', async () => {
    deliver({ diagramType: 'graph', source: '<mxGraphModel><root/></mxGraphModel>' });

    await vi.waitFor(() => expect(GraphViewer).toHaveBeenCalledTimes(1));
    // An absolute base, never the frame's: the frame's base is the host sandbox.
    expect(drawio.ensureDrawioViewerLoaded.mock.calls[0][0]).toMatch(/^[a-z]+:\/\//);
    const [container, node, config] = GraphViewer.mock.calls[0];
    expect(document.querySelector('#app')?.contains(container)).toBe(true);
    expect((node as Element).nodeName).toBe('mxGraphModel');
    expect(config).toMatchObject({ 'auto-fit': true, lightbox: false });
    // Before the GraphViewer: only Editors created after initMath typeset math.
    expect(drawio.ensureDrawioMathForDocument.mock.calls[0][0]).toBe(node);
    expect(drawio.ensureDrawioMathForDocument.mock.invocationCallOrder[0]).toBeLessThan(GraphViewer.mock.invocationCallOrder[0]);
  });

  it('decompresses a legacy compressed record before drawing it', async () => {
    deliver({ diagramType: 'graph', source: compress('<mxGraphModel><root/></mxGraphModel>') });

    await vi.waitFor(() => expect(GraphViewer).toHaveBeenCalledTimes(1));
    expect((GraphViewer.mock.calls[0][1] as Element).nodeName).toBe('mxGraphModel');
  });

  it('says so rather than drawing garbage when the source is not XML', async () => {
    deliver({ diagramType: 'graph', source: 'A -> B' });

    await vi.waitFor(() => expect(document.querySelector('#app')?.textContent).toMatch(/Could not draw/));
    expect(GraphViewer).not.toHaveBeenCalled();
  });
});

describe('drawing an OpenAPI result', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    swagger.SwaggerUI.mockClear();
    swagger.updateSpec.mockClear();
  });

  it('hands the spec to a read-only swagger-ui: no Try it out, no validator call-out', async () => {
    const spec = 'openapi: 3.0.0\ninfo:\n  title: Pets\n  version: "1"\npaths: {}\n';
    deliver({ diagramType: 'OpenAPI', source: spec });

    await vi.waitFor(() => expect(swagger.updateSpec).toHaveBeenCalledWith(spec));
    const config = swagger.SwaggerUI.mock.calls[0][0];
    expect(config).toMatchObject({ supportedSubmitMethods: [], validatorUrl: null, presets: ['apis-preset'] });
    expect(document.querySelector('#app')?.contains(config.domNode as Node)).toBe(true);
  });
});

// #1038: the renderer download is the slow part of a first diagram, so it
// starts on tool-input, and a failed download says so instead of hanging.
describe('loading the renderer', () => {
  type View = typeof import('./mcp-app-view');
  let view: View;
  const GraphViewer = vi.fn();

  beforeEach(async () => {
    // A fresh module per test: the view keeps one download per renderer.
    vi.resetModules();
    view = await import('./mcp-app-view');
    document.body.innerHTML = '<div id="app"></div>';
    GraphViewer.mockClear();
    drawio.ensureDrawioViewerLoaded.mockReset();
    drawio.ensureDrawioViewerLoaded.mockImplementation(async () => {});
    vi.stubGlobal('GraphViewer', GraphViewer);
    vi.stubGlobal('mxUtils', { parseXml: (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') });
  });
  afterEach(() => vi.unstubAllGlobals());

  function input(args: Record<string, unknown>): void {
    view.onHostMessage({
      data: { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: args } },
    } as MessageEvent);
  }
  function result(structuredContent: Record<string, unknown>): void {
    view.onHostMessage({
      data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent } },
    } as MessageEvent);
  }
  const XML = '<mxGraphModel><root/></mxGraphModel>';

  it('reads the coming diagram type from the tool input, detecting it when diagramType is left out', () => {
    expect(view.typeFromToolInput({ arguments: { diagramType: 'Mermaid', source: 'A->B.call()' } })).toBe('mermaid');
    expect(view.typeFromToolInput({ arguments: { source: 'flowchart TD\n A --> B' } })).toBe('mermaid');
    expect(view.typeFromToolInput({ arguments: { source: '@startuml\nA -> B\n@enduml' } })).toBe('plantuml');
    expect(view.typeFromToolInput({ arguments: { source: 'A->B.call()' } })).toBe('sequence');
    // read_diagram and friends carry no source in their input
    expect(view.typeFromToolInput({ arguments: { cloudId: 'c', contentId: '1' } })).toBeNull();
    expect(view.typeFromToolInput(undefined)).toBeNull();
  });

  it('starts the download on tool-input, before the tool has answered', async () => {
    input({ diagramType: 'graph', source: XML });

    await vi.waitFor(() => expect(drawio.ensureDrawioViewerLoaded).toHaveBeenCalledTimes(1));
    expect(document.querySelector('#app')?.textContent).toBe('Loading the renderer…');
    expect(GraphViewer).not.toHaveBeenCalled();
  });

  it('downloads once: the result reuses the download the input started', async () => {
    input({ diagramType: 'graph', source: XML });
    result({ diagramType: 'graph', source: XML });

    await vi.waitFor(() => expect(GraphViewer).toHaveBeenCalledTimes(1));
    // once by the shared download; renderGraph's own call returns at once in the real loader
    expect(drawio.ensureDrawioViewerLoaded.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('keeps the old status when the input does not say which renderer', () => {
    input({ cloudId: 'c', contentId: '1' });
    expect(document.querySelector('#app')?.textContent).toBe('Loading the diagram…');
  });

  it('says the renderer could not be downloaded, and tries again on the next result', async () => {
    drawio.ensureDrawioViewerLoaded.mockRejectedValueOnce(new Error('network timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    result({ diagramType: 'graph', source: XML });
    await vi.waitFor(() =>
      expect(document.querySelector('#app')?.textContent).toMatch(/Could not download the diagram renderer.*ask again/),
    );
    expect(GraphViewer).not.toHaveBeenCalled();

    result({ diagramType: 'graph', source: XML });
    await vi.waitFor(() => expect(GraphViewer).toHaveBeenCalledTimes(1));
  });
});
