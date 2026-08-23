# Editor Staleness Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On inline page-editor renders of a diagram macro whose host page has drifted ≥5 versions since the diagram's last update, show an in-macro hint strip (with a rotating-gradient attention ring) whose CTA opens the macro editor — Job B shell, author-conversion core.

**Architecture:** A self-contained `src/utils/stalenessHint/` module cluster (surface predicate, drift computation, localStorage markers, flag read, DOM strip) wired into `src/forgeIndex.ts` exactly like the snapshot-backfill block: fire-and-forget dynamic import after custom content loads, never on the render critical path, never throws. The strip is vanilla DOM mounted onto the iframe body (no coupling to the viewer component tree). Design spec: `docs/superpowers/specs/2026-07-18-job-b-editor-staleness-hint-design.md`. Spike evidence: `docs/superpowers/plans/2026-07-18-job-b-spike-findings.md` — surface predicate is `extension.type==='macro' && extension.isEditing===true && !extension.modal`; CTA clicks reach the iframe first-click (no fallback needed); drift via `GET /wiki/api/v2/pages/{id}/versions?limit=50` newest-first walk (~130-270ms typical).

**Tech Stack:** Vue-free vanilla DOM + TypeScript for the strip; `@forge/bridge` FeatureFlags (DI pattern copied from `src/utils/viewerLoad/flags.ts`); Vitest.

## Global Constraints

- **Branch/worktree:** `git worktree add ../conf-app-hint -b feat/editor-staleness-hint origin/main` — main checkout has other sessions' uncommitted changes; origin/main just absorbed the snapshot PRs (#296/#347/#349), branch from its CURRENT tip.
- **Product copy is English** (the zh copy in the spec/mockup was discussion-language). Exact strings are in Task 4 — use them verbatim.
- **Analytics-first:** events land as the first commit.
- **Feature flag `editor-staleness-hint-enabled`** gates everything, fail-closed (missing flag ⇒ off). Flag creation in the Developer Console (per app) is a post-merge ops step — NOT part of this plan's execution.
- **v1 macro-type scope:** sequence, mermaid, plantuml, graph. Excluded: embed, openapi, asyncapi.
- **Trigger:** drift ≥ 5 AND inline-editor surface AND no dismissal in 30 days AND flag on.
- **Never throws into the render path**; every localStorage access try/caught; drift fetch is post-render.
- **Suite:** `pnpm test:unit` (note: path args are IGNORED — it always runs the full suite). Typecheck/lint judged relative to origin/main.
- No client data in public files.

---

### Task 1: Analytics events

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (insert into `AnalyticsEventName` union, after `"viewer_source_copied"`)
- Modify: `src/utils/analytics/types.ts` (add props to `AnalyticsProperties`, after the `cohorts`/`cohort_count` block)

**Interfaces:**
- Produces: event names `"staleness_hint_shown"`, `"staleness_hint_clicked"`, `"staleness_hint_dismissed"`; props `drift_count?: number`, `is_diagram_author?: boolean`. Task 4 calls `trackAnalyticsEvent` with exactly these.

- [ ] **Step 1: catalog.ts** — insert after `| "viewer_source_copied"`:

```ts
  // Editor staleness hint (docs/superpowers/specs/
  // 2026-07-18-job-b-editor-staleness-hint-design.md). Shown on inline
  // page-editor renders when the host page drifted >=5 versions past the
  // diagram's last update. Job B shell / author-conversion core: the north
  // star is a non-author's first macro_save_succeeded after a hint click.
  | "staleness_hint_shown"
  | "staleness_hint_clicked"
  | "staleness_hint_dismissed"
```

- [ ] **Step 2: types.ts** — insert after the `cohort_count?: number;` line:

```ts
  // Staleness hint (staleness_hint_*). `drift_count` = page versions newer
  // than the diagram's last update at decision time; `is_diagram_author` =
  // current accountId equals the diagram custom content's last-version
  // authorId (picks the copy variant).
  drift_count?: number;
  is_diagram_author?: boolean;
```

- [ ] **Step 3: Verify** — `npx vue-tsc --noEmit 2>&1 | grep -c "error TS"` matches origin/main's count (0 as of ②'s run).

- [ ] **Step 4: Commit**

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git commit -m "feat(analytics): staleness-hint events (shown/clicked/dismissed)"
```

---

### Task 2: Core logic modules (surface, markers, drift, flag)

**Files:**
- Create: `src/utils/stalenessHint/core.ts`
- Create: `src/utils/stalenessHint/drift.ts`
- Create: `src/utils/stalenessHint/flags.ts`
- Test: `src/utils/stalenessHint/core.spec.ts`, `src/utils/stalenessHint/drift.spec.ts`

**Interfaces:**
- Consumes: `getClientDomain` from `@/utils/ContextParameters/ContextParameters`; `forgeRequest` from `@/utils/requestUtil` (returns parsed JSON body); `getContext` from `@/model/globals/forgeGlobal`; `mapEnvironment` from `@/utils/prefetch/flags`.
- Produces (Task 4 consumes):
  - `isInlineEditorRender(context: any): boolean`
  - `readDismissMarker(ccId: string): {dismissedAt: string} | null`, `writeDismissMarker(ccId: string): void`, `isDismissalActive(marker, now): boolean`, `DISMISS_SILENCE_MS`
  - `countVersionsSince(pageId: string, sinceIso: string): Promise<number>` and cached wrapper `getDrift(pageId: string, pageVersion: number, sinceIso: string): Promise<number>`
  - `isStalenessHintEnabled(): Promise<boolean>` (fail-closed)
  - `DRIFT_THRESHOLD = 5`

- [ ] **Step 1: Write failing specs**

`src/utils/stalenessHint/core.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { vi } from 'vitest'
import {
  isInlineEditorRender,
  readDismissMarker,
  writeDismissMarker,
  isDismissalActive,
  DISMISS_SILENCE_MS,
  DRIFT_THRESHOLD,
} from './core'

const NOW = Date.parse('2026-07-18T00:00:00Z')

describe('isInlineEditorRender (spike Q1 signature)', () => {
  it('true only for macro + isEditing + no modal', () => {
    expect(isInlineEditorRender({ extension: { type: 'macro', isEditing: true } })).toBe(true)
    expect(isInlineEditorRender({ extension: { type: 'macro', isEditing: false } })).toBe(false)
    expect(isInlineEditorRender({ extension: { type: 'macro', isEditing: true, modal: { macroMode: 'editor' } } })).toBe(false)
    expect(isInlineEditorRender({ extension: { type: 'other', isEditing: true } })).toBe(false)
    expect(isInlineEditorRender({})).toBe(false)
    expect(isInlineEditorRender(undefined)).toBe(false)
  })
})

describe('dismiss marker', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips per ccId and domain', () => {
    expect(readDismissMarker('cc-1')).toBeNull()
    writeDismissMarker('cc-1')
    const m = readDismissMarker('cc-1')
    expect(m).not.toBeNull()
    expect(Date.parse(m!.dismissedAt)).not.toBeNaN()
    expect(readDismissMarker('cc-2')).toBeNull()
  })

  it('isDismissalActive: fresh yes, expired no, malformed no', () => {
    expect(isDismissalActive(null, NOW)).toBe(false)
    expect(isDismissalActive({ dismissedAt: new Date(NOW - 1000).toISOString() }, NOW)).toBe(true)
    expect(isDismissalActive({ dismissedAt: new Date(NOW - DISMISS_SILENCE_MS - 1).toISOString() }, NOW)).toBe(false)
    expect(isDismissalActive({ dismissedAt: 'garbage' }, NOW)).toBe(false)
  })

  it('constants match the spec', () => {
    expect(DISMISS_SILENCE_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(DRIFT_THRESHOLD).toBe(5)
  })
})
```

`src/utils/stalenessHint/drift.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/requestUtil', () => ({ forgeRequest: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { forgeRequest } from '@/utils/requestUtil'
import { countVersionsSince, getDrift } from './drift'

const CUTOFF = '2026-07-10T00:00:00Z'
const v = (createdAt: string) => ({ createdAt })

describe('countVersionsSince (newest-first walk, spike Q3 recipe)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('stops at the first entry at/older than the cutoff', async () => {
    vi.mocked(forgeRequest).mockResolvedValue({
      results: [v('2026-07-17T00:00:00Z'), v('2026-07-15T00:00:00Z'), v('2026-07-09T00:00:00Z'), v('2026-07-01T00:00:00Z')],
      _links: {},
    })
    await expect(countVersionsSince('p1', CUTOFF)).resolves.toBe(2)
    expect(forgeRequest).toHaveBeenCalledWith('/wiki/api/v2/pages/p1/versions?limit=50')
  })

  it('follows _links.next only when a full page is exhausted', async () => {
    vi.mocked(forgeRequest)
      .mockResolvedValueOnce({
        results: [v('2026-07-17T00:00:00Z'), v('2026-07-16T00:00:00Z')],
        _links: { next: '/wiki/api/v2/pages/p1/versions?limit=50&cursor=abc' },
      })
      .mockResolvedValueOnce({
        results: [v('2026-07-01T00:00:00Z')],
        _links: {},
      })
    await expect(countVersionsSince('p1', CUTOFF)).resolves.toBe(2)
    expect(forgeRequest).toHaveBeenCalledTimes(2)
    expect(forgeRequest).toHaveBeenLastCalledWith('/wiki/api/v2/pages/p1/versions?limit=50&cursor=abc')
  })

  it('getDrift caches per (pageId, pageVersion)', async () => {
    vi.mocked(forgeRequest).mockResolvedValue({
      results: [v('2026-07-17T00:00:00Z')],
      _links: {},
    })
    await expect(getDrift('p1', 7, CUTOFF)).resolves.toBe(1)
    await expect(getDrift('p1', 7, CUTOFF)).resolves.toBe(1)
    expect(forgeRequest).toHaveBeenCalledTimes(1)
    await expect(getDrift('p1', 8, CUTOFF)).resolves.toBe(1)
    expect(forgeRequest).toHaveBeenCalledTimes(2)
  })

  it('never throws: fetch failure resolves to 0', async () => {
    vi.mocked(forgeRequest).mockRejectedValue(new Error('boom'))
    await expect(countVersionsSince('p1', CUTOFF)).resolves.toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify both fail** — `pnpm test:unit` → the two new spec files fail on unresolved imports.

- [ ] **Step 3: Implement**

`src/utils/stalenessHint/core.ts`:

```ts
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'

/**
 * Editor staleness hint — core predicates and markers.
 * Spec: docs/superpowers/specs/2026-07-18-job-b-editor-staleness-hint-design.md
 * Surface signature is spike-verified (2026-07-18 findings, Q1): the inline
 * page-editor render is the ONLY surface with isEditing=true and no modal.
 * The existing isEditorish check in forgeIndex covers the edit modal, not
 * this; extension.macro.isConfiguring never appears on render-time contexts.
 */

export const DRIFT_THRESHOLD = 5
export const DISMISS_SILENCE_MS = 30 * 24 * 60 * 60 * 1000

export function isInlineEditorRender(context: any): boolean {
  const ext = context?.extension
  return ext?.type === 'macro' && ext?.isEditing === true && !ext?.modal
}

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function dismissMarkerKey(ccId: string, clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['stalenessHint', normalizeKeyPart(clientDomain), normalizeKeyPart(ccId)].join(':')
}

export interface DismissMarker {
  dismissedAt: string
}

export function readDismissMarker(ccId: string): DismissMarker | null {
  try {
    const raw = localStorage.getItem(dismissMarkerKey(ccId))
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<DismissMarker>
    return typeof p.dismissedAt === 'string' ? { dismissedAt: p.dismissedAt } : null
  } catch {
    return null
  }
}

export function writeDismissMarker(ccId: string): void {
  try {
    localStorage.setItem(dismissMarkerKey(ccId), JSON.stringify({ dismissedAt: new Date().toISOString() }))
  } catch (e) {
    console.warn('[staleness-hint] dismiss marker write failed', e)
  }
}

export function isDismissalActive(marker: DismissMarker | null, now: number = Date.now()): boolean {
  if (!marker) return false
  const t = Date.parse(marker.dismissedAt)
  if (!Number.isFinite(t)) return false
  return now - t <= DISMISS_SILENCE_MS
}
```

`src/utils/stalenessHint/drift.ts`:

```ts
import { forgeRequest } from '@/utils/requestUtil'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'

/**
 * Drift = number of page versions newer than the diagram's last update.
 * Spike-verified recipe (2026-07-18 findings, Q3): the v2 versions endpoint
 * is sorted newest-first with an opaque _links.next cursor — walk from the
 * front, stop at the first entry at/older than the cutoff, follow next only
 * when a full page is exhausted (drift >= 50, far past the threshold).
 * Observed latency 79-613ms; runs post-render on editor surfaces only.
 * Never throws: any failure counts as drift 0 (hint stays hidden).
 */

export async function countVersionsSince(pageId: string, sinceIso: string): Promise<number> {
  try {
    let url: string | null = `/wiki/api/v2/pages/${pageId}/versions?limit=50`
    let count = 0
    while (url) {
      const data: any = await forgeRequest(url)
      const results: Array<{ createdAt: string }> = data?.results ?? []
      for (const v of results) {
        if (v.createdAt <= sinceIso) return count
        count++
      }
      url = data?._links?.next ?? null
    }
    return count
  } catch (e) {
    console.debug('[staleness-hint] drift fetch failed, treating as 0', e)
    return 0
  }
}

interface DriftCache {
  pageVersion: number
  drift: number
}

function driftCacheKey(pageId: string): string {
  return ['stalenessDrift', encodeURIComponent(getClientDomain() || 'unknown'), encodeURIComponent(pageId)].join(':')
}

/** At most one versions fetch per (pageId, pageVersion) per browser. */
export async function getDrift(pageId: string, pageVersion: number, sinceIso: string): Promise<number> {
  try {
    const raw = localStorage.getItem(driftCacheKey(pageId))
    if (raw) {
      const cached = JSON.parse(raw) as Partial<DriftCache>
      if (cached.pageVersion === pageVersion && typeof cached.drift === 'number') {
        return cached.drift
      }
    }
  } catch {
    // cache is best-effort
  }
  const drift = await countVersionsSince(pageId, sinceIso)
  try {
    localStorage.setItem(driftCacheKey(pageId), JSON.stringify({ pageVersion, drift }))
  } catch {
    // cache is best-effort
  }
  return drift
}
```

`src/utils/stalenessHint/flags.ts` (DI pattern copied from `src/utils/viewerLoad/flags.ts` — read that file first and mirror it):

```ts
import { getContext } from '@/model/globals/forgeGlobal'
import { mapEnvironment } from '@/utils/prefetch/flags'

export const STALENESS_HINT_FLAG = 'editor-staleness-hint-enabled'

type FeatureFlagEnvironment = 'development' | 'staging' | 'production'

interface FlagClient {
  initialize(
    user: {
      attributes?: Record<string, string | number>
      identifiers?: { installContext?: string; accountId?: string }
    },
    config?: { environment: FeatureFlagEnvironment },
  ): Promise<void>
  checkFlag(flagName: string, defaultValue?: boolean): boolean
  shutdown(): void
}

async function defaultCreateClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import('@forge/bridge')
  return new FeatureFlags()
}

/** Fail-closed: standalone env, missing cloudId, missing flag, any error => off. */
export async function isStalenessHintEnabled(deps?: {
  createClient?: () => Promise<FlagClient>
  getForgeContext?: () => Promise<{ cloudId?: string; accountId?: string; environmentType?: string } | undefined>
}): Promise<boolean> {
  let client: FlagClient | undefined
  try {
    const context = await (deps?.getForgeContext ?? getContext)()
    const cloudId = context?.cloudId
    if (!cloudId) return false
    client = await (deps?.createClient ?? defaultCreateClient)()
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${cloudId}` },
        identifiers: { accountId: context?.accountId },
      },
      { environment: mapEnvironment(context?.environmentType) },
    )
    return client.checkFlag(STALENESS_HINT_FLAG, false)
  } catch (e) {
    console.debug('[staleness-hint] flag off: evaluation failed', e)
    return false
  } finally {
    try {
      client?.shutdown()
    } catch {
      // best-effort cleanup
    }
  }
}
```

- [ ] **Step 4: Run to green** — `pnpm test:unit` → new specs pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/utils/stalenessHint/
git commit -m "feat(staleness-hint): surface predicate, dismiss marker, cached drift, fail-closed flag"
```

---

### Task 3: Hint strip DOM module

**Files:**
- Create: `src/utils/stalenessHint/hint.ts`
- Create: `src/utils/stalenessHint/hint.css`
- Test: `src/utils/stalenessHint/hint.spec.ts`

**Interfaces:**
- Consumes: Task 2's `writeDismissMarker`; `trackAnalyticsEvent` from `@/utils/analytics/trackAnalyticsEvent`; Task 1's event names.
- Produces: `mountStalenessHint(opts: MountOpts): void` where

```ts
export interface MountOpts {
  drift: number
  isDiagramAuthor: boolean
  macroType: string
  ccId: string
  onCta: () => void
}
```

- [ ] **Step 1: Write the failing spec**

`src/utils/stalenessHint/hint.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { mountStalenessHint } from './hint'
import { readDismissMarker } from './core'

const baseOpts = () => ({
  drift: 12,
  isDiagramAuthor: false,
  macroType: 'sequence',
  ccId: 'cc-9',
  onCta: vi.fn(),
})

describe('mountStalenessHint', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts strip + ring, tracks shown with props', () => {
    mountStalenessHint(baseOpts())
    expect(document.querySelector('.staleness-hint')).not.toBeNull()
    expect(document.querySelector('.staleness-ring')).not.toBeNull()
    expect(document.querySelector('.staleness-hint')!.textContent).toContain('12')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('staleness_hint_shown', {
      feature_area: 'macro',
      surface: 'editor',
      drift_count: 12,
      is_diagram_author: false,
      macro_type: 'sequence',
    })
  })

  it('non-author copy includes the permission fact; author copy does not', () => {
    mountStalenessHint(baseOpts())
    expect(document.querySelector('.staleness-hint')!.textContent).toContain('edit access')
    document.body.innerHTML = ''
    mountStalenessHint({ ...baseOpts(), isDiagramAuthor: true })
    expect(document.querySelector('.staleness-hint')!.textContent).not.toContain('edit access')
  })

  it('CTA click calls onCta and tracks clicked', () => {
    const opts = baseOpts()
    mountStalenessHint(opts)
    ;(document.querySelector('.staleness-hint__cta') as HTMLButtonElement).click()
    expect(opts.onCta).toHaveBeenCalledTimes(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('staleness_hint_clicked', expect.objectContaining({ drift_count: 12 }))
  })

  it('dismiss removes strip and ring, writes the 30d marker, tracks dismissed', () => {
    mountStalenessHint(baseOpts())
    ;(document.querySelector('.staleness-hint__dismiss') as HTMLButtonElement).click()
    expect(document.querySelector('.staleness-hint')).toBeNull()
    expect(document.querySelector('.staleness-ring')).toBeNull()
    expect(readDismissMarker('cc-9')).not.toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('staleness_hint_dismissed', expect.objectContaining({ drift_count: 12 }))
  })

  it('mounting twice does not duplicate the strip', () => {
    mountStalenessHint(baseOpts())
    mountStalenessHint(baseOpts())
    expect(document.querySelectorAll('.staleness-hint').length).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: Implement**

`src/utils/stalenessHint/hint.css`:

```css
/* Editor staleness hint. The ring is a pointer-events-none overlay ring drawn
   with the padding+mask gradient-ring technique (transparent center — content
   stays fully visible/clickable). Spins ~6s per appearance, then settles
   static; reduced-motion users get static from the start. */
@property --staleness-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
@keyframes staleness-ringspin {
  to { --staleness-angle: 360deg; }
}
.staleness-ring {
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
  border-radius: 6px;
  padding: 2px;
  background: conic-gradient(from var(--staleness-angle),
    #0052CC, #6554C0, #00B8D9, #36B37E, #0052CC);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  animation: staleness-ringspin 3.2s linear infinite;
}
.staleness-ring--settled {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .staleness-ring { animation: none; }
}
.staleness-hint {
  position: fixed;
  top: 2px;
  left: 2px;
  right: 2px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  line-height: 1.5;
  background: #E9F2FF;
  color: #0747A6;
  border-bottom: 1px solid #CFE1FB;
}
.staleness-hint__text { flex: 1; min-width: 0; }
.staleness-hint__cta {
  flex: none;
  font-weight: 600;
  font-size: 12px;
  color: #0052CC;
  background: #FFFFFF;
  border: 1px solid rgba(0, 82, 204, 0.2);
  border-radius: 3px;
  padding: 2px 10px;
  cursor: pointer;
}
.staleness-hint__dismiss {
  flex: none;
  color: #6B778C;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}
```

`src/utils/stalenessHint/hint.ts`:

```ts
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { writeDismissMarker } from './core'
import './hint.css'

/**
 * Vanilla-DOM strip + attention ring, mounted directly on the iframe body so
 * it stays decoupled from the viewer component tree. English product copy —
 * facts and permissions, no persuasion (design decision 2026-07-18).
 */

export interface MountOpts {
  drift: number
  isDiagramAuthor: boolean
  macroType: string
  ccId: string
  onCta: () => void
}

const RING_SETTLE_MS = 6000

export function mountStalenessHint(opts: MountOpts): void {
  if (document.querySelector('.staleness-hint')) return

  const props = {
    feature_area: 'macro' as const,
    surface: 'editor' as const,
    drift_count: opts.drift,
    is_diagram_author: opts.isDiagramAuthor,
    macro_type: opts.macroType as any,
  }

  const ring = document.createElement('div')
  ring.className = 'staleness-ring'

  const strip = document.createElement('div')
  strip.className = 'staleness-hint'

  const text = document.createElement('span')
  text.className = 'staleness-hint__text'
  text.textContent = opts.isDiagramAuthor
    ? `This page has changed ${opts.drift} times since this diagram was last updated — it may need a refresh.`
    : `This page has changed ${opts.drift} times since this diagram was last updated — it may be out of date. Anyone with page edit access can update it.`

  const cta = document.createElement('button')
  cta.className = 'staleness-hint__cta'
  cta.type = 'button'
  cta.textContent = 'Update diagram'
  cta.addEventListener('click', () => {
    trackAnalyticsEvent('staleness_hint_clicked', props)
    opts.onCta()
  })

  const dismiss = document.createElement('button')
  dismiss.className = 'staleness-hint__dismiss'
  dismiss.type = 'button'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.textContent = '✕'
  dismiss.addEventListener('click', () => {
    writeDismissMarker(opts.ccId)
    trackAnalyticsEvent('staleness_hint_dismissed', props)
    strip.remove()
    ring.remove()
  })

  strip.append(text, cta, dismiss)
  document.body.append(ring, strip)

  window.setTimeout(() => ring.classList.add('staleness-ring--settled'), RING_SETTLE_MS)

  trackAnalyticsEvent('staleness_hint_shown', props)
}
```

- [ ] **Step 4: Run to green** (`pnpm test:unit`). If the CSS import trips Vitest, check how existing specs handle CSS imports (Vite handles them natively; Vitest config may need nothing) — if it genuinely fails to resolve, move the CSS injection to a `<style>` tag created in TS and note it in your report.

- [ ] **Step 5: Commit**

```bash
git add src/utils/stalenessHint/hint.ts src/utils/stalenessHint/hint.css src/utils/stalenessHint/hint.spec.ts
git commit -m "feat(staleness-hint): in-macro strip + settling attention ring, English copy variants"
```

---

### Task 4: Decision orchestrator + forgeIndex wiring

**Files:**
- Create: `src/utils/stalenessHint/maybeShowStalenessHint.ts`
- Test: `src/utils/stalenessHint/maybeShowStalenessHint.spec.ts`
- Modify: `src/forgeIndex.ts` (immediately after the snapshot-backfill block inside `if (customContentId) { ... }` — the block that dynamic-imports `@/model/SnapshotAttachment`; follow the same fire-and-forget shape)

**Interfaces:**
- Consumes: everything from Tasks 2-3; `loaded.customContent` fields `id`, `pageId`, `version: {number, createdAt, authorId}` (shape: `src/model/ICustomContentResponseBody.ts:52`); `context` (already in scope in forgeIndex); `context.extension.content.id` (host page id) and `context.extension.content.version` (host page version, spike-verified present); `context.accountId`.
- Produces: `maybeShowStalenessHint(input): Promise<void>` — the single entry forgeIndex calls.

- [ ] **Step 1: Write the failing spec**

`src/utils/stalenessHint/maybeShowStalenessHint.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./flags', () => ({ isStalenessHintEnabled: vi.fn() }))
vi.mock('./drift', () => ({ getDrift: vi.fn() }))
vi.mock('./hint', () => ({ mountStalenessHint: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { isStalenessHintEnabled } from './flags'
import { getDrift } from './drift'
import { mountStalenessHint } from './hint'
import { writeDismissMarker } from './core'
import { maybeShowStalenessHint } from './maybeShowStalenessHint'

const inlineCtx = {
  accountId: 'user-1',
  extension: {
    type: 'macro',
    isEditing: true,
    content: { id: 'page-1', version: 7 },
  },
}

const input = (over: Record<string, unknown> = {}) => ({
  context: inlineCtx,
  macroType: 'sequence',
  ccId: 'cc-1',
  ccLastModified: '2026-07-01T00:00:00Z',
  ccAuthorId: 'author-9',
  onCta: vi.fn(),
  ...over,
})

describe('maybeShowStalenessHint gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
    vi.mocked(isStalenessHintEnabled).mockResolvedValue(true)
    vi.mocked(getDrift).mockResolvedValue(9)
  })

  it('mounts when all gates pass (non-author)', async () => {
    await maybeShowStalenessHint(input())
    expect(mountStalenessHint).toHaveBeenCalledWith(
      expect.objectContaining({ drift: 9, isDiagramAuthor: false, macroType: 'sequence', ccId: 'cc-1' })
    )
  })

  it('detects the diagram author', async () => {
    await maybeShowStalenessHint(input({ ccAuthorId: 'user-1' }))
    expect(mountStalenessHint).toHaveBeenCalledWith(expect.objectContaining({ isDiagramAuthor: true }))
  })

  it('skips: not inline editor surface', async () => {
    await maybeShowStalenessHint(input({ context: { ...inlineCtx, extension: { ...inlineCtx.extension, isEditing: false } } }))
    expect(getDrift).not.toHaveBeenCalled()
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: out-of-scope macro type', async () => {
    await maybeShowStalenessHint(input({ macroType: 'embed' }))
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: flag off (and never fetches drift)', async () => {
    vi.mocked(isStalenessHintEnabled).mockResolvedValue(false)
    await maybeShowStalenessHint(input())
    expect(getDrift).not.toHaveBeenCalled()
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: drift below threshold', async () => {
    vi.mocked(getDrift).mockResolvedValue(4)
    await maybeShowStalenessHint(input())
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: active dismissal', async () => {
    writeDismissMarker('cc-1')
    await maybeShowStalenessHint(input())
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('never throws on internal failure', async () => {
    vi.mocked(isStalenessHintEnabled).mockRejectedValue(new Error('boom'))
    await expect(maybeShowStalenessHint(input())).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: Implement**

`src/utils/stalenessHint/maybeShowStalenessHint.ts`:

```ts
import { DRIFT_THRESHOLD, isDismissalActive, isInlineEditorRender, readDismissMarker } from './core'
import { getDrift } from './drift'
import { isStalenessHintEnabled } from './flags'
import { mountStalenessHint } from './hint'

/** v1 scope: diagram types with a meaningful in-place "update" job. */
const HINT_MACRO_TYPES = new Set(['sequence', 'mermaid', 'plantuml', 'graph'])

export interface StalenessHintInput {
  context: any
  macroType: string
  ccId: string
  ccLastModified: string
  ccAuthorId: string | undefined
  onCta: () => void
}

/**
 * Single decision entry, called fire-and-forget from forgeIndex after the
 * custom content loads. Gate order is cheapest-first; the drift fetch only
 * runs after surface/type/dismissal/flag all pass. Never throws.
 */
export async function maybeShowStalenessHint(input: StalenessHintInput): Promise<void> {
  try {
    if (!isInlineEditorRender(input.context)) return
    if (!HINT_MACRO_TYPES.has(input.macroType)) return
    if (!input.ccId || !input.ccLastModified) return
    if (isDismissalActive(readDismissMarker(input.ccId))) return
    if (!(await isStalenessHintEnabled())) return

    const pageId = input.context?.extension?.content?.id
    const pageVersion = Number(input.context?.extension?.content?.version)
    if (!pageId || !Number.isFinite(pageVersion)) return

    const drift = await getDrift(String(pageId), pageVersion, input.ccLastModified)
    if (drift < DRIFT_THRESHOLD) return

    mountStalenessHint({
      drift,
      isDiagramAuthor: !!input.ccAuthorId && input.ccAuthorId === input.context?.accountId,
      macroType: input.macroType,
      ccId: input.ccId,
      onCta: input.onCta,
    })
  } catch (e) {
    console.debug('[staleness-hint] skipped', e)
  }
}
```

- [ ] **Step 4: forgeIndex wiring** — in `src/forgeIndex.ts`, directly AFTER the snapshot-backfill block (`if (doc && loaded.customContent) { import('@/model/SnapshotAttachment')...}`), add (same guard variables are in scope: `doc`, `loaded`, `customContentId`, `context`):

```ts
      // Editor staleness hint (docs/superpowers/specs/
      // 2026-07-18-job-b-editor-staleness-hint-design.md): on inline
      // page-editor renders only, offer a drift-based "update this diagram"
      // strip. Fire-and-forget like the snapshot backfill above — never on
      // the render critical path, and the module gates itself (surface,
      // type, flag, drift, dismissal) and never throws.
      if (doc && loaded.customContent?.version) {
        import('@/utils/stalenessHint/maybeShowStalenessHint').then(({ maybeShowStalenessHint }) =>
          maybeShowStalenessHint({
            context,
            macroType: diagramType,
            ccId: String(customContentId),
            ccLastModified: loaded.customContent!.version!.createdAt,
            ccAuthorId: loaded.customContent!.version!.authorId,
            onCta: () => {
              import('@forge/bridge').then(({ events }) =>
                events.emit('open-macro-editor', {})
              ).catch(() => window.location.reload())
            },
          })
        ).catch(e => console.debug('[staleness-hint] wiring skipped', e))
      }
```

**IMPORTANT — resolve the two integration facts against the real file, and adapt:**
1. The macro-type variable name at that point in `forgeIndex.ts` (the plan says `diagramType`; the actual const may be named differently, e.g. derived from `moduleKey`/`isSequence`. Find the variable that holds the macro's diagram type string — or derive it from the existing `isSequence`/`isAsyncApi` logic — and pass THAT. If only booleans exist, pass `'sequence'` when `isSequence` and read the type from `doc?.diagramType ?? 'unknown'` otherwise; `Diagram` carries `diagramType` per `src/model/Diagram/Diagram.ts`.)
2. The CTA action: the goal is "open this macro's editor". Search for how the existing UI opens the macro editor from the viewer (e.g. the edit button in the viewer toolbar / `MacroPage.editMacro` selector target — grep `openModal`, `CustomUIModal`, `view.getContext` edit flows in `src/`). Use the SAME mechanism the viewer's own Edit button uses. The `events.emit('open-macro-editor')` line above is a PLACEHOLDER-BY-NECESSITY for that mechanism — replacing it with the real one is part of this task, and your report must name what the real mechanism is. If no programmatic path exists (editor opens only via Confluence's ✏️ toolbar), change the CTA copy to `Update diagram ↗` and make `onCta` a no-op that only tracks, then FLAG THIS LOUDLY in your report — it reopens the spec's display-only fallback question.

- [ ] **Step 5: Full suite green** (`pnpm test:unit`), typecheck relative to origin/main.

- [ ] **Step 6: Commit**

```bash
git add src/utils/stalenessHint/ src/forgeIndex.ts
git commit -m "feat(staleness-hint): decision orchestrator wired into the macro load path"
```

---

### Task 5: Full verification + PR

- [ ] **Step 1:** `pnpm test:unit` — zero failures beyond origin/main's baseline.
- [ ] **Step 2:** `npx eslint src/utils/stalenessHint --ext .ts` (note: the `lint:vue` npm script is broken pre-existing — run eslint directly, compare to origin/main).
- [ ] **Step 3:** Push and open the PR:

```bash
git push -u origin feat/editor-staleness-hint
gh pr create --title "Editor staleness hint — Job B drift-based update affordance (flag-gated)" --body "$(cat <<'EOF'
## Summary
- In-macro hint strip on inline page-editor renders (spike-verified surface signature `isEditing && !modal`), shown when the host page drifted >=5 versions past the diagram's last update
- Rotating-gradient attention ring (settles after 6s; reduced-motion static); English fact-based copy, author/non-author variants
- Drift via /wiki/api/v2 versions walk (newest-first early-stop, cached per page version); dismiss = 30d localStorage silence
- Everything behind NEW Forge flag `editor-staleness-hint-enabled` (fail-closed; flag not yet created in any environment)
- Analytics: staleness_hint_shown / clicked / dismissed with drift_count + is_diagram_author
- Spec: docs/superpowers/specs/2026-07-18-job-b-editor-staleness-hint-design.md
- Spike evidence: docs/superpowers/plans/2026-07-18-job-b-spike-findings.md

## Test plan
- [ ] Unit: core predicates/markers, drift walk + cache, strip DOM, orchestrator gates
- [ ] Post-merge: create flag in Developer Console (staging ON), spot-check on lite-stg editor with the spike fixture pages (158335381 has 55 versions — over threshold by construction)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0145fd39NzSov7tpayu53z4q
EOF
)"
```

- [ ] **Step 4 (post-merge ops, approval-gated, NOT in this plan's execution):** create `editor-staleness-hint-enabled` in the Developer Console for the Lite app (staging env ON, production OFF), spot-check the full chain on lite-stg using spike fixture page `158335381` (55 versions — drift is over threshold by construction), then decide the prod rollout.

---

## Out of scope (deliberately)

- AI-assisted CTA landing (v2 after ⑤/#334; v1 measures the baseline).
- The ✏️-toolbar display-only fallback (spike Q2 proved unnecessary — clicks reach the iframe).
- Growth contract — create via `/growth new` after the flag is ON in prod.
- Any entitlement/paywall coupling.
