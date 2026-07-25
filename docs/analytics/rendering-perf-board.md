# Mixpanel board: Macro View Loading Time

Build spec for the board that tracks how long a macro takes to render for a user.
Project **3373228**, event **`macro_viewed`**.

## The board shell exists — cards are a UI job

**`⏱️ Macro Loading Time` — board `11400356`**
<https://mixpanel.com/project/3373228/view/3879592/app/boards#id=11400356>

Created 2026-07-25 by `.claude/skills/rendering-perf/scripts/build_board.py`, with its title
and description set. **It is empty.** Add the 10 cards below through the UI; run the script
with `--dry-run` to print them as a build checklist with exact metrics, filters, breakdowns
and chart types.

⚠️ **Unresolved:** this board also showed "Something went wrong" while empty. Board-level
filters were the suspect and have been cleared; a bare control board (`title` only) was
created alongside it to isolate whether *any* API-created board renders cleanly. If the
control board is also broken, then API-created boards are unusable in the UI regardless of
their contents and the board must be created by hand — the card design below is unaffected
either way, since it is all card-level.

**Cards cannot be created by API — this was tried properly and it does not work.** A first
attempt did create all 10 (they computed correctly, and card 1's daily p50 of 1,708–1,847ms
matched the JQL baseline of 1,640–1,835ms for the same population, confirming the board
filters really do apply to saved queries). But **a card that is not placed in the board's
`layout` does not render at all** — the board showed Mixpanel's "Looking a little empty…"
state plus a "Something went wrong" banner, because `contents` listed 10 reports the `layout`
did not. There was nothing to drag; the cards were invisible, not merely unpositioned. That
board was deleted and replaced by the clean shell above.

Placement is not expressible anywhere in this API. All verified 2026-07-25:

- `PATCH …/dashboards/<b>` takes `{"layout": {"rows": {}}}` (200) but returns
  `403 INVALID_LAYOUT` for **any** non-empty `rows` — list, dict, extra keys, garbage keys,
  valid or bogus `content_id` alike. The check is semantic, so no error ever names the
  expected shape.
- The same call refuses the `order` and `version` keys the stored layout itself contains, so
  the write validator cannot express the `2.0.0` layout format these boards use.
- No layout endpoint exists: `/layout`, `/contents`, `/dashboard-contents`, `/reorder`,
  `/add-content`, `/copy`, `/duplicate` all 404.
- `POST /bookmarks` rejects every placement key as "extra keys not allowed": `position`,
  `layout`, `row`, `width`, `cell_id`, `include_in_dashboard`, `is_visible`.
- A card can't be detached into a standalone saved report either — `dashboard_id` must be a
  valid int, so `null`/`0` are refused.
- `DELETE /bookmarks/<r>` returns **500**: a mis-created card cannot be removed on its own.
  Deleting the board removes its cards, which is how the first attempt was cleaned up.

So the automation boundary is: **the API can create and scope a board; only the UI can add
cards.** Don't spend another session rediscovering this.

### The undocumented write API, as established

Mixpanel documents no board API at all; this was reverse-engineered from an existing board.
Needs a **service account** (`MIXPANEL_SA_USER` / `MIXPANEL_SA_SECRET`) — a project API
secret gets 401 on every `/api/app/` path.

| Action | Call |
|---|---|
| create board | `POST /api/app/projects/<p>/dashboards` `{"title": …}` |
| board identity | `PATCH /api/app/projects/<p>/dashboards/<b>` `{"description": …}` |
| board filters | `PATCH …/dashboards/<b>` `{"filters": [ … ]}` |
| create card | `POST /api/app/projects/<p>/bookmarks` `{"name", "type":"insights", "params":"<JSON STRING>", "dashboard_id"}` — **works, but the card will be invisible; see above** |
| register card | `PATCH /api/app/projects/<p>/bookmarks/<r>` `{"dashboard_id": <b>}` |
| verify a card | `GET /api/query/insights?project_id=<p>&bookmark_id=<r>` (documented) |
| place a card | **impossible** |
| delete one card | **impossible** (500) |
| delete board | `DELETE …/dashboards/<b>` (also deletes its cards) |

Five things that cost real debugging time:

1. **`params` must be a JSON-encoded string.** A nested object returns
   `400 "… is not of type 'string'"`.
2. **A freshly POSTed card is invisible until the `PATCH` re-asserts its `dashboard_id`.**
   Before that the board's `contents.report` is `{}` and the board looks empty.
3. **`POST /boards` is 405** — writes use `dashboards`, even though reads and the UI both
   say boards.
4. **`description` is capped at 400 characters, and the cap fails the entire PATCH.** Sending
   description and filters together meant a 407-char description left the board with *zero*
   filters while every card reported success — an unfiltered board silently pools editor
   renders, untimed events and our own staging tenants into every number. `build_board.py`
   now sends them separately and asserts the length.
5. **`can_update_basic` is per-board, not per-role.** It stays `False` on someone else's
   board even for an admin service account, and is `True` on boards the account created.
   Don't read it as "my credentials can't write".

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

## The existing "Rendering Perf" board (11250759) — audit and migration

Audited 2026-07-25 via `board_audit.py`. Board `11250759`, workspace `3879592`, created
**2026-06-05** by Yanhui Li and **not modified since**; the API reports 0 recorded views
(that counter may not capture every view, so read it as "not actively used", not as proof
nobody opened it).

**It is not a loading-time board, and it never was.** It is a one-off A/B harness built to
compare `cached_svg` against `live_render` on two specific staging diagrams during the SVG
cache spike. Judged as a spike harness it was fine. Judged as loading-time tracking it
cannot work, for one structural reason and one historical one:

- **Structural:** every card is pinned to two hardcoded `custom_content_id`s
  (`2842066972`, `91815969` — the latter on lite-stg). It measures two diagrams on a
  staging tenant, not the product.
- **Historical:** it predates the instrumentation. `renderPerf.ts` — `bootstrap_ms`,
  `context_ms`, `fetch_ms`, `render_ms`, `tab_hidden` — landed **2026-07-17**, and
  `content_source` **2026-07-22**, six and seven weeks after the board was built. None of
  the properties that make loading time *attributable* existed yet.

**All three cards are empty today.** Those two content ids last produced an event in June
2026 (155 events total: 75 + 70 `cached_svg` + 10 `live_render`), and none since:

| Card | Config | Why it shows nothing |
|---|---|---|
| `90538442` "live (Page A) vs cached_svg (Page B) — mermaid" | `duration_ms > 0`, `macro_type=mermaid`, `custom_content_id in (2842066972, 91815969)`; grouped by `custom_content_id`; **time = since start of current day**; bar | Those ids get no traffic. A single-day window on dead ids is empty by construction. |
| `90538444` "… — mermaid 1" | **Byte-identical to 90538442** | Duplicate card. Delete outright. |
| `90538690` "cached_svg vs live_render — SAME page (lite-stg cc 91815969)" | `duration_ms > 0`, `custom_content_id=91815969`; grouped by `render_mode`; last 14 days; bar; shows Total/**Min**/Median/P90 | No events in the last 14 days. Its premise also expired: `cached_svg` never shipped, so `render_mode` is 100% `live_render` in production — the breakdown has one bucket. |

Defects to carry forward as lessons, independent of the dead ids:

1. **No board-level filters** (`filters: []`, `breakdowns: []`, `time_filter: {}`), so cards
   disagree with each other — card 1 is "today", card 3 is "last 14 days". Comparing them
   is meaningless.
2. **No `surface` filter** → editor and viewer renders are pooled.
3. **`Minimum of duration_ms`** on card 3 is not a performance statistic; it reports the
   single luckiest render. Use p50/p90/p99.
4. **Bar charts for a time-varying metric** → no trend, so a regression is invisible.
5. **`custom_content_id` as the unit of analysis** is right for an A/B of one diagram and
   wrong for tracking; it cannot generalize to "how fast is the product".

### Migration

`can_update_basic` is `False` for our service account, so this cannot be scripted — the
edits are manual. Recommended:

1. **Rename** the board to `Rendering Perf — SVG cache A/B (archived 2026-06)` and leave it,
   or delete it. Do **not** retrofit it: every card's unit of analysis is wrong for tracking,
   so there is nothing to salvage beyond the idea.
2. **Delete `90538444`** regardless — it is a pure duplicate.
3. **Build the tracking board fresh** from the card spec below. It shares only the event
   (`macro_viewed`) and one filter (`duration_ms > 0`) with the old board; everything else
   differs, which is why editing in place is more work than starting clean.
4. **Re-create the A/B when the SVG cache actually ships.** Card 3's design — same page,
   grouped by `render_mode` — is the right shape for that comparison. Keep it as the
   template, and add the `surface` and `tab_hidden` filters it was built too early to know
   about.

## Auditing an existing board

To review a board that already exists — e.g.
`https://mixpanel.com/project/3373228/view/3879592/app/boards#id=11250759`, whose three
numbers are **project** `3373228`, **workspace** `3879592` (the `/view/` segment) and
**board** `11250759` (the `#id=` fragment):

```bash
python3 .claude/skills/rendering-perf/scripts/board_audit.py --board 11250759 --raw board.json
python3 .claude/skills/rendering-perf/scripts/board_audit.py --report <bookmark_id>
```

It needs **service-account** credentials in `.env.mixpanel` (gitignored) as
`MIXPANEL_SA_USER` / `MIXPANEL_SA_SECRET` — create one at *Settings → Project settings →
Service accounts → + Add service account*; the secret is shown only once.

What was actually verified about Mixpanel auth here (2026-07-25), because the error codes
are misleading:

| Endpoint | Project API secret | Notes |
|---|---|---|
| `/api/2.0/jql`, `/api/2.0/events/names` | ✅ works | Query API accepts the project secret |
| `/api/app/projects/<p>/...` (boards, bookmarks, schemas) | ❌ `401 Invalid service account credentials` | The app API needs a service account, full stop |
| board create / update | — | No documented API exists at all |

Two traps worth knowing before you debug an auth failure:

- **Bad credentials on the query API return `400`, not `401`** — body
  `"Unable to authenticate request"`. A 400 is not automatically a malformed request.
- **`/api/query/insights?bookmark_id=0` validates the id BEFORE auth**, so it answers
  `400 "Invalid insights_id"` even for completely bogus credentials. It therefore proves
  *nothing* about whether your credentials work, and must not be used as an auth check —
  `board_audit.py` validates against `/api/2.0/events/names` instead, which is the probe
  confirmed to discriminate (200 vs 400).

## First: the population, or the board tracks noise

Set these on **every card** (card → *Filter*). Every number below assumes them. Without
them the board mixes four different workloads and will show "regressions" that are pure
mix shift.

> **Why per-card and not board-level?** Board-level filters are tidier, and the API does
> accept them — but a board with an API-set `filters` array rendered "Something went wrong",
> and no board in this project has working board-level filters to copy a known-good shape
> from. Per-card filters need no guessing, and they let card 9 legitimately omit
> `tab_hidden` rather than fighting a board-wide rule. If you set them at board level by
> hand in the UI instead, that's fine — just remember card 9 then needs an override.

| Filter | Value | Why it is not optional |
|---|---|---|
| `surface` | `is` `viewer` | Excludes editor renders — a different workload (long-lived iframes, tab switches re-firing). Before 2026-07-19 (#368) the native macro-config surface was mislabelled `viewer`, so windows crossing that date still blend the two. |
| `tab_hidden` | `is false` | A backgrounded tab has throttled timers. ~19% of renders; roughly doubles p50 and inflates p99 by ~10x. This one filter matters more than every card choice below. **But see the note underneath — the operator choice has a sharp edge.** |
| `duration_ms` | `>` `0` | Drops events that carry no timing. |
| `is_internal_client_domain` | `is` `false` | Our own tenants and the four staging sites. This computed property is the UI equivalent of the JQL exclude list in the mixpanel skill. |

**The `tab_hidden` operator is a real decision, not a formality.** `is false` matches only
events that carry the property *and* set it false — which silently drops every event from a
build older than **2026-07-17**, when `tab_hidden` was introduced. That is what you want for
forward-looking tracking, and wrong if you ever widen the window back past mid-July, where
it would quietly discard the entire earlier population rather than including it. If you need
those older events, use `does not equal` `true` instead, which keeps events missing the
property. Either way the board is only comparable within one instrumentation era — a caveat
worth putting in the board description.

Board **date range: last 7 days**, comparison **"previous period"**. Do not default it to
30 days: the SWR rollout on 2026-07-23 means a 30-day window currently averages two
different products together.

## Board identity and layout

- **Title:** `⏱️ Macro Loading Time` (the project's convention is a leading emoji — e.g. the
  existing health and paywall monitors)
- **Description:** `How long a macro takes to render for a user. Population is pinned at
  board level — read "First: the population" in docs/analytics/rendering-perf-board.md
  before changing any filter.`
- **Order matters.** Put cards 1–3 in the first two rows: someone opening this board with a
  "did we regress?" question should get the answer without scrolling. Diagnosis (4–7) sits
  below, guards (8–9) at the bottom, and the tenant table (10) last since it is the widest.

| Row | Cards | Role |
|---|---|---|
| 1 | 2 (SLO), 1 (percentiles) | Is it good? Did it change? |
| 2 | 3 (by macro type) | Which viewer? |
| 3 | 4 (phases), 5 (SWR hit rate) | Why? |
| 4 | 6 (SWR effect), 7 (cold cache) | Which lever? |
| 5 | 8 (volume), 9 (tab-hidden) | Do I trust the above? |
| 6 | 10 (worst tenants) | Who is hurting? |

## Verified schema vocabulary

Read out of this project's own boards on 2026-07-25, so these are values Mixpanel actually
accepts here rather than guesses. Use them verbatim when building cards.

| Field | Confirmed values |
|---|---|
| Aggregation (`math`) | `total`, `unique`, `unique_values`, `median`, `p90`, `min`, `conversion_rate_total` |
| Chart type | `line`, `bar`, `table`, `pie`, `insights-metric`, `funnel-steps` |
| Date range | `in the last` + `{unit, value}`, or `since` + `$start_of_current_day` |
| Date unit | `hour`, `day`, `week`, `month` |
| Filter operator | `equals`, `does not equal`, `is greater than`, `is false` |

Cards 5, 7 and 9 are specified below as **% of total** over a breakdown. That is the natural
reading of a share, but note `displayOptions.value` is `absolute` in every board sampled
here, so the percentage toggle is unconfirmed in this project. All three still work as
absolute counts per breakdown value — you just read the share by eye against card 8's total.
Don't block the build on finding the toggle.

Two more things this list does **not** confirm — check the UI picker before relying on them:

- **`p99`** appears nowhere in this project's boards. `median` and `p90` are confirmed. If
  the aggregation menu has no p99, use p90 as the tail metric on cards 1 and 3 and get p99
  from `perf_report.py`, which computes it directly from JQL.
- **Stacked area** is not among the chart types observed. Card 5 below therefore specifies
  `line`, not the stacked area my first draft called for.

## Cards

Add each as **Insights** unless noted. "Metric" means the event; "aggregate property"
is under the metric's `⋯` → *Aggregate property*.

### 1. Headline — p50 / p90 over time
- Metric `macro_viewed`, two series: aggregate property `duration_ms` → **median** and **p90**
  (add **p99** as a third only if the aggregation menu offers it — see the vocabulary note above)
- Chart: **line**, **daily** buckets — not weekly. Weekly hides the thing this board exists to
  catch: a rollout or regression landing mid-week shows up as a muted two-week slope instead
  of a step. The 2026-07-23 SWR rollout is only visible as a step at daily granularity.
- Purpose: the one number anyone asks for. Baseline 2026-07-25: **p50 1,676ms, p90 5,276ms,
  p99 16,036ms**.

### 2. Slow-render share — the actual SLO
- Two metrics on one card: **A** = `macro_viewed` with an extra card-level filter
  `duration_ms` `is greater than` `3000`; **B** = `macro_viewed` with no extra filter.
  Then add a **formula `A/B`** and hide A and B so only the ratio plots.
- Chart: **line**, daily
- **Verification caveat:** the report schema does have a `sections.formula` array, but it is
  empty in every board sampled in this project, and `displayOptions.value` is `absolute`
  everywhere — so I have not seen a working percentage or formula card here to copy. If the
  formula path fights you, don't force it: `perf_report.py` already prints `slow%` per day
  from JQL, and a plain count-of-slow-renders line card (metric A alone) still shows the
  trend, just not normalized for volume — which is exactly what card 8 is there to provide.
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
- Chart: **line**, daily (stacked area is not among this project's confirmed chart types;
  a line per `content_source` reads the rollout just as well)
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
