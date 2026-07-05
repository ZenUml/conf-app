---
name: metrics
description: >
  Inspect MacroMetrics KV cache for a domain and space.
  Usage: /metrics <domain> [space]
  Returns stored metrics data with diagnostic information (status, freshness, available spaces).
  Triggers on "check metrics", "metrics for domain", "inspect KV cache", "metrics data",
  "is metrics data available", "why no metrics".
---

# Metrics Inspector

Inspect the MacroMetrics KV cache to see what data is stored and diagnose issues.

## Arguments

Usage: `/metrics <domain> [space]`

- **domain** (required): The Confluence cloud domain, e.g. `zenuml.atlassian.net`
- **space** (optional): A specific space key, e.g. `ZEN`. If omitted, lists all spaces for the domain.

## Environments

| Name | Base URL |
|------|----------|
| Production (full) | `https://conf-full.zenuml.com` |
| Production (lite) | `https://conf-lite.zenuml.com` |
| Staging (full) | `https://conf-stg-full.zenuml.com` |
| Staging (lite) | `https://conf-stg-lite.zenuml.com` |

Append `/admin/metrics-inspect?domain=<domain>&space=<space>` to the base URL.

For the lite product, always add `&addonKey=com.zenuml.confluence-addon-lite` to the query string — this selects the Lite KV bucket (the endpoint keys off the addonKey containing `-lite`). Omitting it reads the Full bucket, whose counts diverge badly from Lite. For the full product, omit `addonKey`.

Note: use curl (not WebFetch's follow-through summarization) to get the raw JSON, e.g.
`curl -s "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>"`

## Execution

1. Parse the arguments to extract `domain` and optional `space`.
2. Call the inspect endpoint using `WebFetch`:
   - If space is provided: `GET <base>/admin/metrics-inspect?domain=<domain>&space=<space>`
   - If space is omitted: `GET <base>/admin/metrics-inspect?domain=<domain>`
3. If the user did not specify an environment/variant, determine the variant first — ask, or check which app the tenant has installed (e.g. `forge-installs` skill, or Mixpanel `product_type`) — then use the matching base URL and addonKey. Do not default to Full: Full and Lite read different KV buckets and their counts diverge.

## Output Format

### Single space result

```
## Metrics: <domain> / <space>

Status: <status> (<age context>)

| Type     | Count |
|----------|-------|
| sequence | N     |
| graph    | N     |
| mermaid  | N     |
| openapi  | N     |
| plantuml | N     |
| unknown  | N     |
| total    | N     |

**Diagnosis:**
- KV Key: `<key>`
- KV Has Data: Yes/No
- Space Found: Yes/No
- Last Updated: <timestamp> (<age>)
- Available Spaces: <list>
- Stale Threshold: 24h

**Suggestion:** <if status is no_data or stale, explain likely cause>
```

### Domain-wide result (no space)

```
## Metrics: <domain> (all spaces)

| Space | Status | Total | Last Updated |
|-------|--------|-------|-------------|
| FOO   | ok     | 42    | 2h ago      |
| BAR   | stale  | 15    | 30h ago     |

**Diagnosis:**
- KV Key: `<key>`
- Total Spaces: N
```

### Suggestions by status

- `ok`: "Data is fresh and available."
- `stale`: "Data exists but has not been updated in over 24 hours. Metrics are reported on save — if no saves have happened recently, this is expected. If saves have occurred, check whether `reportMacroMetrics()` is being called (browser console: filter `[metrics`)."
- `no_data` (KV has data but space missing): "This domain has metrics for other spaces (<list>) but not for '<space>'. Metrics may never have been reported for this space — a user needs to save a macro in this space to trigger reporting."
- `no_data` (KV empty): "No metrics data exists for this domain at all. Either the app has never been installed on this site, or metrics reporting has never successfully completed."
