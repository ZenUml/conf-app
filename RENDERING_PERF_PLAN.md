# Implementation Plan: Mermaid Rendering Performance (EAG-18)

**Approach: instrument first, then optimize the phase the data indicts.** Revised 2026-06-06 after
querying production — the POC's "optimize render" framing doesn't survive contact with the data.

Companion design: `RENDERING_PERF_DESIGN.md` (timer placement + pre-analyzed candidate levers).

## What production actually says (Mixpanel `macro_viewed`, 30d, internal domains excluded)

| macro_type | p50 | p90 | p99 | Views | % views |
|---|---|---|---|---|---|
| sequence | 4,808ms | 16,894 | 73,835 | 515 | 3% |
| plantuml | 3,477ms | 10,013 | **424,637** | 949 | 6% |
| graph | 2,693ms | 6,609 | 16,440 | 762 | 5% |
| mermaid | 2,537ms | 10,438 | 38,058 | **12,465** | **80%** |
| openapi | 1,869ms | 6,035 | 19,262 | 868 | 6% |

1. **Mermaid is the right target — by volume, not by per-view slowness.** Mermaid is 80% of all views
   (`vin3s` alone = 32% of mermaid), so it owns most of the *aggregate* user-wait. But per view it's the
   2nd-*fastest* type: sequence (4.8s) and plantuml (3.5s) are slower. We optimize mermaid because it's
   where the traffic is.
2. **The p99 "40s" headline is mostly artifact — do not chase it.** plantuml p99 = 424,637ms (7 min);
   the slowest tenant medians are all 1–6-view tenants (`arcadisintel` 49s/4 views). That's tab-backgrounded
   timer throttling + tiny-sample noise. The real, broad signal is **p50 ≈ 2.5s**, shared by nearly every
   high-volume tenant (`vin3s` 2.9s, `colesgroup` 2.5s, `airwallex` 1.8s) → it's the **common code path**,
   not tenant-specific big diagrams.
3. **We cannot see where the 2.5s goes.** `trackRenderTime` emits only `duration_ms`. The sole phase
   breakdown we have is the POC, on **one synthetic diagram**: content_fetch ~50%, context_init ~30%,
   lib_load ~13%, **mermaid.render() ~4%**. If that holds in prod, the originally-planned SVG cache touches
   only ~17% and the DrawIO split ~a couple hundred ms, while **~80% (fetch + context) was untouched.**

**Conclusion:** building the SVG cache now is a bet on a one-diagram profile. Instrument production first;
let real data choose the lever.

## Target (provisional)

Mermaid `macro_viewed` **p50 < 1,000ms, p90 < 3,000ms** — but treat as provisional until Phase 1 shows
the breakdown. If fetch/context dominate (likely), the lever and even the achievable target may shift.
Always measure on a **tab-foregrounded** subset (see `tab_hidden` below) so artifact renders don't move
the numbers.

## Phase 0 — Instrument (SHIP FIRST, low-risk, no architecture change)

Two parts, both analytics-only:

**0a. Vocabulary (DONE, uncommitted):** `render_mode` (`live_render`|`cached_svg`) + `cache_source`
dimension in `catalog.ts`/`types.ts`/`trackRenderTime.ts`, with a unit test. Lets us tell cached from
live once a cache exists.

**0b. Production phase sub-timings (NEW — the heart of this phase):** emit four timers + one flag on every
`macro_viewed`, so we can attribute the ~2.5s. Full placement in `RENDERING_PERF_DESIGN.md`:

| Property | Measures | Indicts lever |
|---|---|---|
| `bootstrap_ms` | `__macroLoadStart` → first app code (head scripts incl. **DrawIO** + entry bundle eval) | DrawIO split |
| `context_ms` | Forge `getContext()` resolution | context optimization |
| `fetch_ms` | custom-content REST round trip | fetch optimization |
| `render_ms` | viewer render (load lib + diagram render) | SVG cache |
| `tab_hidden` | was `document.hidden` true during load (artifact flag) | — (filter, not lever) |

`tab_hidden` directly fixes the p99-artifact problem we found: we can finally exclude backgrounded renders
from percentiles instead of guessing.

**Success criteria:** the four timers appear on `macro_viewed` for sequence/mermaid/plantuml (they share
the path, so this explains *all* slow types); `duration_ms − Σ(timers)` (the unattributed remainder) is
emitted so overhead we haven't named is visible; `tab_hidden` populated. No behavior change.
**Risk:** very low — timestamp capture + a marks singleton; read-only on render behavior.

## Phase 1 — Measure & decide (1–2 weeks of data)

Re-run the by-type and by-phase Mixpanel queries on foregrounded (`tab_hidden=false`) events. **Decision
gate — which phase dominates mermaid's foregrounded p50/p90?**

| If dominant phase is… | Build (candidate pre-analyzed in DESIGN) |
|---|---|
| `fetch_ms` | **Lever A — custom-content fetch** (prefetch during bootstrap, payload trim, edge cache) |
| `context_ms` | **Lever B — Forge context** (parallelize context with fetch; defer non-critical context) |
| `bootstrap_ms` | **Lever C — DrawIO code-split** (load DrawIO only on the graph path) |
| `render_ms` | **Lever D — SVG cache** (persist SVG in CC body, viewer injects, skip render) |

Likely outcome on POC priors: fetch + context dominate → Lever A/B, with C as a cheap parallel win.
We commit to the indicted lever(s) only here, with numbers in hand.

## Phase 2+ — Build the indicted lever

Implement whichever lever Phase 1 names, measure the delta on `macro_viewed` (foregrounded), iterate to
target. Each lever's design is pre-drafted in `RENDERING_PERF_DESIGN.md` so this phase is execution, not
rediscovery. Stop when mermaid foregrounded p50 < target.

## Cross-cutting constraints (apply to any lever)

- **System of record:** any cache lives in Confluence (CC body / attachment), never our CF backend;
  the live path must always work on a miss. Cache is never required for correctness.
- **Staleness/atomicity:** co-store any cached artifact in the same CC body version as the DSL; client
  cache keys include the content version/hash.
- **Scope:** Mermaid first (80% of views). Sequence/PlantUML follow once the lever is proven; the shared
  instrumentation already covers them.
- **Stored-XSS (only if Lever D):** sanitize injected SVG on read (DOMPurify SVG profile) with a
  render-fidelity test; today the live path `v-html`s mermaid's own output unsanitized.
- **Mixpanel-first:** Phase 0 ships analytics before any optimization — already the plan.

## Decisions
1. **Instrument-first — agreed 2026-06-06.** Do not build the SVG cache (or any lever) until Phase 1 data
   names the dominant phase.
2. **Target p50<1s/p90<3s — provisional**, re-confirmed against the phase breakdown in Phase 1.
3. Measure on `tab_hidden=false` to exclude tab-backgrounding artifact.

## Open questions
1. Phase 0 commit grouping: ship 0a (vocab) + 0b (sub-timings) as one instrumentation PR? (Recommend yes.)
2. Instrumentation touches the shared load path (one marker in `index.html`'s entry, marks in
   `getContext`/fetch/viewer, a read in `trackRenderTime`) — not just analytics files. It stays read-only
   on behavior. OK?
