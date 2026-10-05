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
 *   1. View  -> `ui/initialize` (a request, with clientInfo/protocolVersion)
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
    const source = (candidate as { source?: unknown } | null)?.source;
    if (typeof source !== 'string') continue;
    try {
      const stored = JSON.parse(source) as Record<string, unknown>;
      if (stored && typeof stored === 'object') {
        candidates.push({ ...stored, title: stored.title ?? (candidate as { title?: unknown }).title });
      }
    } catch {
      // an older record whose source is bare DSL carries no diagramType; skip it
    }
  }

  for (const candidate of candidates) {
    const c = candidate as { diagramType?: unknown; dsl?: unknown; code?: unknown; title?: unknown };
    const type = typeof c?.diagramType === 'string' ? c.diagramType : undefined;
    // `dsl` is what our tools return; `code` is the stored custom-content field,
    // so a payload passed straight through from Confluence still renders.
    const dsl = typeof c?.dsl === 'string' ? c.dsl : typeof c?.code === 'string' ? c.code : undefined;
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
    } else if (type === 'sequence') {
      const { default: ZenUml } = await import('@zenuml/core');
      el.innerHTML = '';
      const zenuml = new ZenUml(el);
      // Read-only: no onContentChange, so nothing here can write back. The
      // option shape mirrors Sequence.vue's call, minus everything that needs a
      // Confluence store (scoped themes, sticky offset against a scrolling
      // iframe) — this frame does not scroll and has no per-diagram theme.
      await zenuml.render(payload.dsl, { theme: 'theme-default', stickyOffset: false });
    } else {
      // Only the text-DSL family is wired up; anything else would render blank,
      // and saying so beats an empty frame.
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
  initializeId = request('ui/initialize', {
    capabilities: {},
    clientInfo: { name: 'zenuml-diagram-view', version: '1' },
    protocolVersion: UI_PROTOCOL_VERSION,
  });
  status('Waiting for the diagram…');
  window.addEventListener('resize', reportSize);
}

if (typeof window !== 'undefined' && window.parent !== window) start();
