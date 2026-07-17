# Viewer Load P1 (deferred ADF scan + fetch instrumentation split) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the blocking cost of every viewer macro mount by deferring the full-page-ADF copy-scan off the critical path (behind Forge flag `viewer-adf-scan-deferred`), and split `fetch_ms` telemetry so the change — and future hung-fetch investigations — are directly observable.

**Architecture:** The viewer fetch path (`forgeIndex.ts` → `ApWrapper2.loadCustomContentWithOrphanRecovery` → `parseCustomContentByIdV2Response`) today blocks on TWO sequential Confluence GETs: the custom-content body and the full page ADF (used only for copy detection). We (a) add sub-phase timers + mount identity to `macro_viewed`, (b) extract copy detection into a callable step, (c) skip it inline when a fail-closed feature flag says so and the surface is a viewer, running it fire-and-forget after load and writing the result back through the Vuex store proxy so the copy banner still appears.

**Tech Stack:** Vue 3 + Vuex 4 (`src/model/store2`), TypeScript, Vitest (`pnpm test:unit <path>`), `@forge/bridge` FeatureFlags SDK (pattern: `src/utils/prefetch/flags.ts`).

**Background docs:** `private/operations/2026-07-17-coles-mermaid-root-cause-and-fix-plan.md` (root cause + P1 definition), `RENDERING_PERF_INSTRUMENTATION.md` (phase timer design).

## Global Constraints

- Feature flag name: `viewer-adf-scan-deferred`. Fail-closed: any error, missing flag, standalone env ⇒ blocking (current) behavior.
- New `macro_viewed` properties (exact names): `custom_content_fetch_ms`, `page_adf_fetch_ms`, `adf_deferred`, `instance_nonce`, `time_origin`.
- `custom_content_fetch_ms` and `page_adf_fetch_ms` are children of `fetch_ms` — they MUST NOT be added to `measured_sum_ms` (would double-count).
- Deferral applies ONLY to the `forgeIndex.ts` sequence/mermaid/plantuml path, ONLY when the surface is not an editor/config surface. Editor, graph, swagger, embed entries keep blocking behavior (follow-up work).
- The deferred scan MUST still record `page_adf_fetch_ms` and MUST clear `copyCheckPending` on the diagram whether it succeeds or fails (fail ⇒ `isCopy` stays `undefined`, same information as today's catch path).
- No new blocking round-trips when the flag is OFF: the flag read starts before the fetch and is only awaited after the custom-content GET has returned.
- Commit style: one-line subject, no body (repo rule). Never commit to `main`; we are on branch `worktree-viewer-load-p1`.
- The repo typecheck baseline is red (~150 pre-existing errors) — compare `npx vue-tsc --noEmit` output against `main` before blaming your change; do not try to fix baseline errors.

## File Structure

- `src/utils/analytics/types.ts` — new optional properties (vocabulary first, repo policy).
- `src/utils/analytics/renderPerf.ts` (+ `renderPerf.spec.ts`) — sub-phases `cc_fetch`, `adf_scan`; `markAdfDeferred()`.
- `src/utils/analytics/trackRenderTime.ts` (+ `trackRenderTime.spec.ts`) — `instance_nonce`, `time_origin`.
- `src/model/Diagram/Diagram.ts` — `copyCheckPending?: boolean`.
- `src/model/ApWrapper2.ts` (+ `ApWrapper2.spec.ts`) — timers, `detectCopy()` extraction, `shouldDeferAdfScan` option threading.
- `src/utils/viewerLoad/flags.ts` (+ `flags.spec.ts`) — NEW, mirrors `src/utils/prefetch/flags.ts`.
- `src/utils/viewerLoad/deferredCopyCheck.ts` (+ `deferredCopyCheck.spec.ts`) — NEW, fire-and-forget completion that writes back through the store.
- `src/forgeIndex.ts` — wiring (flag kickoff, option pass-through, post-load completion).

---

### Task 1: Analytics vocabulary (types only)

**Files:**
- Modify: `src/utils/analytics/types.ts` (append inside `AnalyticsProperties`, after the Phase-0b sub-timing block around line 107-115)

**Interfaces:**
- Produces: optional properties `custom_content_fetch_ms?: number`, `page_adf_fetch_ms?: number`, `adf_deferred?: boolean`, `instance_nonce?: string`, `time_origin?: number` on `AnalyticsProperties`. Later tasks reference these exact names.

- [ ] **Step 1: Add the properties**

Locate the Phase 0b sub-timings block in `AnalyticsProperties` (it declares `bootstrap_ms` / `context_ms` / `fetch_ms` / `render_ms` / `measured_sum_ms` / `tab_hidden`) and append directly below it:

```typescript
  // P1.3 fetch split (children of fetch_ms — NOT part of measured_sum_ms):
  // custom-content GET vs full-page-ADF copy-scan. See renderPerf.ts.
  custom_content_fetch_ms?: number;
  page_adf_fetch_ms?: number;
  // True when the viewer deferred the ADF copy-scan off the critical path
  // (flag `viewer-adf-scan-deferred`). Absent on editor/config surfaces.
  adf_deferred?: boolean;
  // Random per-iframe id + performance.timeOrigin. Makes concurrent
  // duplicate mounts of one macro (remount storms) directly countable
  // without burst reconstruction. See trackRenderTime.ts.
  instance_nonce?: string;
  time_origin?: number;
```

- [ ] **Step 2: Verify it compiles no worse than main**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | wc -l` — compare with the same command on `main` (run once before editing). Expected: identical count.

- [ ] **Step 3: Commit**

```bash
git add src/utils/analytics/types.ts
git commit -m "feat(analytics): declare P1 viewer-load props (fetch split, adf_deferred, instance identity)"
```

---

### Task 2: renderPerf sub-phases + adf_deferred marker

**Files:**
- Modify: `src/utils/analytics/renderPerf.ts`
- Test: `src/utils/analytics/renderPerf.spec.ts`

**Interfaces:**
- Produces: `RenderPhase` union gains `'cc_fetch' | 'adf_scan'`; new export `markAdfDeferred(deferred: boolean): void`; `RenderTimings` gains `custom_content_fetch_ms?`, `page_adf_fetch_ms?`, `adf_deferred?`. `renderPerf.time('cc_fetch', fn)` / `renderPerf.time('adf_scan', fn)` are what Task 4 calls; `markAdfDeferred` is what Task 7 calls.

- [ ] **Step 1: Write the failing tests** (append to `renderPerf.spec.ts`, using the file's existing imports/reset pattern)

```typescript
describe('P1.3 fetch split', () => {
  beforeEach(() => renderPerf._resetForTesting());

  it('records cc_fetch and adf_scan as custom_content_fetch_ms / page_adf_fetch_ms', async () => {
    await renderPerf.time('cc_fetch', async () => 'cc');
    await renderPerf.time('adf_scan', async () => 'adf');
    const t = renderPerf.getTimings();
    expect(t.custom_content_fetch_ms).toBeTypeOf('number');
    expect(t.page_adf_fetch_ms).toBeTypeOf('number');
  });

  it('excludes sub-phases from measured_sum_ms', async () => {
    await renderPerf.time('fetch', async () => {
      await renderPerf.time('cc_fetch', async () => 'cc');
    });
    const t = renderPerf.getTimings();
    expect(t.measured_sum_ms).toBe(t.fetch_ms);
  });

  it('emits adf_deferred only when marked', async () => {
    expect(renderPerf.getTimings().adf_deferred).toBeUndefined();
    renderPerf.markAdfDeferred(true);
    expect(renderPerf.getTimings().adf_deferred).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit src/utils/analytics/renderPerf.spec.ts`
Expected: FAIL (`markAdfDeferred` is not a function / properties undefined).

- [ ] **Step 3: Implement**

In `renderPerf.ts`:

```typescript
export type RenderPhase = 'context' | 'fetch' | 'render' | 'cc_fetch' | 'adf_scan';
```

Add module state + marker below `bootstrapMs`:

```typescript
// P1.1: set by forgeIndex when the viewer defers the ADF copy-scan. Sticky
// per iframe, undefined until explicitly marked so editor surfaces (which
// never decide) emit nothing.
let adfDeferred: boolean | undefined;

export function markAdfDeferred(deferred: boolean): void {
  adfDeferred = deferred;
}
```

Extend `RenderTimings` and `getTimings()` (sub-phases deliberately NOT in `measured`):

```typescript
export interface RenderTimings {
  bootstrap_ms?: number;
  context_ms?: number;
  fetch_ms?: number;
  render_ms?: number;
  // Children of fetch_ms (custom-content GET vs page-ADF copy-scan). Not
  // added to measured_sum_ms — they'd double-count their parent.
  custom_content_fetch_ms?: number;
  page_adf_fetch_ms?: number;
  adf_deferred?: boolean;
  measured_sum_ms?: number;
  tab_hidden?: boolean;
}
```

In `getTimings()` return object add:

```typescript
    custom_content_fetch_ms: durations.cc_fetch,
    page_adf_fetch_ms: durations.adf_scan,
    ...(adfDeferred !== undefined ? { adf_deferred: adfDeferred } : {}),
```

In `_resetForTesting()` add:

```typescript
  delete durations.cc_fetch;
  delete durations.adf_scan;
  adfDeferred = undefined;
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit src/utils/analytics/renderPerf.spec.ts` — Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/analytics/renderPerf.ts src/utils/analytics/renderPerf.spec.ts
git commit -m "feat(perf): split fetch_ms into cc_fetch/adf_scan sub-timers with adf_deferred marker"
```

---

### Task 3: Mount identity on macro_viewed

**Files:**
- Modify: `src/utils/analytics/trackRenderTime.ts`
- Test: `src/utils/analytics/trackRenderTime.spec.ts`

**Interfaces:**
- Consumes: nothing new. Produces: every `macro_viewed` emitted via `trackRenderTime` carries `instance_nonce` (random UUID, constant within one iframe/module instance) and `time_origin` (`Math.round(performance.timeOrigin)`).

- [ ] **Step 1: Write the failing test** (follow the existing spec's mocking pattern for `trackAnalyticsEvent`)

```typescript
it('stamps instance_nonce and time_origin on macro_viewed', () => {
  window.__macroLoadStart = performance.now() - 5;
  trackRenderTime('mermaid', true);
  const props = mockTrack.mock.calls.at(-1)![1];
  expect(props.instance_nonce).toMatch(/[0-9a-f-]{36}/);
  expect(props.time_origin).toBeTypeOf('number');
});

it('keeps instance_nonce constant across emissions from one module instance', () => {
  window.__macroLoadStart = performance.now() - 5;
  trackRenderTime('mermaid', true);
  trackRenderTime('mermaid', true);
  const [a, b] = mockTrack.mock.calls.slice(-2).map(c => c[1]);
  expect(a.instance_nonce).toBe(b.instance_nonce);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit src/utils/analytics/trackRenderTime.spec.ts` — Expected: FAIL (properties undefined).

- [ ] **Step 3: Implement**

In `trackRenderTime.ts` add module-level identity (below the imports):

```typescript
// P1.3 mount identity: one nonce per iframe module instance. Concurrent
// duplicate mounts of the same macro (remount storms) become countable in
// Mixpanel as distinct nonces sharing macro_uuid/page_id. crypto.randomUUID
// is available in all supported browsers; the fallback covers jsdom/tests.
const INSTANCE_NONCE: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `nofallback-${Math.random().toString(36).slice(2)}`;
```

In the `trackAnalyticsEvent('macro_viewed', {...})` call add:

```typescript
    instance_nonce: INSTANCE_NONCE,
    time_origin: Math.round(performance.timeOrigin),
```

- [ ] **Step 4: Run tests** — `pnpm test:unit src/utils/analytics/trackRenderTime.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/analytics/trackRenderTime.ts src/utils/analytics/trackRenderTime.spec.ts
git commit -m "feat(perf): stamp instance_nonce + time_origin on macro_viewed for remount-storm attribution"
```

---

### Task 4: ApWrapper2 — timers, detectCopy extraction, defer option

**Files:**
- Modify: `src/model/ApWrapper2.ts`, `src/model/Diagram/Diagram.ts`
- Test: `src/model/ApWrapper2.spec.ts`

**Interfaces:**
- Consumes: `renderPerf.time('cc_fetch'|'adf_scan', fn)` from Task 2.
- Produces:
  - `Diagram.copyCheckPending?: boolean` (in `Diagram.ts`, next to `isCopy`).
  - `ApWrapper2.detectCopy(id: string, ccPageId: string | number | undefined): Promise<{ isCopy: boolean; copyReason?: 'cross-page' | 'same-page-duplicate' }>` — public, timed as `adf_scan`.
  - `loadCustomContentWithOrphanRecovery(pageId, customContentId, opts?: { shouldDeferAdfScan?: () => Promise<boolean> })` — option threaded to `fetchCustomContentByIdV2WithStatus(id, opts)` → `parseCustomContentByIdV2Response(id, rawResponse, opts)`. When the callback resolves `true`, parse skips copy detection and sets `value.copyCheckPending = true`, `isCopy`/`copyReason` untouched (undefined).

- [ ] **Step 1: Add `copyCheckPending` to the Diagram model** (`src/model/Diagram/Diagram.ts`, directly after `copyReason`):

```typescript
  // P1.1: true while a deferred viewer copy-scan is still in flight.
  // Cleared (with isCopy/copyReason set) by utils/viewerLoad/deferredCopyCheck.
  copyCheckPending?: boolean;
```

- [ ] **Step 2: Write the failing tests** (append to `ApWrapper2.spec.ts`, reusing its existing mock plumbing for `makeRequest` / `_page`)

```typescript
describe('deferred ADF copy-scan (P1.1)', () => {
  it('skips countMacros and marks copyCheckPending when shouldDeferAdfScan resolves true', async () => {
    const countSpy = vi.spyOn(apWrapper._page, 'countMacros');
    const result = await apWrapper.loadCustomContentWithOrphanRecovery(
      'page-1', 'cc-1', { shouldDeferAdfScan: async () => true });
    expect(countSpy).not.toHaveBeenCalled();
    expect(result.customContent?.value.copyCheckPending).toBe(true);
    expect(result.customContent?.value.isCopy).toBeUndefined();
  });

  it('keeps blocking copy detection when option is absent', async () => {
    const result = await apWrapper.loadCustomContentWithOrphanRecovery('page-1', 'cc-1');
    expect(result.customContent?.value.copyCheckPending).toBeUndefined();
    expect(typeof result.customContent?.value.isCopy).toBe('boolean');
  });

  it('detectCopy reports same-page-duplicate when count > 1', async () => {
    vi.spyOn(apWrapper._page, 'countMacros').mockResolvedValue(2);
    vi.spyOn(apWrapper._page, 'getPageId').mockResolvedValue('page-1');
    const verdict = await apWrapper.detectCopy('cc-1', 'page-1');
    expect(verdict).toEqual({ isCopy: true, copyReason: 'same-page-duplicate' });
  });

  it('detectCopy reports cross-page when CC pageId differs', async () => {
    vi.spyOn(apWrapper._page, 'countMacros').mockResolvedValue(1);
    vi.spyOn(apWrapper._page, 'getPageId').mockResolvedValue('page-2');
    const verdict = await apWrapper.detectCopy('cc-1', 'page-1');
    expect(verdict).toEqual({ isCopy: true, copyReason: 'cross-page' });
  });
});
```

Adapt spy targets to the spec file's actual fixture names (the file already constructs an `ApWrapper2` with a mocked page — reuse it; if `_page` is private, add the existing workaround used elsewhere in the spec, e.g. `(apWrapper as any)._page`).

- [ ] **Step 3: Run to verify failure** — `pnpm test:unit src/model/ApWrapper2.spec.ts` — Expected: new tests FAIL.

- [ ] **Step 4: Implement in `ApWrapper2.ts`**

Import renderPerf at top (namespace import, matching forgeIndex style):

```typescript
import * as renderPerf from '@/utils/analytics/renderPerf';
```

4a. Time the custom-content GET in `fetchCustomContentByIdV2WithStatus` (the `makeRequest` at ~line 521):

```typescript
      rawResponse = await renderPerf.time('cc_fetch', () =>
        this.makeRequest(`/api/v2/custom-content/${id}?body-format=raw`));
```

4b. Extract copy detection. Replace the inline block in `parseCustomContentByIdV2Response` (the `countMacros` → `getPageId` → `isCopy` assignment section, ~lines 563-587) with:

```typescript
    if (opts?.shouldDeferAdfScan && await opts.shouldDeferAdfScan()) {
      // P1.1: viewer chose to run the ADF copy-scan after first paint.
      // deferredCopyCheck.ts owns completing this and clearing the flag.
      diagram.copyCheckPending = true;
    } else {
      const verdict = await this.detectCopy(id, customContent?.pageId);
      diagram.isCopy = verdict.isCopy;
      diagram.copyReason = verdict.copyReason;
      if (verdict.isCopy) {
        console.warn(`Detected copied macro - ID: ${id}, reason: ${verdict.copyReason}, Source page: ${customContent?.pageId}`);
      }
    }
```

4c. New public method (place right after `parseCustomContentByIdV2Response`), preserving the exact existing semantics — count>1 OR cross-page, cross-page wins the reason, issue-#80 guard on both ids present, and the existing `trackEvent` telemetry:

```typescript
  /**
   * P1.1: the ADF copy-scan, extracted so viewers can run it off the
   * critical path. One full-page ADF GET via _page.countMacros. Timed as
   * `adf_scan` → macro_viewed.page_adf_fetch_ms (first call wins).
   */
  async detectCopy(
    id: string,
    ccPageId: string | number | undefined,
  ): Promise<{ isCopy: boolean; copyReason?: 'cross-page' | 'same-page-duplicate' }> {
    return renderPerf.time('adf_scan', async () => {
      const count = await this._page.countMacros((m) => {
        //TODO: filter by macro type
        return m?.customContentId?.value === id;
      });
      console.debug(`Found ${count} macros on page`);
      const pageId = await this._page.getPageId();
      // Require both sides present — undefined pageId on the custom content
      // previously caused a false-positive isCopy=true (issue #80).
      const isCrossPageCopy = !!(pageId && ccPageId && pageId !== String(ccPageId));
      if (isCrossPageCopy) {
        trackEvent('cross_page', 'duplication_detect', 'warning');
      }
      if (count > 1) {
        trackEvent('same_page', 'duplication_detect', 'warning');
      }
      if (isCrossPageCopy || count > 1) {
        return { isCopy: true, copyReason: isCrossPageCopy ? 'cross-page' as const : 'same-page-duplicate' as const };
      }
      return { isCopy: false };
    });
  }
```

Note: today's code sets `diagram.isCopy = false; diagram.copyReason = undefined;` in the else branch — `detectCopy` returning `{isCopy:false}` plus the caller assignment preserves that.

4d. Thread the option. Signatures:

```typescript
export interface LoadCustomContentOpts {
  // Resolves true ⇒ skip the blocking ADF copy-scan (viewer defers it).
  // A callback (not a boolean) so the flag read overlaps the CC GET.
  shouldDeferAdfScan?: () => Promise<boolean>;
}
```

- `private async fetchCustomContentByIdV2WithStatus(id: string, opts?: LoadCustomContentOpts)` — pass `opts` to `parseCustomContentByIdV2Response(id, rawResponse, opts)`.
- `private async parseCustomContentByIdV2Response(id: string, customContent: any, opts?: LoadCustomContentOpts)`.
- `async loadCustomContentWithOrphanRecovery(pageId, customContentId, opts?: LoadCustomContentOpts)` — pass `opts` only to the DIRECT fetch (`this.fetchCustomContentByIdV2WithStatus(customContentId, opts)`). The orphan-recovery re-fetch (`getCustomContentByIdV2(recoveredId)`) stays blocking — recovery is rare and its copy semantics must stay exact.
- All other callers (`isCustomContentFetchableV2`, `getCustomContentByIdV2`, editors) pass nothing ⇒ behavior unchanged.

- [ ] **Step 5: Run tests** — `pnpm test:unit src/model/ApWrapper2.spec.ts` — Expected: PASS (new + all pre-existing, especially the existing copy-detection specs).

- [ ] **Step 6: Commit**

```bash
git add src/model/ApWrapper2.ts src/model/Diagram/Diagram.ts src/model/ApWrapper2.spec.ts
git commit -m "feat(perf): time cc/adf fetch phases and make viewer ADF copy-scan deferrable"
```

---

### Task 5: viewer-load feature flag module

**Files:**
- Create: `src/utils/viewerLoad/flags.ts`
- Test: `src/utils/viewerLoad/flags.spec.ts`

**Interfaces:**
- Produces: `ADF_DEFER_FLAG = 'viewer-adf-scan-deferred'`; `getViewerLoadFlags(deps?): Promise<{ adfScanDeferred: boolean }>`. Task 7 consumes `getViewerLoadFlags`.

- [ ] **Step 1: Copy the proven pattern.** `src/utils/prefetch/flags.ts` is the reference implementation (bridge `FeatureFlags` SDK, install-ARI attribute, env mapping, fail-closed, `shutdown` in `finally`). Create `src/utils/viewerLoad/flags.ts` with the same structure, exporting:

```typescript
import { getContext } from '@/model/globals/forgeGlobal';

export const ADF_DEFER_FLAG = 'viewer-adf-scan-deferred';

export interface ViewerLoadFlags {
  adfScanDeferred: boolean;
}
```

…and `getViewerLoadFlags(deps?)` identical to `getPrefetchFlags` except: single flag (`adfScanDeferred: client.checkFlag(ADF_DEFER_FLAG, false)`), log prefix `[viewer-load]`. Reuse `mapEnvironment` by importing it: `import { mapEnvironment } from '@/utils/prefetch/flags';` (it is already exported there) — do NOT duplicate it.

- [ ] **Step 2: Write the spec** — port `src/utils/prefetch/flags.spec.ts` cases to the new module (rename symbols): flag on ⇒ `{adfScanDeferred: true}`; missing cloudId ⇒ off; createClient throws ⇒ off; environment mapping passed through; `shutdown` called even on throw.

- [ ] **Step 3: Run** — `pnpm test:unit src/utils/viewerLoad/flags.spec.ts` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/viewerLoad/flags.ts src/utils/viewerLoad/flags.spec.ts
git commit -m "feat(perf): viewer-adf-scan-deferred feature flag reader (fail-closed)"
```

---

### Task 6: deferred completion helper

**Files:**
- Create: `src/utils/viewerLoad/deferredCopyCheck.ts`
- Test: `src/utils/viewerLoad/deferredCopyCheck.spec.ts`

**Interfaces:**
- Consumes: `ApWrapper2.detectCopy` (Task 4).
- Produces: `runDeferredCopyCheck(apWrapper, doc, customContentId, ccPageId): Promise<void>` — fire-and-forget-safe (never throws). Task 7 consumes it.

- [ ] **Step 1: Write the failing tests**

```typescript
import { runDeferredCopyCheck } from './deferredCopyCheck';
import store from '@/model/store2';

function makeDoc(): any {
  return { copyCheckPending: true };
}

it('writes verdict onto the store diagram when it is the mounted doc', async () => {
  const doc = makeDoc();
  store.state.diagram = doc;
  const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: true, copyReason: 'same-page-duplicate' }) };
  await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1');
  expect(store.state.diagram.isCopy).toBe(true);
  expect(store.state.diagram.copyReason).toBe('same-page-duplicate');
  expect(store.state.diagram.copyCheckPending).toBe(false);
});

it('clears pending without setting isCopy when detectCopy rejects', async () => {
  const doc = makeDoc();
  store.state.diagram = doc;
  const ap = { detectCopy: vi.fn().mockRejectedValue(new Error('network')) };
  await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1');
  expect(store.state.diagram.isCopy).toBeUndefined();
  expect(store.state.diagram.copyCheckPending).toBe(false);
});

it('writes the raw doc when the store holds a different diagram', async () => {
  const doc = makeDoc();
  store.state.diagram = { other: true } as any;
  const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: false }) };
  await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1');
  expect(doc.isCopy).toBe(false);
  expect(doc.copyCheckPending).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:unit src/utils/viewerLoad/deferredCopyCheck.spec.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
import type ApWrapper2 from '@/model/ApWrapper2';
import type { Diagram } from '@/model/Diagram/Diagram';
import { toRaw } from 'vue';

/**
 * P1.1 completion half: run the ADF copy-scan the viewer skipped, then land
 * the verdict on the SAME diagram the app mounted. Writes go through the
 * store proxy when the mounted diagram is ours (post-mount reactivity), and
 * through the raw object otherwise (pre-mount: mountRoot will hand the
 * already-updated doc to Vue). Never throws — a failed scan degrades to
 * "no copy info", exactly like today's catch path in AtlasPage.macros().
 */
export async function runDeferredCopyCheck(
  apWrapper: Pick<ApWrapper2, 'detectCopy'>,
  doc: Diagram,
  customContentId: string,
  ccPageId: string | number | undefined,
): Promise<void> {
  let verdict: { isCopy: boolean; copyReason?: Diagram['copyReason'] } | undefined;
  try {
    verdict = await apWrapper.detectCopy(customContentId, ccPageId);
  } catch (e) {
    console.warn('[viewer-load] deferred copy-scan failed; leaving isCopy unknown', e);
  }
  try {
    const { default: store } = await import('@/model/store2');
    const mounted = store.state.diagram;
    const target: Diagram = mounted && toRaw(mounted) === doc ? mounted : doc;
    if (verdict) {
      target.isCopy = verdict.isCopy;
      target.copyReason = verdict.copyReason;
    }
    target.copyCheckPending = false;
  } catch (e) {
    // Store not available (tests/teardown) — still clear the raw doc.
    if (verdict) {
      doc.isCopy = verdict.isCopy;
      doc.copyReason = verdict.copyReason;
    }
    doc.copyCheckPending = false;
  }
}
```

Note for the spec: with a static `import store from '@/model/store2'` in the test and the dynamic import in the implementation resolving to the same module instance, the three cases above exercise both branches (`toRaw` handles the store-proxy identity). If `store.state.diagram` assignment in tests trips strict-mode warnings, that matches production usage (`mount-root.ts:9` assigns it directly).

- [ ] **Step 4: Run tests** — `pnpm test:unit src/utils/viewerLoad/deferredCopyCheck.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/viewerLoad/deferredCopyCheck.ts src/utils/viewerLoad/deferredCopyCheck.spec.ts
git commit -m "feat(perf): deferred copy-scan completion writes verdict back through store"
```

---

### Task 7: forgeIndex wiring

**Files:**
- Modify: `src/forgeIndex.ts` (the sequence/mermaid/plantuml macro-data load, ~lines 232-259)

**Interfaces:**
- Consumes: `getViewerLoadFlags` (Task 5), `runDeferredCopyCheck` (Task 6), `renderPerf.markAdfDeferred` (Task 2), `LoadCustomContentOpts` (Task 4).

- [ ] **Step 1: Kick off the flag read before the fetch, decide after the CC GET.**

In the function containing the `renderPerf.time('fetch', ...)` call (~line 241), after `context` is available and BEFORE the `if (customContentId)` block, add:

```typescript
    // P1.1: viewer surfaces may defer the ADF copy-scan. Kick the flag read
    // off NOW so it overlaps the custom-content GET; the decision callback
    // awaits it only after that GET returns — zero added blocking time when
    // the flag is off. Editor/config surfaces never defer (their blocking
    // copy check guards the save path).
    const isEditorish =
      context.extension.modal?.macroMode === 'editor' ||
      !!context.extension?.macro?.isConfiguring;
    let shouldDeferAdfScan: (() => Promise<boolean>) | undefined;
    if (!isEditorish) {
      const flagsPromise = import('@/utils/viewerLoad/flags')
        .then(({ getViewerLoadFlags }) => getViewerLoadFlags())
        .catch(() => ({ adfScanDeferred: false }));
      shouldDeferAdfScan = async () => {
        const deferred = (await flagsPromise).adfScanDeferred;
        renderPerf.markAdfDeferred(deferred);
        return deferred;
      };
    }
```

- [ ] **Step 2: Pass the option and complete the deferral.** Change the load call (~line 241-242) to:

```typescript
      const loaded = await renderPerf.time('fetch', () =>
        globals.apWrapper.loadCustomContentWithOrphanRecovery(recoveryPageId, customContentId, { shouldDeferAdfScan }));
```

Immediately after `doc = loaded.customContent?.value;` (~line 244) add:

```typescript
      if (doc?.copyCheckPending && loaded.customContent) {
        // Fire-and-forget: render proceeds now; the verdict lands on the
        // mounted diagram (store write-through) when the scan returns.
        import('@/utils/viewerLoad/deferredCopyCheck').then(({ runDeferredCopyCheck }) =>
          runDeferredCopyCheck(globals.apWrapper, doc!, customContentId, loaded.customContent!.pageId));
      }
```

Check the actual field name for the CC's container page on `ICustomContentV2` (`pageId` — same field `parseCustomContentByIdV2Response` reads as `customContent?.pageId`) and pass exactly that.

- [ ] **Step 3: Full unit suite + lint**

Run: `pnpm test:unit` — Expected: PASS (0 failures; compare any pre-existing failures against `main` before touching them).
Run: `pnpm lint` — Expected: no new errors in touched files.

- [ ] **Step 4: Commit**

```bash
git add src/forgeIndex.ts
git commit -m "feat(perf): defer viewer ADF copy-scan behind viewer-adf-scan-deferred flag"
```

---

### Task 8: Viewer banner reacts to late verdict (regression spec)

**Files:**
- Test: `src/components/Viewer/GenericViewer.spec.ts`

**Interfaces:**
- Consumes: `Diagram.copyCheckPending` (Task 4). No production code change expected — `editDisabledReason` already treats `isCopy` falsy (undefined) as "no restriction", which is the intended pending behavior (the editor modal re-runs its own blocking check, so there is no data-safety hole). This task pins that with a spec.

- [ ] **Step 1: Add the spec** (reuse the file's existing mount helper):

```typescript
it('shows the copy notice when a deferred scan lands after mount', async () => {
  const { wrapper, store } = mountViewer({ diagram: { ...baseDiagram, copyCheckPending: true } });
  expect(wrapper.vm.editDisabledReason).toBeNull();
  store.state.diagram.isCopy = true;
  store.state.diagram.copyReason = 'same-page-duplicate';
  store.state.diagram.copyCheckPending = false;
  await wrapper.vm.$nextTick();
  expect(wrapper.vm.editDisabledReason).toContain('multiple copies');
});
```

Adapt `mountViewer`/`baseDiagram` to the spec file's real fixtures.

- [ ] **Step 2: Run** — `pnpm test:unit src/components/Viewer/GenericViewer.spec.ts` — Expected: PASS. If the reactivity assertion fails, the store write-through in Task 6 is broken — fix there, not here.

- [ ] **Step 3: Commit**

```bash
git add src/components/Viewer/GenericViewer.spec.ts
git commit -m "test(viewer): copy notice appears when deferred scan verdict lands post-mount"
```

---

### Task 9: Ship

- [ ] **Step 1: Validate the branch** — run the `validate-branch` skill (lint, unit, build sanity).
- [ ] **Step 2: PR** — run the `submit-branch` skill. PR description must include: root-cause link (private doc path only, no tenant data beyond `colesgroup` — that name must NOT appear; say "an affected enterprise tenant"), the flag rollout steps (create `viewer-adf-scan-deferred` in the Developer Console for lite/full/diagramly/asyncapi apps, default OFF everywhere; enable staging first), and the observation plan (Mixpanel board 11377482, `adf_deferred` split once live).
- [ ] **Step 3: Do NOT merge, do NOT create the console flags, do NOT deploy** — those are explicit user go-aheads per repo policy.

## Client-privacy constraint (repo hard rule)

No real tenant names in ANY public-repo artifact this plan produces: code comments, commit messages, spec names, PR text. The incident tenant is referred to only as "an affected enterprise tenant". The private doc path may be referenced by filename.
