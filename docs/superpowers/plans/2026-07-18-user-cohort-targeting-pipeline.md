# User-Cohort Targeting Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any client surface (page banner, upgrade modal, editor) answer "is the current user in cohort X" synchronously, fed by offline-computed cohort lists (Mixpanel/D1 analysis) uploaded to KV.

**Architecture:** Offline cohort seed JSONs (`private/growth/cohorts/*.json`, already generated 2026-07-18: `vs-copier` 38 users, `t1-lapsed-author-strict` 284, `t1-lapsed-author-loose` 1250) are merged by a build script into a wrangler bulk-put file keyed `cohort:user:<accountId>`, uploaded into the existing **SPACE_LICENSE_KV** namespace (key-prefix isolation; zero new cloud resources). A new authenticated Pages Function `/api/user-cohorts` resolves the caller's accountId **from the Forge invocation token** and returns their cohorts. On the client, the macro iframe refreshes at most once per 24h and persists a localStorage marker (`userCohorts:<domain>`), following the exact single-writer marker pattern of `src/utils/paywall/warningBanner.ts` — because the page-banner iframe cannot read accountId synchronously (documented in that file's header comment), the marker is domain-scoped and relies on localStorage being per-browser ≈ per-user. Consumers (④ T1 win-back banner, S3 awareness banner) read the marker synchronously via `isInCohort()`.

**Tech Stack:** Vue 3 + TypeScript + Vite (client), Cloudflare Pages Functions + Workers KV (backend), Vitest (unit tests), jose (JWT validation — existing `functions/utils/authenticate.ts`).

## Global Constraints

- **Branch/worktree:** never commit to `main`; both the repo and `private/` have other sessions' uncommitted changes — work in a worktree: `git worktree add ../conf-app-cohorts -b feat/user-cohort-targeting origin/main` (local main is 23 commits stale; MUST branch from `origin/main`).
- **Client privacy:** accountIds + tenant names never enter the public repo. Cohort seed JSONs stay in `private/growth/cohorts/`; the public repo gets only the (data-free) build script and runtime code.
- **Cloud changes are approval-gated:** any `wrangler kv` write to staging or prod requires the user's explicit go-ahead (CLAUDE.md safety rule + deploy-confirmation policy). The plan builds everything up to the upload; Task 6 lists the commands but they are executed only on approval.
- **KV key namespace:** all pipeline keys use the `cohort:` prefix inside SPACE_LICENSE_KV. Existing license keys use the `license:` prefix — no collision possible. If cohorts outgrow this, migrate to a dedicated namespace later.
- **Analytics-first (project hard rule):** the Mixpanel events land as the first commit.
- **Typecheck baseline is red** (~150 pre-existing tsc errors) — judge `tsc` output by comparison to `origin/main`, not by absolute zero.
- **Package manager:** pnpm. Unit tests: `pnpm test:unit` (Vitest). Run from the worktree root.

---

### Task 1: Analytics events (catalog + types)

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (insert into the `AnalyticsEventName` union, after `"viewer_source_copied"` at ~line 162)
- Modify: `src/utils/analytics/types.ts` (add optional props to `AnalyticsProperties`, after the `is_space_admin` block at ~line 87)

**Interfaces:**
- Consumes: nothing.
- Produces: event names `"cohorts_refreshed"` / `"cohorts_refresh_failed"` and props `cohorts?: string`, `cohort_count?: number` — Task 4 calls `trackAnalyticsEvent` with exactly these.

- [ ] **Step 1: Add the event names to the union in `catalog.ts`**

Insert after the `| "viewer_source_copied"` line:

```ts
  // User-cohort targeting pipeline (docs/superpowers/plans/
  // 2026-07-18-user-cohort-targeting-pipeline.md). The macro iframe refreshes
  // the current user's cohort membership from /api/user-cohorts (KV-backed,
  // offline-computed) and persists it as a localStorage marker for synchronous
  // reads by other iframes (page banner, upgrade modal). `refreshed` fires on
  // a successful fetch (including an empty cohort list); `refresh_failed` on
  // network/auth/malformed-response errors.
  | "cohorts_refreshed"
  | "cohorts_refresh_failed"
```

- [ ] **Step 2: Add the properties to `AnalyticsProperties` in `types.ts`**

Insert after the `is_space_admin?: boolean;` line (keep its trailing comment block intact):

```ts
  // Cohort targeting (cohorts_refreshed). `cohorts` = comma-joined cohort list
  // the refresh resolved; empty string = user in no cohort (still a successful
  // refresh). `cohort_count` = same list's length, for numeric filtering.
  cohorts?: string;
  cohort_count?: number;
```

- [ ] **Step 3: Verify the compiler accepts the union extension**

Run: `npx vue-tsc --noEmit 2>&1 | grep -c "error TS"` and compare against the same command's output on an untouched `origin/main` checkout.
Expected: identical error count (baseline is red; no NEW errors).

- [ ] **Step 4: Commit**

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git commit -m "feat(analytics): cohort-refresh events for the user-cohort targeting pipeline"
```

---

### Task 2: Client marker module `userCohorts.ts`

**Files:**
- Create: `src/utils/cohorts/userCohorts.ts`
- Test: `src/utils/cohorts/userCohorts.spec.ts`

**Interfaces:**
- Consumes: `getClientDomain` from `@/utils/ContextParameters/ContextParameters` (existing); `callRemote` from `@/utils/requestUtil` (existing — throws on non-2xx, returns parsed body); `trackAnalyticsEvent` from `@/utils/analytics/trackAnalyticsEvent` (existing); Task 1's event names.
- Produces: `readUserCohortsMarker(): UserCohortsMarker | null`, `isInCohort(cohort: string): boolean` (synchronous, for hot paths), `refreshUserCohortsIfStale(now?: number): Promise<void>` (fire-and-forget refresh, ≤1 fetch/24h), plus `parseUserCohortsMarker`, `isMarkerStale`, `userCohortsMarkerKey`, `COHORT_MARKER_TTL_MS` for tests/consumers. Task 5 calls `refreshUserCohortsIfStale`; future consumers (④/⑥ banners) call `isInCohort`.

- [ ] **Step 1: Write the failing spec**

`src/utils/cohorts/userCohorts.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import { callRemote } from '@/utils/requestUtil'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import {
  COHORT_MARKER_TTL_MS,
  userCohortsMarkerKey,
  parseUserCohortsMarker,
  isMarkerStale,
  readUserCohortsMarker,
  isInCohort,
  refreshUserCohortsIfStale,
} from './userCohorts'

const NOW = Date.parse('2026-07-18T00:00:00Z')

function seedMarker(fetchedAt: string, cohorts: string[] = ['vs-copier']) {
  localStorage.setItem(
    userCohortsMarkerKey(),
    JSON.stringify({ cohorts, accountId: 'a-1', fetchedAt })
  )
}

describe('userCohorts marker', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.clearAllMocks())

  it('derives a domain-scoped key', () => {
    expect(userCohortsMarkerKey()).toBe('userCohorts:example-tenant')
  })

  it('parses a valid marker and rejects malformed ones', () => {
    expect(parseUserCohortsMarker(JSON.stringify({ cohorts: ['a'], accountId: 'x', fetchedAt: 't' })))
      .toEqual({ cohorts: ['a'], accountId: 'x', fetchedAt: 't' })
    expect(parseUserCohortsMarker(null)).toBeNull()
    expect(parseUserCohortsMarker('not json')).toBeNull()
    expect(parseUserCohortsMarker(JSON.stringify({ cohorts: 'nope', accountId: 'x', fetchedAt: 't' }))).toBeNull()
    expect(parseUserCohortsMarker(JSON.stringify({ cohorts: [1], accountId: 'x', fetchedAt: 't' }))).toBeNull()
  })

  it('isMarkerStale: null, unparseable date, and expired TTL are stale; fresh is not', () => {
    expect(isMarkerStale(null, NOW)).toBe(true)
    expect(isMarkerStale({ cohorts: [], accountId: 'x', fetchedAt: 'garbage' }, NOW)).toBe(true)
    const old = new Date(NOW - COHORT_MARKER_TTL_MS - 1).toISOString()
    expect(isMarkerStale({ cohorts: [], accountId: 'x', fetchedAt: old }, NOW)).toBe(true)
    const fresh = new Date(NOW - 1000).toISOString()
    expect(isMarkerStale({ cohorts: [], accountId: 'x', fetchedAt: fresh }, NOW)).toBe(false)
  })

  it('isInCohort reads synchronously from localStorage, stale or not', () => {
    seedMarker(new Date(NOW - COHORT_MARKER_TTL_MS * 10).toISOString())
    expect(isInCohort('vs-copier')).toBe(true)
    expect(isInCohort('other')).toBe(false)
    localStorage.clear()
    expect(isInCohort('vs-copier')).toBe(false)
  })

  it('refreshUserCohortsIfStale skips the fetch when the marker is fresh', async () => {
    seedMarker(new Date(NOW - 1000).toISOString())
    await refreshUserCohortsIfStale(NOW)
    expect(callRemote).not.toHaveBeenCalled()
  })

  it('refreshUserCohortsIfStale fetches, writes the marker, and tracks success', async () => {
    vi.mocked(callRemote).mockResolvedValue({ cohorts: ['t1-lapsed-author-strict'], accountId: 'a-9' })
    await refreshUserCohortsIfStale(NOW)
    expect(callRemote).toHaveBeenCalledWith('/api/user-cohorts', 'GET')
    expect(readUserCohortsMarker()).toEqual({
      cohorts: ['t1-lapsed-author-strict'],
      accountId: 'a-9',
      fetchedAt: new Date(NOW).toISOString(),
    })
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refreshed', {
      feature_area: 'system',
      surface: 'viewer',
      cohorts: 't1-lapsed-author-strict',
      cohort_count: 1,
    })
  })

  it('refreshUserCohortsIfStale tracks failure and leaves no marker on malformed response', async () => {
    vi.mocked(callRemote).mockResolvedValue({ nope: true })
    await refreshUserCohortsIfStale(NOW)
    expect(readUserCohortsMarker()).toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: 'malformed_response',
    })
  })

  it('refreshUserCohortsIfStale never throws on network error', async () => {
    vi.mocked(callRemote).mockRejectedValue(new Error('HTTP 500'))
    await expect(refreshUserCohortsIfStale(NOW)).resolves.toBeUndefined()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: 'HTTP 500',
    })
  })
})
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test:unit -- src/utils/cohorts/userCohorts.spec.ts`
Expected: FAIL — cannot resolve `./userCohorts`.

- [ ] **Step 3: Implement `src/utils/cohorts/userCohorts.ts`**

```ts
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { callRemote } from '@/utils/requestUtil'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

/**
 * User-cohort marker (targeting pipeline —
 * docs/superpowers/plans/2026-07-18-user-cohort-targeting-pipeline.md).
 *
 * Single-writer localStorage marker, same discipline as
 * utils/paywall/warningBanner.ts: the macro iframe (the only iframe with a
 * full Forge context) fetches /api/user-cohorts at most once per TTL and
 * writes `userCohorts:<domain>`; other iframes (page banner, upgrade modal)
 * read it synchronously. Domain-scoped, NOT accountId-scoped: the page-banner
 * iframe cannot read accountId synchronously (see warningBanner.ts header),
 * and localStorage is per-browser ≈ per-user. The server still resolves
 * cohorts strictly by the token's accountId; the marker records which
 * accountId it was fetched for, so a shared-browser mismatch is detectable.
 */

export const COHORT_MARKER_TTL_MS = 24 * 60 * 60 * 1000

export interface UserCohortsMarker {
  cohorts: string[]
  accountId: string
  fetchedAt: string
}

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function userCohortsMarkerKey(clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['userCohorts', normalizeKeyPart(clientDomain)].join(':')
}

export function parseUserCohortsMarker(raw: string | null): UserCohortsMarker | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<UserCohortsMarker>
    if (!Array.isArray(p.cohorts) || p.cohorts.some((c) => typeof c !== 'string')) return null
    if (typeof p.accountId !== 'string') return null
    if (typeof p.fetchedAt !== 'string') return null
    return { cohorts: p.cohorts, accountId: p.accountId, fetchedAt: p.fetchedAt }
  } catch {
    return null
  }
}

export function isMarkerStale(marker: UserCohortsMarker | null, now: number = Date.now()): boolean {
  if (!marker) return true
  const fetchedMs = Date.parse(marker.fetchedAt)
  if (!Number.isFinite(fetchedMs)) return true
  return now - fetchedMs > COHORT_MARKER_TTL_MS
}

export function readUserCohortsMarker(clientDomain?: string): UserCohortsMarker | null {
  try {
    return parseUserCohortsMarker(localStorage.getItem(userCohortsMarkerKey(clientDomain)))
  } catch {
    return null
  }
}

function writeUserCohortsMarker(marker: UserCohortsMarker, clientDomain?: string): void {
  try {
    localStorage.setItem(userCohortsMarkerKey(clientDomain), JSON.stringify(marker))
  } catch (e) {
    console.warn('[cohorts] marker write failed', e)
  }
}

/** Synchronous membership check for hot paths (page banner, upgrade modal).
 * A stale marker still answers — staleness only drives refresh, never reads. */
export function isInCohort(cohort: string): boolean {
  const marker = readUserCohortsMarker()
  return !!marker && marker.cohorts.includes(cohort)
}

/**
 * Refresh the marker from the backend if it is missing/stale. Never throws
 * and never blocks a render path — callers fire-and-forget (`void refresh…`).
 */
export async function refreshUserCohortsIfStale(now: number = Date.now()): Promise<void> {
  if (!isMarkerStale(readUserCohortsMarker(), now)) return
  try {
    const response = await callRemote('/api/user-cohorts', 'GET')
    if (!response || !Array.isArray(response.cohorts)) {
      trackAnalyticsEvent('cohorts_refresh_failed', {
        feature_area: 'system',
        surface: 'viewer',
        failure_reason: 'malformed_response',
      })
      return
    }
    const cohorts = (response.cohorts as unknown[]).filter((c): c is string => typeof c === 'string')
    writeUserCohortsMarker({
      cohorts,
      accountId: typeof response.accountId === 'string' ? response.accountId : 'unknown',
      fetchedAt: new Date(now).toISOString(),
    })
    trackAnalyticsEvent('cohorts_refreshed', {
      feature_area: 'system',
      surface: 'viewer',
      cohorts: cohorts.join(','),
      cohort_count: cohorts.length,
    })
  } catch (e) {
    trackAnalyticsEvent('cohorts_refresh_failed', {
      feature_area: 'system',
      surface: 'viewer',
      failure_reason: e instanceof Error ? e.message : 'unknown',
    })
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm test:unit -- src/utils/cohorts/userCohorts.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/cohorts/userCohorts.ts src/utils/cohorts/userCohorts.spec.ts
git commit -m "feat(cohorts): domain-scoped user-cohort marker with 24h TTL refresh"
```

---

### Task 3: Backend endpoint `/api/user-cohorts`

**Files:**
- Create: `functions/api/user-cohorts.ts`
- Test: `functions/api/user-cohorts.spec.ts`
- Modify: `public/_routes.json` (add `"/api/user-cohorts"` to `include` — **CRITICAL**: without this, Cloudflare Pages serves the path as SPA HTML fallback; symptom is `content-type: text/html`)

**Interfaces:**
- Consumes: `validateContextToken(jwt, allowedAppIds)` from `../utils/authenticate` (returns jose result + `payload.principal` = accountId); `getAuthorizationHeader(request)` from `../utils/requestUtils`; `captureError` from `../utils/sentry`; `env.SPACE_LICENSE_KV: KVNamespace`; `env.ALLOWED_FORGE_APP_IDS`. All identical to `functions/api/space-status.ts` — use it as the reference implementation.
- Produces: `GET /api/user-cohorts` → `200 {"cohorts": string[], "accountId"?: string}`; KV record contract `cohort:user:<accountId>` → `{"cohorts": [...]}`; exported pure `resolveCohorts(raw: string | null): string[]` (tested). Task 2's `refreshUserCohortsIfStale` consumes the response shape; Task 5's build script produces the KV record shape.

- [ ] **Step 1: Write the failing spec**

`functions/api/user-cohorts.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveCohorts } from './user-cohorts';

describe('resolveCohorts', () => {
  it('returns [] for a KV miss', () => {
    expect(resolveCohorts(null)).toEqual([]);
  });
  it('returns the cohorts array from a valid record', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: ['vs-copier', 't1-lapsed-author-strict'] })))
      .toEqual(['vs-copier', 't1-lapsed-author-strict']);
  });
  it('returns [] for malformed JSON', () => {
    expect(resolveCohorts('{oops')).toEqual([]);
  });
  it('returns [] when cohorts is not an array', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: 'vs-copier' }))).toEqual([]);
  });
  it('drops non-string entries', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: ['a', 1, null, 'b'] }))).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test:unit -- functions/api/user-cohorts.spec.ts`
Expected: FAIL — cannot resolve `./user-cohorts`. (`functions/forge-custom-content.spec.ts` proves Vitest collects `functions/**` specs; if this one is not picked up, check `include` globs in the Vitest config and extend to `functions/api/**/*.spec.ts` in the same style.)

- [ ] **Step 3: Implement `functions/api/user-cohorts.ts`**

```ts
import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
}

export interface UserCohortsResponse {
  cohorts: string[];
  accountId?: string;
  error?: string;
}

/**
 * KV record contract (written by scripts/cohorts/build-kv-bulk.mjs):
 *   cohort:user:<accountId> -> {"cohorts": ["vs-copier", ...]}
 * Keys live in SPACE_LICENSE_KV under the `cohort:` prefix — license keys use
 * the `license:` prefix, so the two datasets cannot collide.
 */
export function resolveCohorts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { cohorts?: unknown };
    if (!Array.isArray(parsed.cohorts)) return [];
    return parsed.cohorts.filter((c): c is string => typeof c === 'string');
  } catch {
    return [];
  }
}

/** Forge invokeRemote requires valid JSON + application/json for every status. */
function jsonResponse(status: number, body: UserCohortsResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // 'private': the response varies by the caller's accountId (from the
      // token) — a shared/CDN cache must never reuse it across users. The
      // client additionally holds a 24h localStorage TTL.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonResponse(405, { cohorts: [], error: 'method_not_allowed' });
  }

  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return jsonResponse(401, { cohorts: [], error: 'unauthorized' });
    }
    if (!env.ALLOWED_FORGE_APP_IDS) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return jsonResponse(500, { cohorts: [], error: 'server_configuration' });
    }

    const payload = await validateContextToken(jwt, env.ALLOWED_FORGE_APP_IDS);
    // Derived from the Forge-validated token, never a query param — a query
    // param would let any user read another user's cohort membership.
    const accountId = payload?.payload?.principal;

    if (typeof accountId !== 'string' || !accountId) {
      return jsonResponse(200, { cohorts: [] });
    }
    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return jsonResponse(200, { cohorts: [], accountId });
    }

    const raw = await env.SPACE_LICENSE_KV.get(`cohort:user:${accountId}`);
    return jsonResponse(200, { cohorts: resolveCohorts(raw), accountId });
  } catch (error) {
    console.error('user-cohorts error:', error);
    captureError(error);
    return jsonResponse(500, { cohorts: [], error: 'internal_error' });
  }
};
```

- [ ] **Step 4: Add the route to `public/_routes.json`**

In the `include` array, after `"/api/space-license"`, add:

```json
    "/api/user-cohorts",
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm test:unit -- functions/api/user-cohorts.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add functions/api/user-cohorts.ts functions/api/user-cohorts.spec.ts public/_routes.json
git commit -m "feat(cohorts): KV-backed /api/user-cohorts endpoint resolving accountId from the Forge token"
```

---

### Task 4: Wire the refresh into the macro lifecycle

**Files:**
- Modify: `src/composables/useCustomerSuccessService.ts` (the `initialize` function, ~line 228)
- Test: `src/composables/useCustomerSuccessService.spec.ts` (add one test)

**Interfaces:**
- Consumes: `refreshUserCohortsIfStale` from `@/utils/cohorts/userCohorts` (Task 2).
- Produces: cohort refresh fires wherever the customer-success service initializes (macro render / editor mount — the same lifecycle that writes the paywall targeting marker). This is the v1 wiring point; both planned consumers (T1 win-back, S3 banner) are Lite plays and Lite surfaces all initialize this composable.

- [ ] **Step 1: Add the failing test**

In `src/composables/useCustomerSuccessService.spec.ts`, add a `vi.mock` for the cohorts module next to the existing mocks at the top of the file:

```ts
vi.mock('@/utils/cohorts/userCohorts', () => ({ refreshUserCohortsIfStale: vi.fn() }))
```

and a test alongside the existing `initialize` tests (reuse the file's existing setup for mocking macroMetrics/flags — follow the local pattern):

```ts
it('initialize fires a cohort refresh (fire-and-forget)', async () => {
  const { refreshUserCohortsIfStale } = await import('@/utils/cohorts/userCohorts')
  const service = useCustomerSuccessService()
  await service.initialize()
  expect(refreshUserCohortsIfStale).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit -- src/composables/useCustomerSuccessService.spec.ts`
Expected: the new test FAILS (refresh not called); pre-existing tests PASS.

- [ ] **Step 3: Implement the wiring**

In `src/composables/useCustomerSuccessService.ts`, import at the top:

```ts
import { refreshUserCohortsIfStale } from '@/utils/cohorts/userCohorts'
```

and extend `initialize`:

```ts
  const initialize = async () => {
    await Promise.all([
      loadMacroMetrics(),
      loadCSSFeatureFlag(),
      loadSpacePaidStatus(),
      loadSpaceKey(),
    ]);
    persistTargetingMarker();
    // Fire-and-forget: cohort refresh must never delay macro render or
    // paywall gating; the module itself rate-limits to one fetch per 24h.
    void refreshUserCohortsIfStale();
  }
```

- [ ] **Step 4: Run the whole spec file to verify green**

Run: `pnpm test:unit -- src/composables/useCustomerSuccessService.spec.ts`
Expected: PASS, including the new test.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useCustomerSuccessService.ts src/composables/useCustomerSuccessService.spec.ts
git commit -m "feat(cohorts): refresh user-cohort marker from the customer-success lifecycle"
```

---

### Task 5: Cohort → KV bulk build script

**Files:**
- Create: `scripts/cohorts/build-kv-bulk.mjs` (public repo — contains NO data)

**Interfaces:**
- Consumes: cohort seed files (`private/growth/cohorts/*.json`, shape `{cohort: string, generatedAt: string, source: string, accountIds: string[]}` — already exist).
- Produces: on stdout, a wrangler-bulk-put JSON array of `{key: "cohort:user:<accountId>", value: "{\"cohorts\":[...]}"}` — the exact record shape Task 3's `resolveCohorts` reads.

- [ ] **Step 1: Write the script**

`scripts/cohorts/build-kv-bulk.mjs`:

```js
#!/usr/bin/env node
// Merge cohort seed files into a `wrangler kv bulk put`-compatible JSON:
// one key per user, cohort:user:<accountId> -> {"cohorts":[...all cohorts...]}.
// Seeds live in private/growth/cohorts/ (client data — NEVER commit them to
// the public repo). The output also contains accountIds: write it to a temp
// path outside the repo.
//
// Usage:
//   node scripts/cohorts/build-kv-bulk.mjs private/growth/cohorts/*.json > /tmp/cohort-bulk.json
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: build-kv-bulk.mjs <cohort-seed.json>...');
  process.exit(1);
}

const byUser = new Map();
for (const f of files) {
  const seed = JSON.parse(readFileSync(f, 'utf8'));
  if (!seed.cohort || !Array.isArray(seed.accountIds)) {
    console.error(`skipping ${f}: not a cohort seed (need {cohort, accountIds})`);
    continue;
  }
  for (const id of seed.accountIds) {
    if (typeof id !== 'string' || !id) continue;
    if (!byUser.has(id)) byUser.set(id, new Set());
    byUser.get(id).add(seed.cohort);
  }
}

const bulk = [...byUser.entries()].map(([id, cohorts]) => ({
  key: `cohort:user:${id}`,
  value: JSON.stringify({ cohorts: [...cohorts].sort() }),
}));

process.stdout.write(JSON.stringify(bulk, null, 2));
console.error(`${bulk.length} users from ${files.length} seed file(s)`);
```

- [ ] **Step 2: Verify against the real seeds (run from the main checkout, where `private/` is initialised)**

Run: `node scripts/cohorts/build-kv-bulk.mjs private/growth/cohorts/*.json > /tmp/cohort-bulk.json && python3 -c "import json; d=json.load(open('/tmp/cohort-bulk.json')); print(len(d), 'keys'); print(d[0]['key'][:20], d[0]['value'])"`
Expected: ~1,300 keys (the three seed cohorts overlap partially); first key starts `cohort:user:` and value is `{"cohorts":[...]}`.

- [ ] **Step 3: Commit**

```bash
git add scripts/cohorts/build-kv-bulk.mjs
git commit -m "feat(cohorts): build script merging private cohort seeds into a KV bulk-put file"
```

---

### Task 6: Full verification + PR (upload commands documented, approval-gated)

**Files:**
- No new files. Runs verification and opens the PR.

- [ ] **Step 1: Full unit-test run**

Run: `pnpm test:unit`
Expected: PASS — zero failures beyond any that also fail on `origin/main` (verify by running the same on the main checkout if anything unexpected fails).

- [ ] **Step 2: Lint the touched Vue/TS surface**

Run: `pnpm lint:vue`
Expected: no NEW errors relative to `origin/main`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/user-cohort-targeting
gh pr create --title "User-cohort targeting pipeline (KV + /api/user-cohorts + localStorage marker)" --body "$(cat <<'EOF'
## Summary
- Offline-computed cohort lists (private/growth/cohorts/) → KV (`cohort:user:<accountId>` in SPACE_LICENSE_KV) via scripts/cohorts/build-kv-bulk.mjs
- New authenticated GET /api/user-cohorts resolves accountId from the Forge invocation token
- Client: 24h-TTL localStorage marker (userCohorts:<domain>), single-writer from the macro iframe (warningBanner.ts pattern); synchronous isInCohort() for banner/modal hot paths
- Analytics: cohorts_refreshed / cohorts_refresh_failed
- Plan: docs/superpowers/plans/2026-07-18-user-cohort-targeting-pipeline.md

## Test plan
- [ ] Unit: userCohorts marker (8 tests), resolveCohorts (5 tests), CSS-service wiring (1 test)
- [ ] After merge + staging KV upload: spot-check /api/user-cohorts on lite-stg returns a seeded accountId's cohorts

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4 (APPROVAL-GATED — do not run without the user's explicit go-ahead): KV upload**

Staging first, then prod; namespace ids come from the Cloudflare dashboard / `npx wrangler kv namespace list` (SPACE_LICENSE_KV):

```bash
node scripts/cohorts/build-kv-bulk.mjs private/growth/cohorts/*.json > /tmp/cohort-bulk.json
npx wrangler kv bulk put /tmp/cohort-bulk.json --namespace-id <SPACE_LICENSE_KV_STAGING_ID>
# verify one key:
npx wrangler kv key get "cohort:user:<one-accountId-from-the-seed>" --namespace-id <SPACE_LICENSE_KV_STAGING_ID>
# then, after staging spot-check passes:
npx wrangler kv bulk put /tmp/cohort-bulk.json --namespace-id <SPACE_LICENSE_KV_PROD_ID>
```

Post-deploy verification (backend ships via the normal CI release, NOT a local deploy): spot-check on lite-stg that a macro render writes the `userCohorts:<domain>` localStorage marker and Mixpanel receives `cohorts_refreshed`.

---

## Out of scope (deliberately)

- **Consumers** — the T1 win-back banner message (④) and any S3 awareness banner (⑥) are separate features with their own plans; they will call `isInCohort('t1-lapsed-author-strict')` etc. ④ additionally must not ship before #334's editor value ("AI in the editor") is real.
- **Cohort refresh automation** — regenerating seeds is a manual JQL run for now (queries recorded in `private/customer-investigation/2026-07-18-vs-copier-leads.md` and the session scratchpad); automate only if the cadence proves >monthly.
- **Dedicated KV namespace** — revisit only if cohort data outgrows prefix-isolation in SPACE_LICENSE_KV.
