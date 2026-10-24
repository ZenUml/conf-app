# ADR-0004: Feasibility of server-side rendering for export (issue #434)

**Status**: Proposed — feasibility only, no implementation
**Date**: 2026-08-17

## Context

Issue #434 (implementation-ready follow-up to #73) quantifies the export failure: 305
`macro_export_failed` / `attachment_not_found` events over one week, 59 tenants, and 79.2% of
the failing macros were never rendered by a browser at all — so the backup PNG that
`src/export.js` looks up (`src/model/Attachment.ts`) never existed and never can, no matter how
many retries.

The proposed fix is to make `src/export.js` self-sufficient: on an empty attachment lookup, fetch
the diagram from custom content (always present — it's what the macro renders from) and render it
server-side. Rendering zenuml-core, Mermaid, PlantUML, and DrawIO without a DOM is multi-session
work; a partial attempt would produce a half-built PR. This ADR answers, per macro type, whether
and how a PNG/SVG can be produced without a browser, so a later dispatch can execute the smallest
slice without re-doing this analysis.

This is a feasibility record, not a design for the full feature. No production code is changed by
this ADR.

## Per-type verdict

Custom content stores, per `src/model/Diagram/Diagram.ts` (`getDiagramData`), one plain-text
source field per type: `code` (Sequence/OpenAPI/AsyncAPI), `mermaidCode` (Mermaid),
`plantUmlCode` (PlantUML), `graphXml` (Graph). All four are always present once a macro exists —
none of them depend on a browser having rendered anything.

### Sequence (zenuml-core) — feasible, has a shipped Node CLI

`@zenuml/core@4.2.0` (the exact version pinned in `package.json:104`) ships a `zenuml` CLI at
`dist/cli/zenuml.mjs` (`bin.zenuml` in the package's own `package.json`), documented as "Render
ZenUML DSL text to SVG or PNG." Verified by running it in this worktree, not read from docs:

```
$ node node_modules/@zenuml/core/dist/cli/zenuml.mjs -i test.zenuml -o test.svg -e svg
Wrote test.svg   # valid <svg> output, no browser
$ node node_modules/@zenuml/core/dist/cli/zenuml.mjs -i test.zenuml -o test.png -e png
Wrote test.png   # PNG image data, 666x502, verified with `file`
```

SVG render needs no DOM and no native binary — the width-measurement code
(`WidthProviderOnCanvas` in the CLI bundle) falls back to a character-estimate when no `canvas` is
available, so pure Node/V8 is sufficient. PNG rasterization is a second, heavier step: the CLI
resolves it through `@napi-rs/canvas` (a platform-specific native N-API binary — confirmed present
in `node_modules/.pnpm` as `@napi-rs+canvas-darwin-arm64@0.1.100`, an *optional* dependency of
`@zenuml/core` that pnpm installed for this machine's architecture) or, per the CLI's own error
text, `playwright-core` + a downloaded Chromium as a fallback.

**Verdict: feasible for SVG unconditionally; PNG needs either a native binary matched to the
runtime's OS/arch (risk: Forge's esbuild-based function bundler, `docs/debugging/` /
`reference_forge_bundler_ts_entry.md`, has no established path for bundling `.node` native
addons) or a headless-Chromium dependency neither runtime carries today. A pure-JS/WASM SVG
rasterizer (e.g. `resvg`'s WASM build) is the path that avoids both — untested here, but WASM is
supported in both a Forge Function's Node runtime and a Cloudflare Worker.**

### Mermaid — undetermined; needs a WASM/Node rasterizer, no DOM-free path in this repo

`mermaid@11.6.0` (`package.json:119`) is used directly as a browser library (`Mermaid.vue`);
nothing in this repo or `mermaid`'s own package exercises it outside a DOM. The only official
headless tool, `@mermaid-js/mermaid-cli`, is not a dependency here and is documented upstream as a
Puppeteer wrapper (spins up headless Chromium) — not a pure-Node/WASM render. `docs/adr/0001` once
added a `mermaidSvg` field to cache a browser-rendered SVG at save time (commit `5176221d`), but it
was reverted (commit `62a20c88`) and no longer exists in the Diagram model (`grep -rn
"mermaidSvg" src functions` outside the ADR text: zero matches). Even had it survived, it was
written by the editor's live preview — a browser render — so it inherits exactly the bug #434
describes: never-opened macros would still have no cached SVG.

**Verdict: undetermined. What would settle it: whether `mermaid`'s parser/renderer core can run
under `d3`+`jsdom` (mermaid's own test suite uses jsdom for unit tests, per its GitHub CI config —
not verified against this pinned 11.6.0 build) without Puppeteer, producing SVG text a
WASM-rasterizer step can turn into PNG. That is a spike, not covered by this ADR.**

### PlantUML — feasible today, already proven in production code

`src/model/Attachment.ts:fetchPlantUmlPng` already fetches a real PNG straight from the public
PlantUML server (`https://www.plantuml.com/plantuml/png/<encoded>`) with no DOM involvement — it
exists specifically because `html-to-image`'s DOM capture failed ~81% of the time on PlantUML's
remote SVG. `src/utils/plantuml/encode.ts` is a pure, dependency-light (`pako` only) deflate+base64
encoder, directly portable to a Forge function. The only gap: `manifest.yml`'s
`permissions.external.fetch` currently lists `https://www.plantuml.com` under `client` (line 173)
but not `backend` (lines 157–167) — a Forge function cannot call it until that's added.

**Verdict: feasible now.** Concrete path: port `plantumlEncode` + a fetch against
`PLANTUML_PNG_SERVER` into `export.js`, and add `https://www.plantuml.com` to
`external.fetch.backend`. Per this project's own `CLAUDE.md` ("Forge app versions — major vs
minor"), an egress URL addition on our Forge-from-Connect apps is a **minor** version bump — no
admin re-consent, auto-upgrades.

### Graph (DrawIO) — infeasible in this codebase's current form; would need a remote render service

The Graph viewer loads `drawio/js/viewer-static.min.js` (`src/utils/drawio/loadDrawioViewer.ts`) —
draw.io's classic mxGraph viewer, which constructs and measures SVG via direct DOM calls
(`document.createElementNS`, `getBBox()` for label layout). This is a well-documented DOM
dependency of mxGraph specifically (`getBBox()` is not implemented by jsdom — a long-standing,
still-open jsdom limitation, not something specific to this codebase), so a headless-DOM shim
cannot substitute for a real rendering engine here. draw.io's own official server-side export path
(`convert.diagrams.net` / the `jgraph/export-server` Docker image) exists but always wraps a
headless-Chromium instance — not a pure-JS/WASM render — and this repo does not vendor or call it
anywhere (`grep -rn "convert.diagrams.net\|export-server" .` outside `node_modules`: zero
matches).

**Verdict: infeasible without a headless-Chromium service.** Concrete path if pursued: stand up (or
call) a draw.io export server and fetch a PNG for the stored `graphXml`. This is the heaviest of
the six — a persistent-process dependency neither a Forge Function nor a Cloudflare Worker can host
directly (see "Where it should run" below); it would need a third external render service,
out of scope for a first slice.

### OpenAPI — infeasible without a headless browser; the API-spec doc has no native raster form

The OpenAPI macro renders `swagger-ui@5.32.1` (`package.json:132`) as a full React UI in the DOM
(`src/forge-swagger-ui.ts` mounts `OpenApiViewer.vue` around it). `swagger-ui` has no server-side
render / static-image mode — it is an interactive spec browser, not a diagram generator, and there
is no equivalent to PlantUML's remote-PNG endpoint for an arbitrary OpenAPI document (the "image"
being exported is a screenshot of an interactive UI, not a deterministic render of a compact
source string). Nothing in this repo or `swagger-ui`'s package touches Node/SSR.

**Verdict: infeasible without a headless-Chromium screenshot of the same page the browser would
have shown.** No concrete DOM-free path exists; this is the other type (with Graph) that would need
a real headless-browser render service, not just a heavier Node dependency.

### Embed — not a distinct renderer; inherits its target type's verdict

`ForgeEmbedViewer.vue` does not render anything itself — `loadForgeViewerComponent` dynamically
mounts whichever of the five real viewer components (Sequence/Mermaid/PlantUml/Graph/OpenApi)
matches the resolved document's `diagramType`, and passes it `doc.graphXml` / `doc.code` /
`doc.mermaidCode` straight through. There is no `embed`-specific rendering code path in
`src/model/Diagram/Diagram.ts` or the viewer tree.

**Verdict: N/A as a type of its own — every Embed macro's feasibility is exactly its underlying
type's feasibility above.**

## Where it should run: Forge Function, not the Cloudflare Worker backend

Recommendation: **the Forge Function (`export.js` itself, or a function it calls), not
`functions/` on Cloudflare.**

- **Credentials.** `export.js` already runs as a Forge function and already calls
  `api.asApp()`/`api.asUser()` directly (verified reading `src/export.js:157-176`) — it has the
  Confluence read credentials needed for custom content with zero additional wiring. The
  Cloudflare Worker backend, by contrast, holds *no* independent Confluence credential: every
  Confluence call it makes is relayed through a Forge-issued OAuth token forwarded in the
  `x-forge-oauth-user` header plus `apiBaseUrl`/`forgeAppId` pulled from a Forge-signed token
  (verified in `functions/forge-custom-content.ts:26-51`). Routing render-on-export through the
  Worker would mean `export.js` minting and forwarding a token to a second hop for no functional
  gain.
- **Runtime fit.** The concrete Sequence and PlantUML paths above are pure-JS/pure-fetch —
  trivially Forge-function-shaped. Where a native binary or WASM rasterizer becomes necessary
  (PNG for Sequence, any path for Mermaid), Cloudflare Workers are no more capable than Forge
  Functions: Workers cannot spawn a child process or load a native N-API addon any more than a
  Forge function bundle reliably can, and WASM is supported in both runtimes equally. Neither
  runtime helps with Graph or OpenAPI, which need an actual headless-Chromium process — a
  capability that lives in neither today and would require a genuinely separate service (e.g. a
  standalone Puppeteer/Playwright render endpoint), independent of this choice.
- **Cost.** Forge Functions bill in GB-seconds (see the project's `forge-functions-cost` skill);
  export-triggered renders are inherently rare-path (the whole point of #434 is these are
  never-viewed macros — a small, bounded population, not hot-path traffic), so GB-seconds exposure
  is low and bounded by export volume, not view volume.

## Smallest first slice

**Implement PlantUML only.** It is the one type with a proven, dependency-light, already-used
server-callable path (`fetchPlantUmlPng` in `src/model/Attachment.ts` is the exact logic to port),
it requires only a manifest egress addition (minor version, no admin consent), and it has no
native-binary or headless-browser dependency to derisk first.

Suggested acceptance criteria for the dispatch that implements it:

1. `src/export.js`, on `attachment_not_found` for a macro whose custom content `diagramType ===
   'plantuml'`: fetch the custom content body (`plantUmlCode`), encode it with a ported
   `plantumlEncode` (or import `src/utils/plantuml/encode.ts` directly — it has no browser-only
   dependency), fetch `https://www.plantuml.com/plantuml/png/<encoded>`, and on a 200 with
   `Content-Type: image/png`, return `createMediaDocument` pointing at that URL (or an inlined
   media node, if Confluence's ADF export accepts an external image URL directly the same way
   `createMediaDocument` already does for attachment download links — verify against the existing
   `createMediaDocument` shape before assuming).
2. On any failure of the PlantUML-server fetch (non-200, wrong content-type, timeout), fall back to
   today's `attachment_not_found` error document unchanged — never regress the current behavior for
   the cases that already work.
3. Add `https://www.plantuml.com` to `manifest.yml`'s `permissions.external.fetch.backend` list.
4. New `macro_export_*` analytics: emit a distinguishing property (e.g.
   `render_source: 'server_render_plantuml'`) on `macro_export_succeeded` so the win is directly
   measurable once PR #488 (carries `macro_type` on every `macro_export_*` event, open as of this
   writing) merges and per-type failure/success is queryable.
5. Verification: re-run the #434 join (never-rendered PlantUML macros against `macro_export_failed`
   rate) post-release; the PlantUML slice of the 79.2% never-rendered bucket should disappear from
   `attachment_not_found` and reappear as `macro_export_succeeded` with the new `render_source` tag.

Sequence (SVG-only) is the natural second slice once a PNG rasterization strategy (WASM resvg,
most likely) is chosen — it already has a working, verified SVG CLI path; it is not the first slice
only because turning SVG into the PNG the export ADF's `media` node needs is still an open
sub-question this ADR does not resolve.

## What this does not solve

Confirmed from code, not assumed: the issue's claim that the diagram-source snapshots don't help is
correct, and the pattern is broader than the one example the issue names.

- `zenuml-<ccId>.json` (referenced in #434) is a real, currently-live artifact:
  `src/model/SnapshotAttachment.ts` writes it, scoped to `DiagramType.Sequence`/`Mermaid`/`PlantUml`
  only (Graph/Embed/OpenApi/AsyncApi excluded — the module's own comment says Graph "already embeds
  its XML in the PNG", and the others are marked YAGNI there). Its own header comment confirms the
  issue's claim precisely: written "at macro save (Task 3) and, as a backfill, from
  `maybeBackfillSnapshot`... an editor-preview render... or ANY macro viewed" — i.e. every write
  path requires either the editor (save) or the viewer (backfill) to have actually mounted in a
  browser. A macro created without ever opening the editor (e.g. an Agent Link API-driven create,
  per this project's Agent Link feature) or never subsequently viewed has no snapshot, confirming
  the issue's claim exactly.
- `mermaidSvg` (`docs/adr/0001`) is a second, previously real instance of exactly this pattern: a
  cached render artifact written only by the editor's live preview (commit `5176221d`), later
  reverted (commit `62a20c88`) for unrelated reasons, but even while it existed it would not have
  helped a never-opened macro, for the identical reason the issue gives for the JSON snapshot.
- Generalized rule for any future cache/snapshot proposal on this bug: **an artifact only closes
  this gap if its write path is reachable without a browser having rendered the macro.** Custom
  content's own source fields (`code` / `mermaidCode` / `plantUmlCode` / `graphXml`) are the only
  artifacts in this codebase that satisfy that today, because they are written at save time by
  whatever created the macro (including non-browser creators, e.g. Agent Link's API-driven
  creates) rather than at view/render time.
- This ADR does not solve Mermaid, Graph, or OpenAPI — those remain either undetermined (Mermaid)
  or blocked on a headless-browser render service this codebase does not have (Graph, OpenAPI).
  #434 will not be fully closed by implementing PlantUML alone; it removes one type's share of the
  79.2% never-rendered bucket, not all of it.
