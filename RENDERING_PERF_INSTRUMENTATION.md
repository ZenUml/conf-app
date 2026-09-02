# Design: Production phase instrumentation (Phase 0b)

Goal: attribute the mermaid `macro_viewed` p50 ≈ 2.5s to phases, so Phase 1 can pick the right lever
instead of betting on the POC's one-diagram profile. Read-only on render behavior. Covers
sequence/mermaid/plantuml together (they share the load path).

## The load path (verified against `main`)

```
index.html:4   window.__macroLoadStart = performance.now()            ← t0
index.html:59  drawio/js/viewer-static.min.js       (classic, blocking)  ┐ DrawIO
index.html:68-70 shapes mxBasic/mxAWS3D/mxAWS4       (classic, blocking)  │ parse
index.html:71-135 stencil registry setup            (classic, blocking)  ┘ cost
index.html:159 <script type="module" src="src/forgeIndex.ts">  ← entry bundle eval
forgeIndex.ts:513  main()  → :515 initializeCriticalPath()      ← APP_ENTRY
forgeIndex.ts:62   await initForgeContext()                     ← Forge context resolve
forgeIndex.ts:179  apWrapper.loadCustomContentWithOrphanRecovery()  ← custom-content fetch
forgeIndex.ts:472  mountRoot(doc, component)                    ← Vue mount
Mermaid.vue:40     mounted() → render() (:58 loadMermaid + mermaid.render)  ← viewer render
Mermaid.vue:41     trackRenderTime('mermaid', …)                ← t_end (fires macro_viewed)
```

Because the DrawIO `<head>` scripts (`:8–135`) are classic, blocking, and sit **after** `__macroLoadStart`
(`:4`) but **before** the module entry (`:159`), the t0→APP_ENTRY gap captures the full DrawIO + bundle
eval cost. That is exactly the DrawIO-split lever's measurement.

## The four timers + one flag

| Property | Start | Stop | What it isolates |
|---|---|---|---|
| `bootstrap_ms` | `__macroLoadStart` (index.html:4) | first stmt of `initializeCriticalPath()` (forgeIndex.ts:61) | head scripts (dom-to-image, md5, **DrawIO**) + entry bundle eval |
| `context_ms` | enter `getContext()` underlying resolve | its resolve | Forge context bridge round-trip |
| `fetch_ms` | enter `loadCustomContentWithOrphanRecovery()` | its resolve | custom-content REST round-trip |
| `render_ms` | enter viewer `render()` | render returns (just before `trackRenderTime`) | `loadMermaid()` + `mermaid.render()` |
| `tab_hidden` | listener armed at module load | read at `trackRenderTime` | `true` if `document.hidden` was ever true t0→end |

Plus `measured_sum_ms = bootstrap+context+fetch+render`. Analysts derive the **unattributed remainder**
= `duration_ms − measured_sum_ms` (Vue mount, `getMacroData`, paywall predicates, gaps). A large remainder
is itself a finding, not an error.

## Mechanism — a tiny marks singleton

New `src/utils/analytics/renderPerf.ts` (module-scoped; each Forge macro is its own iframe → its own
module instance → no cross-macro bleed):

```
renderPerf.time(name, () => promise)   // awaits, records duration once (first call wins)
renderPerf.markAppEntry()              // records performance.now() − __macroLoadStart as bootstrap_ms
renderPerf.getTimings()                // { bootstrap_ms, context_ms, fetch_ms, render_ms,
                                        //   measured_sum_ms, tab_hidden }
```
- t0 read from `window.__macroLoadStart` (already set in index.html:4).
- `tab_hidden`: at module load, `let everHidden = document.hidden;` + a `visibilitychange` listener that
  sticks `everHidden = true`. Read at emit time.
- **Record-once** semantics: `getContext`/fetch are memoized and called from several sites
  (forgeIndex.ts:62, 65, 123, 148). Timing the *first* resolution avoids double counting cache hits.
- Phases that don't run (e.g. legacy macro with no `customContentId` → no fetch) emit **undefined**, not 0,
  so absent phases don't dilute medians.

## Call-site wiring (4 touch points + emit)

1. **`renderPerf.markAppEntry()`** — first line of `initializeCriticalPath()` (forgeIndex.ts:61).
2. **`context_ms`** — wrap the underlying resolve in `forgeGlobal.getContext` (the memoized fn), so all
   call sites are covered by one change.
3. **`fetch_ms`** — wrap the body of `ApWrapper2.loadCustomContentWithOrphanRecovery` (or the call at
   forgeIndex.ts:179) in `renderPerf.time('fetch', …)`.
4. **`render_ms`** — wrap `render()` in the viewers: `Mermaid.vue:58`, `Sequence.vue` render, `PlantUml.vue`
   `fetchSvg`. (Mermaid first; the other two are one line each and give us the sequence/plantuml breakdown
   for free.)
5. **Emit** — `trackRenderTime` (already the choke point, called by every viewer) spreads
   `renderPerf.getTimings()` into the `macro_viewed` payload.

## Analytics schema (Phase 0a already added `cache_source`; add these)

`catalog.ts` / `types.ts`: `bootstrap_ms?, context_ms?, fetch_ms?, render_ms?, measured_sum_ms?` (number),
`tab_hidden?` (boolean). `trackRenderTime.ts` reads `renderPerf.getTimings()` and merges.

## Caveats baked in
- Timers are **measured durations, not a partition** — they won't sum to `duration_ms`; the remainder is
  emitted, not hidden.
- Tab-backgrounding inflates whichever phase was in flight; `tab_hidden` lets us **filter** those events
  out of percentiles (the fix for the 40s–425s p99 artifact), rather than capping blindly.
- Pure instrumentation: no change to what renders or when. Behavior-neutral, reversible.

## Verification (no deploy)
Unit: `renderPerf.time` records first-resolution duration; `getTimings` shape; `tab_hidden` sticky.
`trackRenderTime` spec extended to assert the timing props flow into the payload. Playwright `preview`
against `pnpm start:local`: load a mermaid macro, assert `macro_viewed` carries non-null
`bootstrap_ms`/`context_ms`/`fetch_ms`/`render_ms` and a plausible `measured_sum_ms ≤ duration_ms`.
