# Design: Mermaid Rendering Performance — candidate levers (EAG-18)

> **Superseded ordering (2026-06-06):** we pivoted to **instrument-first** after production data showed
> we can't see where the 2.5s p50 goes (`RENDERING_PERF_PLAN.md`). The two sections below — DrawIO
> code-split and persist-SVG — are now **Lever C** and **Lever D**: pre-analyzed candidates we build only
> if Phase 1 instrumentation indicts `bootstrap_ms` (C) or `render_ms` (D). On POC priors, fetch/context
> dominate, so Levers A/B (in the plan) are more likely. The immediate work is
> `RENDERING_PERF_INSTRUMENTATION.md`, not this doc.

Companion to `RENDERING_PERF_PLAN.md`. All file references are real, read from `main`. Nothing below is
implemented (only Phase 0a analytics vocabulary is written so far).

---

## Lever C — Code-split DrawIO out of the diagram view path (build only if `bootstrap_ms` dominates)

### Current state
`index.html` `<head>` loads DrawIO **unconditionally** for every macro (sequence, mermaid, plantuml,
graph, openapi, embed all map to `resource: main` → `dist/`):
- `index.html:59` `drawio/js/viewer-static.min.js` (self-contained DrawIO v30, the bulk)
- `index.html:68–70` shape JS (`mxBasic`, `mxAWS3D`, `mxAWS4`)
- `index.html:100–135` stencil registry (XML)
- `index.html:11` already carries the TODO: *"load DrawIO scripts for Graph macro only."*

So a mermaid view pays the full DrawIO parse/eval cost before it does anything. (Mermaid itself is
already lazy — `loadMermaid.ts` dynamic-imports it — so there's no double cost to untangle, just DrawIO.)

### Target state
DrawIO loads **only** on the Graph path. The router already branches by macro at
`forgeIndex.ts:430–496` (graph → `forge-graph-viewer`; everything else → `DiagramPortal`/`Workspace`).

### Mechanism (chosen): runtime injection in the graph branch
Move the DrawIO `<script>`/stencil tags out of `index.html` into a `loadDrawioRuntime()` helper that
injects them and resolves when `window.mxGraph`/the viewer globals are ready. Call it:
- in `forge-graph-viewer.ts` bootstrap before `new GraphViewer()`,
- in the Graph **editor** path (ForgeGraphEditor) before it instantiates DrawIO.

One HTML entry stays; no manifest/resource change. This mirrors the POC's no-DrawIO bundle result
(arm3 817ms → arm5 613ms warm ≈ **‑200ms**) without maintaining a second Vite entry.

**Rejected alternative:** a separate `graph.html` Vite entry + new Forge resource (like the POC's
`poc-text-main`). Cleaner isolation, but adds a manifest module, a build entry, and a second bundle to
keep in sync — not worth it when the router already forks by macro type.

### Risk & audit
DrawIO globals are loaded eagerly today, so shared code *may* assume they exist at import time. Before
moving: grep for `mxGraph`/`mxClient`/`viewer-static` references reachable from the non-graph path and
confirm none execute outside the graph branch. The graph editor is the second consumer and is easy to miss.

### Verification (no deploy needed)
Playwright `preview` against `pnpm start:local`: assert **zero** network requests matching
`viewer-static|mxBasic|stencils` on a mermaid view, and that they **are** present + Graph renders
(visual snapshot unchanged) on a graph view. The POC harness already greps these markers
(`POC_TEXT_MAIN_DRAWIO_HITS`).

### Files
`index.html`, new `src/utils/drawio/loadDrawioRuntime.ts`, `src/forge-graph-viewer.ts`,
`src/components/Viewer/Editor` graph editor entry. Independent of Phase 2; ship first.

---

## Lever D — Persist rendered SVG, viewer injects it (build only if `render_ms` dominates)

### One-paragraph summary
At save, render the Mermaid SVG once and store it as a new `mermaidSvg` field **in the custom-content
body** (same JSON, same version as `mermaidCode` → atomic). At view, if `mermaidSvg` is present, sanitize
it and inject directly, **skipping `mermaid.render()`**; otherwise live-render exactly as today. The SVG
arrives with the custom-content fetch the viewer already does — **no extra network round trip**.

### Data model (confirmed auto-persist)
Add to `src/model/Diagram/Diagram.ts`:
```ts
/** Phase 2 render cache: SVG produced at save, injected at view to skip mermaid.render(). */
mermaidSvg?: string = undefined;
```
Why this is enough: `ApWrapper2.updateCustomContentV2` writes `body.value = JSON.stringify(sanitizedBody)`
where `sanitizedBody` is the **whole diagram** minus a few transient flags (`ApWrapper2.ts:280–296, 314`).
On read it's `JSON.parse(body.raw.value)` back into the diagram (`ApWrapper2.ts:351`). So any new model
field round-trips for free — this is exactly the `raw.mermaidSvg` the POC read.

### Write path
Single choke point: `saveToPlatform(diagram)` (`Persistence.ts:23`) — used by every save path (slash-menu
insert, page-editor edit, view-mode Edit, fullscreen). Add a pre-save step:

```
saveToPlatform(diagram):
  if diagram.diagramType == Mermaid and diagram.mermaidCode:
     try: diagram.mermaidSvg = await renderMermaidToSvg(diagram.mermaidCode)   # loadMermaid + mermaid.render
     catch: leave mermaidSvg undefined            # cache is best-effort; never block save
  ... existing save (serializes mermaidSvg into the CC body) ...
```

```zenuml
// Write (save)
Editor -> saveToPlatform: diagram(mermaidCode)
saveToPlatform -> mermaid: render(code)
mermaid --> saveToPlatform: svg
saveToPlatform -> saveToPlatform: diagram.mermaidSvg = svg
saveToPlatform -> ApWrapper2: create/updateCustomContentV2(diagram)
ApWrapper2 -> Confluence: PUT body = JSON.stringify(diagram)  // includes mermaidSvg
```

**Chosen: re-render at save** (Option B). Self-contained, code is the single source of truth, mermaid is
already loaded in the editor so the cost is marginal, and save is not latency-critical.
**Rejected — Option A** (scrape the live preview component's `this.svg`): couples save to the viewer
component and risks a preview that lags the code being saved. **Rejected — Option C** (commit SVG to the
store on every viewer render, read at save): timing-fragile and doesn't cover save paths where the viewer
isn't mounted.

### Read path
`Mermaid.vue` (`:11` already injects `this.svg` via `v-html`; `mounted()`/`watch` call `render()`):

```
Mermaid.mounted / watch:
  cached = store.diagram.mermaidSvg
  if cached and sanitizeOk(cached):
     this.svg = sanitize(cached)
     trackRenderTime('mermaid', isDisplayMode, 'cached_svg', 'cc_body')   # Phase 0 dims
  else:
     this.svg = await this.render(mermaidCode)                            # live, unchanged
     trackRenderTime('mermaid', isDisplayMode, 'live_render', 'none')
```

```zenuml
// Read (view)
Viewer -> store: diagram (incl. mermaidSvg)
Viewer -> Viewer: cached present?
if (cached) {
  Viewer -> sanitizer: scrub(mermaidSvg)
  Viewer -> DOM: v-html (no mermaid.render)
} else {
  Viewer -> mermaid: render(code)   // fallback
  mermaid --> Viewer: svg
}
```

Net warm path becomes ≈ arm5/arm6 (~450–600ms): no DrawIO (Phase 1), no `mermaid.render()`, SVG already
in the fetched body. The long p90/p99 tail (live mermaid parsing + tab-throttling) is removed for cached views.

### Fallback & correctness (the cache is never required)
- No `mermaidSvg` (every macro saved before this ships) → live render. Backward-compatible by construction.
- Sanitizer rejects / empty / malformed SVG → live render.
- An edit rewrites `mermaidCode` and `mermaidSvg` in the **same body version**, so a stale SVG can't
  outlive its code (no separate cache key needed for the CC-body path — that only mattered for the
  out-of-scope localStorage/attachment viewer).
- System-of-record honored: SVG lives in Confluence, never our CF backend; render works with the backend down.

### Security — stored-SVG sanitization (decision needed, see open questions)
Today the live path `v-html`s **mermaid's own** output unsanitized. The new surface: a stored `mermaidSvg`
could be tampered via a direct `write:custom-content` REST PUT and then injected into a *viewer's* iframe —
stored XSS, bounded by the Forge sandbox/CSP but not eliminated. There is **no sanitizer dependency today**.
- **Recommended:** add DOMPurify, sanitize on read with the SVG profile. **Acceptance gate:** a sanitized
  real-world mermaid SVG (which uses `<style>`, `<foreignObject>`, `<marker>`) must render pixel-identical
  to the live render — DOMPurify's strict SVG profile can strip these, so this must be tested, not assumed.
- **Fallback if DOMPurify breaks fidelity:** a targeted scrub (drop `<script>`, `on*` attributes,
  `javascript:`/`data:` URLs, `<foreignObject>` script content) tuned to what mermaid emits.

### Size
The SVG now rides inside the CC body JSON (typical mermaid SVG ~5–50KB). Helps view latency (one fetch,
no second round trip) but bloats body parse. **Guard:** if `mermaidSvg` length > a cap (e.g. 256KB), skip
caching for that diagram (live render). Monitor body sizes post-rollout.

### Analytics
Done in Phase 0: `render_mode='cached_svg'` + `cache_source='cc_body'` on `macro_viewed`. This is how we
measure whether the target is hit and what fraction of views are served from cache.

### Files
`Diagram.ts` (field), `Persistence.ts` (+ `src/utils/mermaid/renderMermaidToSvg.ts` write helper),
`Mermaid.vue` (read branch), `src/utils/mermaid/sanitizeSvg.ts` (+ DOMPurify), specs for each.
PlantUML fast-follow reuses the same shape (`fetchSvg` already yields an SVG).

---

## Edge cases

| Case | Behavior |
|---|---|
| Macro saved before this ships (no `mermaidSvg`) | Live render (fallback) |
| User edits the code | Save re-renders → new SVG in same body version (atomic) |
| `mermaid.render()` throws at save | `mermaidSvg` left undefined; save succeeds; view live-renders |
| Sanitizer empties/rejects the SVG | Live render |
| SVG over size cap | Not cached; live render |
| Non-Mermaid types (sequence/openapi/graph/embed) | Untouched this phase |
| Backend (CF) down at view | Unaffected — SVG comes from Confluence CC body |

## Open questions for review
1. **Sanitization:** OK to add **DOMPurify** (new dep) with a render-fidelity acceptance test, falling back
   to a targeted scrub if it strips mermaid internals? Or do you consider the Forge sandbox sufficient and
   prefer the lighter targeted scrub from the start?
2. **Write trigger:** re-render at save inside `saveToPlatform` (chosen) vs. reuse the editor preview's
   already-rendered SVG (faster save, more coupling). Confirm re-render.
3. **Phase 1 mechanism:** runtime DrawIO injection in the graph branch (chosen) vs. a separate `graph.html`
   Vite entry/resource. Confirm runtime injection.
4. **Scope confirm:** Mermaid only in Phase 2, PlantUML as a separate follow-up PR?
