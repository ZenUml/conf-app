# MCP Apps diagram view

The headless MCP endpoint (`POST /agent-link/mcp`, `functions/agent-link/oauth/headlessMcp.ts`) answers `read_diagram`, `create_diagram` and `update_diagram` with a rendered diagram, not just DSL text. It does this through the MCP Apps extension (`io.modelcontextprotocol/ui`, [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). The host (claude.ai, the Claude desktop app, …) fetches a `ui://` resource and mounts it in a sandboxed iframe. That page is **the view**.

It draws:
- Sequence (`@zenuml/core`);
- Mermaid (`mermaid`);
- PlantUML, as an `<img>` of `https://www.plantuml.com/plantuml/svg/<encoded>` (same encoder as `PlantUml.vue`);
- Graph, with the static DrawIO viewer (`GraphViewer`, via `src/utils/drawio/loadDrawioViewer.ts`), loaded from the deploy's own `drawio/`. Legacy LZUTF8-compressed XML is decompressed first;
- OpenAPI, with `swagger-ui`, read-only: no "Try it out" (`supportedSubmitMethods: []`) and no validator call-out (`validatorUrl: null`).

AsyncAPI, Markdown and Embed are not supported; the view says so instead of rendering blank.

**Why not AsyncAPI.** `@asyncapi/react-component` cannot run in the host's frame. It imports `@asyncapi/parser`, which imports Spectral and Ajv. Ajv compiles every validator with `new Function`, and Spectral does that at module load (`spectral-core/dist/ruleset/function.js` and `ajv-formats`). The host's CSP has no `'unsafe-eval'`, and `_meta.ui.csp` can only add domains. Turning off the parser's rulesets (`ruleset: { core: false, recommended: false }`, `parseSchemas: false`) does not help, because the import alone throws "Refused to evaluate a string as JavaScript" (found 2026-10-17 in a simulated host; reproducible with `node --disallow-code-generation-from-strings`).

Two ways forward were considered and not built:
- a nested frame on our own origin (listed in `frameDomains`), whose own CSP allows eval, with the spec passed to it by `postMessage`. This depends on the host honouring `frameDomains`, which is unverified for claude.ai;
- a lightweight renderer of our own over the parsed YAML.

`update_diagram` returns no diagram type or source, so after an update the view says "No diagram in this result." for every type.

## Rendering without an Atlassian site: `POST /mcp/render`

A second, public MCP endpoint, `POST /mcp/render` (route `functions/mcp/render.ts`, logic in `functions/agent-link/renderMcp.ts`), uses the same view with **no sign-in and no Confluence**. Anyone can add it as a connector, e.g. `https://conf-lite.zenuml.com/mcp/render`.

- **One tool, `render_diagram`** (`diagramType`: `sequence` | `mermaid` | `plantuml` | `graph` | `openapi`, `source`, optional `title`). It returns `structuredContent: { diagramType, source, title?, valid, unvalidated?, errors? }`, the shape `extractDiagram` already reads, and a short text summary for the model.
- **The source is parse-checked** with `parseDsl.ts`: ZenUML and Mermaid get real parser errors with line and column; PlantUML and OpenAPI a structural check; Graph is not checked (`unvalidated: true`). A source that fails still goes to the view, and the errors go to the agent so it can fix and call again.
- **Resources:** the view (`ui://zenuml/diagram`) and the four DSL guides (`zenuml://dsl-guide`, …).
- **No diagram is stored** and the server makes no outbound call except fetching its own `mcp-app/view.html`. PlantUML is fetched from `www.plantuml.com` by the view, as in Confluence. `source` is capped at 500,000 characters.
- **Rate limit:** 30 `render_diagram` calls per 60-second window per caller address (`CF-Connecting-IP`; IPv6 folded to its /64), counted in D1 table `McpRenderRate` (migration `0035_mcp_render_rate_limit.sql`, logic in `functions/agent-link/renderRateLimit.ts`). Handshakes, `tools/list` and `resources/*` are not counted. A refused call gets a tool result with `isError: true` and "Try again in N seconds", not an HTTP 429, which MCP clients show as a broken connection. The bucket is an HMAC of the address under `OAUTH_GRANT_SECRET`; about 2% of calls also delete rows from past windows.
  - **Why D1:** Cloudflare's Rate Limiting binding is documented for Workers, not Pages Functions; KV reads are cached per edge, so a per-minute counter undercounts; and the Durable Object worker is not bound in production. D1's single primary makes the UPSERT an atomic count, at one round trip per call (≈100–480 ms).
  - **Fails open:** with no `DB` binding, no `McpRenderRate` table, or a D1 error, the call goes through and `agent_link_mcp_tool_called` carries `reason: 'rate_limit_unavailable'`. **The migration must reach each D1 database** before the limit is in force. Main's staging validation applies it to staging (`cp wrangler-stg.toml wrangler.toml && wrangler d1 migrations apply DB --remote --env production`); no workflow does that for production `conf-zenuml-prod`, so run the same with `wrangler-prod.toml` (for `0035` this was done on 2026-10-31, ahead of the code; `migrations list` then reported nothing pending). Production volume of `rate_limit_unavailable` shows whether that has happened.
- **Why not an anonymous tool on `/agent-link/mcp`:** a token-less request there must get the 401 + RFC 9728 challenge, which is what starts OAuth in a host that has never connected. Answering it without a token would let hosts skip sign-in and then fail on every Confluence tool.
- **Route:** `/mcp/render` is listed in `public/_routes.json` (without it Pages serves the SPA's HTML there). `_middleware.ts` does not authenticate it. It sits outside `/agent-link/` because the URL is public and has nothing to do with linking to Confluence; the Confluence connector stays at `/agent-link/mcp`.
- **Analytics:** the existing `agent_link_mcp_initialized`, `agent_link_mcp_tool_called` and `agent_link_app_view_*` events, with `mcp_mode: 'render'`. `_tool_called` adds `macro_type` and `render_validation` (`valid` | `invalid` | `unvalidated`). There is no user, so these share Mixpanel's `unknown_user_account_id`; filter by `mcp_mode`.

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
3. **CSP lives on the resource, not the tool.** `_meta.ui.csp` goes on the `resources/list` entry and the `resources/read` contents. `resourceDomains` lists our origin and `https://www.plantuml.com`. `connectDomains` lists only our origin, because the DrawIO viewer fetches stencil XML by XHR.
4. **Nothing may load from a third-party origin.** GraphViewer loads MathJax on every render, by default from `viewer.diagrams.net`, which the host's CSP refuses. When `ensureDrawioViewerLoaded` is given an asset base, it points `DRAW_MATH_URL` at the deploy's own `drawio/math4/es5`.

## Testing

- **Unit:** `src/mcp-app-view.spec.ts`, `functions/agent-link/oauth/mcpApps.spec.ts`, `functions/agent-link/oauth/headlessMcp.spec.ts`, `functions/agent-link/renderMcp.spec.ts`, `functions/agent-link/renderRateLimit.spec.ts`.
- **Build:** `pnpm build:<variant>` (which runs `build:mcp-app`), or `pnpm build:mcp-app` alone after a variant build.
- **Real host:** add a custom connector for `https://conf-stg-lite.zenuml.com/agent-link/mcp` in claude.ai and call `read_diagram` on a lite-stg diagram.
  - Before testing, confirm staging actually serves the view: `curl -sL https://conf-stg-lite.zenuml.com/mcp-app/view.html | grep 'name="mcp-app"'`.
  - **A deploy from `main` overwrites `conf-stg-lite`**, including the daily staging regression. A branch's view therefore lasts only until the next one; re-run that branch's `PR validation` to put it back.
- **Diagnosis:** Mixpanel `agent_link_app_view_requested` / `agent_link_app_view_failed`.
  - `_requested` without `_failed` means the host fetched the view, so any fault is inside the frame.
  - `_failed` with `reason: fetch_failed` usually means the SPA shell answered, because the view is missing from that deploy.
