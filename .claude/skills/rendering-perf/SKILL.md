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

**Ongoing tracking**, as opposed to a one-off analysis, has two halves:
`docs/analytics/rendering-perf-board.md` specs the Mixpanel board card by card (it must be
built by hand — Mixpanel has no board-creation API), and `scripts/perf_report.py` produces
the same cuts headlessly for cron/CI/regression diffs.

## What `duration_ms` measures

`window.__macroLoadStart = performance.now()` is set in `index.html` `<head>` — the first line our JS executes inside the Forge iframe. `trackRenderTime()` fires at the end of each macro's render path.

**Included:** Vue app init → Forge context load → custom content fetch → diagram parse + render (e.g. mxGraph SVG, Mermaid/PlantUML transform, swagger-ui mount).

**Not included:** Forge iframe bootstrap (sandboxed OOPIF creation is opaque to JS; by the time `performance.now()` is callable, Forge is already done).

This makes `duration_ms` a reliable regression detector for **our own code's** contribution, not total user-perceived latency from click to visible diagram.

## Segment before you compare — four dimensions that swamp any code change

A single pooled p50 is close to meaningless. Always pin these four, or you will
"discover" regressions that are really mix shifts:

| Dimension | Why it matters |
|---|---|
| `surface` | `viewer` (real page render) vs `editor`. **Editor renders are a different workload** — long-lived iframes, tab switches re-firing. Before 2026-07-19 (#368) the native macro-config surface was mislabelled `viewer`, so any window spanning that fix mixes the two. |
| `tab_hidden` | `true` ⇒ the tab was backgrounded at some point and timers were throttled. ~19% of viewer renders. Inflates p50 by ~2x and p99 by ~10x. **Filter `tab_hidden != true` for every percentile you quote.** |
| `cache_state` | `warm` vs `cold` browser cache. Cold is ~1.8x slower at p50. Cold share ~15% of visible viewer renders. |
| `content_source` | `swr_cache` (content-SWR hit) vs `fetch` vs absent. Since the SWR rollout this is the single largest determinant — a cache hit is ~3x faster. Mixing them hides everything else. |

## Baseline (captured 2026-07-25, 7 days 07-18 → 07-25)

Mixpanel project `3373228`, event `macro_viewed`. Population: **`surface='viewer'`,
`tab_hidden != true`, `duration_ms > 0`, internal domains excluded** (exclude list: the
**mixpanel** skill). n = 62,227. All events `render_mode='live_render'`.

| Macro type | n | p50 | p90 | p99 |
|---|---|---|---|---|
| mermaid | 44,790 | 1,490ms | 5,013ms | 14,086ms |
| plantuml | 5,933 | 2,411ms | 5,750ms | 13,568ms |
| graph | 5,254 | 2,280ms | 5,903ms | 16,300ms |
| openapi | 3,179 | 1,451ms | 3,317ms | 8,724ms |
| sequence | 3,071 | 2,401ms | 9,893ms | 59,436ms |
| **overall** | **62,227** | **1,671ms** | **5,224ms** | — |

Mermaid is ~72% of all viewer renders, so it dominates the pooled number.

**Phase attribution (p50 / p90, same population).** `duration_ms − measured_sum_ms` is the
deliberate unattributed remainder (Vue mount, `getMacroData`, paywall predicates, gaps):

| Macro type | bootstrap | context | fetch | render | measured_sum |
|---|---|---|---|---|---|
| mermaid | 64 / 307 | 183 / 735 | **792 / 1,905** | 229 / 1,451 | 1,372 / 4,460 |
| plantuml | 87 / 539 | 260 / 1,469 | **640 / 1,592** | 10 / 70 | 1,163 / 3,648 |
| graph | 39 / 161 | 119 / 457 | **1,003 / 2,307** | *none* | 1,230 / 2,891 |
| openapi | 43 / 196 | 133 / 563 | **986 / 2,277** | *none* | 1,288 / 2,873 |
| sequence | 101 / 683 | 261 / 1,991 | **736 / 1,466** | 293 / 1,644 | 1,598 / 6,363 |

**`fetch` is the dominant phase for every macro type** — roughly half of `measured_sum_ms`
at p50. Its children: `custom_content_fetch_ms` p50 686ms / p90 1,703ms, and
`page_adf_fetch_ms` p50 322ms / p90 913ms (children are not summed into `measured_sum_ms`).
Bootstrap is negligible (39–101ms p50) — do not spend effort there.

**Content-SWR is the biggest lever, and it is already paying (2026-07-24, visible viewer):**

| content_source | mermaid p50 | mermaid p90 | plantuml p50 | sequence p50 |
|---|---|---|---|---|
| `fetch` | 1,960ms | 5,739ms | 3,199ms | 1,983ms |
| `swr_cache` | **655ms** | **1,927ms** | **1,593ms** | **892ms** |

A SWR hit is ~3x faster at p50 and eliminates `fetch_ms` entirely. SWR reached prod
mid-day 2026-07-23 and was fully rolled out 07-24; the daily pooled p50 fell from
~2,100ms (07-11 → 07-18) to 1,240ms on 07-24 as it landed. Only sequence/mermaid/plantuml
are wired to SWR — graph and openapi still report no `content_source`.

**vs the 2026-06-05 baseline:** every type improved, but the old table pooled `surface`
and included `tab_hidden` renders, so it is **not** a like-for-like comparison — treat
the direction as real and the magnitude as unreliable. Old pooled p50/p90 was
2,614ms / 11,231ms; comparable-population today is 1,671ms / 5,224ms.

## How to re-query

The claude.ai Mixpanel MCP is **absent in headless runs** (cron, `/loop`, CI, remote
sessions). Use JQL via `.claude/skills/mixpanel/scripts/mp_query.py --file q.js`, which
reads `API_Secret` from `.env.mixpanel`; in a remote container the secret is usually in
the `MIXPANEL_API_SECRET` env var instead, so write it to a scratchpad `.env.mixpanel`
and run from there. Never echo or commit the secret.

Fastest path for a standard read — the whole baseline in one command:

```bash
python3 .claude/skills/rendering-perf/scripts/perf_report.py --days 7          # text
python3 .claude/skills/rendering-perf/scripts/perf_report.py --days 1 --json d.json
```

It reports overall + per-type percentiles, phase attribution, the `content_source` split,
and a daily trend with slow-share/SWR-share/cold-share — the same cuts as the Mixpanel
board, on the same pinned population. Reach for hand-written JQL only for a cut it
doesn't cover.

JQL notes that cost time to work out:
- **Max 8 reducers per `groupBy`.** A 9th returns `412 Precondition Failed`
  (`UserVisiblePreconditionFailedError: … accept at most 8 reducers`), which looks exactly
  like a rate limit but is not — retrying never clears it. Split the query instead; that is
  why `perf_report.py` fetches phases separately from duration percentiles.
- `412` and `429` *are* also the throttle codes, so check the response **body** before
  assuming you are rate-limited — the reducer-cap error is only visible there.
- `mixpanel.reducer.numeric_percentiles(prop, [50, 90, 99])` gives percentiles directly,
  but returns **no count** — pass an array of reducers to get both:
  `groupBy([keyFn], [mixpanel.reducer.count(), mixpanel.reducer.numeric_percentiles(...)])`.
- Percentiles do **not** compose across groups. For a pooled figure, run a separate query
  whose key function returns a constant — don't try to average per-type percentiles.
- Events missing a phase property are skipped by `numeric_percentiles`, which returns `[]`
  for that group. An empty result means **not instrumented**, not "zero ms".

A worked set of queries (per-type percentiles + phase attribution + SWR split) is in
`references/queries/`.

## Interactive path

When the claude.ai Mixpanel MCP *is* available, `mcp__claude_ai_Mixpanel__Run-Query` with
`report_type: insights` works for the simple per-type percentile view — but it cannot
express the four-way segmentation above as cleanly as JQL. Prefer JQL for anything you
intend to compare against this baseline.

## Regression detection

A regression is: p90 for any macro type increases by >50% vs baseline, or a new macro type appears with zero events (tracking not firing).

| Signal | Likely cause |
|---|---|
| p99 spikes but p50 is stable | Tab-backgrounded outliers — check you filtered `tab_hidden != true` before blaming code |
| p50 rises with no phase moving | Mix shift, not a regression. Check the `content_source` / `cache_state` / `surface` split first |
| p50 + p90 both rise for one type | Rendering regression in that macro's viewer component |
| p50 + p90 rise for all types | Common path regression (Vue init, Forge context fetch, custom content load) |
| `fetch_ms` rises | Confluence custom-content API latency, or a SWR cache-hit-rate drop — check `content_source` share before touching code |
| `swr_cache` share falls | SWR store eviction/versioning issue; a hit-rate drop shows up as a pooled p50 rise with every phase unchanged |
| Zero events for a macro type | Tracking not firing — check `trackRenderTime` placement in that viewer |
| Missing `duration_ms` on events | `window.__macroLoadStart` not set — check `index.html` `<head>` ordering |
| A phase absent for one type only | That viewer never wraps the phase in `renderPerf.time(...)` — instrumentation gap, not speed |

## Architecture reference

- `src/utils/analytics/trackRenderTime.ts` — fires `macro_viewed` with `duration_ms`, guards on `typeof window.__macroLoadStart === 'number'`
- `src/utils/analytics/renderPerf.ts` — the phase timers. `markAppEntry()` → `bootstrap_ms`; `time(phase, fn)` → `context_ms` / `fetch_ms` / `render_ms` / `custom_content_fetch_ms` / `page_adf_fetch_ms`; `markContentSource()` → `content_source`; sticky `tab_hidden`
- `index.html` — `window.__macroLoadStart = performance.now()` in `<head>` before any module load
- `src/components/Viewer/ForgeGraphViewer.vue` — calls `trackRenderTime('graph', ...)` inside `renderViewer()` after `new GraphViewer()` returns (synchronous mxGraph render)
- Other viewers (Mermaid, PlantUML, Sequence, OpenAPI) call `trackRenderTime` at their respective render-complete points

Where each phase is actually wrapped (grep `renderPerf.time(` to re-verify — this list drifts):
`context` in `src/model/globals/forgeGlobal.ts`; `fetch` in `src/forgeIndex.ts`;
`cc_fetch` + `adf_scan` in `src/model/ApWrapper2.ts`; `render` in **only**
`src/components/Sequence.vue`, `Mermaid.vue`, `PlantUml.vue`.

## Known gaps

1. **Forge bootstrap not measurable** — cannot be changed; platform constraint.
2. **`render_ms` is missing for graph and openapi** — confirmed in both the data (empty
   percentile result for those two types, 2026-07-25) and the code (no `renderPerf.time('render', …)`
   in `ForgeGraphViewer.vue` or the swagger viewer). Their `duration_ms − measured_sum_ms`
   remainder therefore silently contains the actual render. Since graph carries the joint-highest
   `fetch_ms` **and** an unmeasured render, it is the least-attributed type we have — wrap
   both viewers' render calls before drawing conclusions about graph performance.
3. **`content_source` is missing for graph and openapi** — they are not on the content-SWR
   path, so the largest available win (~3x at p50) does not apply to them yet.
4. **`render_mode: cached_svg`** — SVG cache (Phase 2) still not shipped: 100% of prod events
   are `live_render` as of 2026-07-25. Track separately from `live_render` once live.
5. **Tab-backgrounded outliers** — p99 is inflated. `tab_hidden` now lets analysts *exclude*
   these (preferred over the previously-suggested 30s cap, which would destroy real slow renders).
6. **`render_gate` (#382/#384 viewport gate) is not in prod yet** — `render_gate` was absent on
   every prod event through 2026-07-25, so the gate's effect on these numbers is zero so far.
   Re-baseline after it deploys; expect it to change *when* renders happen, not how long they take.
