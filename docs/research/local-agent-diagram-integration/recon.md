# Recon: diagram create/store/render + MCP infra — reuse points for a local-AI-agent → diagram bridge

Scope: read-only recon across `conf-app`, `mcp-zenuml`, `diagramly-mcp-serverless`. Every claim below is grounded in a file:line I read. Where I could not confirm something, it is marked UNKNOWN.

Path roots:
- conf-app: `/Users/pengxiao/workspaces/zenuml/conf-app`
- mcp-zenuml: `/Users/pengxiao/workspaces/mcp/mcp-zenuml`
- diagramly-mcp-serverless: `/Users/pengxiao/workspaces/zenuml/diagramly-mcp-serverless`

---

## (a) Diagram create → custom-content store path

A diagram save flows: editor → `CompositeContentProvider`/`CustomContentStorageProvider` → `ApWrapper2` → `@forge/bridge.requestConfluence` → Confluence custom-content v2 REST. Confluence is the system of record; the Cloudflare backend (`/forge-custom-content`) only mirrors into D1 for telemetry.

- `CustomContentStorageProvider.save()` decides create vs update: if `source === 'custom-content'` and has an `id` and not a copy → `saveCustomContentV2`, else `createCustomContentV2`. `src/model/ContentProvider/CustomContentStorageProvider.ts:34-42`.
- The provider chain that selects which storage backend to use (custom-content, content-property, macro-body fallback): `src/model/ContentProvider/CompositeContentProvider.ts:42-56`.
- `ApWrapper2.createCustomContentV2()` builds the v2 payload: `type`, `title`, `body.value = JSON.stringify(sanitizedContent)` with `representation: "raw"`, attaches `pageId` (or `spaceId` fallback), then POSTs `/api/v2/custom-content`. `src/model/ApWrapper2.ts:237-278`.
- Transport: `ApWrapper2.makeRequest()` is a thin wrapper that prefixes `/wiki` and delegates to `forgeRequest`. `src/model/ApWrapper2.ts:1327-1329`.
- `forgeRequest()` dynamically imports `@forge/bridge` and calls `requestConfluence(url, {method, headers, body})` — i.e. all Confluence reads/writes go through the Forge iframe bridge, not a raw HTTP client. `src/utils/requestUtil.ts:58-73`.
- Backend mirror endpoint re-fetches the just-saved custom content from Confluence and writes versions/content into D1; it explicitly states "Confluence is the system of record; mirroring into D1 is telemetry only" and returns 2xx even when the re-fetch fails. `functions/forge-custom-content.ts:14-61`, route allowlisted at `public/_routes.json` (`/forge-custom-content`).

Two distinct backend transports exist in the frontend: `forgeRequest` → `requestConfluence` (Confluence REST) vs `forgeCallRemote` → `invokeRemote` (calls conf-app's own Cloudflare Workers via the `connect`/`diagramly` remotes). `src/utils/requestUtil.ts:58-110`.

## (b) Diagram render path (DSL → rendered diagram)

Rendering is fully client-side inside the Forge iframe: the DSL string lives in Vuex (`store.state.diagram.code`), and `DiagramPortal` picks a renderer component by `diagramType`; the Sequence component dynamically imports `@zenuml/core` and calls `zenuml.render(code)`.

- `DiagramPortal.vue` switches renderer component on `diagramType` (Mermaid / PlantUml / Sequence) inside a `GenericViewer`. `src/components/DiagramPortal.vue:1-6`; the `diagramType` getter reads `this.$store.state.diagram.diagramType` at `:32-34`.
- `Workspace.vue` is the split editor/preview shell that mounts `DiagramPortal`. `src/components/Workspace.vue:14` (`<DiagramPortal :hide-header="true" />`), import at `:28`.
- Sequence renderer: dynamic import of `@zenuml/core` (`loadZenUml`), instantiate `new ZenUml(this.$refs["zenuml"])`, then `await zenuml.render(this.$store.state.diagram.code, {...})`. `src/components/Sequence.vue:22, 56-58, 83`. The DSL the renderer consumes is `store.state.diagram.code` (`:46`).
- Viewers directory (per-type render surfaces incl. DrawIO/OpenAPI/Embed) lives at `src/components/Viewer/` (`GenericViewer.vue`, `GraphViewer.vue`, `OpenApiViewer.vue`, `ForgeGraphViewer.vue`, etc.).

Note: Mermaid/PlantUml/Sequence render client-side; Graph (DrawIO) and OpenAPI use their own viewer components. The render input is always the DSL/source string from the diagram model — there is no server render in this path.

## (c) mcp-zenuml tool surface

A local **stdio** MCP server (Node + Puppeteer) exposing a single tool that renders Mermaid DSL to a PNG image.

- Server identity + transport: `McpServer({name: "Mermaid Renderer"})` over `StdioServerTransport`. `mcp-zenuml/src/stdio-mcp-server.ts:15-19, 78-82`.
- Tool **`renderMermaid`** — input `{ diagram: string }` (zod), renders via a Puppeteer-backed `MermaidRenderer`, returns `{ type: "image", data: base64, mimeType: "image/png" }`. `mcp-zenuml/src/stdio-mcp-server.ts:35-66`.
- Dependencies confirm the local/headless-browser nature: `puppeteer`, `@modelcontextprotocol/sdk@1.10.1`, `express`. `mcp-zenuml/package.json` (dependencies block).
- There are sibling experimental entrypoints (`server.ts`, `mermaid-image-server.ts`, `mcp-image-client.ts`, `test-server.ts`) but `stdio-mcp-server.ts` is the MCP stdio surface. Only `renderMermaid` is exposed as a tool there.

This is **Mermaid-only** and **render-to-image only**. It has no ZenUML-DSL tool, no Confluence/store integration. UNKNOWN whether it is currently wired into any client config beyond local dev (logs are from Apr 2025).

## (d) diagramly-mcp-serverless endpoints

A **Cloudflare Worker** MCP-over-HTTP server (Hono) implementing JSON-RPC at `/mcp`, exposing three render/screenshot tools. No persistence, no Confluence access.

HTTP routes (`diagramly-mcp-serverless/src/index.ts`):
- `GET /health` — health check (`:26-28`).
- `GET /` — info/endpoints listing (`:31-41`).
- `POST /test-todo-screenshot` — test harness invoking the todo tool directly (`:44-72`).
- `POST /mcp` — JSON-RPC MCP handler: `initialize`, `tools/list`, `tools/call`, `ping`, `prompts/list`, `resources/list`, `completion/complete` (`:88-...`, switch at `:121+`; CORS `*` middleware at `:75-92`).
- `GET /mcp` — server info/capabilities (`:300+`).

Tools registered (`diagramly-mcp-serverless/src/tools/index.ts:16-20`):
- **`mermaid-to-image`** — compresses Mermaid DSL (pako deflate), base64url-encodes, fetches PNG/SVG from `https://kroki.io/mermaid/...`. `src/tools/mermaid-to-image.ts:13-37` (Kroki URL at `:36`).
- **`zenuml-renderer-screenshot`** — launches `@cloudflare/playwright` (`env.MYBROWSER` binding), navigates to `https://zenuml-web-renderer.zenuml.workers.dev/renderer?code=<encoded>`, screenshots the rendered ZenUML to PNG. `src/tools/zenuml-renderer-screenshot.ts:23, 36-90`.
- **`todo-screenshot`** — unrelated demo tool (renders a todo list screenshot). `src/tools/index.ts:18`.

This is the closest existing "agent talks to a hosted endpoint and gets a diagram" pattern: HTTP MCP on Cloudflare, ZenUML-aware, but render-only (DSL → image), with **no Confluence write-back** and **no auth** (CORS `*`, no token check). `CURSOR_MCP_SETUP.md` / `cursor-mcp-config.json` in that repo show it was wired for Cursor.

## (e) Forge egress/auth constraints for a LOCAL-agent bridge

The hard constraint: **all Confluence reads/writes today happen *inside* the Forge Custom-UI iframe via `@forge/bridge` (`requestConfluence`/`invokeRemote`)**, which mints app/user tokens from the live Forge runtime context. A local agent (Claude Code/Cursor) has **no** Forge bridge and **no** Forge invocation context, so it cannot reuse that path directly.

Backend auth (the only token a non-Forge caller could theoretically present):
- conf-app's Cloudflare backend authenticates **Forge invocation tokens** (RS256) verified against Atlassian's JWKS (`https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json`), and checks the token's `app.id` is in `ALLOWED_FORGE_APP_IDS`. `functions/utils/authenticate.ts:6-35` (validate), `:39-71` (request auth + D1 upsert), `:71-95` (entry). A local agent cannot mint these tokens — they are issued by the Forge runtime, not obtainable client-side. So the backend is effectively closed to non-Forge callers via this guard.
- `forge-custom-content` additionally requires the `x-forge-oauth-user` header (set by the Forge remote proxy), rejecting requests without it. `functions/forge-custom-content.ts:16-19`.

Manifest egress / scopes / remotes (`manifest.yml`):
- `remotes`: `connect` → `BACKEND_API_BASE_URL` (conf-app Cloudflare backend) with `appSystemToken`+`appUserToken`; `diagramly` → `DIAGRAMLY_BASE_URL` (compute only). These remotes are reachable **only from within Forge** (the bridge proxies to them with minted tokens).
- `permissions.scopes`: broad Confluence read/write incl. `read:custom-content:confluence`, `write:custom-content:confluence`, `write:page:confluence`, `read:page:confluence`, `storage:app` — i.e. the app *itself* already has the scopes needed to create/read diagram custom content; the gating is purely *who can drive the app*.
- `permissions.external.fetch.backend`/`client`: allowlists `https://zenuml.com`, `https://*.zenuml.com`, mixpanel, plantuml, and the `connect`/`diagramly` remotes. Outbound fetch from the app is CSP-restricted to these. A new external host (e.g. a local-agent relay) would need to be added here, and adding fetch hosts is a **minor** version (no admin re-consent) per the manifest comment ("Modifying ... fetch permissions options and URLs ... does not require admin approval").
- `content.styles: unsafe-inline` only; no `connect-src` to arbitrary localhost — the iframe cannot call `http://localhost` on the user's machine, and a local agent cannot reach the sandboxed cross-origin iframe (documented: only Playwright crosses the Forge OOPIF boundary).

What blocks vs enables a local-agent bridge:
- **Blocks (direct):** No way for a local process to obtain a Forge invocation token or `x-forge-oauth-user`, so it cannot call conf-app's Cloudflare backend write paths, and it cannot drive `@forge/bridge` (no iframe, no context). UNKNOWN: whether any conf-app backend route is intentionally unauthenticated (the `_routes.json` allowlist includes `/track`, `/ai-generate-title`, `/diagramly/*`, `/diagram-likes/*`, `/api/*` — auth per-route was not individually audited here; `forge-custom-content` and `authenticate.ts` are confirmed Forge-token-gated).
- **Enables (indirect):** A local agent CAN produce/transform **DSL** and render images using the existing render-only MCP services (`diagramly-mcp-serverless` HTTP MCP, `mcp-zenuml` stdio) with no Forge dependency. The actual *store-to-Confluence* step would have to go through a user-authenticated Atlassian path (user's own Confluence OAuth/PAT against the v2 custom-content REST API), not through conf-app's Forge-gated backend.

---

## Reuse opportunities & constraints (summary)

**Top reuse opportunities**
1. **`diagramly-mcp-serverless` as the bridge skeleton** — it is already an HTTP MCP server on Cloudflare with a ZenUML-aware tool (`zenuml-renderer-screenshot`) and a Mermaid tool. Adding "create/update diagram" tools here is the lowest-friction path for a local agent (`src/index.ts` JSON-RPC handler + `src/tools/index.ts` registry).
2. **The DSL is the single source of truth for rendering** — `store.state.diagram.code` → `@zenuml/core .render()` (`src/components/Sequence.vue:83`). A local agent only needs to produce/modify the DSL string + `diagramType`; everything downstream (render, store) already keys off that.
3. **`CustomContentStorageProvider` / `createCustomContentV2` define the exact store contract** — v2 custom-content body = `{type, title, body:{value: JSON.stringify(diagram), representation:"raw"}, pageId|spaceId}` (`src/model/ApWrapper2.ts:237-278`). A local-agent write path can target the same Confluence v2 REST shape using the user's own Atlassian credentials, producing content the existing viewers read unchanged.

**Top constraints**
1. **Forge-token gating** — conf-app's backend only accepts Forge invocation tokens (`functions/utils/authenticate.ts:6-35`) + `x-forge-oauth-user` (`functions/forge-custom-content.ts:16-19`). A local agent cannot mint these; it cannot reuse conf-app's backend for writes. It must go to Confluence directly with the user's own auth.
2. **No bridge / no iframe access for local processes** — all current Confluence I/O is via `@forge/bridge` inside a sandboxed cross-origin Forge iframe (`src/utils/requestUtil.ts:65-66`); a local agent has neither the bridge nor a way into the iframe. The store step cannot be "call the running app".
3. **CSP / egress allowlist** — the Forge app's outbound fetch is restricted to `*.zenuml.com` + named remotes (`manifest.yml` `external.fetch`); there is no localhost/arbitrary-host egress and no inbound channel to the iframe. Any new relay host must be added to the allowlist (minor version, no admin re-consent), but localhost is not reachable from the iframe at all.

UNKNOWN / not verified here: per-route auth for the non-`forge-custom-content` Cloudflare endpoints in `_routes.json`; whether `mcp-zenuml` is wired into any shipped client config today; whether `@zenuml/core` exposes a headless DSL→SVG API usable server-side by a bridge (only the browser `.render()` call was confirmed).
