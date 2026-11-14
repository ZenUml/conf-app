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

import { detectDiagramType } from '../functions/agent-link/detectDiagramType';
import { createGestureGate, createWheelStepper, isZoomIntent } from '@/utils/viewport/wheelZoom';

type Json = Record<string, unknown>;

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

/** Our other requests (`ui/request-display-mode`) waiting for the host's answer. */
const pendingRequests = new Map<number, (response: { result?: unknown; error?: unknown }) => void>();

/** A request whose answer we need. Rejects if the host has not answered in `timeoutMs`. */
function ask(method: string, params: Json, timeoutMs = 10_000): Promise<{ result?: unknown; error?: unknown }> {
  const id = request(method, params);
  return new Promise((resolveAsk, rejectAsk) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      rejectAsk(new Error(`${method} got no answer`));
    }, timeoutMs);
    pendingRequests.set(id, (response) => {
      clearTimeout(timer);
      resolveAsk(response);
    });
  });
}

/**
 * The parts of the spec's HostContext this view uses. It arrives in the
 * `ui/initialize` result and changes by `ui/notifications/host-context-changed`,
 * which carries only the fields that changed.
 */
interface HostContext {
  displayMode?: string;
  availableDisplayModes?: string[];
  containerDimensions?: { width?: number; maxWidth?: number; height?: number; maxHeight?: number };
}

let hostContext: HostContext = {};

/** Reset between tests: the state above lives as long as the frame. */
export function resetViewState(): void {
  hostContext = {};
  drawnType = null;
  userZoom = 1;
  pendingRequests.clear();
}

function isFullscreen(): boolean {
  return hostContext.displayMode === 'fullscreen';
}

/** The host offers fullscreen. The spec says to check this before asking for it. */
export function fullscreenAvailable(): boolean {
  return Array.isArray(hostContext.availableDisplayModes) && hostContext.availableDisplayModes.includes('fullscreen');
}

/** The type of the diagram on screen, or null while there is none (status text). */
let drawnType: string | null = null;

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
    // PlantUML, `markdownCode` Markdown, `graphXml` (or `boardGraphXml` for a
    // Board) Graph, and the inactive ones keep stale drafts. Only the field for
    // `diagramType` is the diagram the page shows. Mirrors sourceFieldFor in
    // headlessTools.ts.
    const type = typeof stored.diagramType === 'string' ? stored.diagramType.toLowerCase() : '';
    const field =
      type === 'mermaid' ? 'mermaidCode'
        : type === 'plantuml' ? 'plantUmlCode'
          : type === 'markdown' ? 'markdownCode'
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
  drawnType = null;
  updateToolbar();
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

  const { ensureDrawioMathForDocument, ensureDrawioViewerLoaded } = await import('@/utils/drawio/loadDrawioViewer');
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
  const xmlNode = w.mxUtils.parseXml(xml).documentElement;
  ensureDrawioMathForDocument(xmlNode);
  // Not auto-fit, and room to draw: the viewer shrinks a diagram to its
  // container's width and draws nothing into a zero-width one, which is what
  // the content-sized fit box is before it has content. Drawn wide, it keeps
  // its natural size and sets that width on `container`; fitDiagram scales it.
  el.style.width = '100000px';
  try {
    new w.GraphViewer(container, xmlNode, {
      'auto-fit': false,
      border: 10,
      lightbox: false,
    });
  } finally {
    el.style.width = '';
  }
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

/**
 * Markdown, with the app's own renderer (react-markdown + GFM, raw HTML
 * escaped). Its ```mermaid blocks are drawn with this view's Mermaid, under
 * the same strict security level as a Mermaid diagram here.
 */
async function renderMarkdownView(el: HTMLElement, source: string): Promise<void> {
  const { renderMarkdownDocument } = await import('@/utils/markdown/renderMarkdownDocument');
  const { html } = await renderMarkdownDocument(source, async (id, block) => {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return mermaid.render(`zen-mcp-${id}`, block);
  });
  el.innerHTML = '';
  const article = document.createElement('article');
  article.className = 'zen-mcp-markdown';
  article.innerHTML = html;
  el.appendChild(article);
}

/**
 * Download a diagram type's renderer, once per frame.
 *
 * The renderer chunks are the slow part of a first diagram (hundreds of KB
 * each; more than 20 s on a slow link, #1038), so the download starts as soon
 * as `ui/notifications/tool-input` says which type is coming, not when the
 * tool answers. render() then awaits the same promise. A failed download is
 * forgotten so a later call can try again.
 */
const rendererLoads = new Map<string, Promise<unknown>>();

export function loadRenderer(type: string): Promise<unknown> | null {
  const cached = rendererLoads.get(type);
  if (cached) return cached;
  // Each import names only what render() uses (`then(({ default: d }) => d)`),
  // so Rollup can still drop the rest: a bare import('@zenuml/core') kept every
  // export and added 37 KB to the sequence renderer.
  const load =
    type === 'mermaid' ? import('mermaid').then(({ default: mermaid }) => mermaid)
      : type === 'sequence' ? import('@zenuml/core').then(({ default: ZenUml }) => ZenUml)
        : type === 'openapi' ? Promise.all([import('swagger-ui'), import('swagger-ui/dist/swagger-ui.css')])
          : type === 'plantuml' ? import('@/utils/plantuml/engine').then(({ preloadPlantUmlEngine }) => preloadPlantUmlEngine())
            : type === 'graph'
              ? import('@/utils/drawio/loadDrawioViewer').then(({ ensureDrawioViewerLoaded }) => ensureDrawioViewerLoaded(viewOrigin()))
              : type === 'asyncapi'
                ? import('@/utils/asyncapi/renderAsyncApiOutline').then(({ renderAsyncApiOutline }) => renderAsyncApiOutline)
                : type === 'markdown'
                  ? import('@/utils/markdown/renderMarkdownDocument').then(({ renderMarkdownDocument }) => renderMarkdownDocument)
                  : null;
  if (!load) return null;
  rendererLoads.set(type, load);
  load.catch(() => rendererLoads.delete(type));
  return load;
}

/** The diagram type a tool call's arguments are about to produce, if they say. */
export function typeFromToolInput(params: unknown): string | null {
  const args = (params as { arguments?: unknown } | undefined)?.arguments as
    | { diagramType?: unknown; source?: unknown }
    | undefined;
  if (typeof args?.diagramType === 'string' && args.diagramType) return args.diagramType.toLowerCase();
  // render_diagram may leave diagramType out; the server then detects it the same way.
  if (typeof args?.source === 'string' && args.source.trim()) return detectDiagramType(args.source);
  return null;
}

/**
 * Draw the engine's SVG as an <img> from a data URL, not inline. An image cannot
 * run script or fetch anything, whatever the agent put in the source, and the
 * host's CSP allows `data:` images by default.
 */
async function renderPlantUml(el: HTMLElement, payload: DiagramPayload): Promise<void> {
  const { renderPlantUmlLocally } = await import('@/utils/plantuml/engine');
  const svg = await renderPlantUmlLocally(payload.dsl);
  const img = document.createElement('img');
  img.alt = payload.title ?? 'PlantUML diagram';
  // Natural size: fitDiagram scales the box it sits in.
  // The frame's height is only right once the image has a size.
  const loaded = new Promise<void>((resolveLoad, rejectLoad) => {
    img.onload = () => resolveLoad();
    img.onerror = () => rejectLoad(new Error('the drawing could not be shown'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  el.innerHTML = '';
  el.appendChild(img);
  await loaded;
}

/**
 * Tell our own origin what became of this diagram (viewEvent.ts): only this
 * frame knows. A string body is a CORS-simple request, so a sandboxed frame needs
 * no preflight. Enums only, never the source or the title.
 */
function reportRender(type: string, failure?: unknown): void {
  const failed = failure !== undefined;
  const reason = (failure as { reason?: unknown } | undefined)?.reason;
  try {
    navigator.sendBeacon?.(
      new URL('mcp/view-event', viewOrigin()).href,
      JSON.stringify({
        macro_type: type,
        render_outcome: failed ? 'failed' : 'rendered',
        fullscreen_available: fullscreenAvailable(),
        ...(type === 'plantuml'
          ? { plantuml_renderer: failed ? 'failed' : 'local', ...(typeof reason === 'string' ? { plantuml_failure_reason: reason } : {}) }
          : {}),
      }),
    );
  } catch {
    // analytics never fails a render
  }
}

/** Drawings, scaled to fit. Markdown, OpenAPI and AsyncAPI are documents that reflow instead. */
const FIT_TYPES = new Set(['sequence', 'mermaid', 'plantuml', 'graph']);

/** How far fullscreen may enlarge a small diagram; inline never enlarges. */
const MAX_FULLSCREEN_SCALE = 3;
/** Below this a diagram is unreadable: keep it here and let the frame scroll. */
const MIN_SCALE = 0.25;
/** The body's default margin on each side. */
const PAGE_MARGIN = 8;

let fitObserver: ResizeObserver | null = null;

/**
 * An empty `.zen-mcp-fit` box in `el`, holding the `.zen-mcp-fit-inner`
 * element the renderer draws into. The inner element keeps the drawing's
 * natural size, which the scale is worked out from (a transform does not
 * change offsetWidth), and the outer box takes the scaled size so the page,
 * and the size we report, follow what is seen.
 */
function prepareFitBox(el: HTMLElement): HTMLElement {
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'zen-mcp-fit';
  const inner = document.createElement('div');
  inner.className = 'zen-mcp-fit-inner';
  box.appendChild(inner);
  el.appendChild(box);
  // The DrawIO viewer and ZenUML keep laying out after they return (stencils,
  // fonts), so refit whenever the natural size changes.
  fitObserver?.disconnect();
  fitObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fitDiagram()) : null;
  fitObserver?.observe(inner);
  return inner;
}

/**
 * Mermaid draws `width="100%"` with a `max-width` style, which has no natural
 * width inside a box sized to its content. Give it the viewBox's size.
 */
function giveSvgItsNaturalSize(container: HTMLElement): void {
  const svg = container.querySelector('svg');
  const box = svg?.viewBox?.baseVal;
  if (!svg || !box || !box.width || !box.height) return;
  svg.setAttribute('width', String(box.width));
  svg.setAttribute('height', String(box.height));
  svg.style.maxWidth = '';
}

/** The strip above the diagram that the toolbar sits in (view.html's #app padding). */
const TOOLBAR_SPACE = 34;

/** The space the diagram may take, from the host's container where it says. */
function availableSpace(): { width: number; height: number | null } {
  const dims = hostContext.containerDimensions ?? {};
  const width = (dims.width ?? dims.maxWidth ?? document.documentElement.clientWidth) - 2 * PAGE_MARGIN;
  const fixedHeight = dims.height ?? (isFullscreen() ? window.innerHeight : null);
  const toolbar = document.getElementById('zen-mcp-toolbar') ? TOOLBAR_SPACE : 0;
  return { width, height: fixedHeight === null ? null : fixedHeight - 2 * PAGE_MARGIN - toolbar };
}

/** The scale for a drawing of this natural size. Exported for its tests. */
export function fitScale(
  natural: { width: number; height: number },
  space: { width: number; height: number | null },
  fullscreen: boolean,
): number {
  let scale = space.width / natural.width;
  if (fullscreen && space.height) scale = Math.min(scale, space.height / natural.height);
  scale = Math.min(scale, fullscreen ? MAX_FULLSCREEN_SCALE : 1);
  return Math.max(scale, MIN_SCALE);
}

/** Scale the drawing on screen to the space it has. Documents are left alone. */
function fitDiagram(): void {
  const box = document.querySelector<HTMLElement>('#app .zen-mcp-fit');
  const inner = box?.querySelector<HTMLElement>('.zen-mcp-fit-inner');
  if (!box || !inner) return;
  const natural = { width: inner.offsetWidth, height: inner.offsetHeight };
  if (!natural.width || !natural.height) return;
  const scale = fitScale(natural, availableSpace(), isFullscreen()) * userZoom;
  inner.style.transform = scale === 1 ? '' : `scale(${scale})`;
  box.style.width = `${Math.ceil(natural.width * scale)}px`;
  box.style.height = `${Math.ceil(natural.height * scale)}px`;
  box.dataset.scale = scale.toFixed(3);
  updateZoomLabel(scale);
}

/**
 * The reader's zoom, on top of the fit: 1 is fitted. The same step and limits
 * as the Confluence viewer's DiagramTransformViewport, so a diagram zooms the
 * same way in a host as on the page.
 */
let userZoom = 1;
const ZOOM_STEP = 1.2;
const MIN_USER_ZOOM = 0.2;
const MAX_USER_ZOOM = 12;

export type ZoomAction = 'zoom_in' | 'zoom_out' | 'fit';
export type ZoomInput = 'toolbar' | 'wheel' | 'keyboard';

/** Zoom only drawings; documents reflow and keep the host's text zoom. */
function zoomable(): boolean {
  return drawnType !== null && FIT_TYPES.has(drawnType);
}

/** The reader's zoom over the fit (1 = fitted). Exported for tests. */
export function currentUserZoom(): number {
  return userZoom;
}

/**
 * Zoom in, out or back to fit, keeping the point at the middle of what is
 * visible where it was. Returns whether anything changed.
 */
export function zoom(action: ZoomAction): boolean {
  if (!zoomable()) return false;
  const next =
    action === 'fit' ? 1
      : Math.min(MAX_USER_ZOOM, Math.max(MIN_USER_ZOOM, userZoom * (action === 'zoom_in' ? ZOOM_STEP : 1 / ZOOM_STEP)));
  if (next === userZoom) return false;
  const app = document.getElementById('app');
  const page = document.scrollingElement ?? document.documentElement;
  // Where the middle of the view sits, as a fraction of what can be scrolled.
  const middleX = app && app.scrollWidth ? (app.scrollLeft + app.clientWidth / 2) / app.scrollWidth : 0.5;
  const middleY = page.scrollHeight ? (page.scrollTop + window.innerHeight / 2) / page.scrollHeight : 0.5;
  userZoom = next;
  fitDiagram();
  reportSize();
  if (app) app.scrollLeft = middleX * app.scrollWidth - app.clientWidth / 2;
  page.scrollTop = middleY * page.scrollHeight - window.innerHeight / 2;
  return true;
}

function zoomAndReport(action: ZoomAction, input: ZoomInput): void {
  if (zoom(action)) reportZoom(action, input);
}

function reportZoom(action: ZoomAction, input: ZoomInput): void {
  if (!drawnType) return;
  try {
    navigator.sendBeacon?.(
      new URL('mcp/view-event', viewOrigin()).href,
      JSON.stringify({
        kind: 'zoom',
        macro_type: drawnType,
        viewport_action: action,
        viewport_input: input,
        fullscreen_active: isFullscreen(),
      }),
    );
  } catch {
    // analytics never fails the view
  }
}

function updateZoomLabel(scale: number): void {
  const label = document.getElementById('zen-mcp-zoom-fit');
  if (!label) return;
  label.textContent = `${Math.round(scale * 100)}%`;
  label.title = userZoom === 1 ? 'Fitted to the view' : 'Back to fit';
}

/** Merge what the host sent, then follow it: the button, the mode, the fit. */
export function applyHostContext(changed: HostContext): void {
  const wasFullscreen = isFullscreen();
  hostContext = { ...hostContext, ...changed };
  // A new size of view starts fitted, as a new diagram does.
  if (isFullscreen() !== wasFullscreen) userZoom = 1;
  document.documentElement.dataset.displayMode = isFullscreen() ? 'fullscreen' : 'inline';
  updateToolbar();
  fitDiagram();
  reportSize();
}

const ENTER_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const EXIT_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const ZOOM_OUT_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ZOOM_IN_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10M8 3v10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

function toolButton(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'zen-mcp-tool';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

/**
 * The toolbar in the top-right corner: zoom controls for a drawing, and the
 * fullscreen button where the host offers fullscreen. Rebuilt when either
 * changes, and absent while there is no diagram.
 */
function updateToolbar(): void {
  const wantsZoom = zoomable();
  const wantsFullscreen = fullscreenAvailable() && drawnType !== null;
  let bar = document.getElementById('zen-mcp-toolbar');
  if (!wantsZoom && !wantsFullscreen) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'zen-mcp-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Diagram view');
    document.body.appendChild(bar);
  }
  const hasZoom = !!document.getElementById('zen-mcp-zoom-in');
  if (wantsZoom && !hasZoom) {
    const out = toolButton('zen-mcp-zoom-out', 'Zoom out', () => zoomAndReport('zoom_out', 'toolbar'));
    out.innerHTML = ZOOM_OUT_ICON;
    const fit = toolButton('zen-mcp-zoom-fit', 'Back to fit', () => zoomAndReport('fit', 'toolbar'));
    fit.classList.add('zen-mcp-zoom-level');
    const zoomIn = toolButton('zen-mcp-zoom-in', 'Zoom in', () => zoomAndReport('zoom_in', 'toolbar'));
    zoomIn.innerHTML = ZOOM_IN_ICON;
    // Before the fullscreen button, in reading order.
    for (const control of [zoomIn, fit, out]) bar.insertBefore(control, bar.firstChild);
  } else if (!wantsZoom && hasZoom) {
    for (const id of ['zen-mcp-zoom-out', 'zen-mcp-zoom-fit', 'zen-mcp-zoom-in']) document.getElementById(id)?.remove();
  }
  let button = document.getElementById('zen-mcp-fullscreen') as HTMLButtonElement | null;
  if (!wantsFullscreen) {
    button?.remove();
    return;
  }
  if (!button) {
    button = toolButton('zen-mcp-fullscreen', 'Fullscreen', () => void toggleFullscreen());
    bar.appendChild(button);
  }
  const label = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
  button.innerHTML = isFullscreen() ? EXIT_ICON : ENTER_ICON;
  button.title = label;
  button.setAttribute('aria-label', label);
}

/**
 * Keys inside the frame: Esc leaves fullscreen (the host's own key handling
 * cannot see a key pressed in our frame); + and - zoom, 0 goes back to fit.
 * Not with Ctrl/Cmd, which is the browser's own page zoom.
 */
export function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isFullscreen()) {
    void toggleFullscreen();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const action: ZoomAction | null = e.key === '+' || e.key === '=' ? 'zoom_in' : e.key === '-' ? 'zoom_out' : e.key === '0' ? 'fit' : null;
  if (!action || !zoomable()) return;
  e.preventDefault();
  zoomAndReport(action, 'keyboard');
}

/** One report per wheel gesture, as in the Confluence viewer. */
const wheelGestureStarts = createGestureGate();
const wheelStep = createWheelStepper((direction) => {
  const action: ZoomAction = direction > 0 ? 'zoom_in' : 'zoom_out';
  if (zoom(action) && wheelGestureStarts()) reportZoom(action, 'wheel');
});

/**
 * Ctrl/Cmd + wheel, and trackpad pinch (which arrives as one), zoom the
 * drawing. A plain wheel stays the frame's to scroll.
 */
export function onWheel(e: WheelEvent): void {
  if (!isZoomIntent(e) || !zoomable()) return;
  e.preventDefault();
  wheelStep(e, window.innerHeight);
}

/** Ask the host for the other display mode, and follow its answer. */
export async function toggleFullscreen(): Promise<void> {
  const wanted = isFullscreen() ? 'inline' : 'fullscreen';
  let outcome: 'entered' | 'exited' | 'declined' | 'failed';
  try {
    const answer = await ask('ui/request-display-mode', { mode: wanted });
    const mode = (answer.result as { mode?: unknown } | undefined)?.mode;
    if (answer.error || typeof mode !== 'string') {
      outcome = 'failed';
    } else {
      // The host may answer with another mode than we asked for; it says which.
      applyHostContext({ displayMode: mode });
      outcome = mode !== wanted ? 'declined' : mode === 'fullscreen' ? 'entered' : 'exited';
    }
  } catch {
    outcome = 'failed';
  }
  reportFullscreen(outcome);
}

function reportFullscreen(outcome: string): void {
  if (!drawnType) return;
  try {
    navigator.sendBeacon?.(
      new URL('mcp/view-event', viewOrigin()).href,
      JSON.stringify({ kind: 'fullscreen', macro_type: drawnType, fullscreen_outcome: outcome }),
    );
  } catch {
    // analytics never fails the view
  }
}

// A dynamic import that failed stays failed for this document, so the useful
// retry is a fresh view: asking again opens a new frame.
const DOWNLOAD_FAILED = 'Could not download the diagram renderer. The connection may be slow or blocked; ask again to retry.';

async function render(payload: DiagramPayload): Promise<void> {
  const el = document.getElementById('app');
  if (!el) return;
  const type = payload.diagramType.toLowerCase();

  const load = loadRenderer(type);
  if (load) {
    status('Loading the renderer…');
    try {
      await load;
    } catch (e) {
      console.error('[zenuml] renderer download failed', e);
      reportRender(type, e);
      status(DOWNLOAD_FAILED);
      return;
    }
  }

  // Drawings are scaled to the container (fitDiagram); documents reflow.
  const target = FIT_TYPES.has(type) ? prepareFitBox(el) : el;
  try {
    if (type === 'mermaid') {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const { svg } = await mermaid.render(`zen-mcp-${Date.now()}`, payload.dsl);
      target.innerHTML = svg;
      giveSvgItsNaturalSize(target);
    } else if (type === 'plantuml') {
      await renderPlantUml(target, payload);
    } else if (type === 'sequence') {
      const [{ default: ZenUml }, { configureDiagramFonts }] = await Promise.all([
        import('@zenuml/core'),
        import('@/utils/fonts/configureDiagramFonts'),
      ]);
      // Host CSP can refuse core's embedded data: fonts. Vite resolves these
      // hosted font assets from the module URL, rather than the host sandbox.
      configureDiagramFonts(ZenUml);
      target.innerHTML = '';
      const zenuml = new ZenUml(target);
      // Read-only: no onContentChange, so nothing here can write back. The
      // option shape mirrors Sequence.vue's call, minus everything that needs a
      // Confluence store (scoped themes, sticky offset against a scrolling
      // iframe) — this frame does not scroll and has no per-diagram theme.
      await zenuml.render(payload.dsl, { theme: 'theme-default', stickyOffset: false });
    } else if (type === 'graph') {
      await renderGraph(target, payload.dsl);
    } else if (type === 'openapi') {
      await renderOpenApi(el, payload.dsl);
    } else if (type === 'asyncapi') {
      // An outline over the parsed YAML, not @asyncapi/react-component, whose
      // parser needs eval (see renderAsyncApiOutline.ts).
      const { renderAsyncApiOutline } = await import('@/utils/asyncapi/renderAsyncApiOutline');
      renderAsyncApiOutline(el, payload.dsl);
    } else if (type === 'markdown') {
      await renderMarkdownView(el, payload.dsl);
    } else {
      // Anything else (an Embed reference, an unknown type) would render
      // blank, and saying so beats an empty frame.
      status(`This view cannot draw a ${payload.diagramType} diagram yet.`);
      return;
    }
  } catch (e) {
    // A chunk that only this diagram needs (C4, themes) failed after the engine loaded.
    const downloadFailed = (e as { reason?: unknown } | undefined)?.reason === 'load_failed';
    status(downloadFailed ? DOWNLOAD_FAILED : `Could not draw the diagram: ${e instanceof Error ? e.message : String(e)}`);
    reportRender(type, e);
    return;
  }

  drawnType = type;
  userZoom = 1;
  updateToolbar();
  fitDiagram();
  reportRender(type);
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
    const context = (msg.result as { hostContext?: unknown } | undefined)?.hostContext;
    if (context && typeof context === 'object') applyHostContext(context as HostContext);
    send('ui/notifications/initialized');
    return;
  }

  if (typeof msg.method !== 'string') {
    const answer = typeof msg.id === 'number' ? pendingRequests.get(msg.id) : undefined;
    if (answer) {
      pendingRequests.delete(msg.id as number);
      answer({ result: msg.result, error: msg.error });
    }
    return;
  }

  if (msg.method === 'ui/notifications/host-context-changed') {
    if (msg.params && typeof msg.params === 'object') applyHostContext(msg.params as HostContext);
    return;
  }

  if (msg.method === 'ui/notifications/tool-result') {
    const payload = extractDiagram(msg.params);
    if (payload) void render(payload);
    else status('No diagram in this result.');
    return;
  }

  if (msg.method === 'ui/notifications/tool-input') {
    // Arrives before the tool has answered, and says which renderer the
    // result will need: start downloading it now (#1038). The result
    // notification is still what carries the diagram.
    const type = typeFromToolInput(msg.params);
    const load = type ? loadRenderer(type) : null;
    if (load) {
      status('Loading the renderer…');
      load.catch(() => undefined); // render() reports a failure, once
    } else {
      status('Loading the diagram…');
    }
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
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    appInfo: { name: 'zenuml-diagram-view', version: '1' },
    protocolVersion: UI_PROTOCOL_VERSION,
  });
  status('Waiting for the diagram…');
  window.addEventListener('resize', () => {
    fitDiagram();
    reportSize();
  });
  // Esc leaves fullscreen when focus is in our frame, where the host's own
  // key handling cannot see it.
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('wheel', onWheel, { passive: false });
  // swagger-ui and the DrawIO viewer keep laying out after render() returns
  // (sections expand, fonts and stencils arrive), so follow the content's own
  // size rather than measuring once.
  const app = document.getElementById('app');
  if (app && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => reportSize()).observe(app);
}

if (typeof window !== 'undefined' && window.parent !== window) start();
