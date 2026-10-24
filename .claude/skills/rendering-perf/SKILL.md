---
name: rendering-perf
description: >
  Rendering performance analysis for ZenUML macros. Queries Mixpanel macro_viewed
  duration_ms percentiles by macro type, compares against baseline, and guides
  investigation of regressions or improvements.
  Usage: /rendering-perf
  Triggers on "rendering performance", "how fast do macros render", "p50 p90 p99",
  "duration_ms baseline", "render time regression".
---

# Rendering Performance

Analyse and track macro rendering performance via the `macro_viewed` `duration_ms` property.

## What `duration_ms` measures

`window.__macroLoadStart = performance.now()` is set in `index.html` `<head>` — the first line our JS executes inside the Forge iframe. `trackRenderTime()` fires at the end of each macro's render path.

**Included:** Vue app init → Forge context load → custom content fetch → diagram parse + render (e.g. mxGraph SVG, Mermaid/PlantUML transform, swagger-ui mount).

**Not included:** Forge iframe bootstrap (sandboxed OOPIF creation is opaque to JS; by the time `performance.now()` is callable, Forge is already done).

This makes `duration_ms` a reliable regression detector for **our own code's** contribution, not total user-perceived latency from click to visible diagram.

## Baseline (captured 2026-06-05, last 7 days)

Mixpanel project `3373228`, event `macro_viewed`, filter `duration_ms > 0`. For every customer-wide re-query or baseline refresh, also apply the **mixpanel** skill's string-encoded `is_internal_client_domain = "false"` filter.

| Macro type | p50 | p90 | p99 |
|---|---|---|---|
| graph | 1,681ms | 2,898ms | 4,132ms |
| openapi | 2,137ms | 6,258ms | 25,898ms |
| mermaid | 2,363ms | 12,910ms | 42,218ms |
| sequence | 3,215ms | 6,906ms | 41,848ms |
| plantuml | 4,544ms | 9,704ms | 54,423ms |
| **overall** | **2,614ms** | **11,231ms** | **41,848ms** |

**Notes on this baseline:**
- Graph data is post-fix (PR #224 moved `trackRenderTime` into `renderViewer()` so it actually fires). Pre-fix graph had zero events.
- High p99s on mermaid/sequence/plantuml are tab-backgrounded renders (browser throttles timers in backgrounded tabs). Consider capping `duration_ms` at ~30,000ms before storing to strip these outliers.
- Graph's tight tail (p99=4.1s vs 25–54s for others) is consistent with synchronous mxGraph SVG rendering — no async iframe loading in the viewer path.

## How to re-query

Run these three Mixpanel queries in parallel (project `3373228`, last 7 days, excluding internal traffic via `is_internal_client_domain = "false"`, `duration_ms > 0`, breakdown by `macro_type`):

```
metric: macro_viewed
measurement: aggregate-property / median   → p50
measurement: aggregate-property / p90      → p90
measurement: aggregate-property / p99      → p99
filter: duration_ms > 0 (strips events without timing)
filter: is_internal_client_domain equals "false" (use the string-encoded global filter from the mixpanel skill)
breakdown: macro_type
dateRange: last 7 days
```

Use `mcp__claude_ai_Mixpanel__Run-Query` with `report_type: insights`.

## Regression detection

A regression is: p90 for any macro type increases by >50% vs baseline, or a new macro type appears with zero events (tracking not firing).

| Signal | Likely cause |
|---|---|
| p99 spikes but p50 is stable | Tab-backgrounded outliers; check if baseline cap (30s) is in place |
| p50 + p90 both rise for one type | Rendering regression in that macro's viewer component |
| p50 + p90 rise for all types | Common path regression (Vue init, Forge context fetch, custom content load) |
| Zero events for a macro type | Tracking not firing — check `trackRenderTime` placement in that viewer |
| Missing `duration_ms` on events | `window.__macroLoadStart` not set — check `index.html` `<head>` ordering |

## Architecture reference

- `src/utils/analytics/trackRenderTime.ts` — fires `macro_viewed` with `duration_ms`, guards on `typeof window.__macroLoadStart === 'number'`
- `index.html` — `window.__macroLoadStart = performance.now()` in `<head>` before any module load
- `src/components/Viewer/ForgeGraphViewer.vue` — calls `trackRenderTime('graph', ...)` inside `renderViewer()` after `new GraphViewer()` returns (synchronous mxGraph render)
- Other viewers (Mermaid, PlantUML, Sequence, OpenAPI) call `trackRenderTime` at their respective render-complete points

## Known gaps

1. **Forge bootstrap not measurable** — cannot be changed; platform constraint.
2. **`render_mode: cached_svg`** — SVG cache (Phase 2, not yet shipped) will surface as a separate `render_mode` value and should be tracked separately from `live_render` once live.
3. **Tab-backgrounded outliers** — p99 is inflated. Mitigation: cap `duration_ms` at 30,000ms in `trackRenderTime.ts` before firing the event.
