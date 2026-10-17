# MCP Apps diagram view

The headless MCP endpoint (`POST /agent-link/mcp`, `functions/agent-link/oauth/headlessMcp.ts`) answers `read_diagram`, `create_diagram` and `update_diagram` with a rendered diagram, not just DSL text. It does this through the MCP Apps extension (`io.modelcontextprotocol/ui`, [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). The host (claude.ai, the Claude desktop app, …) fetches a `ui://` resource and mounts it in a sandboxed iframe. That page is **the view**.

It draws Sequence (`@zenuml/core`), Mermaid (`mermaid`) and PlantUML (an `<img>` of `https://www.plantuml.com/plantuml/svg/<encoded>`, same encoder as `PlantUml.vue`). Graph, OpenAPI and AsyncAPI are not supported; the view says so instead of rendering blank.

## Pieces

| Piece | Role |
|---|---|
| `mcp-app/view.html` | The view's HTML entry. Carries `<meta name="mcp-app" content="zenuml-diagram">`, the marker `readUiResource` requires. |
| `src/mcp-app-view.ts` | The view: host handshake over `postMessage`, payload extraction, rendering, `size-changed`. |
| `vite.mcp-app.config.mjs` | The view's **own** Vite build. |
| `functions/agent-link/oauth/mcpApps.ts` | Server side: capability, `ui://zenuml/diagram` resource, `_meta.ui` + CSP, and `readUiResource`, which fetches the built view from Pages and serves it as the resource body. |

## A second build, deployed with Cloudflare Pages

Every `build:*` script (`build:lite`, `build:full`, `build:diagramly`, `build:asyncapi`) ends with `pnpm run build:mcp-app`, which runs `vite build -c vite.mcp-app.config.mjs`. It must run **after** the app build, because the app build empties `dist/`. The view build empties only `dist/mcp-app/`.

Output, about 7 files:

```
dist/mcp-app/view.html
dist/mcp-app/assets/view-<hash>.js        entry (handshake, extraction)
dist/mcp-app/assets/runtime-<hash>.js     Vite preload + commonjs helpers
dist/mcp-app/assets/zenuml-<hash>.js      @zenuml/core, loaded only for Sequence
dist/mcp-app/assets/mermaid-<hash>.js     mermaid, loaded only for Mermaid
dist/mcp-app/assets/mermaid.core-<hash>.js
dist/mcp-app/assets/encode-<hash>.js      PlantUML encoder (pako)
```

**Where it is served from:** the Cloudflare Pages project that also serves `/agent-link/mcp` (see [Cloudflare Pages](../ops/cloudflare-pages.md)), at `/mcp-app/view.html`. Pages answers that path with a redirect to `/mcp-app/view`, which `fetch` follows. Nothing else is needed:
- these are static assets, so `public/_routes.json` is not involved;
- Pages already sends `access-control-allow-origin: *` on static assets, which the cross-origin module scripts need.

`readUiResource` fetches from the **requesting** origin, so staging serves staging's view and production serves production's.

**Forge also gets a copy, unused.** `manifest.yml` uploads all of `dist/` as one Forge resource, so `dist/mcp-app/` ships to Forge too. Nothing reads it there, but its files count toward Forge's **5,000-files-per-resource** cap.

### Why a separate build

The view was first a root HTML entry of the app build (`vite.config.mjs` picks up every root `*.html`). Adding any root entry makes Rollup re-split the whole Confluence app, and the re-hashed chunks pushed `dist/` past the Forge cap: `Deploy: Lite` failed with `Each resource can only have up to 5000 files`. A separate build adds only its own files and leaves the app's chunks byte-identical.

`manualChunks` in `vite.mcp-app.config.mjs` keeps that count small and the loads lazy:
- one chunk per renderer;
- the Vite/commonjs helpers in `runtime`, so the entry does not import a renderer up front.

Left to itself, Rollup splits mermaid into dozens of files.

Forge reports only the cap, never the actual count, and local `dist/` counts have not matched CI's. Take the number from a CI `Deploy: Lite` run.

## Host constraints that broke real hosts

Each of these passed every unit test and a hand-built test host, and failed in claude.ai:

1. **No `<base>`; asset URLs must be absolute.** claude.ai's sandbox applies its own `base-uri` and ignores `csp.baseUriDomains`, so an injected `<base href="<origin>/">` is refused. Relative URLs then resolve against `*.claudemcpcontent.com`, and the frame stays hidden at 0 px. The two halves of the fix:
   - `withAbsoluteAssetUrls` rewrites the entry HTML's relative `src`/`href` to absolute URLs on the requesting origin;
   - the view build uses `base: './'`, so Vite's in-bundle preload URLs resolve from `import.meta.url`.
2. **`ui/initialize` must match the ext-apps schema.** The request needs `appInfo` and `appCapabilities` (not `clientInfo` / `capabilities` from the spec's prose example). claude.ai validates against `McpUiInitializeRequestSchema` and otherwise rejects the request with an error, and the view shows "The host refused this view."
3. **CSP lives on the resource, not the tool.** `_meta.ui.csp` goes on the `resources/list` entry and the `resources/read` contents. `resourceDomains` lists our origin and `https://www.plantuml.com`, and `connectDomains` is empty.
4. **Tools carry the view under both keys.** `uiMeta` sets `_meta.ui.resourceUri` and the flat legacy `_meta["ui/resourceUri"]`, as the ext-apps SDK's `registerAppTool` does. With only the nested key, Cursor 3.25 declared the extension, listed the `ui://` resource, and still never fetched the view.

## Testing

- **Unit:** `src/mcp-app-view.spec.ts`, `functions/agent-link/oauth/mcpApps.spec.ts`, `functions/agent-link/oauth/headlessMcp.spec.ts`.
- **Build:** `pnpm build:<variant>` (which runs `build:mcp-app`), or `pnpm build:mcp-app` alone after a variant build.
- **Real host:** add a custom connector for `https://conf-stg-lite.zenuml.com/agent-link/mcp` in claude.ai and call `read_diagram` on a lite-stg diagram.
  - Before testing, confirm staging actually serves the view: `curl -sL https://conf-stg-lite.zenuml.com/mcp-app/view.html | grep 'name="mcp-app"'`.
  - **A deploy from `main` overwrites `conf-stg-lite`**, including the daily staging regression. A branch's view therefore lasts only until the next one; re-run that branch's `PR validation` to put it back.
- **Diagnosis:** Mixpanel `agent_link_app_view_requested` / `agent_link_app_view_failed`.
  - `_requested` without `_failed` means the host fetched the view, so any fault is inside the frame.
  - `_failed` with `reason: fetch_failed` usually means the SPA shell answered, because the view is missing from that deploy.
