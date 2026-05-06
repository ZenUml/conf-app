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

- **Project ID**: `3373228` (ZenUML)
- **Internal sites to exclude**: all `zenuml*` domains, all `whimet*` domains, `diagramly`, `dia-stg` (always filter these out)

## Key Events

**Event migration note (deployed 2026-04-27):** Event names were renamed to canonical form. Both old and new names are live during the transition — query both and sum totals.

| New canonical name | Legacy name | What it means | Healthy signal |
|--------------------|------------|----------------|----------------|
| `macro_viewed` | `view_macro` | Macro rendered on a page | Should never be zero in past day |
| `macro_create_succeeded` | `create_macro_end` | User created a new macro | Low volume is normal; zero for a week is concerning |
| `macro_save_succeeded` | `edit_macro_end` | User edited an existing macro | Low volume is normal |
| `save_failed` | *(was `unexpected_error` — now split)* | Save operation failed | Any spike vs previous period is a red flag |
| `macro_save_failed` | *(was `update_custom_content_error`)* | Custom content save failed | Any spike means backend issues |

## Execution Steps

Run these queries using `mcp__mixpanel__Run-Query` with `project_id: 3373228`. All queries should filter out internal sites using a global filter on `client_domain`.

### Global filter (apply to every query)

```json
{"type": "string", "propertyName": "client_domain", "operator": "does not contain", "value": "zenuml"},
{"type": "string", "propertyName": "client_domain", "operator": "does not contain", "value": "whimet"},
{"type": "string", "propertyName": "client_domain", "operator": "does not equal", "value": "diagramly"},
{"type": "string", "propertyName": "client_domain", "operator": "does not equal", "value": "dia-stg"}
```

> **Note:** `does not contain` covers all `zenuml*` variants (zenuml, zenuml-stg, zenuml-connect, etc.) and all `whimet*` variants in one filter. No customer domain contains "zenuml" or "whimet" as a substring.

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

Run sub-queries per time window — legacy events with `event_category` breakdown, canonical events with `macro_type` breakdown. Sum per-category totals across both.

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

Legacy `unexpected_error` and `update_custom_content_error` are gone from the catalog. Use `save_failed` (general save failure) and `macro_save_failed` (custom content save failure).

**Today errors (hourly):**
```json
{
  "name": "Health: Errors today (hourly)",
  "chartType": "line",
  "unit": "hour",
  "dateRange": { "type": "relative", "range": "today" },
  "metrics": [
    { "eventName": "save_failed", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "macro_save_failed", "measurement": { "type": "basic", "math": "total" } }
  ],
  "filters": [ ...global filters... ]
}
```

For 1d and 1w error comparisons, follow the same current+previous pattern as queries 2-3.

### Step 0: Announce the check plan

**Before running any queries**, print a summary of what will be checked so the user knows what to expect:

```
## Health Check Plan

Checking ZenUML Confluence app health via Mixpanel (project 3373228).
Excluding internal sites: zenuml* (all variants), whimet* (all variants), diagramly, dia-stg.
Note: querying both legacy and canonical event names (migration deployed 2026-04-27; legacy confirmed zero as of 2026-05-05).

**Queries to run** (10 in parallel):
1. Today hourly — macro_viewed+view_macro, macro_create_succeeded+create_macro_end, macro_save_succeeded+edit_macro_end by category
2. Past 1 day — activity totals by category
3. Previous day ({yesterday}) — activity totals for comparison
4. Past 1 week — activity totals by category
5. Previous week ({prev_week_start} to {prev_week_end}) — activity totals for comparison
6. Today hourly — save_failed, macro_save_failed
7. Past 1 day — error totals
8. Previous day ({yesterday}) — error totals for comparison
9. Past 1 week — error totals
10. Previous week ({prev_week_start} to {prev_week_end}) — error totals for comparison

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

### Anomaly flags

Present a summary table, then flag any of these conditions:

| Condition | Severity | What it means |
|-----------|----------|---------------|
| `macro_viewed` + `view_macro` = 0 in past day | CRITICAL | App may be completely down |
| combined views dropped >50% vs previous period | WARNING | Possible outage or tracking regression |
| combined views dropped >50% vs same time last week | WARNING | Could be seasonal, but investigate |
| `save_failed` or `macro_save_failed` > 2x previous period | WARNING | New bug or backend issue introduced |
| `macro_create_succeeded` + `create_macro_end` = 0 for past week | INFO | Low activity but possibly normal for small user base |
| Any `event_category` that had volume before but now shows 0 | WARNING | Specific diagram type may be broken |

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
| Window | save_failed | macro_save_failed | vs previous |
|--------|-------------|-------------------|-------------|
| Today  | 3           | 0                 | —           |
| 1 day  | 5           | 1                 | +2 / +1     |
| 1 week | 12          | 3                 | -5 / +1     |

### Flags
- ✅ No critical issues (or list flags)
```

## Known Limitations

- **Event migration complete (as of 2026-05-05)**: Events were renamed to canonical form on 2026-04-27. Legacy names (`view_macro`, `create_macro_end`, `edit_macro_end`) returned zero for both today and yesterday as of 2026-05-06 — the migration is done. Queries can now use canonical names only (`macro_viewed`, `macro_create_succeeded`, `macro_save_succeeded`). Keep the dual-query approach only if you need historical data before Apr 27; for current health checks, canonical queries alone are sufficient.
- **Property rename: `event_category` → `macro_type`**: Legacy events used `event_category` for the diagram type breakdown. New canonical events use `macro_type` instead. The values are identical (`sequence`, `mermaid`, `plantuml`, `graph`, `openapi`, `embed`). Use `event_category` breakdown for legacy queries and `macro_type` breakdown for canonical queries; sum per-category totals.
- **`unexpected_error` / `update_custom_content_error` are gone**: These old error event names are no longer in the Mixpanel catalog. Use `save_failed` (general) and `macro_save_failed` (custom content) instead.
- **No 5-minute window**: Mixpanel's smallest query granularity via the MCP tool is hourly. Today's hourly chart is the closest to real-time. Mixpanel also has ~5-10 min ingestion delay.
- **`timeComparison` not in API response**: The Mixpanel `timeComparison` parameter creates visual comparisons in the UI but delta values are not returned in the Run-Query API response. Use explicit previous-period queries instead.
- **Forge graph macro_viewed missing**: `macro_viewed` (and legacy `view_macro`) for graph type on Forge is not tracked (known bug in `forge-graph-viewer.ts`). Don't flag missing graph views as an anomaly.
- **`event_category` casing**: `openapi` and `OpenAPI` both appear. Treat them as the same category when comparing.
- **Weekend/holiday dip**: Confluence usage drops significantly on weekends. A 50% drop on Saturday vs Friday is normal, not an outage.

## Tips

- Run all queries in parallel (multiple tool calls in one turn) for speed
- If a specific `event_category` looks broken, suggest a deeper dive with the `/conf-app` analytics skill
- After a deploy, wait ~15 minutes before running the health check (Mixpanel ingestion delay)
