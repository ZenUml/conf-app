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
 * THE PROTOCOL, MINIMALLY. The host speaks JSON-RPC over postMessage. We send
 * `ui/initialize` once, then wait: the payload arrives as either
 * `ui/notifications/tool-result` (the normal path) or
 * `ui/notifications/tool-input` (preloaded before the call completes, which we
 * use only to show that something is coming). We answer nothing else, and we
 * never call `tools/call` — this view only draws.
 */

const HOST = window.parent;

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
  HOST?.postMessage({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }, '*');
}

let nextId = 1;
function request(method: string, params?: Json): void {
  HOST?.postMessage({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }, '*');
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

function onHostMessage(event: MessageEvent): void {
  const msg = event.data as { method?: unknown; params?: unknown } | undefined;
  if (!msg || typeof msg.method !== 'string') return;

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

function start(): void {
  window.addEventListener('message', onHostMessage);
  // Announce ourselves, then wait. A view that draws nothing until the host
  // speaks is correct: there is no diagram to draw before the tool answers.
  request('ui/initialize', {});
  status('Waiting for the diagram…');
  window.addEventListener('resize', reportSize);
}

if (typeof window !== 'undefined' && window.parent !== window) start();
