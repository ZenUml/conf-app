---
name: health-check
description: >
  [today] [1d] [1w] — Quick health check of ZenUML Confluence app via Mixpanel.
  Queries key events (view_macro, create_macro_end, edit_macro_end, errors) across
  time windows, broken down by event_category, compared to previous period and same
  time last week. Flags anomalies like zero views or error spikes.
  Use when the user wants to check app health, verify the app is working after a deploy,
  monitor event volumes, or investigate if something is broken. Triggers on "health check",
  "is the app working", "check mixpanel", "any errors", "event volumes", "is anything broken",
  "post-deploy check", or any request to verify the conf-app is healthy.
---

# Health Check — ZenUML Confluence App

Run a quick health check by querying Mixpanel for key event volumes across multiple time windows, comparing to previous periods, and flagging anomalies.

## Mixpanel Project

- **Project ID**: `3402701` (ZenUML)
- **Internal sites to exclude**: `zenuml`, `zenuml-stg`, `dia-stg` (always filter these out)

## Key Events

| Event | What it means | Healthy signal |
|-------|--------------|----------------|
| `view_macro` | Macro rendered on a page | Should never be zero in past day |
| `create_macro_end` | User created a new macro | Low volume is normal; zero for a week is concerning |
| `edit_macro_end` | User edited an existing macro | Low volume is normal |
| `unexpected_error` | Client-side error | Any spike vs previous period is a red flag |
| `update_custom_content_error` | Save-to-backend failed | Any spike means backend issues |

## Execution Steps

Run these queries using `mcp__mixpanel__Run-Query` with `project_id: 3402701`. All queries should filter out internal sites using a global filter on `client_domain`.

### Global filter (apply to every query)

```json
{
  "type": "string",
  "propertyName": "client_domain",
  "operator": "does not equal",
  "value": "zenuml"
},
{
  "type": "string",
  "propertyName": "client_domain",
  "operator": "does not equal",
  "value": "zenuml-stg"
},
{
  "type": "string",
  "propertyName": "client_domain",
  "operator": "does not equal",
  "value": "dia-stg"
}
```

### Query 1: Today hourly — activity events

Purpose: See recent activity. The last complete hour is the closest to "right now" that Mixpanel supports.

```json
{
  "report_type": "insights",
  "report": {
    "name": "Health: Today hourly activity",
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

### Query 2: Past 1 day — activity events (current + previous)

Run TWO queries: one for the current day, one for the previous day. Compute deltas yourself.

**Current day:**
```json
{
  "name": "Health: 1d activity",
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

**Previous day** (use absolute date range for yesterday):
Same query but with `"dateRange": { "type": "absolute", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` where both dates are yesterday. Calculate yesterday's date from the current date.

### Query 3: Past 1 week — activity events (current + previous)

Same pattern: run TWO queries. Current week uses `{ "unit": "week", "value": 1 }`. Previous week uses absolute date range for the 7 days before that.

### Query 4: Error events — today, 1d (current + previous), 1w (current + previous)

**Today errors (hourly):**
```json
{
  "name": "Health: Errors today (hourly)",
  "chartType": "line",
  "unit": "hour",
  "dateRange": { "type": "relative", "range": "today" },
  "metrics": [
    { "eventName": "unexpected_error", "measurement": { "type": "basic", "math": "total" } },
    { "eventName": "update_custom_content_error", "measurement": { "type": "basic", "math": "total" } }
  ],
  "filters": [ ...global filters... ]
}
```

For 1d and 1w error comparisons, follow the same current+previous pattern as queries 2-3.

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
| `view_macro` = 0 in past day | CRITICAL | App may be completely down |
| `view_macro` dropped >50% vs previous period | WARNING | Possible outage or tracking regression |
| `view_macro` dropped >50% vs same time last week | WARNING | Could be seasonal, but investigate |
| `unexpected_error` > 2x previous period | WARNING | New bug introduced |
| `update_custom_content_error` > 0 and rising | WARNING | Backend save issues |
| `create_macro_end` = 0 for past week | INFO | Low activity but possibly normal for small user base |
| Any `event_category` that had volume before but now shows 0 | WARNING | Specific diagram type may be broken |

### Output format

Present results as a concise table per time window:

```
## Health Check — {date/time}

### Today (hourly)
Last hour: view_macro={N}, create={N}, edit={N}, errors={N}
Peak hour: {time} with {N} views

### Past 24 hours (vs previous day)
| Event | Category | Count | Prev Day | Change |
|-------|----------|-------|----------|--------|
| view_macro | sequence | 150 | 140 | +7% |
| ... | ... | ... | ... | ... |

### Past 7 days (vs previous week)
| Event | Category | Count | Prev Week | Change |
|-------|----------|-------|-----------|--------|
| ... | ... | ... | ... | ... |

### Errors
| Window | unexpected_error | save_error | vs previous |
|--------|-----------------|------------|-------------|
| Today  | 3               | 0          | —           |
| 1 day  | 5               | 1          | +2 / +1     |
| 1 week | 12              | 3          | -5 / +1     |

### Flags
- ✅ No critical issues (or list flags)
```

## Known Limitations

- **No 5-minute window**: Mixpanel's smallest query granularity via the MCP tool is hourly. Today's hourly chart is the closest to real-time. Mixpanel also has ~5-10 min ingestion delay.
- **`timeComparison` not in API response**: The Mixpanel `timeComparison` parameter creates visual comparisons in the UI but delta values are not returned in the Run-Query API response. Use explicit previous-period queries instead.
- **Forge graph view_macro missing**: `view_macro` for graph type on Forge is not tracked (known bug in `forge-graph-viewer.ts`). Don't flag missing graph views as an anomaly.
- **`event_category` casing**: `openapi` and `OpenAPI` both appear. Treat them as the same category when comparing.
- **Weekend/holiday dip**: Confluence usage drops significantly on weekends. A 50% drop on Saturday vs Friday is normal, not an outage.

## Tips

- Run all queries in parallel (multiple tool calls in one turn) for speed
- If a specific `event_category` looks broken, suggest a deeper dive with the `/conf-app` analytics skill
- After a deploy, wait ~15 minutes before running the health check (Mixpanel ingestion delay)
