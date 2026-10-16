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
// call. Instead the view is built on its own (`vite.mcp-app.config.mjs`) into
// the Pages deploy, and this module serves THAT html as the ui:// body.
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
 * `mcp-app/view.html` is built by its own config (`vite.mcp-app.config.mjs`,
 * run by every `build:*` script after the app build), so the hashed script
 * references inside it always match the bundles deployed next to it. Nothing
 * here hardcodes an asset URL, which is why a rebuild cannot silently break
 * the view.
 *
 * Why its own build: `resources: path: dist/` in manifest.yml uploads the
 * whole directory as ONE Forge resource, capped at 5000 files. As a root entry
 * of the app build, the view broke `Deploy: Lite` with `Each resource can only
 * have up to 5000 files` — not by its own weight, but because any root entry
 * makes Rollup re-split the whole app. Built separately it adds seven files
 * under dist/mcp-app/ and leaves the app's chunks alone.
 */
export const DIAGRAM_VIEW_ASSET_PATH = '/mcp-app/view.html';

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
 * The text-DSL family that shares one macro and one custom-content type.
 * PlantUML is drawn by the public PlantUML server, as the Confluence app
 * already does (see PLANTUML_ORIGIN). Graph is DrawIO XML, and
 * OpenAPI/AsyncAPI would pull in swagger-ui or @asyncapi/react-component —
 * each is its own decision, not a line in a list.
 */
export const RENDERABLE_TYPES: readonly string[] = ['sequence', 'mermaid', 'plantuml'];

/**
 * Where a PlantUML diagram's SVG comes from: the view draws it as an <img>.
 *
 * Not a new recipient of diagram source — the Confluence app's PlantUML macro
 * sends the same encoded source to the same server on every render, and
 * manifest.yml already declares it as an egress.
 */
export const PLANTUML_ORIGIN = 'https://www.plantuml.com';

export function isRenderableType(diagramType: unknown): boolean {
  return typeof diagramType === 'string' && RENDERABLE_TYPES.includes(diagramType.toLowerCase());
}

/** What we answer with in `initialize`, when the client declared the extension. */
export function uiCapability(): Record<string, unknown> {
  return { [UI_EXTENSION_ID]: { mimeTypes: [UI_MIME_TYPE] } };
}

/**
 * The CSP the host must apply to the view's frame.
 *
 * WHERE THIS GOES MATTERS AND IT IS NOT THE TOOL. The spec puts `csp` on the UI
 * RESOURCE's `_meta.ui` — both in `resources/list` and in the `resources/read`
 * contents — not on the tool. We had it on the tool, which meant the host saw
 * no csp for the resource at all and applied its documented default:
 *
 *   default-src 'none'; script-src 'self' 'unsafe-inline'; ...
 *
 * `'self'` there is the frame's origin, not ours, so the view's own bundle was
 * refused and the iframe rendered empty with nothing logged anywhere — Claude
 * Desktop, 2026-10-03, after the handshake and the fetch were both confirmed
 * working. Everything upstream can be correct and the view will still draw
 * nothing if this object is attached to the wrong object.
 *
 * No baseUriDomains: the view carries no <base> (see withAbsoluteAssetUrls).
 */
export function uiCsp(origin: string): Record<string, unknown> {
  return {
    // PLANTUML_ORIGIN is img-src only in practice: the view loads no script
    // from it, but the spec has one list for every resource type.
    resourceDomains: [origin, PLANTUML_ORIGIN],
    connectDomains: [],
    frameDomains: [],
  };
}

/** `_meta` for the UI resource itself: this is where the csp belongs. */
export function uiResourceMeta(origin: string): Record<string, unknown> {
  return { ui: { csp: uiCsp(origin) } };
}

/**
 * `_meta` for a tool that carries the view.
 *
 * Only the association lives here. `visibility` is omitted deliberately: the
 * spec defaults it to ["model","app"], which is what we want.
 */
export function uiMeta(_origin?: string): Record<string, unknown> {
  return { ui: { resourceUri: DIAGRAM_VIEW_URI } };
}


/** Attach `_meta.ui` to the view-carrying tools, leaving the rest alone. */
export function withUiMeta<T extends { name: string }>(tools: readonly T[], origin: string): T[] {
  const meta = uiMeta(origin);
  return tools.map((tool) => (VIEW_TOOLS.includes(tool.name) ? { ...tool, _meta: meta } : { ...tool }));
}

/** The `resources/list` entry for the view. */
export function uiResourceList(origin: string): Array<Record<string, unknown>> {
  return [
    {
      uri: DIAGRAM_VIEW_URI,
      name: 'ZenUML diagram view',
      description: 'Renders a ZenUML sequence, Mermaid or PlantUML diagram from a tool result.',
      mimeType: UI_MIME_TYPE,
      _meta: uiResourceMeta(origin),
    },
  ];
}

/**
 * Make every asset URL in the served HTML absolute, or its scripts never load.
 *
 * The host renders this html as the ui:// resource BODY, inside a sandboxed
 * frame whose base URL is not ours, so a relative `./assets/view-<hash>.js`
 * resolves against the frame and fetches nothing — silently, because the app
 * sandbox runs `default-src 'none'`.
 *
 * A single injected `<base href="<origin>/">` was the first fix, and it does
 * not work in claude.ai: its sandbox sends its own `base-uri` directive and
 * ignores `csp.baseUriDomains`, so the tag is refused (`securitypolicyviolation:
 * base-uri`), every asset resolved against `*.claudemcpcontent.com`, and no
 * view code ran — the frame stayed hidden at 0 px with no `ui/initialize`
 * (claude.ai, 2026-10-16). Rewriting each URL depends on no host honouring
 * anything but `resourceDomains`, which claude.ai was seen to honour.
 *
 * Only `src` and `href` are rewritten: they are the only URL attributes Vite
 * writes into an entry html. Inside the bundles, URLs are built from
 * `import.meta.url` (vite.mcp-app.config.mjs uses a relative base for that), so
 * they are already absolute on our origin.
 */
export function withAbsoluteAssetUrls(html: string, viewUrl: string): string {
  return html.replace(/\b(src|href)="([^"]*)"/gi, (whole, attr: string, value: string) => {
    // Already absolute (scheme or protocol-relative), a fragment, or empty.
    if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return whole;
    }
    return `${attr}="${new URL(value, viewUrl).href}"`;
  });
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
      detail: `asset did not carry ${VIEW_MARKER} — is mcp-app/view.html in the build (build:mcp-app), or did the SPA fallback answer?`,
    };
  }

  return {
    ok: true,
    // `_meta.ui.csp` on the CONTENTS is the one the host actually enforces for
    // the frame it is about to create. Omitting it falls back to the spec's
    // restrictive default, which refuses this very bundle.
    contents: [
      {
        uri: DIAGRAM_VIEW_URI,
        mimeType: UI_MIME_TYPE,
        text: withAbsoluteAssetUrls(text, `${origin}${DIAGRAM_VIEW_ASSET_PATH}`),
        _meta: uiResourceMeta(origin),
      },
    ],
  };
}
