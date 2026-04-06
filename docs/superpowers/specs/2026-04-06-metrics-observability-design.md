# Metrics Observability Design

## Problem

When MacroMetrics data is missing or stale on the frontend, there is no way to determine the root cause. The pipeline (collect -> KV write -> KV read -> display) is opaque. Developers cannot tell whether metrics were never reported, whether KV storage failed, whether the data is stale, or whether there is an environment mismatch between staging and production.

## Goals

1. Make the metrics pipeline observable for both humans and AI agents
2. When data is missing, proactively surface the reason instead of silently returning `undefined`
3. Provide discoverable diagnostic capabilities

## Non-Goals

- Refactoring MacroMetrics internals or changing the collect/cache architecture
- Real-time monitoring or alerting (the existing `/health-check` skill covers event-level health via Mixpanel)
- Changing how metrics are collected or what data is tracked

## Design

### Component 1: Diagnostic API — `GET /metrics-cache/inspect`

A new Cloudflare Worker endpoint that returns stored metrics data along with structured diagnostic information.

**Location**: `functions/metrics-cache/inspect.ts`

**Parameters**: `domain` (required), `space` (optional), `addonKey` (optional, for lite/full detection)

**Response**:

```json
{
  "status": "ok | no_data | stale",
  "data": { "...metrics if available..." },
  "diagnosis": {
    "kvKey": "metrics:example.atlassian.net:full",
    "kvHasData": true,
    "domainSpaces": ["BAR", "DEV"],
    "spaceFound": true,
    "lastUpdated": "2026-04-05T10:00:00Z",
    "ageHours": 26,
    "staleThresholdHours": 24
  }
}
```

**Status logic**:
- `ok`: space found and `ageHours < staleThresholdHours`
- `stale`: space found but `ageHours >= staleThresholdHours`
- `no_data`: KV key missing or space not found in domain data

**When `space` is omitted**: return all spaces for the domain with their individual statuses.

### Component 2: Admin Portal

A standalone HTML page served from Cloudflare Pages (same deployment as the existing app). Not inside a Confluence iframe.

**Location**: A dedicated route such as `/admin/metrics` on the existing Cloudflare Pages deployment.

**Access control**: Cloudflare Access policy on `/admin/*`. Allowed identities configured in Cloudflare Dashboard (email allowlist or domain-based, e.g. `*@zenuml.com`). Zero code changes required for auth.

**UI**:
- Input fields: domain, space (optional)
- Calls `GET /metrics-cache/inspect`
- Displays:
  - Status badge (ok / stale / no_data) with color coding
  - Metrics data table (sequence, graph, mermaid, openapi, plantuml, unknown, total)
  - Last updated timestamp with relative age
  - List of all spaces available for this domain
  - When `no_data` or `stale`: a clear explanation of what is likely wrong

**Tech**: Plain HTML + vanilla JS (or minimal Vue). No build step required — a single static file is sufficient.

### Component 3: `/metrics` Skill (AI Agent Interface)

A Claude Code skill for programmatic access to metrics diagnostics.

**Location**: `.claude/skills/metrics/skill.md`

**Invocation**:
```
/metrics <domain> [space]
```

**Behavior**:
- Calls `GET /metrics-cache/inspect?domain=<domain>&space=<space>` via `curl` or `WebFetch`
- Formats the response as a readable table with status and diagnosis
- When space is omitted, lists all spaces for the domain with their statuses
- When data is missing, includes a `Suggestion` line with likely cause

**Example output**:
```
## Metrics: zenuml.atlassian.net / BAR

Status: stale (last updated 26h ago)

| Type     | Count |
|----------|-------|
| sequence | 15    |
| graph    | 8     |
| mermaid  | 3     |
| openapi  | 1     |
| total    | 27    |

Diagnosis: Data exists but is stale (threshold: 24h).
Available spaces: BAR, DEV, STAGING
```

**Discoverability**: The skill description in skill.md includes trigger phrases like "check metrics", "metrics for domain", "inspect KV cache", so it surfaces naturally when an agent is investigating metrics issues.

### Component 4: Structured Console Logging

Improve frontend console logs in `MacroMetrics.ts` so developers can trace the pipeline in browser DevTools.

**Convention**: `[metrics:<step>]` prefix on all log lines.

**Steps logged**:
- `[metrics:collect] start space=X` / `success total=N` / `failed error=...`
- `[metrics:kv:read] hit space=X` / `miss space=X` / `failed error=...`
- `[metrics:kv:write] success` / `failed error=...`
- `[metrics:report] success` / `failed error=...`

**Implementation**: Replace the current generic `console.error('Error on getMacroMetrics', e)` with step-specific tagged logs. Use `console.debug` for success cases and `console.warn` for failures. No changes to return types or control flow.

## File Changes Summary

| File | Change |
|------|--------|
| `functions/metrics-cache/inspect.ts` | New: diagnostic API endpoint |
| `public/admin/metrics.html` (or similar) | New: admin portal page |
| `.claude/skills/metrics/skill.md` | New: AI agent skill |
| `src/services/MacroMetrics.ts` | Modify: add `[metrics:*]` structured logging |

## Testing

- **inspect endpoint**: Unit test with mocked KV — verify correct status for ok/stale/no_data scenarios
- **Admin portal**: Manual verification — input domain/space, confirm display matches KV state
- **Skill**: Manual invocation against staging — verify output format and diagnosis accuracy
- **Console logging**: Verify in browser DevTools that filtering `[metrics` shows the full pipeline trace
