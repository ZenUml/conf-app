// MCP Apps (the `io.modelcontextprotocol/ui` extension): how a diagram result
// becomes a rendered diagram in the host instead of a wall of DSL.
//
// Spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
// Overview: https://modelcontextprotocol.io/extensions/apps/overview
//
// THE EXTENSION IS BILATERAL, AND THAT IS THE TRAP. Both sides declare it in
// `capabilities.extensions`, and the intersection is what gets used. A host
// that does not declare it still calls the tool and still gets a perfectly good
// text result — so a missing declaration on EITHER side looks exactly like a
// view that failed to render, with no error anywhere.
//
// We therefore declare ours UNCONDITIONALLY and attach `_meta.ui` to every
// response. The first draft of this file gated both on the client's own
// declaration, which cannot work: `initialize` and `tools/list` are separate
// HTTP requests against a stateless endpoint, so honouring the client's
// declaration later would mean persisting it per token — a KV write on every
// handshake to decide something the host can already decide for itself. A host
// that does not understand `_meta.ui` ignores it, which is what unknown `_meta`
// is for.
//
// WHY THE VIEW IS FETCHED RATHER THAN INLINED. The renderers are big —
// mermaid's own minified bundle is 2.9 MB, @zenuml/core's is 3.4 MB — so
// inlining one into every `resources/read` response would ship megabytes per
// call. Instead the view is an ordinary Vite entry (`mcp-app-view.html`) built
// into the Pages deploy, and this module serves THAT html as the ui:// body.
// The html already references its own hashed script, so the resource and the
// bundle can never drift apart; the alternative (hardcoding an asset URL here)
// breaks on the next build. `_meta.ui.csp` is what lets the iframe load it:
// the app sandbox's baseline is `default-src 'none'`, so an undeclared origin
// silently fetches nothing.

export const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';

/** The mandatory content type for an MCP Apps HTML resource. */
export const UI_MIME_TYPE = 'text/html;profile=mcp-app';

/** The single view: one template renders every diagram type it supports. */
export const DIAGRAM_VIEW_URI = 'ui://zenuml/diagram';

/**
 * Path of the built view inside the Pages deploy.
 *
 * `mcp-app-view.html` is a root Vite entry, so the build emits this file and the
 * hashed script reference inside it always matches the bundle deployed next to
 * it. Nothing here hardcodes an asset URL, which is why a rebuild cannot
 * silently break the view.
 *
 * Watch the file count. `resources: path: dist/` in manifest.yml uploads the
 * whole directory as ONE Forge resource, and Forge caps a resource at 5000
 * files. Adding this entry the first time broke `Deploy: Lite` with
 * `Each resource can only have up to 5000 files` — and not because of the
 * view's own weight: adding any root entry makes Rollup re-split the whole
 * build, so the extra files were mostly the app's own chunks re-hashed. Forge
 * reports only the limit, never the actual count, so if that failure returns the
 * number has to come from a CI build; a local `build:lite` has measured well
 * under the cap while CI was over it, and the discrepancy is unexplained.
 */
export const DIAGRAM_VIEW_ASSET_PATH = '/mcp-app-view.html';

/**
 * What proves the fetched html is the view and not something else.
 *
 * Cloudflare Pages answers an unknown path with the SPA shell and a 200, so
 * there is no status code to distinguish "the view" from "the app". The entry
 * carries this meta tag and `readUiResource` requires it; a build that drops
 * the tag fails closed, which is the right way round.
 */
export const VIEW_MARKER = '<meta name="mcp-app" content="zenuml-diagram">';

/**
 * Which tools carry a view.
 *
 * The two write tools are here deliberately: seeing what the agent actually
 * wrote is the moment a picture is worth most, because it is the only check on
 * whether the edit meant what the user asked for. `list_diagrams` is left out —
 * a table of rows is already the right shape for a list.
 */
export const VIEW_TOOLS: readonly string[] = ['read_diagram', 'update_diagram', 'create_diagram'];

/**
 * Diagram types this view can draw.
 *
 * The text-DSL family that already shares one macro and one custom-content
 * type. PlantUML needs a server-side render, Graph is DrawIO XML, and
 * OpenAPI/AsyncAPI would pull in swagger-ui or @asyncapi/react-component —
 * each is its own decision, not a line in a list.
 */
export const RENDERABLE_TYPES: readonly string[] = ['sequence', 'mermaid'];

export function isRenderableType(diagramType: unknown): boolean {
  return typeof diagramType === 'string' && RENDERABLE_TYPES.includes(diagramType.toLowerCase());
}

/** What we answer with in `initialize`, when the client declared the extension. */
export function uiCapability(): Record<string, unknown> {
  return { [UI_EXTENSION_ID]: { mimeTypes: [UI_MIME_TYPE] } };
}

/**
 * The `_meta.ui` a view-carrying tool advertises.
 *
 * `csp.resourceDomains` names our own origin because that is where the built
 * bundle lives. Nothing else is listed: the view draws from the tool result it
 * is handed and makes no calls of its own, so a wider policy would buy nothing
 * and widen what a compromised bundle could reach.
 */
export function uiMeta(origin: string): Record<string, unknown> {
  return {
    ui: {
      resourceUri: DIAGRAM_VIEW_URI,
      // baseUriDomains is what lets the injected <base> stick — see
      // withAbsoluteBase. Without it the tag is refused and every relative
      // asset URL resolves against the iframe instead of our origin.
      csp: {
        resourceDomains: [origin],
        baseUriDomains: [origin],
        connectDomains: [],
        frameDomains: [],
      },
    },
  };
}

/** Attach `_meta.ui` to the view-carrying tools, leaving the rest alone. */
export function withUiMeta<T extends { name: string }>(tools: readonly T[], origin: string): T[] {
  const meta = uiMeta(origin);
  return tools.map((tool) => (VIEW_TOOLS.includes(tool.name) ? { ...tool, _meta: meta } : { ...tool }));
}

/** The `resources/list` entry for the view. */
export function uiResourceList(): Array<Record<string, unknown>> {
  return [
    {
      uri: DIAGRAM_VIEW_URI,
      name: 'ZenUML diagram view',
      description: 'Renders a sequence or Mermaid diagram from a tool result.',
      mimeType: UI_MIME_TYPE,
    },
  ];
}

/**
 * Give the served HTML an absolute base, or its scripts never load.
 *
 * Vite emits relative references (`src="./assets/mcp-app-view-<hash>.js"`),
 * which is right for a page served from our own origin and wrong here: the host
 * renders this html as the ui:// resource BODY, inside a sandboxed frame whose
 * base URL is not ours. `./assets/...` then resolves against the frame and
 * fetches nothing — and because the app sandbox runs `default-src 'none'`, it
 * fetches nothing SILENTLY. Found 2026-09-28 by building the entry and reading
 * what Vite actually wrote.
 *
 * One `<base>` fixes every relative reference at once, which is why the spec
 * gives `csp.baseUriDomains` a place to allow it. Rewriting each URL instead
 * would mean keeping a list of the attributes Vite might emit.
 */
export function withAbsoluteBase(html: string, origin: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${origin}/">`;
  // After <head> where there is one; otherwise lead with it, so a
  // head-less fragment still resolves rather than half-loading.
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

export type ViewReadResult =
  | { ok: true; contents: Array<Record<string, unknown>> }
  | { ok: false; reason: 'unknown_uri' | 'fetch_failed'; detail?: string };

/**
 * Serve the built view as the ui:// resource body.
 *
 * `origin` is this request's own origin, so a staging deploy serves staging's
 * bundle and production serves production's without either knowing the other
 * exists.
 */
export async function readUiResource(
  uri: unknown,
  origin: string,
  fetchImpl: (url: string) => Promise<Response>,
): Promise<ViewReadResult> {
  if (uri !== DIAGRAM_VIEW_URI) {
    return { ok: false, reason: 'unknown_uri', detail: typeof uri === 'string' ? uri.slice(0, 120) : typeof uri };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${origin}${DIAGRAM_VIEW_ASSET_PATH}`);
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', detail: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, reason: 'fetch_failed', detail: `asset returned ${res.status}` };

  const text = await res.text();
  // A Pages deploy that is missing the entry answers with the SPA SHELL and a
  // 200 — not a 404 — so "is this html with a script in it?" is not the
  // question. The shell is html full of scripts, and the first version of this
  // check asked exactly that and passed it: staging served the Forge app as
  // the diagram view, reported success, and left nothing to say so (found on
  // a real deploy 2026-09-29).
  //
  // The view therefore carries a marker no other page in the build has, and
  // nothing but that marker will do.
  if (!text.includes(VIEW_MARKER)) {
    return {
      ok: false,
      reason: 'fetch_failed',
      detail: `asset did not carry ${VIEW_MARKER} — is mcp-app-view.html in the build, or did the SPA fallback answer?`,
    };
  }

  return {
    ok: true,
    contents: [{ uri: DIAGRAM_VIEW_URI, mimeType: UI_MIME_TYPE, text: withAbsoluteBase(text, origin) }],
  };
}
