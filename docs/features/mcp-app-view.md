# MCP Apps diagram view

The public render endpoint now has a separate deployment target described in [Independent public render MCP deployment](../ops/render-mcp-deployment.md). That target builds the same view without a Forge release. The Pages build described below remains in use for the authenticated Confluence integration.

The headless MCP endpoint (`POST /agent-link/mcp`, `functions/agent-link/oauth/headlessMcp.ts`) answers `read_diagram`, `create_diagram` and `update_diagram` with a rendered diagram, not just DSL text. It does this through the MCP Apps extension (`io.modelcontextprotocol/ui`, [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). The host (claude.ai, the Claude desktop app, …) fetches a `ui://` resource and mounts it in a sandboxed iframe. That page is **the view**.

It draws:
- Sequence (`@zenuml/core`);
- Mermaid (`mermaid`);
- PlantUML, with the in-browser engine (`@plantuml/core`, `src/utils/plantuml/engine.ts`), as an `<img>` of the SVG in a `data:` URL. The source stays in the frame. A diagram the engine cannot draw (an `!include` we do not host, a crash, a chunk that will not load) shows the error: unlike the Confluence macro, this view has no plantuml.com fallback, so the render server can say that no third party sees the source (ADR-0010 step 7);
- Graph, with the static DrawIO viewer (`GraphViewer`, via `src/utils/drawio/loadDrawioViewer.ts`), loaded from the deploy's own `drawio/`. Legacy LZUTF8-compressed XML is decompressed first;
- OpenAPI, with `swagger-ui`, read-only: no "Try it out" (`supportedSubmitMethods: []`) and no validator call-out (`validatorUrl: null`);
- AsyncAPI, as an outline of our own (`src/utils/asyncapi/renderAsyncApiOutline.ts`): title, version, description, servers, operations, channels and messages, read from the YAML/JSON with `js-yaml`, for both 2.x (publish/subscribe under each channel) and 3.x (top-level `operations`). Every spec string is set as text, never HTML;
- Markdown, with the app's own renderer (`renderMarkdownDocument`: react-markdown + GFM, raw HTML escaped). Its ` ```mermaid ` blocks are drawn with the view's Mermaid under `securityLevel: 'strict'`, not the app's `loadMermaid`, which loads from the Confluence bundle path.

**Fitting and fullscreen.** Sequence, Mermaid, PlantUML and Graph are drawn into a `.zen-mcp-fit` box and scaled with a CSS transform (`fitDiagram` / `fitScale` in `src/mcp-app-view.ts`). The scale comes from the drawing's natural size and the space the host gives: `containerDimensions` from the `ui/initialize` result and `ui/notifications/host-context-changed`, falling back to the frame's width. Inline, a drawing is shrunk to the width and never enlarged; in fullscreen it fits width and height and may grow up to 3×. Below 0.25 it stops shrinking and the frame scrolls. A ResizeObserver refits when the natural size changes (fonts, DrawIO stencils). This is the same measure-then-transform rule as the Confluence viewer's `DiagramTransformViewport.vue`; it replaced the sequence-only `fitSequence` (PR #1176) so fullscreen fits every drawing the same way. The DrawIO viewer runs with `auto-fit: false` for this reason. Markdown, OpenAPI and AsyncAPI are documents and reflow instead.

**Zoom.** Drawings also get zoom controls in the toolbar at the top right (zoom out, the current percentage, which goes back to fit, and zoom in), Ctrl/Cmd + wheel or a trackpad pinch, and the `+` `-` `0` keys when focus is in the frame. The zoom multiplies the fit, with the Confluence viewer's step and limits (1.2×, 0.2×–12×, `DiagramTransformViewport.vue`), keeps the middle of the view in place, and lets the frame scroll; there is no drag-to-pan. A new diagram or a change of display mode starts fitted again. Documents get no zoom. The toolbar has its own 34px strip above the diagram (`TOOLBAR_SPACE`) so it never covers it. Each zoom records `agent_link_app_view_zoomed` (`viewport_action`: `zoom_in` | `zoom_out` | `fit`; `viewport_input`: `toolbar` | `wheel` | `keyboard`, a wheel gesture once; `fullscreen_active`) through `POST /mcp/view-event`.

The view declares `availableDisplayModes: ['inline', 'fullscreen']`. Where the host's context lists `fullscreen` too, a button in the top-right corner sends `ui/request-display-mode` and follows the mode the host answers with (it may decline); Esc inside the frame asks to go back inline. Hosts that do not list fullscreen get no button. Analytics: `agent_link_app_view_rendered` carries `fullscreen_available`, and each press records `agent_link_app_view_fullscreen_requested` with `fullscreen_outcome` (`entered` | `exited` | `declined` | `failed`), both through `POST /mcp/view-event`.

An Embed macro is not a type of its own and has no stored record: it names another diagram's custom content, usually stored on another page. `list_diagrams` with a `pageId` reads the page's ADF for embed macros (`embeddedContentIds` in `functions/agent-link/macroNode.ts`) and lists each target as itself, marked `embedded: true`, so `read_diagram` returns the target's real type and the view draws it. Anything else, the view says it cannot draw rather than rendering blank. None of these chunks uses `eval` or `new Function` (checked in the built output, 2026-11-11).

**Why not `@asyncapi/react-component` for AsyncAPI.** It cannot run in the host's frame. It imports `@asyncapi/parser`, which imports Spectral and Ajv. Ajv compiles every validator with `new Function`, and Spectral does that at module load (`spectral-core/dist/ruleset/function.js` and `ajv-formats`). The host's CSP has no `'unsafe-eval'`, and `_meta.ui.csp` can only add domains. Turning off the parser's rulesets (`ruleset: { core: false, recommended: false }`, `parseSchemas: false`) does not help, because the import alone throws "Refused to evaluate a string as JavaScript" (found 2026-10-17 in a simulated host; reproducible with `node --disallow-code-generation-from-strings`).

Two ways forward were considered; the second is the one built:
- a nested frame on our own origin (listed in `frameDomains`), whose own CSP allows eval, with the spec passed to it by `postMessage`. This depends on the host honouring `frameDomains`, which is unverified for claude.ai;
- a lightweight renderer of our own over the parsed YAML (the outline above).

`update_diagram` returns no diagram type or source, so after an update the view says "No diagram in this result." for every type.

## Rendering without an Atlassian site: `POST /mcp`

A second, public MCP endpoint, `POST /mcp` (route `functions/mcp/index.ts`, logic in `functions/agent-link/renderMcp.ts`), uses the same view with **no sign-in and no Confluence**. The address to publish is **`https://zenuml.com/mcp`**, served by the separate render Worker ([render-mcp-deployment.md](../ops/render-mcp-deployment.md)). That origin advertises no OAuth, so clients that run OAuth discovery connect without trying to sign in ([#1038](https://github.com/ZenUml/conf-app/issues/1038)). `https://conf-lite.zenuml.com/mcp` and the original `/mcp/render` stay as aliases for clients already configured with them, including the Claude directory listing submitted on 2026-10-31. On `conf-lite` they share an origin with agent-link's OAuth documents, so some clients still attempt a sign-in there first.

- **One tool, `render_diagram`** (`source`; optional `diagramType`: `sequence` | `mermaid` | `plantuml` | `markdown` | `graph` | `openapi` | `asyncapi`; optional `title`). It returns `structuredContent: { diagramType, source, title?, detected?, valid, unvalidated?, errors? }`, the shape `extractDiagram` already reads, and a short text summary for the model.
- **Type detection** (`functions/agent-link/detectDiagramType.ts`) runs when `diagramType` is left out or blank: `@start…` → plantuml; an `<mxfile>` / `<mxGraphModel>` root → graph; a top-level `asyncapi:` key → asyncapi (checked before OpenAPI); a top-level `openapi:` / `swagger:` key (YAML at column 0, or a JSON key) → openapi; a Mermaid diagram keyword as the first token of the first line (after `%%` directives and `---` front matter) → mermaid; anything else → sequence, since ZenUML has no header. Markdown is never detected (a `# heading` is valid ZenUML too), so it must be passed explicitly. The result carries `detected: true` and the summary says so. A given type always wins, and an unknown given type is refused rather than replaced by a guess. Known miss: a ZenUML source whose first line is a bare participant named like a Mermaid keyword (`graph`, `pie`, `timeline`, …) is read as Mermaid; it then fails Mermaid's parse check and the agent sees the errors.
- **The source is parse-checked** with `parseDsl.ts`: ZenUML and Mermaid get real parser errors with line and column; PlantUML, OpenAPI and AsyncAPI a structural check; Graph and Markdown are not checked (`unvalidated: true`). A source that fails still goes to the view, and the errors go to the agent so it can fix and call again.
- **Resources:** the view (`ui://zenuml/diagram`) and the four DSL guides (`zenuml://dsl-guide`, …).
- **No diagram is stored** and the server makes no outbound call except fetching its own `mcp-app/view.html`. PlantUML is drawn in the view by the in-browser engine, so no source goes to a third party. `source` is capped at 500,000 characters.
- **Rate limit:** 30 `render_diagram` calls per 60-second window per caller address (`CF-Connecting-IP`; IPv6 folded to its /64), counted in D1 table `McpRenderRate` (migration `0035_mcp_render_rate_limit.sql`, logic in `functions/agent-link/renderRateLimit.ts`). Handshakes, `tools/list` and `resources/*` are not counted. A refused call gets a tool result with `isError: true` and "Try again in N seconds", not an HTTP 429, which MCP clients show as a broken connection. The bucket is an HMAC of the address under `OAUTH_GRANT_SECRET`; about 2% of calls also delete rows from past windows.
  - **Why D1:** Cloudflare's Rate Limiting binding is documented for Workers, not Pages Functions; KV reads are cached per edge, so a per-minute counter undercounts; and the Durable Object worker is not bound in production. D1's single primary makes the UPSERT an atomic count, at one round trip per call (≈100–480 ms).
  - **Fails open:** with no `DB` binding, no `McpRenderRate` table, or a D1 error, the call goes through and `agent_link_mcp_tool_called` carries `reason: 'rate_limit_unavailable'`. **The migration must reach each D1 database** before the limit is in force. Main's staging validation applies it to staging (`cp wrangler-stg.toml wrangler.toml && wrangler d1 migrations apply DB --remote --env production`); no workflow does that for production `conf-zenuml-prod`, so run the same with `wrangler-prod.toml` (for `0035` this was done on 2026-10-31, ahead of the code; `migrations list` then reported nothing pending). Production volume of `rate_limit_unavailable` shows whether that has happened.
- **Why not an anonymous tool on `/agent-link/mcp`:** a token-less request there must get the 401 + RFC 9728 challenge, which is what starts OAuth in a host that has never connected. Answering it without a token would let hosts skip sign-in and then fail on every Confluence tool.
- **Route:** `/mcp` and `/mcp/render` are listed in `public/_routes.json` (without it Pages serves the SPA's HTML there). `_middleware.ts` does not authenticate it. It sits outside `/agent-link/` because the URL is public and has nothing to do with linking to Confluence; the Confluence connector stays at `/agent-link/mcp`.
- **Analytics:** the existing `agent_link_mcp_initialized`, `agent_link_mcp_tool_called` and `agent_link_app_view_*` events, with `mcp_mode: 'render'`. `_tool_called` adds `macro_type`, `render_validation` (`valid` | `invalid` | `unvalidated`) and `render_type_source` (`given` | `detected`). There is no user, so these share Mixpanel's `unknown_user_account_id`; filter by `mcp_mode`.

## Pieces

| Piece | Role |
|---|---|
| `mcp-app/view.html` | The view's HTML entry. Carries `<meta name="mcp-app" content="zenuml-diagram">`, the marker `readUiResource` requires. |
| `src/mcp-app-view.ts` | The view: host handshake over `postMessage`, payload extraction, rendering, `size-changed`. |
| `vite.mcp-app.config.mjs` | The view's **own** Vite build. |
| `functions/agent-link/oauth/mcpApps.ts` | Server side: capability, `ui://zenuml/diagram` resource, `_meta.ui` + CSP, and `readUiResource`, which fetches the built view from Pages and serves it as the resource body. |

## A second build, deployed with Cloudflare Pages

Every `build:*` script (`build:lite`, `build:full`, `build:diagramly`, `build:asyncapi`) ends with `pnpm run build:mcp-app`, which runs `vite build -c vite.mcp-app.config.mjs`. It must run **after** the app build, because the app build empties `dist/`. The view build empties only `dist/mcp-app/`.

Output, 11 files:

```
dist/mcp-app/view.html
dist/mcp-app/assets/view-<hash>.js                    entry (handshake, extraction)
dist/mcp-app/assets/runtime-<hash>.js                 Vite preload + commonjs helpers
dist/mcp-app/assets/zenuml-<hash>.js                  @zenuml/core, loaded only for Sequence
dist/mcp-app/assets/mermaid-<hash>.js                 mermaid, loaded only for Mermaid
dist/mcp-app/assets/openapi-<hash>.js                 swagger-ui, loaded only for OpenAPI
dist/mcp-app/assets/openapi-<hash>.css                swagger-ui's stylesheet
dist/mcp-app/assets/shared-mermaid-openapi-<hash>.js  what both use (dompurify)
dist/mcp-app/assets/encode-<hash>.js                  PlantUML encoder (pako)
dist/mcp-app/assets/loadDrawioViewer-<hash>.js        Graph: loads the DrawIO viewer
dist/mcp-app/assets/compress-<hash>.js                Graph: LZUTF8, for legacy compressed XML
```

The DrawIO viewer itself is not in this build. The view loads `drawio/js/viewer-static.min.js`, its shapes, stencils and `drawio/math4` (MathJax) from the same deploy, where the app build already puts them.

**Where it is served from:** the Cloudflare Pages project that also serves `/agent-link/mcp` (see [Cloudflare Pages](../ops/cloudflare-pages.md)), at `/mcp-app/view.html`. Pages answers that path with a redirect to `/mcp-app/view`, which `fetch` follows. Nothing else is needed:
- these are static assets, so `public/_routes.json` is not involved;
- Pages already sends `access-control-allow-origin: *` on static assets, which the cross-origin module scripts need.

`readUiResource` fetches from the **requesting** origin, so staging serves staging's view and production serves production's.

**Forge also gets a copy, unused.** `manifest.yml` uploads all of `dist/` as one Forge resource, so `dist/mcp-app/` ships to Forge too. Nothing reads it there, but its files count toward Forge's **5,000-files-per-resource** cap.

### Why a separate build

The view was first a root HTML entry of the app build (`vite.config.mjs` picks up every root `*.html`). Adding any root entry makes Rollup re-split the whole Confluence app, and the re-hashed chunks pushed `dist/` past the Forge cap: `Deploy: Lite` failed with `Each resource can only have up to 5000 files`. A separate build adds only its own files and leaves the app's chunks byte-identical.

`manualChunks` in `vite.mcp-app.config.mjs` keeps that count small and the loads lazy:
- one chunk per renderer;
- a dependency that several renderers share goes in a `shared-<renderers>` chunk named for exactly those, so no renderer downloads another's code;
- the Vite/commonjs helpers in `runtime`, so the entry does not import a renderer up front.

Left to itself, Rollup splits mermaid into dozens of files.

Forge reports only the cap, never the actual count, and local `dist/` counts have not matched CI's. Take the number from a CI `Deploy: Lite` run.

## Host constraints that broke real hosts

Each of these passed every unit test and a hand-built test host, and failed in claude.ai:

1. **No `<base>`; asset URLs must be absolute.** claude.ai's sandbox applies its own `base-uri` and ignores `csp.baseUriDomains`, so an injected `<base href="<origin>/">` is refused. Relative URLs then resolve against `*.claudemcpcontent.com`, and the frame stays hidden at 0 px. The two halves of the fix:
   - `withAbsoluteAssetUrls` rewrites the entry HTML's relative `src`/`href` to absolute URLs on the requesting origin;
   - the view build uses `base: './'`, so Vite's in-bundle preload URLs resolve from `import.meta.url`.
2. **`ui/initialize` must match the ext-apps schema.** The request needs `appInfo` and `appCapabilities` (not `clientInfo` / `capabilities` from the spec's prose example). claude.ai validates against `McpUiInitializeRequestSchema` and otherwise rejects the request with an error, and the view shows "The host refused this view."
3. **CSP lives on the resource, not the tool.** `_meta.ui.csp` goes on the `resources/list` entry and the `resources/read` contents. `resourceDomains` and `connectDomains` each list only our origin. The DrawIO viewer fetches stencil XML by XHR, and the view posts its outcome to `/mcp/view-event`.
4. **Nothing may load from a third-party origin.** GraphViewer loads MathJax on every render, by default from `viewer.diagrams.net`, which the host's CSP refuses. When `ensureDrawioViewerLoaded` is given an asset base, it points `DRAW_MATH_URL` at the deploy's own `drawio/math4/es5`.

## Testing

- **Unit:** `src/mcp-app-view.spec.ts`, `functions/agent-link/oauth/mcpApps.spec.ts`, `functions/agent-link/oauth/headlessMcp.spec.ts`, `functions/agent-link/renderMcp.spec.ts`, `functions/agent-link/renderRateLimit.spec.ts`, `functions/agent-link/detectDiagramType.spec.ts`.
- **Build:** `pnpm build:<variant>` (which runs `build:mcp-app`), or `pnpm build:mcp-app` alone after a variant build.
- **Real host:** add a custom connector for `https://conf-stg-lite.zenuml.com/agent-link/mcp` in claude.ai and call `read_diagram` on a lite-stg diagram.
  - Before testing, confirm staging actually serves the view: `curl -sL https://conf-stg-lite.zenuml.com/mcp-app/view.html | grep 'name="mcp-app"'`.
  - **A deploy from `main` overwrites `conf-stg-lite`**, including the daily staging regression. A branch's view therefore lasts only until the next one; re-run that branch's `PR validation` to put it back.
- **Diagnosis:** Mixpanel `agent_link_app_view_requested` / `agent_link_app_view_failed` (was the view served) and `agent_link_app_view_rendered` (did it draw: `macro_type`, `render_outcome`, and for PlantUML `plantuml_renderer` and `plantuml_failure_reason`). The view posts that last one to `POST /mcp/view-event` (`functions/agent-link/viewEvent.ts`), on the Worker for `zenuml.com` and `conf-lite`, and on Pages elsewhere; only enums are accepted.
  - `_requested` without `_failed` means the host fetched the view, so any fault is inside the frame.
  - `_failed` with `reason: fetch_failed` usually means the SPA shell answered, because the view is missing from that deploy.
