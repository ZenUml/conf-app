# Mixpanel board: Macro View Loading Time

Build spec for the board that tracks how long a macro takes to render for a user.
Project **3373228**, event **`macro_viewed`**.

**This board has to be created by hand.** Mixpanel exposes no API for creating or
modifying boards — the documented surface is ingestion, query, raw export, pipelines,
Lexicon, GDPR, warehouse connectors and feature flags only (verified 2026-07-25). The
undocumented app endpoints (`/api/app/projects/<id>/boards`, `…/dashboards`) answer
`401 {"error": "Invalid service account credentials"}` to a project API secret, so even
off-label automation needs a service account we do not currently hold. Ten minutes of
clicking, once.

For anything scriptable — cron, CI, a regression diff — use the headless twin instead,
which reports the same cuts on the same population:

```bash
python3 .claude/skills/rendering-perf/scripts/perf_report.py --days 7
python3 .claude/skills/rendering-perf/scripts/perf_report.py --days 1 --json today.json
```

## First: the population, or the board tracks noise

Set these as **board-level filters** (Board → `⋯` → *Add filter*, then "apply to all
cards") before adding a single card. Every number below assumes them. Without them the
board mixes four different workloads and will show "regressions" that are pure mix shift.

| Filter | Value | Why it is not optional |
|---|---|---|
| `surface` | `is` `viewer` | Excludes editor renders — a different workload (long-lived iframes, tab switches re-firing). Before 2026-07-19 (#368) the native macro-config surface was mislabelled `viewer`, so windows crossing that date still blend the two. |
| `tab_hidden` | `is not` `true` | A backgrounded tab has throttled timers. ~19% of renders; roughly doubles p50 and inflates p99 by ~10x. This one filter matters more than every card choice below. |
| `duration_ms` | `>` `0` | Drops events that carry no timing. |
| `is_internal_client_domain` | `is` `false` | Our own tenants and the four staging sites. This computed property is the UI equivalent of the JQL exclude list in the mixpanel skill. |

Board **date range: last 7 days**, comparison **"previous period"**. Do not default it to
30 days: the SWR rollout on 2026-07-23 means a 30-day window currently averages two
different products together.

## Cards

Add each as **Insights** unless noted. "Metric" means the event; "aggregate property"
is under the metric's `⋯` → *Aggregate property*.

### 1. Headline — p50 / p90 / p99 over time
- Metric `macro_viewed`, three series: aggregate property `duration_ms` → **median**, **p90**, **p99**
- Chart: **line**, weekly buckets
- Purpose: the one number anyone asks for. Baseline 2026-07-25: **p50 1,676ms, p90 5,276ms, p99 16,036ms**.

### 2. Slow-render share — the actual SLO
- Metric `macro_viewed` with an added filter `duration_ms` `>` `3000`, displayed as
  **% of total** (`⋯` → *Show as* → percentage of the unfiltered metric)
- Chart: **line**, daily
- Purpose: percentiles move for boring reasons; "what fraction of renders were bad"
  is the number to put in front of non-analysts. 3s sits just above the pooled p75, so it
  tracks the genuinely-slow tail without flapping. Baseline: **25%**, falling through the
  SWR rollout to **17.3%** on 07-24.
- **This is the card to alert on.** Mixpanel alerts live on the card's `⋯` → *Alerts*.

### 3. By macro type
- Metric `macro_viewed`, aggregate property `duration_ms` → **median** (add a second card
  or a second series for **p90**), breakdown by **`macro_type`**
- Chart: **bar**
- Purpose: isolates a regression to one viewer. Mermaid is ~72% of volume, so it dominates
  card 1 — a plantuml regression is invisible without this breakdown.

Baseline (7d to 2026-07-25):

| macro_type | n | p50 | p90 | p99 |
|---|---|---|---|---|
| mermaid | 44,815 | 1,489ms | 5,011ms | 14,080ms |
| plantuml | 5,933 | 2,411ms | 5,750ms | 13,568ms |
| graph | 5,254 | 2,280ms | 5,903ms | 16,300ms |
| openapi | 3,181 | 1,451ms | 3,316ms | 8,724ms |
| sequence | 3,071 | 2,401ms | 9,893ms | 59,436ms |

### 4. Phase attribution — where the time actually goes
- Metric `macro_viewed`, five series, each aggregate property → **median**:
  `bootstrap_ms`, `context_ms`, `fetch_ms`, `render_ms`, `measured_sum_ms`
- Chart: **line**, daily
- Purpose: turns "it got slower" into "which phase got slower". `fetch` is the dominant
  phase for every macro type (p50 640–1,003ms, about half of `measured_sum_ms`); bootstrap
  is 39–101ms and is not a lever.
- **Known hole:** `render_ms` is only recorded for sequence/mermaid/plantuml — the graph and
  openapi viewers never wrap their render in `renderPerf.time('render', …)`, so this card
  under-reports for them and their render time hides inside
  `duration_ms − measured_sum_ms`. Don't read a low `render_ms` as a fast render.
- Optional companion card: `custom_content_fetch_ms` and `page_adf_fetch_ms` (the two
  children of `fetch`, p50 ~686ms and ~322ms). They are deliberately **not** summed into
  `measured_sum_ms` — adding them would double-count their parent.

### 5. Content-SWR hit rate — the lever
- Metric `macro_viewed`, breakdown by **`content_source`**, **% of total**
- Chart: **stacked area**, daily
- Purpose: the single largest determinant of loading time right now. A cache hit is ~3x
  faster than a fetch. Watch this before blaming code: **a hit-rate drop looks exactly like
  a code regression on card 1, with every phase on card 4 unchanged.**
- Rollout for reference: 0% through 07-22, 9.5% on 07-23 (mid-day prod release), 53.5% on
  07-24. `unset` = a macro type not on the SWR path (graph, openapi) or a pre-rollout build.

### 6. SWR effect — p50 split by content source
- Metric `macro_viewed`, aggregate property `duration_ms` → **median**, breakdown `content_source`
- Chart: **bar**
- Purpose: quantifies the win and proves the cache is still worth its complexity.
  Baseline: `swr_cache` **674ms** vs `fetch` **2,097ms** p50.

### 7. Cold-cache share and cost
- Two series: breakdown by **`cache_state`** as **% of total**, and aggregate property
  `duration_ms` → **median** broken down by `cache_state`
- Chart: **line**, daily
- Purpose: cold browser cache is ~1.8x slower at p50 and runs ~15% of renders. A cold-share
  jump after a deploy is expected (new bundle hashes) and should decay within a day — if it
  doesn't, cache headers regressed.

### 8. Volume — the denominator
- Metric `macro_viewed`, **total events**, no breakdown
- Chart: **line**, daily
- Purpose: guards every card above. A p50 improvement alongside a volume collapse is a
  tracking break or a mix shift, not a win. Weekends are genuinely quiet (~900/day vs
  ~12,000 on weekdays) — do not read Saturday as an outage, and note the current UTC day is
  always partial.

### 9. Data-quality guard — tab-hidden share
- Metric `macro_viewed`, breakdown by **`tab_hidden`**, **% of total**
- Chart: **line**, daily
- **Remove the board-level `tab_hidden` filter on this card only** (card `⋯` → *Filters* →
  override), otherwise it can only ever show one value.
- Purpose: the board's own validity check. This share should sit near 19%. If it moves a
  lot, every percentile on the board shifted for a reason that has nothing to do with our code.

### 10. Worst tenants — p90 by client
- Metric `macro_viewed`, aggregate property `duration_ms` → **p90**, breakdown by
  **`client_domain`**, sorted descending, **table**
- Add a card filter `duration_ms` `>` `0` and rely on the board's internal-domain exclusion
- Purpose: finds tenants with pathological latency (huge diagrams, slow region, throttled
  network) so support has somewhere to start. Read the `n` column first — a 3-render tenant
  at the top of the p90 list is noise, not a customer problem.

## Not on the board yet, deliberately

- **`render_mode` / `cache_source`** — 100% of prod events are `live_render`; the SVG cache
  (Phase 2) has not shipped. Add a breakdown when it does, and split it from `live_render`.
- **`render_gate` / `render_deferred_ms` / `visible_at_boot`** (#382/#384 viewport gate) —
  absent from every prod event through 2026-07-25, so a card would be empty today. When the
  gate ships, expect it to change *when* renders happen rather than how long each takes, so
  it needs card 8 (volume) beside it to interpret.

## Reading the board without fooling yourself

| What you see | Check this first |
|---|---|
| p50 up, phases on card 4 all flat | Card 5 (SWR hit rate) and card 7 (cold share) — almost always a mix shift |
| p99 up, p50 flat | Card 9 — tab-hidden leakage, or one tenant on card 10 |
| A phase is `0` or blank for one macro type | Instrumentation gap, not speed. `grep renderPerf.time(` to confirm |
| Everything improved overnight | Check a deploy landed; then confirm on card 8 that volume held |
| A single day looks great | If it's today, it's partial. UTC day boundary |

Baseline numbers, the segmentation rationale, and the JQL behind each card:
`.claude/skills/rendering-perf/SKILL.md` and `references/queries/`.
