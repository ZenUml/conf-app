---
name: rendering-perf
description: >
  Rendering performance analysis for ZenUML macros. Queries Mixpanel macro_viewed
  duration_ms and its phase timings, split by viewport gate and first/repeat view,
  compares against baseline, and guides investigation of regressions or improvements.
  Usage: /rendering-perf
  Triggers on "rendering performance", "how fast do macros render", "loading time of diagrams",
  "p50 p90 p99", "duration_ms baseline", "render time regression".
---

# Rendering Performance

Analyse and track macro rendering performance via the `macro_viewed` `duration_ms` property.

## What `duration_ms` measures

`window.__macroLoadStart = performance.now()` is set in `index.html` `<head>` — the first line our JS executes inside the Forge iframe. `trackRenderTime()` (`src/utils/analytics/trackRenderTime.ts`) fires at the end of each macro's render path.

**Included:** app init → Forge context load → custom content fetch → diagram parse + render, **and any time the #382 viewport gate held the macro back** (see below).

**Not included:** Forge iframe bootstrap (sandboxed OOPIF creation is opaque to JS; by the time `performance.now()` is callable, Forge is already done). User-perceived latency is therefore always longer than `duration_ms`.

## Two traps that make a raw `duration_ms` percentile meaningless

### 1. The viewport gate adds deliberate waiting (since 2026-08)

`src/utils/renderGate/maybeGateViewerRender.ts` runs on every viewer mount. Offscreen macros wait their turn (default `gate_mode: load` defers the content fetch too), and that wait is inside `duration_ms`. The outcome is on the event as `render_gate`:

| `render_gate` | Meaning | Use for user-perceived load? |
|---|---|---|
| `immediate` | Visible at page load, not deferred (`render_deferred_ms` ≈ 0) | **Yes — this is the headline metric** |
| `scrolled_in` | Offscreen at load, rendered when scrolled into view | No — includes scroll time; subtract `render_deferred_ms` |
| `background` | Offscreen, rendered at idle after visible macros | No — includes ~5 s of intentional deferral |
| `failopen` | Gate errored, rendered eagerly | Yes, but rare |
| (not set) | Gate never ran (e.g. some embed / non-gated paths) | Report separately |

Graph and OpenAPI viewers report no `immediate` bucket in practice; for them use all views plus `measured_sum_ms`.

### 2. Repeat views are sampled at 10% (since the 2026-11-06 release, commit `ea209d1c4`)

`view_of_day: "first"` (first render of that macro in that browser per UTC day) is sent at 100%; `view_of_day: "repeat"` is sent at 10% with `sample_rate: 0.1`. Repeats are much faster (warm cache), so after this release the raw event mix shifts toward slow first views and **every raw percentile rose with no code change** (week of 2026-11-09: immediate p50 650 → 1,180 ms, overall p50 6.1 → 6.8 s, event volume halved). Always break down by `view_of_day`; never compare a raw percentile across 2026-11-06. Events without `view_of_day` predate the release or come from a browser without storage.

## Baseline (captured 2026-11-21, last 7 days)

Filters: `is_internal_client_domain = "false"` (string-encoded, see **mixpanel** skill), `duration_ms > 0`, `tab_hidden = "false"` (string-encoded), `surface = "viewer"`. 36,890 events; ~84% mermaid, ~84% Lite.

**Headline — `render_gate = immediate`, by `view_of_day`:**

| | events | p50 | p90 |
|---|---|---|---|
| first | 1,699 | 1,374 ms | 4,867 ms |
| repeat (×10 sampled) | 332 | 389 ms | 1,557 ms |

**Immediate by macro type (first + repeat mixed, post-sampling):**

| Type | p50 | p90 |
|---|---|---|
| mermaid | 1,156 ms | 4,205 ms |
| sequence | 1,667 ms | 4,733 ms |
| plantuml | 2,337 ms | 6,450 ms |

**All views by gate (context only, not a latency metric):**

| `render_gate` | share | p50 | p90 | median `render_deferred_ms` |
|---|---|---|---|---|
| immediate | 6% | 1,205 ms | 4,501 ms | 6 ms |
| scrolled_in | 14% | 2,546 ms | 6,470 ms | 722 ms |
| background | 70% | 7,008 ms | 10,150 ms | 5,395 ms |
| (not set) | 11% | 1,785 ms | 4,601 ms | — |

All-views type medians (graph 1.9 s, openapi 1.6 s, mermaid 6.4 s, sequence 6.6 s, plantuml 6.7 s) mostly reflect how many offscreen macros each type has.

**Phase breakdown (all views, p50 / p90):** `bootstrap_ms` 49 / 346, `context_ms` 171 / 703, `fetch_ms` 580 / 1,501, `render_ms` 249 / 1,716 (mermaid 270 / 1,986; sequence 288 / 1,387; plantuml ≈ 4 because the image loads outside the measured path). Content fetch dominates the median; mermaid/sequence render dominates the tail.

**Cache:** pre-sampling week 2026-10-26..11-01, immediate renders: `cache_state = warm` p50 556 ms / p90 1,708 ms vs `cold` p50 2,077 ms / p90 5,453 ms. Bundle download is the single biggest lever on a visible macro.

**Historical:** the 2026-06-05 baseline (overall p50 2,614 ms, p90 11,231 ms; graph 1,681 ms p50) predates the viewport gate, phase timings and sampling — do not compare it with anything above.

## How to re-query

Mixpanel MCP `Get-Business-Context` (project `3373228`) first, then `Run-Query` with `report_type: insights`, `chartType: table`. Use the four common filters above on every query. Run in parallel:

1. **Headline:** filter `render_gate = immediate`; metrics total, median/p90 of `duration_ms`; breakdown `view_of_day`, then `macro_type`.
2. **Gate mix:** breakdown `render_gate`; metrics total, median/p90 `duration_ms`, median `render_deferred_ms`, median/p90 `measured_sum_ms`.
3. **Phases:** median and p90 of `bootstrap_ms`, `context_ms`, `fetch_ms`, `render_ms` (children of fetch: `custom_content_fetch_ms`, `page_adf_fetch_ms`); breakdown `macro_type`.
4. **Trend:** `chartType: line`, `unit: week`, 12 weeks, median `duration_ms`, breakdown `render_gate` (and `view_of_day` for windows after 2026-11-06).

Optional: breakdown `cache_state`, `product_type`, `content_source`, `gate_mode`.

## Regression detection

Compare like with like: `immediate` + `view_of_day = first` against the same slice of the baseline. A regression is p90 up >50% in that slice for any type, or a type dropping to zero events.

| Signal | Likely cause |
|---|---|
| Raw percentiles jump while event volume changes sharply | Sampling / mix shift — check `view_of_day`, `sample_rate`, `render_gate` shares before calling it a regression |
| `background` / `scrolled_in` slower, `immediate` flat | Gate scheduling change, not render cost |
| `immediate` `bootstrap_ms` or `cold` share up | Bundle size / cache-busting change (new deploy invalidates the cache for a day) |
| `fetch_ms` up for all types | Confluence custom-content API latency or fetch-path change |
| `render_ms` up for one type | That renderer (mermaid/sequence library upgrade, viewer component) |
| p99 spikes, p50 stable | Backgrounded tabs — confirm the `tab_hidden = "false"` filter |
| Zero events for a type | `trackRenderTime` not firing in that viewer |
| Missing `duration_ms` | `window.__macroLoadStart` not set — check `index.html` `<head>` ordering |

## Architecture reference

- `src/utils/analytics/trackRenderTime.ts` — fires `macro_viewed` with `duration_ms`, `cache_state`, phase timings, gate telemetry
- `src/utils/analytics/renderPerf.ts` — phase timers, `measured_sum_ms`, `tab_hidden`, `content_source`
- `src/utils/renderGate/maybeGateViewerRender.ts` — viewport gate, `render_gate` / `render_deferred_ms` / `visible_at_boot` / `gate_mode`
- `src/utils/analytics/macroViewOfDay.ts` — `view_of_day` classification and repeat sampling
- `index.html` — `window.__macroLoadStart = performance.now()` in `<head>` before any module load

## Known gaps

1. **Forge iframe bootstrap is not measurable** — platform constraint.
2. **No `immediate` slice for graph/openapi** — their user-perceived latency has to be inferred from `measured_sum_ms`.
3. **No first/repeat split before 2026-11-06** — compare pre-release windows only against weighted post-release figures (repeats × 10).
