---
name: health-check
description: >
  [today] [1d] [1w] — Quick health check of ZenUML Confluence app via Mixpanel.
  Queries key events (macro_viewed/view_macro, macro_create_succeeded/create_macro_end,
  macro_save_succeeded/edit_macro_end, save_failed) across time windows, broken down by
  event_category, compared to previous period and same time last week.
  Flags anomalies like zero views or error spikes.
  Use when the user wants to check app health, verify the app is working after a deploy,
  monitor event volumes, or investigate if something is broken. Triggers on "health check",
  "is the app working", "check mixpanel", "any errors", "event volumes", "is anything broken",
  "post-deploy check", or any request to verify the conf-app is healthy.
---

# Health Check — ZenUML Confluence App

Run a quick health check by querying Mixpanel for key event volumes across multiple time windows, comparing to previous periods, and flagging anomalies.

## Mixpanel Project

> Canonical Mixpanel reference (project, event names + the 2026-04 rename, internal filter, isForge/product_type, MCP-vs-JQL): the **mixpanel** skill. The facts repeated below are just the ones this health check needs inline.

- **Project ID**: `3373228` (ZenUML)
- **Internal sites to exclude**: the canonical exclude list lives in `.claude/skills/mixpanel/SKILL.md` — read it, never inline a copy. The staging sites in that list matter: CI/E2E runs (and `/release-app` pipelines) render macros on `lite-stg`/`full-stg`, which inflate activity totals by a few hundred/day on busy build days if not excluded.

## Key Events

**Event migration note (deployed 2026-04-27):** Event names were renamed to canonical form. Both old and new names are live during the transition — query both and sum totals.

| New canonical name | Legacy name | What it means | Healthy signal |
|--------------------|------------|----------------|----------------|
| `macro_viewed` | `view_macro` | Macro rendered on a page | Should never be zero in past day |
| `macro_create_succeeded` | `create_macro_end` | User created a new macro | Low volume is normal; zero for a week is concerning |
| `macro_save_succeeded` | `edit_macro_end` | User edited an existing macro | Low volume is normal |
| `save_failed` | — | Forge editor save path threw | Any spike is a red flag |
| `update_custom_content_error` | — | Custom content PUT failed after retries (`ApWrapper2`) | Any spike means backend issues |
| `save_existence_check_failed` | — | Pre-save GET to verify CC exists failed | Any occurrence is suspicious |
| `load_macro` | — | `CompositeContentProvider` threw on load | Any spike means macros fail to open |
| `load_custom_content` | — | `ApWrapper2` CC fetch threw | Any spike means content unreadable |
| `render_failed` | — | Diagram render threw in Mermaid/Sequence/PlantUML component; `event_category` = diagram type | Any spike vs previous period is a red flag |
| `customcontent_orphan_observed` | — | Orphan CC detected; query **total** and **`recovery_used=false`** separately | Rising unrecovered count means data loss risk |
| `load_custom_content_v2_missing` | — | CC ID resolved to nothing (warning-level precursor to orphan) | Track alongside orphan total — a spike here without a matching orphan spike = gap in orphan detection |
| `attachment_upload_failed` | — | PNG attachment write failed | Any spike means export broken |

## Execution Steps

Run these queries using `mcp__claude_ai_Mixpanel__Run-Query` with `project_id: 3373228`. All customer-wide queries must filter out internal sites with the global computed-property filter below.

### Global filter (apply to every query)

Use exactly this one global filter in every customer-wide MCP report; do **not** build per-domain `client_domain` exclusions:

```json
{"type":"string", "propertyName":"is_internal_client_domain", "propertyType":"string", "resource":"event", "operator":"equals", "value":"false"}
```

The string encoding is deliberate: it matches the native boolean result while keeping a shared or saved report's filter stable. Raw JQL is the only exception because it cannot access computed properties; follow the JQL guidance in the **mixpanel** skill for that path.

### Query 1: Today hourly — activity events

Purpose: See recent activity. The last complete hour is the closest to "right now" that Mixpanel supports.

Query both old (legacy) and new (canonical) event names — the migration deployed 2026-04-27 so both are live. Sum old+new totals when reporting.

**Property name change:** New canonical events use `macro_type` for the diagram type; legacy events used `event_category`. The values are identical (`sequence`, `mermaid`, `plantuml`, `graph`, `openapi`, `embed`). Run two breakdown queries — one per property — and sum the category totals.

**Query 1a — legacy events, broken down by `event_category`:**
```json
{
  "report_type": "insights",
  "report": {
    "name": "Health: Today hourly activity (legacy)",
    "chartType": "line",
    "unit": "hour",
    "dateRange": { "type": "relative", "range": "today" },
    "metrics": [
      { "eventName": "view_macro", "measurement": { "type": "basic", "math": "total" } },
      { "eventName": "create_macro_end", "measurement": { "type": "basic", "math": "total" } },
      { "eventName": "edit_macro_end", "measurement": { "type": "basic", "math": "total" } }
    ],
    "breakdowns": [
      { "metric": { "type": "property", "propertyName": "event_category" } }
    ],
    "filters": [ ...global filters... ]
  }
}
```

**Query 1b — canonical events, broken down by `macro_type`:**
```json
{
  "report_type": "insights",
  "report": {
    "name": "Health: Today hourly activity (canonical)",
    "chartType": "line",
    "unit": "hour",
    "dateRange": { "type": "relative", "range": "today" },
    "metrics": [
      { "eventName": "macro_viewed", "measurement": { "type": "basic", "math": "total" } },
      { "eventName": "macro_create_succeeded", "measurement": { "type": "basic", "math": "total" } },
      { "eventName": "macro_save_succeeded", "measurement": { "type": "basic", "math": "total" } }
    ],
    "breakdowns": [
      { "metric": { "type": "property", "propertyName": "macro_type" } }
    ],
    "filters": [ ...global filters... ]
  }
}
```

### Query 2: Past 1 day — activity events (current + previous)

> **⚠️ Window-overlap gotcha — do NOT use `{ "unit": "day", "value": 1 }` for the "current day".** Mixpanel interprets that relative range as **start-of-yesterday → now** (≈ 1.8 calendar days when run late in the day), so it *contains* the entire previous-day window. Comparing it to an absolute "previous day" double-counts yesterday and makes "current ≥ previous" a tautology (verified 2026-06-06: relative-1d = 15,679 = Fri 12,086 + Sat-so-far 3,604).
>
> **Use clean, non-overlapping absolute windows instead:**
> - **Current day** = `{ "type": "absolute", "from": "<today>", "to": "<today>" }`
> - **Previous day** = `{ "type": "absolute", "from": "<yesterday>", "to": "<yesterday>" }`
>
> Note the current day is **partial** until midnight — when comparing a partial today against a full yesterday, say so (and remember weekends run ~85% below weekday peaks; a partial weekend day will look far lower, which is normal). For a true like-for-like, compare today-to-now against yesterday up to the same hour.

Run sub-queries per time window — legacy events with `event_category` breakdown, canonical events with `macro_type` breakdown. Sum per-category totals across both. (The JSON blocks below still show the old relative `{unit:day,value:1}` for reference — substitute the absolute `today` range per the warning above.)

**Current day — legacy (`event_category`):**
```json
{
  "name": "Health: 1d activity legacy",
  "chartType": "table",
  "dateRange": { "type": "relative", "range": { "unit": "day", "value": 1 } },
  "metrics": [
    { "eventName": "view_macro", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "create_macro_end", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "edit_macro_end", "measurement": { "type": "basic", "math": "total" } }
  ],
  "breakdowns": [
    { "metric": { "type": "property", "propertyName": "event_category" } }
  ],
  "filters": [ ...global filters... ]
}
```

**Current day — canonical (`macro_type`):**
```json
{
  "name": "Health: 1d activity canonical",
  "chartType": "table",
  "dateRange": { "type": "relative", "range": { "unit": "day", "value": 1 } },
  "metrics": [
    { "eventName": "macro_viewed", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "macro_create_succeeded", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "macro_save_succeeded", "measurement": { "type": "basic", "math": "total" } }
  ],
  "breakdowns": [
    { "metric": { "type": "property", "propertyName": "macro_type" } }
  ],
  "filters": [ ...global filters... ]
}
```

**Previous day**: Same two sub-queries with `"dateRange": { "type": "absolute", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` (both dates = yesterday).

### Query 3: Past 1 week — activity events (current + previous)

Same pattern as Query 2 (two sub-queries per window). Current week uses `{ "unit": "week", "value": 1 }`. Previous week uses absolute date range for 7 days before that.

### Query 4: Error events — today, 1d (current + previous), 1w (current + previous)

Errors are split into four groups. Run each group as a single Mixpanel query (multiple `metrics` entries), so the full error picture is 4 queries × 3 time windows = 12 queries total. Collapse into the pattern used for activity: today (hourly) + current period + previous period.

**Group A — Save errors:** `save_failed`, `update_custom_content_error`, `save_existence_check_failed`

**Group B — Load errors:** `load_macro`, `load_custom_content`

**Group C — Render errors:** `render_failed` (break down by `event_category` to see which diagram type)

**Group D — Orphan errors:** three separate metrics queries:
- Total orphan observations: `customcontent_orphan_observed` (no extra filter)
- Unrecovered orphans: `customcontent_orphan_observed` with filter `recovery_used = false`
- CC ID missing: `load_custom_content_v2_missing` (precursor — CC resolved to nothing)

**Group E — Export errors:** `attachment_upload_failed`

**Example — Save errors today (hourly):**
```json
{
  "name": "Health: Save errors today (hourly)",
  "chartType": "line",
  "unit": "hour",
  "dateRange": { "type": "relative", "range": "today" },
  "metrics": [
    { "eventName": "save_failed", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "update_custom_content_error", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "save_existence_check_failed", "measurement": { "type": "basic", "math": "total" } }
  ],
  "filters": [ ...global filters... ]
}
```

**Example — Orphan errors (unrecovered), 1d:**
```json
{
  "name": "Health: Orphan unrecovered 1d",
  "chartType": "table",
  "dateRange": { "type": "relative", "range": { "unit": "day", "value": 1 } },
  "metrics": [
    { "eventName": "customcontent_orphan_observed", "measurement": { "type": "basic", "math": "total" } }
  ],
  "filters": [
    ...global filters...,
    { "type": "boolean", "propertyName": "recovery_used", "operator": "equals", "value": false }
  ]
}
```

For 1d and 1w comparisons, follow the same current+previous pattern as queries 2-3. Run all error group queries in parallel.

### Step 0: Announce the check plan

**Before running any queries**, print a summary of what will be checked so the user knows what to expect:

```
## Health Check Plan

Checking ZenUML Confluence app health via Mixpanel (project 3373228).
Excluding internal sites with the computed `is_internal_client_domain = "false"` filter from the mixpanel skill (`.claude/skills/mixpanel/SKILL.md`).
Note: querying both legacy and canonical event names (migration deployed 2026-04-27; legacy confirmed zero as of 2026-05-05).

**Queries to run** (10 in parallel):
1. Today hourly — macro_viewed+view_macro, macro_create_succeeded+create_macro_end, macro_save_succeeded+edit_macro_end by category
2. Past 1 day — activity totals by category
3. Previous day ({yesterday}) — activity totals for comparison
4. Past 1 week — activity totals by category
5. Previous week ({prev_week_start} to {prev_week_end}) — activity totals for comparison
6. Today hourly — save errors (save_failed, update_custom_content_error, save_existence_check_failed)
7. Today hourly — load errors (load_macro, load_custom_content)
8. Today hourly — render errors (render_failed by event_category)
9. Today hourly — orphan total + unrecovered
10. Past 1 day — all error groups (current + previous day)
11. Past 1 week — all error groups (current + previous week)

Running all queries now...
```

Replace `{yesterday}`, `{prev_week_start}`, `{prev_week_end}` with actual calculated dates.

### Query execution strategy

Run all queries in parallel in a single turn. For the comparison periods, calculate dates based on today:
- **Previous day**: yesterday's date for both `from` and `to`
- **Previous week**: 14 days ago to 8 days ago

This gives you actual numbers for both periods, allowing you to compute % change yourself.

**Important**: The `timeComparison` parameter only renders in the Mixpanel UI — delta values are NOT returned in the API response. Always use explicit previous-period queries to get comparison data.

## Interpreting Results

### Observation vs interpretation rule

**State what the data shows first. Only offer a causal explanation if you can verify it before writing it.**

- ✅ "views +47% week-over-week — both windows are structurally identical (Tue–Mon, 2 weekend days each), so this looks like genuine growth worth investigating"
- ✅ "views dropped 40% Saturday vs Friday — expected weekend dip (Sat/Sun consistently lower in this dataset)"
- ❌ "views up because fewer weekend days in the comparison window" — **verify the calendar before claiming this**

When comparing two date windows and attributing a difference to calendar composition (weekends, holidays), **list the day-of-week for each date in both windows and count explicitly**. Do not assert a calendar explanation from memory.

If you cannot identify a verified cause, say so: "cause unclear — possible explanations: new large customer, genuine growth, tracking change. Worth investigating."

### Holiday calendar check

**Trigger:** Run this check whenever week-over-week delta exceeds ±15%. Holidays can suppress a week's baseline by 10–30%, making genuine growth look larger (or a real drop look smaller).

**Procedure:**

1. List every date in both the current and previous week windows with its day-of-week.
2. For each date, check against the high-impact holiday list below.
3. Count "affected business days" per window (a day is affected if a major holiday falls on a weekday in that window).
4. If the counts differ, estimate the view suppression: a fully-off Labour Day (~13k/day typical) or Golden Week weekday (~5–8k/day) can shift the weekly total by 10–20k.
5. State the holiday-adjusted estimate explicitly: "Holiday-adjusted previous week ≈ X; holiday-adjusted current week ≈ Y; underlying change ≈ Z%".

**High-impact holidays for this user base (global enterprise Confluence users):**

| Holiday | Date | Countries affected | Expected views impact |
|---------|------|--------------------|-----------------------|
| New Year's Day | Jan 1 | Global | Full weekday wipeout |
| Chinese New Year | Late Jan / early Feb (varies) | China, SE Asia | 2–5 day suppression |
| Easter (Good Friday) | Variable (Fri before Easter Sunday) | Europe, Australia, LATAM | ~1 weekday |
| Easter (Easter Monday) | Variable (Mon after Easter Sunday) | Europe, Australia | ~1 weekday |
| Labour Day / May Day | May 1 | Europe, China, India, SE Asia, LATAM | Full weekday wipeout (~65% drop) |
| Japanese Golden Week | Apr 29 – May 5 | Japan | 3–5 affected weekdays |
| US Memorial Day | Last Monday of May | USA | ~1 weekday (partial — US only) |
| US Independence Day | Jul 4 | USA | ~1 weekday (partial) |
| US Labor Day | First Monday of September | USA | ~1 weekday (partial) |
| US Thanksgiving | 4th Thursday of November | USA | ~1–2 weekdays |
| Christmas / Boxing Day | Dec 25–26 | Global / Commonwealth | Full weekday; 2-day window Dec 25–26 |
| New Year's Eve | Dec 31 | Global | Partial suppression |

> **Note:** The ZenUML Confluence user base skews heavily non-US (EU, APAC, LATAM). US-only holidays cause a modest dip (~10–15%); global holidays like May Day or Christmas cause severe drops (40–70%).

**Example (from May 12, 2026 health check):**

> Previous week Apr 28–May 4: May 1 (Labour Day, -9k vs expected) + May 4 (Golden Week trailing, -4.6k) = ~13.6k suppressed. Adjusted total: ~73k. Current week: ~84k. Holiday-adjusted growth: **+15%** (not the raw +47%).

### Anomaly flags

Present a summary table, then flag any of these conditions:

| Condition | Severity | What it means |
|-----------|----------|---------------|
| `macro_viewed` = 0 in past day | CRITICAL | App may be completely down |
| Views dropped >50% vs previous period | WARNING | Possible outage or tracking regression |
| Views dropped >50% vs same time last week | WARNING | Could be seasonal, but investigate |
| Any save error (`save_failed`, `update_custom_content_error`, `save_existence_check_failed`) > 2× previous period | WARNING | New bug or backend issue introduced |
| Any load error (`load_macro`, `load_custom_content`) > 0 in past day | WARNING | Macros failing to open |
| `render_failed` > 0 in past day | WARNING | Diagram rendering broken for at least one type — check `event_category` breakdown |
| `customcontent_orphan_observed` with `recovery_used=false` > 0 in past day | INFO | Unrecovered orphan: user saw a blank macro; actionable if rising trend |
| `customcontent_orphan_observed` with `recovery_used=false` rising week-over-week | WARNING | Orphan recovery is degrading — data loss risk |
| `load_custom_content_v2_missing` spike without matching spike in `customcontent_orphan_observed` | WARNING | Orphan detection gap — missing CCs not reaching the orphan recovery path |
| `attachment_upload_failed` > 2× previous period | WARNING | PNG export broken |
| `macro_create_succeeded` = 0 for past week | INFO | Low activity but possibly normal for small user base |
| Any diagram type that had `macro_viewed` volume before but now shows 0 | WARNING | Specific diagram type may be broken |

### Output format

Present results as a concise table per time window:

```
## Health Check — {date/time}

### Today (hourly)
Last hour: views={N} (macro_viewed={N} + view_macro={N}), create={N}, edit={N}, errors={N}
Peak hour: {time} with {N} total views

### Past 24 hours (vs previous day)
| Metric | Category | Count (new+legacy) | Prev Day | Change |
|--------|----------|--------------------|----------|--------|
| views  | sequence | 150 (10+140)       | 140      | +7%    |
| ...    | ...      | ...                | ...      | ...    |

### Past 7 days (vs previous week)
| Metric | Category | Count (new+legacy) | Prev Week | Change |
|--------|----------|--------------------|-----------|--------|
| ...    | ...      | ...                | ...       | ...    |

### Errors
| Window | save_failed | update_cc_error | existence_check | load_macro | load_cc | render_failed | orphan (total/unrecovered) | attach_upload_failed | vs prev |
|--------|-------------|-----------------|-----------------|------------|---------|---------------|---------------------------|----------------------|---------|
| Today  | 3           | 0               | 0               | 1          | 0       | 0             | 5 / 2                     | 0                    | —       |
| 1 day  | 5           | 1               | 0               | 2          | 0       | 0             | 12 / 4                    | 0                    | +2      |
| 1 week | 12          | 3               | 1               | 4          | 0       | 0             | 60 / 10                   | 1                    | -5      |

### Flags
- ✅ No critical issues (or list flags)
```

## Known Limitations

- **Event migration complete (as of 2026-05-05)**: Events were renamed to canonical form on 2026-04-27. Legacy names (`view_macro`, `create_macro_end`, `edit_macro_end`) returned zero for both today and yesterday as of 2026-05-06 — the migration is done. Queries can now use canonical names only (`macro_viewed`, `macro_create_succeeded`, `macro_save_succeeded`). Keep the dual-query approach only if you need historical data before Apr 27; for current health checks, canonical queries alone are sufficient.
- **Property rename: `event_category` → `macro_type`**: Legacy events used `event_category` for the diagram type breakdown. New canonical events use `macro_type` instead. The values are identical (`sequence`, `mermaid`, `plantuml`, `graph`, `openapi`, `embed`). Use `event_category` breakdown for legacy queries and `macro_type` breakdown for canonical queries; sum per-category totals.
- **`update_custom_content_error` is still live**: Despite an earlier note saying it was gone, this event is still fired in `ApWrapper2.ts` on CC PUT failure after retries. Include it in save-error queries.
- **`render_failed` is new (added 2026-05-24)**: Tracking was added to `Mermaid.vue`, `Sequence.vue`, and `PlantUml.vue` on this date — no historical data exists before then. Don't flag zero 1w counts as a gap.
- **No 5-minute window**: Mixpanel's smallest query granularity via the MCP tool is hourly. Today's hourly chart is the closest to real-time. Mixpanel also has ~5-10 min ingestion delay.
- **`timeComparison` not in API response**: The Mixpanel `timeComparison` parameter creates visual comparisons in the UI but delta values are not returned in the Run-Query API response. Use explicit previous-period queries instead.
- **Forge graph macro_viewed missing**: `macro_viewed` (and legacy `view_macro`) for graph type on Forge is not tracked (known bug in `forge-graph-viewer.ts`). Don't flag missing graph views as an anomaly.
- **`event_category` casing**: `openapi` and `OpenAPI` both appear. Treat them as the same category when comparing.
- **Weekend dip**: Confluence usage drops significantly on weekends (~85% vs weekday peak). A 50–80% drop on Saturday vs Friday is normal, not an outage.
- **Holiday dip**: Major public holidays (Labour Day, Christmas, Golden Week) can suppress a full weekday by 50–70%. Always run the holiday calendar check (see above) before interpreting any week-over-week delta >15% as genuine signal.

## Tips

- Run all queries in parallel (multiple tool calls in one turn) for speed
- If a specific `event_category` looks broken, suggest a deeper dive with the `/conf-app` analytics skill
- After a deploy, wait ~15 minutes before running the health check (Mixpanel ingestion delay)
