/**
 * The MCP Apps view: renders the diagram a tool result describes, inside the
 * host's sandboxed iframe.
 *
 * Spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
 *
 * WHY THIS IS NOT A COMPONENT IN THE CONFLUENCE APP. It shares the renderers but
 * nothing else: there is no Forge bridge, no AP, no Confluence context, and no
 * persistence. It receives one payload over postMessage, draws it, and reports
 * its height. Keeping it a separate entry keeps `forgeGlobal` and the Confluence
 * store out of a bundle that runs in someone else's iframe.
 *
 * THE PROTOCOL, MINIMALLY. The host speaks JSON-RPC over postMessage, and the
 * handshake has THREE steps, not one:
 *
 *   1. View  -> `ui/initialize` (a request, with appInfo/appCapabilities/protocolVersion)
 *   2. Host  -> McpUiInitializeResult (the response to that request)
 *   3. View  -> `ui/notifications/initialized`
 *
 * Only after step 3 does the host send `ui/notifications/tool-input` and
 * `ui/notifications/tool-result`. Step 3 is not optional and it is easy to miss:
 * the first version of this file sent step 1 with empty params and never
 * answered step 2, so the host fetched the view, drew its frame, and then
 * correctly never delivered the diagram. The symptom is a widget that renders
 * nothing with no error anywhere (seen in Claude Desktop 2026-10-03;
 * agent_link_app_view_requested fired, agent_link_app_view_failed did not,
 * which is what proved the resource had been served and the fault was here).
 *
 * We answer nothing else, and we never call `tools/call` — this view only draws.
 */

/**
 * Resolved per call rather than captured once, so the handshake is reachable
 * from a test. Capturing `window.parent` at module load made every message
 * untestable, which is why the missing `ui/notifications/initialized` shipped.
 */
function host(): Window | null {
  return typeof window !== 'undefined' ? window.parent : null;
}

type Json = Record<string, unknown>;

/**
 * The public PlantUML server the Confluence app already draws with
 * (PlantUml.vue). PlantUML has no browser renderer, so the diagram is an <img>
 * of the server's SVG; `www.plantuml.com` is in the resource csp for exactly
 * this (mcpApps.ts uiCsp).
 */
export const PLANTUML_SVG_BASE = 'https://www.plantuml.com/plantuml/svg/';

/** Diagram payload, once we have found it in whatever shape the host delivered. */
interface DiagramPayload {
  diagramType: string;
  dsl: string;
  title?: string;
}

function send(method: string, params?: Json): void {
  // Targeting '*' is what the spec's transport does: the view cannot know the
  // host's origin, and the channel carries no secrets in this direction.
  host()?.postMessage({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }, '*');
}

let nextId = 1;
function request(method: string, params?: Json): number {
  const id = nextId++;
  host()?.postMessage({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, '*');
  return id;
}

/** The id of our `ui/initialize`, so its response can be told from any other. */
let initializeId: number | null = null;

/**
 * The spec's protocol revision, sent in `ui/initialize`.
 *
 * Hard-coded rather than negotiated: this view implements exactly one revision,
 * and claiming a different one would be a lie the host acts on.
 */
export const UI_PROTOCOL_VERSION = '2026-01-26';

/**
 * The stored custom-content body, if `source` is one: a JSON object carrying
 * `diagramType`. Anything else, a JSON OpenAPI spec included, is not.
 */
function storedEnvelope(source: unknown): Record<string, unknown> | null {
  if (typeof source !== 'string' || !source.trimStart().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(source) as unknown;
    return parsed && typeof parsed === 'object' && 'diagramType' in parsed ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Find the diagram in a tool result.
 *
 * Hosts may hand us `structuredContent`, or only the text block, and our own
 * tools return the payload at the top level. Rather than couple the view to one
 * shape, look in the three places it can be and give up visibly if it is in
 * none — a blank iframe is the worst outcome here.
 */
export function extractDiagram(result: unknown): DiagramPayload | null {
  const candidates: unknown[] = [];
  const r = result as { structuredContent?: unknown; content?: unknown } | undefined;
  if (r?.structuredContent) candidates.push(r.structuredContent);
  if (Array.isArray(r?.content)) {
    for (const block of r.content as Array<{ type?: unknown; text?: unknown }>) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        try {
          candidates.push(JSON.parse(block.text));
        } catch {
          // a text block that is not JSON is not a diagram; keep looking
        }
      }
    }
  }
  if (result && typeof result === 'object') candidates.push(result);

  // read_diagram answers with the stored custom-content body as it is in
  // Confluence: `source` is a JSON STRING holding `{title, code, diagramType}`.
  // Without unwrapping it no real read_diagram result ever renders — the shapes
  // above only match payloads we wrote ourselves.
  for (const candidate of [...candidates]) {
    const stored = storedEnvelope((candidate as { source?: unknown } | null)?.source);
    if (!stored) continue;
    // The stored body keeps one source field per type (the editor's tabs):
    // `code` is ZenUML and OpenAPI, `mermaidCode` Mermaid, `plantUmlCode`
    // PlantUML, `graphXml` (or `boardGraphXml` for a Board) Graph, and the
    // inactive ones keep stale drafts. Only the field for `diagramType` is the
    // diagram the page shows. Mirrors sourceFieldFor in headlessTools.ts.
    const type = typeof stored.diagramType === 'string' ? stored.diagramType.toLowerCase() : '';
    const field =
      type === 'mermaid' ? 'mermaidCode'
        : type === 'plantuml' ? 'plantUmlCode'
          : type === 'graph'
            ? stored.graphEditorMode === 'board' && stored.boardGraphXml !== undefined ? 'boardGraphXml' : 'graphXml'
            : 'code';
    candidates.push({
      diagramType: stored.diagramType,
      dsl: stored[field],
      title: stored.title ?? (candidate as { title?: unknown }).title,
    });
  }

  for (const candidate of candidates) {
    const c = candidate as { diagramType?: unknown; dsl?: unknown; code?: unknown; source?: unknown; title?: unknown };
    const type = typeof c?.diagramType === 'string' ? c.diagramType : undefined;
    // `dsl` is what our tools return; `code` is the stored custom-content field,
    // so a payload passed straight through from Confluence still renders.
    // `source` beside a `diagramType` is read_diagram's current shape: the DSL
    // already unwrapped from the stored envelope (95920e6d). A `source` that is
    // still the JSON envelope was handled above and is not DSL — but a JSON
    // OpenAPI spec is also JSON, and is the diagram.
    const bareSource = typeof c?.source === 'string' && !storedEnvelope(c.source) ? c.source : undefined;
    const dsl =
      typeof c?.dsl === 'string' ? c.dsl : typeof c?.code === 'string' ? c.code : bareSource;
    if (type && dsl) {
      return { diagramType: type, dsl, title: typeof c.title === 'string' ? c.title : undefined };
    }
  }
  return null;
}

/** Report our drawn height so the host can size the iframe to the diagram. */
function reportSize(): void {
  const el = document.getElementById('app');
  if (!el) return;
  const rect = el.getBoundingClientRect();
  send('ui/notifications/size-changed', {
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height) + 16,
  });
}

function status(message: string): void {
  const el = document.getElementById('app');
  if (el) el.innerHTML = `<p class="zen-mcp-status"></p>`;
  const p = el?.querySelector('.zen-mcp-status');
  if (p) p.textContent = message;
  reportSize();
}

/**
 * Our own origin, where the Pages deploy serves `drawio/` next to `mcp-app/`.
 * The frame's document base is the host's sandbox, so it cannot be used.
 */
function viewOrigin(): string {
  // Through a variable: Vite rewrites the literal `new URL(<path>, import.meta.url)`
  // as a build-time asset reference, and `/` is not one.
  const self = import.meta.url;
  return new URL('/', self).href;
}

/**
 * Graph (DrawIO XML), drawn by the same static DrawIO viewer the Confluence
 * app uses, loaded from our origin. Its stencil XML arrives by XHR, which is
 * why mcpApps.ts uiCsp puts our origin in `connectDomains`.
 */
async function renderGraph(el: HTMLElement, source: string): Promise<void> {
  let xml = source.trim();
  // Legacy records stored the XML LZUTF8-compressed (ForgeGraphViewerEmbed.vue
  // decompresses the same way). read_diagram passes the stored field through.
  if (!xml.startsWith('<')) {
    const { decompress } = await import('@/utils/compress');
    xml = String(decompress(xml) ?? '').trim();
  }
  if (!xml.startsWith('<')) throw new Error('the diagram is not DrawIO XML');

  const { ensureDrawioViewerLoaded } = await import('@/utils/drawio/loadDrawioViewer');
  await ensureDrawioViewerLoaded(viewOrigin());
  const w = window as typeof window & {
    mxUtils: { parseXml(xml: string): Document };
    GraphViewer: new (container: HTMLElement, xml: Element, config: Record<string, unknown>) => unknown;
  };
  el.innerHTML = '';
  const container = document.createElement('div');
  el.appendChild(container);
  // No toolbar and no lightbox: both link out to diagrams.net, which this
  // frame cannot open. Same options as ForgeGraphViewer.vue otherwise.
  new w.GraphViewer(container, w.mxUtils.parseXml(xml).documentElement, {
    'auto-fit': true,
    border: 10,
    lightbox: false,
  });
}

/**
 * OpenAPI, drawn by swagger-ui as OpenApiViewer.vue does, but read-only:
 * no "Try it out" (it would call the API from someone else's iframe) and no
 * validator badge (it calls validator.swagger.io).
 */
async function renderOpenApi(el: HTMLElement, spec: string): Promise<void> {
  const [{ default: SwaggerUI }] = await Promise.all([
    import('swagger-ui'),
    import('swagger-ui/dist/swagger-ui.css'),
  ]);
  el.innerHTML = '';
  const container = document.createElement('div');
  el.appendChild(container);
  const ui = SwaggerUI({
    domNode: container,
    presets: [SwaggerUI.presets.apis],
    supportedSubmitMethods: [],
    validatorUrl: null,
  });
  // A string, YAML or JSON, as the app passes it.
  ui.specActions.updateSpec(spec);
}

async function render(payload: DiagramPayload): Promise<void> {
  const el = document.getElementById('app');
  if (!el) return;
  const type = payload.diagramType.toLowerCase();

  try {
    if (type === 'mermaid') {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const { svg } = await mermaid.render(`zen-mcp-${Date.now()}`, payload.dsl);
      el.innerHTML = svg;
    } else if (type === 'plantuml') {
      const { plantumlEncode } = await import('@/utils/plantuml/encode');
      const img = document.createElement('img');
      img.alt = payload.title ?? 'PlantUML diagram';
      img.style.maxWidth = '100%';
      // The frame's height is only right once the image has a size, and a
      // syntax error still answers with an SVG (PlantUML draws the error), so
      // `error` here means the server itself was unreachable.
      const loaded = new Promise<void>((resolveLoad, rejectLoad) => {
        img.onload = () => resolveLoad();
        img.onerror = () => rejectLoad(new Error('the PlantUML server did not answer'));
      });
      img.src = PLANTUML_SVG_BASE + plantumlEncode(payload.dsl);
      el.innerHTML = '';
      el.appendChild(img);
      await loaded;
    } else if (type === 'sequence') {
      const { default: ZenUml } = await import('@zenuml/core');
      el.innerHTML = '';
      const zenuml = new ZenUml(el);
      // Read-only: no onContentChange, so nothing here can write back. The
      // option shape mirrors Sequence.vue's call, minus everything that needs a
      // Confluence store (scoped themes, sticky offset against a scrolling
      // iframe) — this frame does not scroll and has no per-diagram theme.
      await zenuml.render(payload.dsl, { theme: 'theme-default', stickyOffset: false });
    } else if (type === 'graph') {
      await renderGraph(el, payload.dsl);
    } else if (type === 'openapi') {
      await renderOpenApi(el, payload.dsl);
    } else {
      // AsyncAPI, Markdown and Embed are not wired up; anything else would
      // render blank, and saying so beats an empty frame.
      status(`This view cannot draw a ${payload.diagramType} diagram yet.`);
      return;
    }
  } catch (e) {
    status(`Could not draw the diagram: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  reportSize();
}

export function onHostMessage(event: MessageEvent): void {
  const msg = event.data as
    | { method?: unknown; params?: unknown; id?: unknown; result?: unknown; error?: unknown }
    | undefined;
  if (!msg) return;

  // Step 2 of the handshake: the response to our `ui/initialize`. Acknowledging
  // it with `ui/notifications/initialized` is what unblocks the host's
  // tool-input/tool-result notifications, so nothing renders without this.
  if (initializeId !== null && msg.id === initializeId && typeof msg.method !== 'string') {
    initializeId = null;
    if (msg.error) {
      status('The host refused this view.');
      return;
    }
    send('ui/notifications/initialized');
    return;
  }

  if (typeof msg.method !== 'string') return;

  if (msg.method === 'ui/notifications/tool-result') {
    const payload = extractDiagram(msg.params);
    if (payload) void render(payload);
    else status('No diagram in this result.');
    return;
  }

  if (msg.method === 'ui/notifications/tool-input') {
    // Arrives before the tool has answered. Only useful as a "something is
    // coming" signal; the result notification is what carries the diagram.
    status('Loading the diagram…');
  }
}

export function start(): void {
  window.addEventListener('message', onHostMessage);
  // Announce ourselves, then wait. A view that draws nothing until the host
  // speaks is correct: there is no diagram to draw before the tool answers.
  // `appInfo` / `appCapabilities` are the names McpUiInitializeRequestSchema
  // requires. The spec's prose example says `clientInfo` / `capabilities`, and
  // claude.ai validates against the schema: with those names it answered with
  // an error and the view showed "The host refused this view." (2026-10-17).
  initializeId = request('ui/initialize', {
    appCapabilities: { availableDisplayModes: ['inline'] },
    appInfo: { name: 'zenuml-diagram-view', version: '1' },
    protocolVersion: UI_PROTOCOL_VERSION,
  });
  status('Waiting for the diagram…');
  window.addEventListener('resize', reportSize);
  // swagger-ui and the DrawIO viewer keep laying out after render() returns
  // (sections expand, fonts and stencils arrive), so follow the content's own
  // size rather than measuring once.
  const app = document.getElementById('app');
  if (app && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => reportSize()).observe(app);
}

if (typeof window !== 'undefined' && window.parent !== window) start();
