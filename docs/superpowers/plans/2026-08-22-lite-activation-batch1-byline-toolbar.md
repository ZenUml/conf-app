# Lite Activation Batch 1 (A): Byline staged rollout + viewer toolbar "New diagram" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first Lite activation batch items T1 (Byline create path: placement telemetry → 10 % cloudId cohort → 100 %) and T8-A (a "New diagram" button on the rendered macro's toolbar that reuses the byline create path and the same rollout cohort).

**Architecture:** One pure cohort function (`isInRolloutCohort`) is consumed by both the hourly byline-visibility sweep (backend Forge trigger) and the viewer iframe, so both surfaces enrol exactly the same sites. The byline's create → mint typed deeplink → open page editor sequence is extracted into a composable that the viewer toolbar reuses. Placement of a pasted typed deeplink (`/d/<type>/<cloudId>/<contentId>`) gains its own outcome events so the autoConvert success rate becomes measurable in Mixpanel.

**Tech Stack:** Vue 3 (Options API in `GenericViewer.vue`, `<script setup>` in byline), TypeScript, vitest (`pnpm test:unit`), Playwright E2E under `tests/e2e-tests/` (`APP=zenuml-lite@stg`), `@forge/bridge` (`Modal`, `router`), Mixpanel via `trackAnalyticsEvent`.

**Spec:** `docs/analysis/2026-08-22-lite-activation-priority/README.md` — sections "决策记录" (decisions 5, 10, 11) and "Go / no-go".

## Global Constraints

- Lite only. The toolbar button and the cohort gate compile out of Full/Diagramly/AsyncAPI via `import.meta.env.PRODUCT_TYPE === 'lite'` (Vite `define`, `vite.config.mjs:91`).
- No new Forge feature flag (Lite is at the 10-flag cap — `.claude/skills/forge-feature-flag/SKILL.md:63`). Rollout is the cohort constant `LITE_ACTIVATION_ROLLOUT_PERCENT`.
- Analytics first: new event names land in `src/utils/analytics/catalog.ts` + `src/utils/analytics/types.ts` as the first commit (project rule "Plan Mixpanel events before implementing any feature").
- Real tenant names never enter public files (`docs/policies/client-privacy.md`).
- Stage 1 ships at `LITE_ACTIVATION_ROLLOUT_PERCENT = 10`; stage 2 (a separate one-line PR) sets `100` only after the 14-day readout passes (paste-placement failure rate ≤ 10 %, no blank-render reports).
- Every commit compiles (`pnpm build:lite`) and passes `pnpm test:unit`. The typecheck baseline is red (~150 pre-existing errors); compare `pnpm exec tsc --noEmit` error counts against `main`, do not require zero.
- Commit subjects: one line, explain why. Never `--no-verify`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/utils/analytics/catalog.ts`, `types.ts` | New event names + `autoconvert` entry point (Task 1) |
| `src/utils/deeplinkPlacement.ts` (+ `.spec.ts`) | Pure classifier: pasted typed link → `resolved` / `cross_tenant` / `invalid_url` / `target_missing` (Task 2) |
| `src/forgeIndex.ts` | Emit placement outcome once per editor/viewer boot; stamp `entry_point: 'autoconvert'` on `macro_create_started` for link-seeded macros (Task 2) |
| `src/utils/rolloutCohort.ts` (+ `.spec.ts`) | `isInRolloutCohort(cloudId, percent)` + `LITE_ACTIVATION_ROLLOUT_PERCENT` (Task 3) |
| `src/byline-visibility.ts` (+ `.spec.ts`) | `decide()` enrols allowlist OR cohort (Task 3) |
| `src/utils/byline/createdDiagram.ts` (+ `.spec.ts`) | Pure helpers extracted from `BylineDiagrams.vue`: `findNewDiagramId`, `mintCreatedLink` (Task 4) |
| `src/composables/useCreateDiagramFlow.ts` (+ `.spec.ts`) | Open editor modal → diff page diagrams → mint link → open page editor (Task 4) |
| `src/components/Byline/BylineDiagrams.vue` | Use the extracted helpers (behaviour unchanged) (Task 4) |
| `src/components/Viewer/CreatedDiagramNotice.vue` | Post-create notice: copy link / open page editor (Task 5) |
| `src/components/Viewer/GenericViewer.vue` (+ `.spec.ts`) | "New diagram" toolbar button, cohort-gated (Task 5) |
| `tests/e2e-tests/tests/insert/toolbar-create.spec.ts`, `tests/e2e-tests/helpers/toolbarCreate.ts` | E2E on lite-stg (Task 6) |
| `docs/analysis/2026-08-22-lite-activation-priority/readout-t1-stage1.js` | 14-day readout JQL (Task 7) |

---

### Task 1: Analytics vocabulary (first commit)

**Files:**
- Modify: `src/utils/analytics/catalog.ts:71-82` (`EntryPoint` union) and the `AnalyticsEventName` union near the `byline_*` block (`catalog.ts:388-430`)
- Modify: `src/utils/analytics/types.ts` (`AnalyticsProperties`)
- Test: `src/utils/analytics/eventVocabulary.spec.ts` (new)

**Interfaces:**
- Produces event names used by later tasks: `deeplink_placement_resolved`, `deeplink_placement_failed`, `viewer_create_clicked`, `viewer_diagram_created`, `viewer_editor_deeplinked`.
- Produces `EntryPoint` member `"autoconvert"`.
- Produces property `placement_result?: 'resolved' | 'cross_tenant' | 'invalid_url' | 'target_missing'`.

- [ ] **Step 1: Write the failing test**

`AnalyticsEventName` is a TypeScript union with no runtime array, so vitest cannot assert membership. The test below pins the *documented* vocabulary in `docs/analytics/events-catalog.md` instead, which is where readers look:

```ts
// src/utils/analytics/eventVocabulary.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG_TS = readFileSync(resolve(HERE, 'catalog.ts'), 'utf8')
const CATALOG_MD = readFileSync(resolve(HERE, '../../../docs/analytics/events-catalog.md'), 'utf8')

const NEW_EVENTS = [
  'deeplink_placement_resolved',
  'deeplink_placement_failed',
  'viewer_create_clicked',
  'viewer_diagram_created',
  'viewer_editor_deeplinked',
]

describe('Lite activation batch 1 event vocabulary', () => {
  for (const name of NEW_EVENTS) {
    it(`declares ${name} in catalog.ts and documents it`, () => {
      expect(CATALOG_TS).toContain(`| "${name}"`)
      expect(CATALOG_MD).toContain(name)
    })
  }
  it('declares the autoconvert entry point', () => {
    expect(CATALOG_TS).toMatch(/export type EntryPoint =[\s\S]*\| "autoconvert"/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/utils/analytics/eventVocabulary.spec.ts`
Expected: FAIL — `expected '...' to contain '| "deeplink_placement_resolved"'`

- [ ] **Step 3: Add the names and the entry point**

In `src/utils/analytics/catalog.ts`, extend `EntryPoint` (line 71-82):

```ts
export type EntryPoint =
  | "page_view"
  | "macro_toolbar"
  | "page_editor"
  | "get_started"
  | "viewer_notice"
  | "ai_prompt"
  | "dashboard"
  | "route"
  | "forge_trigger"
  | "byline"
  // The macro was produced by pasting a confluence.zenuml.com/new/<type> or
  // /d/<type>/<cloudId>/<contentId> link that Confluence autoConvert turned into
  // this macro (src/utils/newDiagramLink.ts, src/utils/embedDeeplink.ts). Lets
  // the paste-to-place funnel be separated from insert-menu creates.
  | "autoconvert"
  | "unknown";
```

Add to the `AnalyticsEventName` union, directly after `| "byline_view_close_requested"`:

```ts
  // Placement of a pasted TYPED deeplink (/d/<type>/<cloudId>/<contentId>) —
  // the other half of the byline/toolbar create→paste handoff. Fires once per
  // macro boot that carries `autoConvertLink` of the typed form; exactly one of
  // resolved / failed. `placement_result` says why a failure failed
  // (cross_tenant | invalid_url | target_missing). Mirrors the embed macro's
  // embed_autoconvert_* family, which covers only the 3-segment /d/ form.
  | "deeplink_placement_resolved"
  | "deeplink_placement_failed"
  // Viewer-toolbar "New diagram" (Lite activation batch 1, T8-A). Same funnel
  // shape as byline_create_clicked → byline_diagram_created →
  // byline_editor_deeplinked so the two entry points compare directly; every
  // event carries entry_point: 'macro_toolbar'.
  | "viewer_create_clicked"
  | "viewer_diagram_created"
  | "viewer_editor_deeplinked"
```

In `src/utils/analytics/types.ts`, inside `AnalyticsProperties` next to `failure_reason`:

```ts
  // deeplink_placement_failed: why a pasted typed link did not resolve.
  placement_result?: 'resolved' | 'cross_tenant' | 'invalid_url' | 'target_missing';
```

Document the five names in `docs/analytics/events-catalog.md` in the byline section (one row each: name, trigger, key props).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/utils/analytics/eventVocabulary.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts src/utils/analytics/eventVocabulary.spec.ts docs/analytics/events-catalog.md
git commit -m "analytics: name the paste-placement and toolbar-create events before building either surface"
```

---

### Task 2: Placement outcome telemetry + `autoconvert` entry point

**Files:**
- Create: `src/utils/deeplinkPlacement.ts`
- Test: `src/utils/deeplinkPlacement.spec.ts`
- Modify: `src/forgeIndex.ts:886` (before the seeding block) and `:977-985` (`macro_create_started`)

**Interfaces:**
- Consumes: `parseDiagramDeeplink(link)` from `src/utils/embedDeeplink.ts:133` (returns `{type, cloudId, contentId} | undefined`), `readAutoConvertLink(context)` from `src/utils/newDiagramLink.ts:85`.
- Produces: `classifyPlacement(link: unknown, currentCloudId: string | undefined, loadedContentId: string | undefined): PlacementOutcome | undefined` where `type PlacementOutcome = 'resolved' | 'cross_tenant' | 'invalid_url' | 'target_missing'`; returns `undefined` when the link is not a typed `/d/` link at all (nothing to report).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/deeplinkPlacement.spec.ts
import { describe, it, expect } from 'vitest'
import { classifyPlacement } from './deeplinkPlacement'

const CLOUD = 'c78e721e-957f-402c-9b70-1df2227c2739'
const LINK = `https://confluence.zenuml.com/d/mermaid/${CLOUD}/123456`

describe('classifyPlacement', () => {
  it('returns undefined when there is no autoConvert link', () => {
    expect(classifyPlacement(undefined, CLOUD, undefined)).toBeUndefined()
  })
  it('returns undefined for a /new/<type> link (empty-diagram seed, not a placement)', () => {
    expect(classifyPlacement('https://confluence.zenuml.com/new/mermaid', CLOUD, undefined)).toBeUndefined()
  })
  it('is resolved when the loaded content id equals the link target', () => {
    expect(classifyPlacement(LINK, CLOUD, '123456')).toBe('resolved')
  })
  it('is cross_tenant when the link cloudId differs from the current site', () => {
    expect(classifyPlacement(LINK, '866c3a03-ec62-4717-91c4-1ad078bfcc60', undefined)).toBe('cross_tenant')
  })
  it('is invalid_url when the host path matches /d/ but the shape does not parse', () => {
    expect(classifyPlacement('https://confluence.zenuml.com/d/mermaid/not-a-cloud/abc', CLOUD, undefined)).toBe('invalid_url')
  })
  it('is target_missing when the link parses locally but nothing loaded', () => {
    expect(classifyPlacement(LINK, CLOUD, undefined)).toBe('target_missing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/utils/deeplinkPlacement.spec.ts`
Expected: FAIL — `Cannot find module './deeplinkPlacement'`

- [ ] **Step 3: Implement the classifier**

```ts
// src/utils/deeplinkPlacement.ts
import { parseDiagramDeeplink } from '@/utils/embedDeeplink'

export type PlacementOutcome = 'resolved' | 'cross_tenant' | 'invalid_url' | 'target_missing'

const TYPED_PATH_RE = /^https:\/\/(?:confluence|conf-lite|conf-full)\.zenuml\.com\/d\/[a-z]+\//i

/**
 * Outcome of placing a pasted typed deeplink. `undefined` = the macro did not
 * come from a typed /d/ link, so there is nothing to report. Pure; the caller
 * (forgeIndex) supplies what it already knows — the link from context and the
 * content id it managed to load.
 */
export function classifyPlacement(
  link: unknown,
  currentCloudId: string | undefined,
  loadedContentId: string | undefined,
): PlacementOutcome | undefined {
  if (typeof link !== 'string' || !TYPED_PATH_RE.test(link.trim())) return undefined
  const parsed = parseDiagramDeeplink(link)
  if (!parsed) return 'invalid_url'
  if (!currentCloudId || parsed.cloudId !== String(currentCloudId).toLowerCase()) return 'cross_tenant'
  if (loadedContentId && String(loadedContentId) === parsed.contentId) return 'resolved'
  return 'target_missing'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/utils/deeplinkPlacement.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Emit from forgeIndex**

In `src/forgeIndex.ts`, add the import next to the existing `newDiagramLink` import (line 51):

```ts
import { classifyPlacement } from '@/utils/deeplinkPlacement';
```

Immediately **before** the seeding block at line 886 (`{ const seeded = applyNewDiagramLink(...)`), where `context`, `customContentId` and `doc` are in scope:

```ts
    // Paste-to-place readout (Lite activation batch 1). One event per boot of a
    // macro that carries a typed /d/ link; the pure classifier decides which.
    {
      const placement = classifyPlacement(readAutoConvertLink(context), context?.cloudId, customContentId);
      if (placement) {
        const { toMacroType } = await import('@/utils/byline/pageDiagrams');
        trackAnalyticsEvent(placement === 'resolved' ? 'deeplink_placement_resolved' : 'deeplink_placement_failed', {
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: doc?.diagramType ? toMacroType(String(doc.diagramType)) : 'unknown',
          placement_result: placement,
        });
      }
    }
```

Then change the `macro_create_started` call at lines 977-985 so a link-seeded macro reports its real entry point:

```ts
        if (isNew) {
          trackAnalyticsEvent("macro_create_started", {
            feature_area: "macro",
            surface: "editor",
            macro_type: macroType,
            entry_point: readAutoConvertLink(context) ? "autoconvert" : "page_editor",
          });
        }
```

- [ ] **Step 6: Build and run the unit suite**

Run: `pnpm build:lite && pnpm test:unit`
Expected: build succeeds; all tests pass (the forgeIndex change has no unit test — it is covered by Task 6's E2E and the spot check in Task 7).

- [ ] **Step 7: Commit**

```bash
git add src/utils/deeplinkPlacement.ts src/utils/deeplinkPlacement.spec.ts src/forgeIndex.ts
git commit -m "analytics: report typed-deeplink placement outcome so the paste-to-place success rate is measurable"
```

---

### Task 3: Rollout cohort shared by the byline sweep and the viewer

**Files:**
- Create: `src/utils/rolloutCohort.ts`
- Test: `src/utils/rolloutCohort.spec.ts`
- Modify: `src/byline-visibility.ts:174-215` (`ALLOWLIST`, `decide`)
- Modify: `src/byline-visibility.spec.ts:76-121`

**Interfaces:**
- Produces: `export const LITE_ACTIVATION_ROLLOUT_PERCENT = 10`, `export const INTERNAL_ALLOWLIST: ReadonlyMap<string, string>` (moved here from `byline-visibility.ts`, re-exported there as `ALLOWLIST` so its spec keeps passing), `export function cohortBucket(cloudId: string): number` (0–99), `export function isInRolloutCohort(cloudId: string | undefined, percent: number): boolean`, and **`export function isActivationEnrolled(cloudId: string | undefined): boolean`** = allowlisted OR in cohort — the ONE switch both the byline sweep and the viewer consume (decision 5: same rollout switch; also makes lite-stg, which is allowlisted, deterministic for E2E).
- `decide(cloudId)` in `byline-visibility.ts` gains a new `VisibilityReason` value `'cohort'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/rolloutCohort.spec.ts
import { describe, it, expect } from 'vitest'
import { cohortBucket, isInRolloutCohort, LITE_ACTIVATION_ROLLOUT_PERCENT } from './rolloutCohort'

describe('rollout cohort', () => {
  it('buckets a cloudId deterministically into 0..99', () => {
    const a = cohortBucket('c78e721e-957f-402c-9b70-1df2227c2739')
    expect(a).toBe(cohortBucket('C78E721E-957F-402C-9B70-1DF2227C2739')) // case-insensitive
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(100)
  })
  it('spreads 10,000 synthetic ids to within ±2 points of the requested percent', () => {
    let hit = 0
    for (let i = 0; i < 10_000; i++) if (isInRolloutCohort(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 10)) hit++
    expect(hit / 10_000).toBeGreaterThan(0.08)
    expect(hit / 10_000).toBeLessThan(0.12)
  })
  it('is monotonic: every id in the 10 % cohort is also in the 100 % cohort', () => {
    for (let i = 0; i < 500; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      if (isInRolloutCohort(id, 10)) expect(isInRolloutCohort(id, 100)).toBe(true)
    }
  })
  it('never enrols a missing id, and 0 % enrols nobody', () => {
    expect(isInRolloutCohort(undefined, 100)).toBe(false)
    expect(isInRolloutCohort('', 100)).toBe(false)
    expect(isInRolloutCohort('c78e721e-957f-402c-9b70-1df2227c2739', 0)).toBe(false)
  })
  it('ships stage 1 at 10 %', () => {
    expect(LITE_ACTIVATION_ROLLOUT_PERCENT).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/utils/rolloutCohort.spec.ts`
Expected: FAIL — `Cannot find module './rolloutCohort'`

- [ ] **Step 3: Implement**

```ts
// src/utils/rolloutCohort.ts
/**
 * Deterministic percentage rollout keyed on cloudId. Pure, dependency-free, no
 * DOM: the same module runs in the Forge scheduled trigger
 * (src/byline-visibility.ts) and in the viewer iframe
 * (src/components/Viewer/GenericViewer.vue), so both enrol exactly the same
 * sites. Raising the percent keeps every previously enrolled site enrolled
 * (bucket < percent is monotonic).
 *
 * Stage plan (docs/analysis/2026-08-22-lite-activation-priority/README.md,
 * decision 11): 10 for 14 days, then 100 — a one-line change here.
 */
export const LITE_ACTIVATION_ROLLOUT_PERCENT = 10

/** FNV-1a 32-bit over the lower-cased id, reduced to 0..99. */
export function cohortBucket(cloudId: string): number {
  let h = 0x811c9dc5
  const s = cloudId.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 100
}

export function isInRolloutCohort(cloudId: string | undefined, percent: number): boolean {
  if (!cloudId) return false
  if (percent <= 0) return false
  if (percent >= 100) return true
  return cohortBucket(cloudId) < percent
}

/** Our own sites, always enrolled (moved from src/byline-visibility.ts). Two UUID literals, no runtime deps. */
export const INTERNAL_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ['c78e721e-957f-402c-9b70-1df2227c2739', 'lite-stg.atlassian.net'],
  ['866c3a03-ec62-4717-91c4-1ad078bfcc60', 'whimet4.atlassian.net'],
])

/** The single rollout switch for Lite activation batch 1 (byline sweep AND viewer toolbar). */
export function isActivationEnrolled(cloudId: string | undefined): boolean {
  if (!cloudId) return false
  return INTERNAL_ALLOWLIST.has(cloudId) || isInRolloutCohort(cloudId, LITE_ACTIVATION_ROLLOUT_PERCENT)
}
```

Add to the spec: `it('always enrols the internal allowlist', () => { expect(isActivationEnrolled('c78e721e-957f-402c-9b70-1df2227c2739')).toBe(true) })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/utils/rolloutCohort.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing byline-visibility test**

Append to `src/byline-visibility.spec.ts` inside `describe('decide', ...)`:

```ts
  it('enrols a site that is in the rollout cohort even when it is not on the allowlist', () => {
    // Find a synthetic id that lands in the 10 % cohort.
    let id = ''
    for (let i = 0; i < 1000 && !id; i++) {
      const candidate = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      if (isInRolloutCohort(candidate, LITE_ACTIVATION_ROLLOUT_PERCENT)) id = candidate
    }
    const d = decide(id)
    expect(d.value).toBe(VISIBLE)
    expect(d.decision).toBe('visible')
    expect(d.reason).toBe('cohort')
  });
  it('still suppresses a site outside both the allowlist and the cohort', () => {
    let id = ''
    for (let i = 0; i < 1000 && !id; i++) {
      const candidate = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      if (!isInRolloutCohort(candidate, LITE_ACTIVATION_ROLLOUT_PERCENT)) id = candidate
    }
    const d = decide(id)
    expect(d.value).toBe(HIDDEN)
    expect(d.reason).toBe('not_enrolled')
  });
```

Add the import at the top of the spec: `import { isInRolloutCohort, LITE_ACTIVATION_ROLLOUT_PERCENT } from '@/utils/rolloutCohort'`.

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest --run src/byline-visibility.spec.ts`
Expected: FAIL — `expected 'not_enrolled' to be 'cohort'`

- [ ] **Step 7: Make `decide()` consult the cohort**

In `src/byline-visibility.ts`: add `'cohort'` to the `VisibilityReason` union (line 151); import the cohort module; change `decide()` (lines 206-215) so an allowlist miss falls through to the cohort:

```ts
import { INTERNAL_ALLOWLIST, isActivationEnrolled } from './utils/rolloutCohort';

/** Kept as a named export for the existing spec and the key-consistency test. */
export const ALLOWLIST = INTERNAL_ALLOWLIST;

export function decide(cloudId: string | undefined): Decision {
  if (!cloudId) return { value: HIDDEN, decision: 'suppressed', reason: 'no_signal' };
  const site = ALLOWLIST.get(cloudId);
  if (site) return { value: VISIBLE, decision: 'visible', reason: 'enrolled', site };
  if (isActivationEnrolled(cloudId)) return { value: VISIBLE, decision: 'visible', reason: 'cohort' };
  return { value: HIDDEN, decision: 'suppressed', reason: 'not_enrolled' };
}
```

Delete the old `ALLOWLIST = new Map([...])` literal from `byline-visibility.ts` (lines 174-177) — the map now lives in `rolloutCohort.ts`. The relative import (`./utils/rolloutCohort`) avoids relying on the `@/` alias in the Forge function bundle.

Keep the existing `'keeps the allowlist to our own sites'` test unchanged — the allowlist stays internal-only; the cohort is the customer rollout. Update the file-header comment "SCOPE" paragraph (lines 27-31) to say: allowlist = own sites; customer rollout = `LITE_ACTIVATION_ROLLOUT_PERCENT` cohort.

Check the Forge bundler resolves the `@/` alias for trigger code: `grep -n "alias\|@/" tsconfig.json` and compare with how `src/byline-visibility.ts` already imports `./space-properties`. If the trigger build does not resolve `@/`, use the relative import `./utils/rolloutCohort` in `byline-visibility.ts`.

- [ ] **Step 8: Run all related tests**

Run: `pnpm vitest --run src/byline-visibility.spec.ts src/utils/rolloutCohort.spec.ts tests/unit/bylineKeyConsistency.spec.ts`
Expected: PASS

- [ ] **Step 9: Build the Forge function bundle to prove the trigger compiles**

Run: `pnpm build:lite && pnpm exec forge lint 2>&1 | tail -5`
Expected: build succeeds; `forge lint` reports no new error (a pre-existing swagger lint flake is Atlassian-side — re-run once if it appears, per memory).

- [ ] **Step 10: Commit**

```bash
git add src/utils/rolloutCohort.ts src/utils/rolloutCohort.spec.ts src/byline-visibility.ts src/byline-visibility.spec.ts
git commit -m "byline: enrol a deterministic 10% cloudId cohort beside the internal allowlist so the first customer rollout is measurable and reversible"
```

---

### Task 4: Extract the create→link→open-editor flow into a composable

**Files:**
- Create: `src/utils/byline/createdDiagram.ts`, `src/utils/byline/createdDiagram.spec.ts`
- Create: `src/composables/useCreateDiagramFlow.ts`, `src/composables/useCreateDiagramFlow.spec.ts`
- Modify: `src/components/Byline/BylineDiagrams.vue:985-1014` (`afterEditorClosed`) — replace the inline diff + mint with the helpers

**Interfaces:**
- Consumes: `openModal(options)` from `src/model/globals/forgeGlobal.ts:220`; `globals.apWrapper.listPageDiagramContents(pageId)` and `globals.apWrapper._getCurrentPageId()` (used at `BylineDiagrams.vue:623-627`); `parsePageDiagrams(responses): PageDiagram[]`, `toMacroType`, `toModalDiagramType` from `src/utils/byline/pageDiagrams.ts`; `buildDiagramDeeplink(type, cloudId, contentId)` from `src/utils/embedDeeplink.ts:123`; `getSpaceKey()`/`NO_SPACE_CONTEXT` from `src/utils/ContextParameters/ContextParameters.ts:39-48`.
- Produces:
  - `findNewDiagramId(before: string[], after: PageDiagram[]): string | undefined`
  - `mintCreatedLink(created: PageDiagram | undefined, cloudId: string | undefined): { link?: string; result: 'linked' | 'unlinkable_type' | 'no_cloud_id' }`
  - `useCreateDiagramFlow(): { createDiagram(opts: { diagramType: string; origin: string }): Promise<CreateOutcome>; openPageEditorToPaste(pageId: string): Promise<'navigated' | 'no_space_context' | 'failed'> }` with `type CreateOutcome = { createdId?: string; link?: string; result: 'linked' | 'unlinkable_type' | 'no_cloud_id' | 'nothing_created' | 'listing_failed' }`.

- [ ] **Step 1: Write the failing helper tests**

```ts
// src/utils/byline/createdDiagram.spec.ts
import { describe, it, expect } from 'vitest'
import { findNewDiagramId, mintCreatedLink } from './createdDiagram'
import type { PageDiagram } from './pageDiagrams'

const CLOUD = 'c78e721e-957f-402c-9b70-1df2227c2739'
const d = (id: string, diagramType = 'mermaid'): PageDiagram => ({ id, diagramType, title: 't' } as PageDiagram)

describe('findNewDiagramId', () => {
  it('returns the one id present after but not before', () => {
    expect(findNewDiagramId(['1', '2'], [d('1'), d('2'), d('3')])).toBe('3')
  })
  it('returns undefined when nothing new appeared', () => {
    expect(findNewDiagramId(['1'], [d('1')])).toBeUndefined()
  })
})

describe('mintCreatedLink', () => {
  it('mints a typed deeplink for a known type', () => {
    expect(mintCreatedLink(d('3'), CLOUD)).toEqual({ link: `https://confluence.zenuml.com/d/mermaid/${CLOUD}/3`, result: 'linked' })
  })
  it('reports no_cloud_id when the site id is missing', () => {
    expect(mintCreatedLink(d('3'), undefined).result).toBe('no_cloud_id')
  })
  it('reports unlinkable_type when the stored type is outside the deeplink set', () => {
    expect(mintCreatedLink(d('3', 'asyncapi'), CLOUD).result).toBe('unlinkable_type')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest --run src/utils/byline/createdDiagram.spec.ts`
Expected: FAIL — `Cannot find module './createdDiagram'`

- [ ] **Step 3: Implement the helpers**

```ts
// src/utils/byline/createdDiagram.ts
import { buildDiagramDeeplink } from '@/utils/embedDeeplink'
import { toMacroType, type PageDiagram } from './pageDiagrams'

export function findNewDiagramId(before: string[], after: PageDiagram[]): string | undefined {
  const seen = new Set(before)
  return after.find(x => !seen.has(x.id))?.id
}

export type MintResult = 'linked' | 'unlinkable_type' | 'no_cloud_id'

/**
 * Typed link only. The 3-segment embed form pastes as a READ-ONLY embed, not
 * the editable macro the create path promises (see BylineDiagrams.vue history).
 */
export function mintCreatedLink(
  created: PageDiagram | undefined,
  cloudId: string | undefined,
): { link?: string; result: MintResult } {
  if (!created) return { result: cloudId ? 'unlinkable_type' : 'no_cloud_id' }
  const link = buildDiagramDeeplink(toMacroType(created.diagramType || ''), cloudId || '', created.id)
  if (link) return { link, result: 'linked' }
  return { result: cloudId ? 'unlinkable_type' : 'no_cloud_id' }
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm vitest --run src/utils/byline/createdDiagram.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing composable test**

```ts
// src/composables/useCreateDiagramFlow.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const openModal = vi.fn()
const navigate = vi.fn()
const listPageDiagramContents = vi.fn()
const getCurrentPageId = vi.fn()
let spaceKey = 'ENG'

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { cloudId: 'c78e721e-957f-402c-9b70-1df2227c2739' } },
  openModal: (o: any) => openModal(o),
}))
vi.mock('@forge/bridge', () => ({ router: { navigate: (u: string) => navigate(u) } }))
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { listPageDiagramContents: (id: string) => listPageDiagramContents(id), _getCurrentPageId: () => getCurrentPageId() } },
}))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({ getSpaceKey: () => spaceKey, NO_SPACE_CONTEXT: 'no_space_context' }))
vi.mock('@/utils/byline/pageDiagrams', async (orig) => ({
  ...(await orig<typeof import('@/utils/byline/pageDiagrams')>()),
  parsePageDiagrams: (r: any[]) => r,
}))

import { useCreateDiagramFlow } from './useCreateDiagramFlow'

beforeEach(() => { vi.clearAllMocks(); spaceKey = 'ENG' })

describe('useCreateDiagramFlow.createDiagram', () => {
  it('opens the editor modal for the type, waits for close, and mints the link to the new diagram', async () => {
    getCurrentPageId.mockResolvedValue('42')
    listPageDiagramContents
      .mockResolvedValueOnce([{ id: '1', diagramType: 'mermaid' }])
      .mockResolvedValueOnce([{ id: '1', diagramType: 'mermaid' }, { id: '7', diagramType: 'mermaid' }])
    openModal.mockImplementation(async (o: any) => { o.onClose() })
    const flow = useCreateDiagramFlow()
    const out = await flow.createDiagram({ diagramType: 'mermaid', origin: 'macro_toolbar' })
    expect(openModal).toHaveBeenCalledWith(expect.objectContaining({ size: 'fullscreen', context: expect.objectContaining({ macroMode: 'editor', origin: 'macro_toolbar' }) }))
    expect(out).toEqual({ createdId: '7', link: 'https://confluence.zenuml.com/d/mermaid/c78e721e-957f-402c-9b70-1df2227c2739/7', result: 'linked' })
  })
  it('reports nothing_created when the editor closed without a new diagram', async () => {
    getCurrentPageId.mockResolvedValue('42')
    listPageDiagramContents.mockResolvedValue([{ id: '1', diagramType: 'mermaid' }])
    openModal.mockImplementation(async (o: any) => { o.onClose() })
    const out = await useCreateDiagramFlow().createDiagram({ diagramType: 'mermaid', origin: 'macro_toolbar' })
    expect(out.result).toBe('nothing_created')
  })
})

describe('useCreateDiagramFlow.openPageEditorToPaste', () => {
  it('navigates to the page editor for the current space', async () => {
    const r = await useCreateDiagramFlow().openPageEditorToPaste('42')
    expect(navigate).toHaveBeenCalledWith('/wiki/spaces/ENG/pages/edit-v2/42')
    expect(r).toBe('navigated')
  })
  it('refuses to navigate without a space key (the sentinel is not a key)', async () => {
    spaceKey = 'no_space_context'
    const r = await useCreateDiagramFlow().openPageEditorToPaste('42')
    expect(navigate).not.toHaveBeenCalled()
    expect(r).toBe('no_space_context')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest --run src/composables/useCreateDiagramFlow.spec.ts`
Expected: FAIL — `Cannot find module './useCreateDiagramFlow'`

- [ ] **Step 7: Implement the composable**

```ts
// src/composables/useCreateDiagramFlow.ts
import globals from '@/model/globals'
import forgeGlobal, { openModal } from '@/model/globals/forgeGlobal'
import { parsePageDiagrams, toModalDiagramType } from '@/utils/byline/pageDiagrams'
import { findNewDiagramId, mintCreatedLink, type MintResult } from '@/utils/byline/createdDiagram'
import { getSpaceKey, NO_SPACE_CONTEXT } from '@/utils/ContextParameters/ContextParameters'

export type CreateOutcome = {
  createdId?: string
  link?: string
  result: MintResult | 'nothing_created' | 'listing_failed'
}

/**
 * The byline's create path, reusable from any surface that cannot insert a
 * macro itself (byline modal, viewer toolbar): open the ordinary editor as a
 * Forge modal, detect the diagram it saved by diffing the page's diagram list,
 * and mint the typed deeplink the user pastes to place it. No analytics here —
 * each caller owns its own funnel names (byline_* vs viewer_*).
 */
export function useCreateDiagramFlow() {
  async function listIds(pageId: string) {
    const responses = await globals.apWrapper.listPageDiagramContents(pageId)
    return parsePageDiagrams(responses)
  }

  async function createDiagram(opts: { diagramType: string; origin: string }): Promise<CreateOutcome> {
    const pageId = await globals.apWrapper._getCurrentPageId()
    let before: string[]
    try {
      before = (await listIds(pageId)).map(d => d.id)
    } catch {
      return { result: 'listing_failed' }
    }
    await new Promise<void>(resolve => {
      openModal({
        resource: 'main',
        size: 'fullscreen',
        context: { macroMode: 'editor', diagramType: toModalDiagramType(opts.diagramType), origin: opts.origin },
        onClose: () => resolve(),
      })
    })
    let after
    try {
      after = await listIds(pageId)
    } catch {
      return { result: 'listing_failed' }
    }
    const newId = findNewDiagramId(before, after)
    if (!newId) return { result: 'nothing_created' }
    const created = after.find(d => d.id === newId)
    const minted = mintCreatedLink(created, forgeGlobal.forgeContext?.cloudId)
    return { createdId: newId, link: minted.link, result: minted.result }
  }

  async function openPageEditorToPaste(pageId: string): Promise<'navigated' | 'no_space_context' | 'failed'> {
    const spaceKey = getSpaceKey()
    if (!spaceKey || spaceKey === NO_SPACE_CONTEXT) return 'no_space_context'
    try {
      const { router } = await import('@forge/bridge')
      await router.navigate(`/wiki/spaces/${spaceKey}/pages/edit-v2/${pageId}`)
      return 'navigated'
    } catch (e) {
      console.error('[create-flow] editor navigation failed', e)
      return 'failed'
    }
  }

  return { createDiagram, openPageEditorToPaste }
}
```

Check `openModal`'s `onClose` reaches the `Modal` constructor: `src/model/globals/forgeGlobal.ts:220-224` passes `_options` straight to `new Modal(_options)`, and `BylineDiagrams.vue:901-911` already relies on `onClose` — so the shape matches.

- [ ] **Step 8: Run composable tests**

Run: `pnpm vitest --run src/composables/useCreateDiagramFlow.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Point the byline at the shared helpers (no behaviour change)**

In `src/components/Byline/BylineDiagrams.vue` `afterEditorClosed()` (lines ~957-1014): replace the inline `after.find(...)`/`buildDiagramDeeplink(...)` pair with

```ts
    const created = after.find(d => d.id === newId)
    const minted = mintCreatedLink(created, forgeGlobal.forgeContext?.cloudId)
    const link = minted.link
    trackAnalyticsEvent('byline_diagram_created', {
      ...baseProps(),
      macro_type: macroType,
      custom_content_id: String(newId),
      result: minted.result,
    })
```

and, where `newId` is derived from `before`/`after`, use `findNewDiagramId(before, after)`. Add `import { findNewDiagramId, mintCreatedLink } from '@/utils/byline/createdDiagram'`; remove the now-unused `buildDiagramDeeplink` import if nothing else in the file uses it (`grep -n buildDiagramDeeplink src/components/Byline/BylineDiagrams.vue`).

- [ ] **Step 10: Run the byline unit tests and the build**

Run: `pnpm vitest --run src/components/Byline && pnpm build:lite`
Expected: PASS; build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/utils/byline/createdDiagram.ts src/utils/byline/createdDiagram.spec.ts src/composables/useCreateDiagramFlow.ts src/composables/useCreateDiagramFlow.spec.ts src/components/Byline/BylineDiagrams.vue
git commit -m "byline: lift the create→link→open-editor flow into a composable so a second entry point can reuse it unchanged"
```

---

### Task 5: Viewer toolbar "New diagram" button

**Files:**
- Create: `src/components/Viewer/CreatedDiagramNotice.vue`
- Modify: `src/components/Viewer/GenericViewer.vue:161-181` (toolbar), data/computed/methods sections (`:423-440`, `:507-518`, `:894-907`)
- Test: `src/components/Viewer/GenericViewer.spec.ts` (extend), `src/components/Viewer/CreatedDiagramNotice.spec.ts` (new)

**Interfaces:**
- Consumes: `useCreateDiagramFlow()` (Task 4), `isInRolloutCohort` + `LITE_ACTIVATION_ROLLOUT_PERCENT` (Task 3), `trackAnalyticsEvent`, existing data `canUserEdit`, computed `isFullscreenMode`, Vuex `diagramType`.
- Produces: computed `showCreateDiagram`, method `createDiagram()`, data `createdNotice: { link: string; pageId: string } | null`.
- `CreatedDiagramNotice.vue` props: `link: string`; emits `copy`, `open-editor`, `dismiss`.

- [ ] **Step 1: Write the failing notice test**

```ts
// src/components/Viewer/CreatedDiagramNotice.spec.ts
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CreatedDiagramNotice from './CreatedDiagramNotice.vue'

describe('CreatedDiagramNotice', () => {
  it('shows the link and emits copy / open-editor / dismiss', async () => {
    const w = mount(CreatedDiagramNotice, { props: { link: 'https://confluence.zenuml.com/d/mermaid/c/7' } })
    expect(w.text()).toContain('Diagram saved')
    await w.get('[data-testid="created-copy-link"]').trigger('click')
    await w.get('[data-testid="created-open-editor"]').trigger('click')
    await w.get('[data-testid="created-dismiss"]').trigger('click')
    expect(w.emitted('copy')).toHaveLength(1)
    expect(w.emitted('open-editor')).toHaveLength(1)
    expect(w.emitted('dismiss')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run src/components/Viewer/CreatedDiagramNotice.spec.ts`
Expected: FAIL — cannot resolve `./CreatedDiagramNotice.vue`

- [ ] **Step 3: Implement the notice**

```vue
<!-- src/components/Viewer/CreatedDiagramNotice.vue -->
<template>
  <div class="created-notice" role="status" data-testid="created-diagram-notice">
    <span class="created-notice__text">Diagram saved. Paste this link where you want it on the page:</span>
    <code class="created-notice__link">{{ link }}</code>
    <button class="viewer-btn-ghost" data-testid="created-copy-link" @click="$emit('copy')">Copy link</button>
    <button class="viewer-btn-primary" data-testid="created-open-editor" @click="$emit('open-editor')">Open page editor</button>
    <button class="viewer-btn-ghost" aria-label="Dismiss" data-testid="created-dismiss" @click="$emit('dismiss')">×</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ link: string }>()
defineEmits<{ (e: 'copy'): void; (e: 'open-editor'): void; (e: 'dismiss'): void }>()
</script>

<style scoped>
.created-notice { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border: 1px solid var(--ds-border, #dfe1e6); border-radius: 3px; background: var(--ds-background-information, #e9f2ff); font-size: 13px; }
.created-notice__link { max-width: 100%; overflow-wrap: anywhere; }
</style>
```

- [ ] **Step 4: Run notice test**

Run: `pnpm vitest --run src/components/Viewer/CreatedDiagramNotice.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing GenericViewer tests**

Append to `src/components/Viewer/GenericViewer.spec.ts` (reuse its `mountViewer`, `store`, `flushPromises`, and the `trackAnalyticsEvent` mock already in the file). Mock the two new modules at the top with the other `vi.mock` calls:

```ts
vi.mock('@/utils/rolloutCohort', () => ({ isActivationEnrolled: vi.fn(() => true) }))
const createDiagram = vi.fn()
const openPageEditorToPaste = vi.fn()
vi.mock('@/composables/useCreateDiagramFlow', () => ({ useCreateDiagramFlow: () => ({ createDiagram, openPageEditorToPaste }) }))
```

and the cases:

```ts
describe('viewer toolbar "New diagram" (Lite activation T8-A)', () => {
  beforeEach(() => { createDiagram.mockReset(); openPageEditorToPaste.mockReset() })

  it('renders for an editor in the rollout cohort, outside fullscreen', async () => {
    const w = mountViewer()
    await w.setData({ canUserEdit: true })
    await flushPromises()
    expect(w.find('[data-testid="viewer-new-diagram"]').exists()).toBe(true)
  })

  it('does not render for a read-only viewer', async () => {
    const w = mountViewer()
    await w.setData({ canUserEdit: false })
    await flushPromises()
    expect(w.find('[data-testid="viewer-new-diagram"]').exists()).toBe(false)
  })

  it('does not render for a site that is not enrolled', async () => {
    const { isActivationEnrolled } = await import('@/utils/rolloutCohort')
    vi.mocked(isActivationEnrolled).mockReturnValueOnce(false)
    const w = mountViewer()
    await w.setData({ canUserEdit: true })
    await flushPromises()
    expect(w.find('[data-testid="viewer-new-diagram"]').exists()).toBe(false)
  })

  it('click → viewer_create_clicked, then viewer_diagram_created with the minted link, then shows the notice', async () => {
    createDiagram.mockResolvedValue({ createdId: '7', link: 'https://confluence.zenuml.com/d/mermaid/c/7', result: 'linked' })
    const w = mountViewer()
    await w.setData({ canUserEdit: true })
    await flushPromises()
    await w.get('[data-testid="viewer-new-diagram"]').trigger('click')
    await flushPromises()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_create_clicked', expect.objectContaining({ entry_point: 'macro_toolbar', surface: 'viewer' }))
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_diagram_created', expect.objectContaining({ entry_point: 'macro_toolbar', custom_content_id: '7', result: 'linked' }))
    expect(w.find('[data-testid="created-diagram-notice"]').exists()).toBe(true)
  })

  it('"Open page editor" → viewer_editor_deeplinked with the navigation result', async () => {
    createDiagram.mockResolvedValue({ createdId: '7', link: 'https://confluence.zenuml.com/d/mermaid/c/7', result: 'linked' })
    openPageEditorToPaste.mockResolvedValue('navigated')
    const w = mountViewer()
    await w.setData({ canUserEdit: true })
    await flushPromises()
    await w.get('[data-testid="viewer-new-diagram"]').trigger('click')
    await flushPromises()
    await w.get('[data-testid="created-open-editor"]').trigger('click')
    await flushPromises()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_editor_deeplinked', expect.objectContaining({ entry_point: 'macro_toolbar', result: 'navigated' }))
  })
})
```

If `mountViewer()` in this spec does not already set `import.meta.env.PRODUCT_TYPE`, add `vi.stubEnv('PRODUCT_TYPE', 'lite')` in a `beforeEach` of this describe and `vi.unstubAllEnvs()` in `afterEach`.

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm vitest --run src/components/Viewer/GenericViewer.spec.ts -t "New diagram"`
Expected: FAIL — `[data-testid="viewer-new-diagram"]` not found

- [ ] **Step 7: Add the button, gate, handler and notice to GenericViewer.vue**

Template — insert before `<ConnectButton ...>` (line 161):

```html
              <button v-if="showCreateDiagram" @click="createDiagram" aria-label="New diagram" class="viewer-btn-ghost" data-testid="viewer-new-diagram">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                <span>New diagram</span>
              </button>
```

and directly under the `.viewer-top-actions` row (still inside `.viewer-body`), the notice:

```html
          <CreatedDiagramNotice
            v-if="createdNotice"
            :link="createdNotice.link"
            @copy="copyCreatedLink"
            @open-editor="openEditorForCreated"
            @dismiss="createdNotice = null"
          />
```

Script — imports (next to line 378/396):

```ts
import CreatedDiagramNotice from '@/components/Viewer/CreatedDiagramNotice.vue'
import { useCreateDiagramFlow } from '@/composables/useCreateDiagramFlow'
import { isActivationEnrolled } from '@/utils/rolloutCohort'
```

register `CreatedDiagramNotice` in `components` (near line 450). Data (near line 423-440):

```ts
      createdNotice: null as null | { link: string; pageId: string },
      creatingDiagram: false,
```

Computed (near `showEdit`, line 507):

```ts
    // Lite activation batch 1 (T8-A). Same cohort as the byline sweep
    // (src/byline-visibility.ts) so the two entry points roll out together.
    showCreateDiagram() {
      if (import.meta.env.PRODUCT_TYPE !== 'lite') return false;
      if (this.isFullscreenMode || !this.canUserEdit) return false;
      return isActivationEnrolled(window.forgeGlobal?.forgeContext?.cloudId);
    },
```

Methods (near `openViewSource`, line 900):

```ts
    async createDiagram() {
      if (this.creatingDiagram) return;
      this.creatingDiagram = true;
      const macroType = this.diagramType ?? 'mermaid';
      trackAnalyticsEvent('viewer_create_clicked', { feature_area: 'macro', surface: 'viewer', entry_point: 'macro_toolbar', macro_type: macroType });
      try {
        const flow = useCreateDiagramFlow();
        const out = await flow.createDiagram({ diagramType: String(this.diagramType ?? 'mermaid'), origin: 'macro_toolbar' });
        trackAnalyticsEvent('viewer_diagram_created', {
          feature_area: 'macro', surface: 'viewer', entry_point: 'macro_toolbar', macro_type: macroType,
          custom_content_id: out.createdId, result: out.result,
        });
        if (out.link && out.createdId) {
          const pageId = await globals.apWrapper._getCurrentPageId();
          this.createdNotice = { link: out.link, pageId };
        }
      } finally {
        this.creatingDiagram = false;
      }
    },
    async copyCreatedLink() {
      if (!this.createdNotice) return;
      try { await navigator.clipboard.writeText(this.createdNotice.link); } catch (e) { console.error('[viewer] clipboard write failed', e); }
    },
    async openEditorForCreated() {
      if (!this.createdNotice) return;
      await this.copyCreatedLink();
      const result = await useCreateDiagramFlow().openPageEditorToPaste(this.createdNotice.pageId);
      trackAnalyticsEvent('viewer_editor_deeplinked', { feature_area: 'macro', surface: 'viewer', entry_point: 'macro_toolbar', result });
    },
```

`result` on `viewer_diagram_created` / `viewer_editor_deeplinked` reuses the existing `result?: string` property in `types.ts` (used by `byline_editor_deeplinked`); `custom_content_id` already exists there too. If `custom_content_id` is typed as `string` only, pass `out.createdId ?? 'none'`.

- [ ] **Step 8: Run the viewer tests and the full unit suite**

Run: `pnpm vitest --run src/components/Viewer && pnpm test:unit`
Expected: PASS

- [ ] **Step 9: Render it once locally and look at it**

Run: `pnpm start:local` (check the port in `package.json` first; do not start a second instance if one is already listening) and open the Lite sequence-macro viewer story/route; screenshot the toolbar with the new button and the notice after a fake create. The button must sit between Copy-for-AI and Fullscreen at the same height; the notice must not overlap the diagram. Fix spacing before committing.

- [ ] **Step 10: Commit**

```bash
git add src/components/Viewer/CreatedDiagramNotice.vue src/components/Viewer/CreatedDiagramNotice.spec.ts src/components/Viewer/GenericViewer.vue src/components/Viewer/GenericViewer.spec.ts
git commit -m "viewer: add a cohort-gated New diagram toolbar button that reuses the byline create path, so the 8,000 never-created Lite viewers get an entry point where they already are"
```

---

### Task 6: E2E on lite-stg

**Files:**
- Create: `tests/e2e-tests/helpers/toolbarCreate.ts`
- Create: `tests/e2e-tests/tests/insert/toolbar-create.spec.ts`

**Interfaces:**
- Consumes: `createPageAndSetup(page, ' Lite')`, `publishAndVerifyMacros` from `tests/e2e-tests/tests/insert/insert-helpers.js`; `testConfig` from `tests/e2e-tests/config/test-config.js`; `createDiagramFromByline` internals in `tests/e2e-tests/helpers/byline.ts:201` (read it and copy its editor-completion steps — the modal editor is the same).
- lite-stg's cloudId `c78e721e-957f-402c-9b70-1df2227c2739` is on `INTERNAL_ALLOWLIST`, and the toolbar gate is `isActivationEnrolled()` = allowlist ∪ cohort (Task 3), so the button renders on lite-stg regardless of the cohort percent — the spec needs no cohort computation.

- [ ] **Step 1: Write the helper**

```ts
// tests/e2e-tests/helpers/toolbarCreate.ts
import type { Page, Frame } from '@playwright/test';

/** The rendered macro's own iframe (view mode), located by its toolbar button. */
export async function viewerFrameWithNewDiagram(page: Page, timeoutMs = 30000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      try {
        if (await f.locator('[data-testid="viewer-new-diagram"]').count()) return f;
      } catch { /* frame detached mid-scan */ }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('[toolbar-create] no viewer frame exposes the New diagram button');
}
```

- [ ] **Step 2: Write the spec**

```ts
// tests/e2e-tests/tests/insert/toolbar-create.spec.ts
import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { viewerFrameWithNewDiagram } from '../../helpers/toolbarCreate.js';

test.describe(`Viewer toolbar New diagram - ${testConfig.productType}`, () => {
  test.skip(!testConfig.isLite, 'Toolbar create ships on Lite only');
  // lite-stg is on INTERNAL_ALLOWLIST (src/utils/rolloutCohort.ts), so the button is always enrolled here.

  test('an editor sees New diagram on a rendered macro, creates one, and gets a typed link', async ({ page }) => {
    const editorPage = await createPageAndSetup(page, ' Lite');
    expect(editorPage, 'editor did not open').toBeTruthy();
    // insert one mermaid macro and publish — the exact helper sequence used by
    // tests/insert/byline-create.spec.ts (copy its insert + publish steps here).
    await publishAndVerifyMacros(page, ['mermaid']);

    const viewer = await viewerFrameWithNewDiagram(page);
    await viewer.locator('[data-testid="viewer-new-diagram"]').click();

    // The editor modal is the same Forge modal the byline opens. Complete it the
    // way tests/e2e-tests/helpers/byline.ts:createDiagramFromByline does (type a
    // title, leave the starter body, click Publish) — copy those steps verbatim.

    const notice = viewer.locator('[data-testid="created-diagram-notice"]');
    await expect(notice).toBeVisible({ timeout: 60000 });
    const link = await notice.locator('code').innerText();
    expect(link).toMatch(/^https:\/\/confluence\.zenuml\.com\/d\/mermaid\/[0-9a-f-]{36}\/\d+$/);
  });
});
```

- [ ] **Step 3: Collect without running**

Run: `cd tests/e2e-tests && npx playwright test --list tests/insert/toolbar-create.spec.ts`
Expected: the one test is listed.

- [ ] **Step 4: Run against lite-stg (after the branch is deployed to staging by CI — see Task 7)**

Run: `cd tests/e2e-tests && APP=zenuml-lite@stg npx playwright test --project=auth --project=insert --grep "toolbar" --workers=1 --reporter=list`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e-tests/helpers/toolbarCreate.ts tests/e2e-tests/tests/insert/toolbar-create.spec.ts
git commit -m "test(e2e): toolbar New diagram creates a diagram and hands back a typed link on lite-stg"
```

---

### Task 7: Ship stage 1, verify, and prepare the readout

**Files:**
- Create: `docs/analysis/2026-08-22-lite-activation-priority/readout-t1-stage1.js`
- Create: `docs/analysis/2026-08-22-lite-activation-priority/deviation-log.md`

- [ ] **Step 1: PR + CI**

Use `submit-branch` (PR title: "Lite activation batch 1A: byline 10% cohort + placement telemetry + viewer New diagram"). Let `babysit-pr` watch CI; the `insert` E2E suite on lite-stg must be green (it includes `typed-deeplink-autoconvert.spec.ts`, the autoConvert regression gate).

- [ ] **Step 2: Staging verification of the cohort**

After the staging deploy, confirm the sweep and the viewer agree on lite-stg (both enrolled via the allowlist): the byline item shows and the toolbar button renders (Task 6's E2E). The cohort leg is verified by the readout query below (`byline_visibility_evaluated` with `reason = 'cohort'` ≈ 10 % of evaluated installs).

Run the byline sweep readout (JQL, `mp_query.py`):

```js
// docs/analysis/2026-08-22-lite-activation-priority/readout-t1-stage1.js
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function main() {
  // FROM/TO: stage-1 deploy date → +14 days. Fill in before running.
  return Events({from_date: '2026-09-01', to_date: '2026-09-15',
    event_selectors: [
      {event: 'byline_visibility_evaluated'}, {event: 'byline_opened'}, {event: 'byline_create_clicked'},
      {event: 'byline_diagram_created'}, {event: 'viewer_create_clicked'}, {event: 'viewer_diagram_created'},
      {event: 'deeplink_placement_resolved'}, {event: 'deeplink_placement_failed'},
      {event: 'macro_create_started'}, {event: 'macro_create_succeeded'}]})
  .filter(function(e) { return !isInternal(e.properties.client_domain) && e.properties.product_type === 'lite'; })
  .groupBy(['name', function(e) { return String(e.properties.entry_point); }, function(e) { return String(e.properties.placement_result); }, function(e) { return String(e.properties.reason); }],
    mixpanel.reducer.count());
}
```

Go/no-go (spec "Go / no-go", row T1 10 % 阶段): `deeplink_placement_failed / (resolved + failed) ≤ 10 %` and no blank-render reports → stage 2.

- [ ] **Step 3: Release**

Release is user-gated (deployment discipline). Hand over: PR label, what changes for users (10 % of Lite sites see the byline "Diagrams" item and the viewer "New diagram" button), and the rollback path (`LITE_ACTIVATION_ROLLOUT_PERCENT = 0` → next hourly sweep un-enrols; the viewer button disappears on the next load).

- [ ] **Step 4: Post-release spot check (never skipped)**

Use the `spot-check` skill on production with an internal Lite site: open a page with a mermaid macro → New diagram visible (if the site is in cohort) → create → notice → paste link in the page editor → macro renders → Mixpanel shows `viewer_create_clicked`, `viewer_diagram_created`, `deeplink_placement_resolved` for that account (ingest can lag ~1 h).

- [ ] **Step 5: Deviation log**

Record every departure from this plan in `docs/analysis/2026-08-22-lite-activation-priority/deviation-log.md` (date, task, what changed, why).

- [ ] **Step 6: Stage 2 (after the 14-day readout passes)**

One-line PR: `LITE_ACTIVATION_ROLLOUT_PERCENT = 100` in `src/utils/rolloutCohort.ts` + the spec expectation in `rolloutCohort.spec.ts` ("ships stage 2 at 100 %"). Same release + spot-check steps.

---

## Self-review

1. **Spec coverage** — decision 5 (T1 telemetry → 10 % → 100 %): Tasks 2, 3, 7. Decision 5 (T8-A reuses byline path, same switch, no new flag): Tasks 4, 5. Decision 10 (events first): Task 1. Decision 11 (cloudId hash, 10 % then all): Task 3 + Task 7 step 6. Go/no-go T1 stage 1: Task 7 step 2. T1+T8-A 30-day readout (首次创作者 within 30 min of click): not a separate task — the events exist after Task 1 and the join is the same shape the byline spec already defines; add the query to `readout-t1-stage1.js` when writing the stage-2 PR.
2. **Placeholders** — the E2E spec instructs copying the editor-completion steps from `helpers/byline.ts:createDiagramFromByline` rather than restating 40 lines of selectors that change with Confluence; that is a pointer to existing checked-in code, not a TODO. Everything else is concrete.
3. **Type consistency** — `CreateOutcome.result` values (`linked | unlinkable_type | no_cloud_id | nothing_created | listing_failed`) match `MintResult` in Task 4 and the `result` strings asserted in Task 5; `PlacementOutcome` strings in Task 2 match `placement_result` in Task 1; `LITE_ACTIVATION_ROLLOUT_PERCENT` / `isInRolloutCohort` / `cohortBucket` / `isActivationEnrolled` / `INTERNAL_ALLOWLIST` are spelled identically in Tasks 3, 5, 6.
