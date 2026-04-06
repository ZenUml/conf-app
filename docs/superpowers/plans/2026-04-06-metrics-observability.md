# Metrics Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MacroMetrics pipeline (collect -> KV write -> KV read -> display) observable for humans and AI agents, so when data is missing or stale, the root cause is immediately clear.

**Architecture:** A new backend endpoint (`/metrics-cache/inspect`) returns stored metrics data plus structured diagnostic information. A standalone admin HTML page and a Claude Code skill both consume this endpoint — one for humans, one for AI agents. Frontend logging in `MacroMetrics.ts` gets step-tagged prefixes for browser DevTools debugging.

**Tech Stack:** Cloudflare Workers (backend), plain HTML + vanilla JS (admin portal), Claude Code skill (agent interface), Vitest (tests)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `functions/metrics-cache/inspect.ts` | New: diagnostic API endpoint, reads KV and returns data + diagnosis |
| `functions/metrics-cache/inspect.spec.ts` | New: unit tests for inspect endpoint |
| `public/admin/metrics.html` | New: standalone admin page for viewing metrics data |
| `.claude/skills/metrics/skill.md` | New: Claude Code skill for AI agent access |
| `src/services/MacroMetrics.ts` | Modify: add `[metrics:*]` structured console logging |
| `src/services/MacroMetrics.spec.ts` | Modify: update tests to verify new log messages |

---

### Task 1: Diagnostic API Endpoint

**Files:**
- Create: `functions/metrics-cache/inspect.ts`

- [ ] **Step 1: Create the inspect endpoint**

```ts
// functions/metrics-cache/inspect.ts
import { Env } from '../utils/KVEnv';

interface SpaceMetrics {
  space: string;
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  plantuml: number;
  unknown: number;
  isLite: boolean;
  lastUpdated?: string;
}

interface DomainData {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

type InspectStatus = 'ok' | 'stale' | 'no_data';

const STALE_THRESHOLD_HOURS = 24;

function computeAgeHours(lastUpdated: string | undefined): number {
  if (!lastUpdated) return Infinity;
  const updatedAt = new Date(lastUpdated).getTime();
  const now = Date.now();
  return Math.round((now - updatedAt) / (1000 * 60 * 60) * 10) / 10;
}

function computeStatus(spaceFound: boolean, ageHours: number): InspectStatus {
  if (!spaceFound) return 'no_data';
  if (ageHours >= STALE_THRESHOLD_HOURS) return 'stale';
  return 'ok';
}

function buildSpaceResponse(
  kvKey: string,
  domainData: DomainData | null,
  space: string
) {
  const kvHasData = domainData !== null;
  const domainSpaces = domainData ? Object.keys(domainData.spaces) : [];
  const spaceData = domainData?.spaces?.[space] ?? null;
  const spaceFound = spaceData !== null;
  const ageHours = spaceData ? computeAgeHours(spaceData.lastUpdated) : 0;
  const status = computeStatus(spaceFound, ageHours);

  return {
    status,
    data: spaceData,
    diagnosis: {
      kvKey,
      kvHasData,
      domainSpaces,
      spaceFound,
      lastUpdated: spaceData?.lastUpdated ?? null,
      ageHours: spaceFound ? ageHours : null,
      staleThresholdHours: STALE_THRESHOLD_HOURS,
    },
  };
}

function buildDomainResponse(
  kvKey: string,
  domainData: DomainData | null
) {
  if (!domainData || Object.keys(domainData.spaces).length === 0) {
    return {
      status: 'no_data' as InspectStatus,
      data: null,
      diagnosis: {
        kvKey,
        kvHasData: domainData !== null,
        domainSpaces: [],
        staleThresholdHours: STALE_THRESHOLD_HOURS,
      },
    };
  }

  const spaces: Record<string, ReturnType<typeof buildSpaceResponse>> = {};
  for (const spaceKey of Object.keys(domainData.spaces)) {
    spaces[spaceKey] = buildSpaceResponse(kvKey, domainData, spaceKey);
  }

  return {
    status: 'ok' as InspectStatus,
    spaces,
    diagnosis: {
      kvKey,
      kvHasData: true,
      domainSpaces: Object.keys(domainData.spaces),
      staleThresholdHours: STALE_THRESHOLD_HOURS,
    },
  };
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');
  const space = url.searchParams.get('space');
  const addonKey = url.searchParams.get('addonKey') || '';

  if (!domain) {
    return new Response(JSON.stringify({ error: 'Missing domain parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isLite = addonKey.includes('-lite');
  const productType = isLite ? 'lite' : 'full';
  const kvKey = `metrics:${domain}:${productType}`;

  const domainData = await env.confluence_plugin_features.get(kvKey, 'json') as DomainData | null;

  const result = space
    ? buildSpaceResponse(kvKey, domainData, space)
    : buildDomainResponse(kvKey, domainData);

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
```

- [ ] **Step 2: Verify the endpoint works locally**

Run: `pnpm wrangler:serve` (or `npx wrangler pages dev`), then:
```bash
curl 'http://localhost:8788/metrics-cache/inspect?domain=test-domain'
```
Expected: JSON response with `status`, `data`, `diagnosis` fields.

- [ ] **Step 3: Commit**

```bash
git add functions/metrics-cache/inspect.ts
git commit -m "feat: add /metrics-cache/inspect diagnostic endpoint"
```

---

### Task 2: Inspect Endpoint Tests

**Files:**
- Create: `functions/metrics-cache/inspect.spec.ts`

- [ ] **Step 1: Write tests**

```ts
// functions/metrics-cache/inspect.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the logic by importing the module and calling onRequest directly.
// Since the file uses Cloudflare Pages Functions convention (export onRequest),
// we import it and call with a mock env.

import { onRequest } from './inspect';

function makeRequest(url: string): Request {
  return new Request(url);
}

function makeEnv(kvData: Record<string, any> = {}) {
  return {
    confluence_plugin_features: {
      get: vi.fn(async (key: string) => kvData[key] ?? null),
    },
  };
}

const baseDomain = 'https://example.com';

describe('metrics-cache/inspect', () => {
  describe('missing parameters', () => {
    it('should return 400 when domain is missing', async () => {
      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect`),
        env: makeEnv(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('domain');
    });
  });

  describe('single space query', () => {
    it('should return ok when space exists and is fresh', async () => {
      const now = new Date().toISOString();
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': {
              space: 'DEV', total: 10, sequence: 5, graph: 3,
              openapi: 1, mermaid: 1, plantuml: 0, unknown: 0,
              isLite: false, lastUpdated: now,
            },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=DEV`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.data.total).toBe(10);
      expect(body.diagnosis.kvHasData).toBe(true);
      expect(body.diagnosis.spaceFound).toBe(true);
      expect(body.diagnosis.ageHours).toBeLessThan(1);
    });

    it('should return stale when data is older than threshold', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': {
              space: 'DEV', total: 10, sequence: 5, graph: 3,
              openapi: 1, mermaid: 1, plantuml: 0, unknown: 0,
              isLite: false, lastUpdated: oldDate,
            },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=DEV`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('stale');
      expect(body.diagnosis.ageHours).toBeGreaterThanOrEqual(24);
    });

    it('should return no_data when space does not exist in domain', async () => {
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': { space: 'DEV', total: 5, sequence: 5, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0, isLite: false },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=MISSING`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('no_data');
      expect(body.diagnosis.spaceFound).toBe(false);
      expect(body.diagnosis.domainSpaces).toEqual(['DEV']);
    });

    it('should return no_data when domain has no KV entry', async () => {
      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=unknown.atlassian.net&space=DEV`),
        env: makeEnv(),
      });

      const body = await res.json();
      expect(body.status).toBe('no_data');
      expect(body.diagnosis.kvHasData).toBe(false);
      expect(body.diagnosis.domainSpaces).toEqual([]);
    });

    it('should use lite key when addonKey contains -lite', async () => {
      const env = makeEnv();
      await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=DEV&addonKey=zenuml-lite`),
        env,
      });

      expect(env.confluence_plugin_features.get).toHaveBeenCalledWith(
        'metrics:test.atlassian.net:lite',
        'json'
      );
    });
  });

  describe('domain-wide query (no space)', () => {
    it('should return all spaces with individual statuses', async () => {
      const now = new Date().toISOString();
      const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': { space: 'DEV', total: 5, sequence: 5, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0, isLite: false, lastUpdated: now },
            'PROD': { space: 'PROD', total: 3, sequence: 3, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0, isLite: false, lastUpdated: oldDate },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.spaces.DEV.status).toBe('ok');
      expect(body.spaces.PROD.status).toBe('stale');
      expect(body.diagnosis.domainSpaces).toEqual(['DEV', 'PROD']);
    });

    it('should return no_data when domain has no KV entry', async () => {
      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=unknown.atlassian.net`),
        env: makeEnv(),
      });

      const body = await res.json();
      expect(body.status).toBe('no_data');
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:unit functions/metrics-cache/inspect.spec.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add functions/metrics-cache/inspect.spec.ts
git commit -m "test: add inspect endpoint unit tests"
```

---

### Task 3: Admin Portal Page

**Files:**
- Create: `public/admin/metrics.html`

- [ ] **Step 1: Create the admin metrics page**

Follow the same style and patterns as the existing `public/admin/index.html` (Space License Admin). Use the same CSS classes (`.container`, `.card`, `.badge`, `.table-wrap`, etc.) and the same `apiCall` pattern.

```html
<!-- public/admin/metrics.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Metrics Inspector</title>
  <style>
    /* Copy the exact same CSS from public/admin/index.html for consistency:
       *, body, .container, h1, .subtitle, .card, .form-grid, .form-group,
       button, .btn-primary, .btn-secondary, .table-wrap, table, th, td,
       .badge, .empty-state, .mono, .toast */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; line-height: 1.5; }
    .container { max-width: 960px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 24px; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 13px; font-weight: 500; color: #555; }
    .form-group input { padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
    .form-group input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
    button { padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #e5e5e5; font-weight: 600; color: #555; white-space: nowrap; }
    td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
    tr:hover td { background: #fafafa; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 500; }
    .badge.ok { background: #dcfce7; color: #16a34a; }
    .badge.stale { background: #fef3c7; color: #d97706; }
    .badge.no_data { background: #fee2e2; color: #dc2626; }
    .empty-state { text-align: center; padding: 40px 20px; color: #999; }
    .mono { font-family: monospace; font-size: 12px; }
    .diagnosis { background: #f8f9fa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px; margin-top: 12px; font-size: 13px; }
    .diagnosis dt { font-weight: 600; color: #555; display: inline; }
    .diagnosis dd { display: inline; margin: 0 16px 0 4px; }
    .form-actions { display: flex; gap: 8px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Metrics Inspector</h1>
    <p class="subtitle">Inspect MacroMetrics KV cache — diagnose missing or stale data</p>

    <div class="card">
      <h2>Query</h2>
      <form id="queryForm" onsubmit="inspect(event)">
        <div class="form-grid">
          <div class="form-group">
            <label for="domain">Domain</label>
            <input type="text" id="domain" required placeholder="example.atlassian.net">
          </div>
          <div class="form-group">
            <label for="space">Space (optional)</label>
            <input type="text" id="space" placeholder="Leave empty to list all spaces">
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Inspect</button>
        </div>
      </form>
    </div>

    <div id="results"></div>
  </div>

  <script>
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    function statusBadge(status) {
      return `<span class="badge ${status}">${status}</span>`;
    }

    function formatAge(hours) {
      if (hours === null || hours === undefined) return '-';
      if (hours < 1) return `${Math.round(hours * 60)}m ago`;
      if (hours < 48) return `${Math.round(hours)}h ago`;
      return `${Math.round(hours / 24)}d ago`;
    }

    function renderMetricsTable(data) {
      if (!data) return '<p class="empty-state">No data</p>';
      const fields = ['sequence', 'graph', 'mermaid', 'openapi', 'plantuml', 'unknown', 'total'];
      return `
        <div class="table-wrap">
          <table>
            <thead><tr>${fields.map(f => `<th>${f}</th>`).join('')}</tr></thead>
            <tbody><tr>${fields.map(f => `<td>${data[f] ?? '-'}</td>`).join('')}</tr></tbody>
          </table>
        </div>`;
    }

    function renderDiagnosis(d) {
      return `
        <div class="diagnosis">
          <dl>
            <dt>KV Key:</dt><dd class="mono">${escapeHtml(d.kvKey)}</dd>
            <dt>KV Has Data:</dt><dd>${d.kvHasData ? 'Yes' : 'No'}</dd>
            ${d.spaceFound !== undefined ? `<dt>Space Found:</dt><dd>${d.spaceFound ? 'Yes' : 'No'}</dd>` : ''}
            ${d.lastUpdated ? `<dt>Last Updated:</dt><dd>${escapeHtml(d.lastUpdated)} (${formatAge(d.ageHours)})</dd>` : ''}
            <dt>Available Spaces:</dt><dd>${d.domainSpaces.length > 0 ? escapeHtml(d.domainSpaces.join(', ')) : 'None'}</dd>
            <dt>Stale Threshold:</dt><dd>${d.staleThresholdHours}h</dd>
          </dl>
        </div>`;
    }

    function renderSpaceResult(body) {
      return `
        <div class="card">
          <h2>Result ${statusBadge(body.status)}</h2>
          ${renderMetricsTable(body.data)}
          ${renderDiagnosis(body.diagnosis)}
        </div>`;
    }

    function renderDomainResult(body) {
      if (body.status === 'no_data') {
        return `
          <div class="card">
            <h2>Result ${statusBadge('no_data')}</h2>
            <p class="empty-state">No metrics data for this domain</p>
            ${renderDiagnosis(body.diagnosis)}
          </div>`;
      }
      let html = `<div class="card"><h2>All Spaces</h2>${renderDiagnosis(body.diagnosis)}`;
      for (const [spaceKey, spaceResult] of Object.entries(body.spaces)) {
        html += `<h3 style="margin-top:16px">${escapeHtml(spaceKey)} ${statusBadge(spaceResult.status)}</h3>`;
        html += renderMetricsTable(spaceResult.data);
      }
      html += '</div>';
      return html;
    }

    async function inspect(e) {
      e.preventDefault();
      const domain = document.getElementById('domain').value.trim();
      const space = document.getElementById('space').value.trim();
      const resultsEl = document.getElementById('results');

      const params = new URLSearchParams({ domain });
      if (space) params.set('space', space);

      resultsEl.innerHTML = '<div class="card"><p class="empty-state">Loading...</p></div>';

      try {
        const res = await fetch(`/metrics-cache/inspect?${params}`);
        const body = await res.json();

        if (!res.ok) {
          resultsEl.innerHTML = `<div class="card"><p class="empty-state" style="color:#dc2626">${escapeHtml(body.error || 'Request failed')}</p></div>`;
          return;
        }

        resultsEl.innerHTML = space ? renderSpaceResult(body) : renderDomainResult(body);
      } catch (err) {
        resultsEl.innerHTML = `<div class="card"><p class="empty-state" style="color:#dc2626">${escapeHtml(err.message)}</p></div>`;
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify locally**

Run `pnpm wrangler:serve`, open `http://localhost:8788/admin/metrics.html` in a browser. Enter a domain, submit the form, verify the layout and error states render correctly.

- [ ] **Step 3: Commit**

```bash
git add public/admin/metrics.html
git commit -m "feat: add metrics inspector admin page"
```

---

### Task 4: `/metrics` Claude Code Skill

**Files:**
- Create: `.claude/skills/metrics/skill.md`

- [ ] **Step 1: Create the skill file**

```markdown
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
| Production (full) | `https://zenuml.com` |
| Production (lite) | `https://lite.zenuml.com` |
| Staging (full) | `https://full-stg.zenuml.com` |
| Staging (lite) | `https://lite-stg.zenuml.com` |

Append `/metrics-cache/inspect?domain=<domain>&space=<space>` to the base URL.

For lite products, add `&addonKey=zenuml-lite` to the query string.

## Execution

1. Parse the arguments to extract `domain` and optional `space`.
2. Call the inspect endpoint using `WebFetch`:
   - If space is provided: `GET <base>/metrics-cache/inspect?domain=<domain>&space=<space>`
   - If space is omitted: `GET <base>/metrics-cache/inspect?domain=<domain>`
3. If the user did not specify an environment, try production (full) first.

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
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/metrics/skill.md
git commit -m "feat: add /metrics Claude Code skill"
```

---

### Task 5: Structured Console Logging in MacroMetrics

**Files:**
- Modify: `src/services/MacroMetrics.ts`
- Modify: `src/services/MacroMetrics.spec.ts`

- [ ] **Step 1: Write test for structured logging**

Add a new `describe('structured logging')` block to `src/services/MacroMetrics.spec.ts`:

```ts
describe('structured logging', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('should log [metrics:kv:read] hit on cache hit', async () => {
    const cachedMetrics: IMacroMetrics = {
      space: mockSpace, total: 5, sequence: 2, graph: 1,
      openapi: 1, mermaid: 1, plantuml: 0, unknown: 0,
      isLite: false, lastUpdated: new Date().toISOString()
    };
    (callRemote as any).mockResolvedValueOnce(cachedMetrics);

    await macroMetrics.getMacroMetrics();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics:kv:read] hit'),
      expect.objectContaining({ space: mockSpace })
    );
  });

  it('should log [metrics:kv:read] miss on cache miss', async () => {
    (callRemote as any).mockResolvedValueOnce(null);
    mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
      consumer({ results: [] });
      return Promise.resolve({});
    });

    await macroMetrics.getMacroMetrics();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics:kv:read] miss'),
      expect.objectContaining({ space: mockSpace })
    );
  });

  it('should log [metrics:kv:read] failed on cache error', async () => {
    (callRemote as any).mockRejectedValueOnce(new Error('Network error'));
    mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
      consumer({ results: [] });
      return Promise.resolve({});
    });

    await macroMetrics.getMacroMetrics();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics:kv:read] failed'),
      expect.objectContaining({ error: 'Network error' })
    );
  });

  it('should log [metrics:collect] success with total count', async () => {
    (callRemote as any).mockResolvedValueOnce(null);
    mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
      consumer({ results: [
        { body: { raw: { value: JSON.stringify({ diagramType: 'Sequence' }) } } },
      ]});
      return Promise.resolve({});
    });

    await macroMetrics.getMacroMetrics();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics:collect] success'),
      expect.objectContaining({ total: 1 })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:unit src/services/MacroMetrics.spec.ts
```

Expected: The new tests fail because `MacroMetrics.ts` does not yet produce `[metrics:*]` log messages.

- [ ] **Step 3: Update MacroMetrics.ts with structured logging**

Replace logging in `getMacroMetrics()`:

In the `getMacroMetrics` method, replace:
```ts
console.debug(`Using cached metrics for space ${space}`);
```
with:
```ts
console.debug('[metrics:kv:read] hit', { domain, space });
```

After the `if (cachedMetrics)` block, when cachedMetrics is null, add:
```ts
console.debug('[metrics:kv:read] miss', { domain, space });
```

Replace the catch block:
```ts
console.error('Error on getMacroMetrics', e);
```
with:
```ts
console.warn('[metrics:kv:read] failed', { domain, space, error: (e as Error).message });
```

In `readFromKV`, replace:
```ts
console.debug('KV read failed', e);
```
with:
```ts
console.warn('[metrics:kv:read] failed', { error: (e as Error).message });
```

In `writeToKV`, replace:
```ts
console.debug('KV write failed (non-critical)', e);
```
with:
```ts
console.warn('[metrics:kv:write] failed', { error: (e as Error).message });
```

In `collectMetrics`, add after the `return` statement (before the catch):
```ts
console.debug('[metrics:collect] success', { space, total: stats.total });
```

Replace the catch in `collectMetrics`:
```ts
console.error('Error on collectMetrics', e);
```
with:
```ts
console.warn('[metrics:collect] failed', { space, error: (e as Error).message });
```

In `reportMacroMetrics`, replace:
```ts
console.debug(`Report macro metrics for space ${metrics.space}:`, metrics);
```
with:
```ts
console.debug('[metrics:report] success', { space: metrics.space, total: metrics.total });
```

Replace the outer catch:
```ts
console.error('Error on reportMacroMetrics', e);
```
with:
```ts
console.warn('[metrics:report] failed', { error: (e as Error).message });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:unit src/services/MacroMetrics.spec.ts
```

Expected: All tests pass, including the new structured logging tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/MacroMetrics.ts src/services/MacroMetrics.spec.ts
git commit -m "feat: add structured [metrics:*] console logging"
```
