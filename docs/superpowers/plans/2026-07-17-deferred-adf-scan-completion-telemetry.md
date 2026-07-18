# Deferred ADF Scan Completion Telemetry Implementation Plan

> **Execution:** Complete tasks in order on one isolated implementation
> worktree. Do not broaden the production flag until the release and
> observation gates pass.

**Goal:** Make every deferred page-ADF copy scan observable after first render
without changing the viewer's non-blocking behavior.

**Design:**
[`docs/superpowers/specs/2026-07-17-deferred-adf-scan-completion-telemetry-design.md`](../specs/2026-07-17-deferred-adf-scan-completion-telemetry-design.md)

**Base:** `origin/main` at or after the docs-only design/plan commit.

## Constraints

- The first commit on the implementation branch must register analytics
  vocabulary in `catalog.ts` and `types.ts` before behavioral code.
- `viewer_adf_scan_completed` remains at a 100% sample rate throughout rollout.
- The event must not contain raw errors, response bodies, page content, tenant
  names, cloud IDs, or hostnames.
- `macro_viewed` timing and emission semantics must not change.
- A telemetry failure must never reject the deferred scan or affect rendering.
- Editor/config, Graph, OpenAPI, Embed, and AsyncAPI paths remain unchanged.

## Task 1: Land documentation separately

Commit the approved design and this plan as `.md`-only changes, then land them
on `main` under the repository's documentation exception. Create the code branch
from that updated `origin/main`; do not carry a docs commit as the first feature
commit.

Verify:

```bash
git diff --check
```

Also run the public-repository discovery command from
`docs/policies/client-privacy.md`. The current repository has pre-existing
baseline hits outside this work; compare against `origin/main` and require no
new hit in this diff.

## Task 2: Analytics vocabulary — first implementation commit

**Files:**

- Modify `src/utils/analytics/catalog.ts`
- Modify `src/utils/analytics/types.ts`

Register `viewer_adf_scan_completed` in `AnalyticsEventName`. Add the bounded
completion properties to `AnalyticsProperties`:

```ts
copy_detected?: boolean;
copy_reason?: 'cross-page' | 'same-page-duplicate';
writeback_target?: 'store' | 'raw';
```

Reuse the existing `result`, `failure_reason`, `page_adf_fetch_ms`,
`adf_deferred`, `instance_nonce`, and `time_origin` fields. Document the exact
call-site values next to the new properties:

- `result`: `succeeded | failed`
- `failure_reason`: `detect_copy_failed` only

Run a compile-oriented focused check, then commit only these two files:

```bash
pnpm exec vue-tsc --noEmit 2>&1 | tee /tmp/adf-telemetry-tsc.log
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git commit -m "feat(analytics): declare deferred ADF completion event"
```

The repository has a known typecheck baseline; compare failures against
`origin/main` rather than attempting unrelated fixes.

## Task 3: Shared render identity

**Files:**

- Add `src/utils/analytics/renderIdentity.ts`
- Add `src/utils/analytics/renderIdentity.spec.ts`
- Modify `src/utils/analytics/trackRenderTime.ts`
- Modify `src/utils/analytics/trackRenderTime.spec.ts`

### Red

Write tests for an iframe-module-scoped `getRenderIdentity()`:

- returns a UUID-shaped `instance_nonce`;
- returns numeric `time_origin`;
- returns the same values across repeated calls;
- `trackRenderTime` forwards that exact identity to `macro_viewed`.

Run:

```bash
pnpm test:unit src/utils/analytics/renderIdentity.spec.ts \
  src/utils/analytics/trackRenderTime.spec.ts
```

Expect the new identity tests to fail before implementation.

### Green

Move the existing nonce creation and rounded `performance.timeOrigin` into
`renderIdentity.ts`. Keep the existing crypto fallback behavior. Replace the
private constant in `trackRenderTime.ts` with `getRenderIdentity()` and spread
the result into `macro_viewed`.

Re-run the focused tests and commit:

```bash
git add src/utils/analytics/renderIdentity.ts \
  src/utils/analytics/renderIdentity.spec.ts \
  src/utils/analytics/trackRenderTime.ts \
  src/utils/analytics/trackRenderTime.spec.ts
git commit -m "refactor(analytics): share viewer render identity"
```

## Task 4: Deferred completion event

**Files:**

- Modify `src/utils/viewerLoad/deferredCopyCheck.ts`
- Modify `src/utils/viewerLoad/deferredCopyCheck.spec.ts`
- Modify `src/utils/analytics/eventSampling.spec.ts`

### Red

Extend the completion-helper tests with deterministic clock/tracker seams or
module mocks. Assert:

1. successful same-page verdict emits exactly one
   `viewer_adf_scan_completed` event;
2. tracking happens after `copyCheckPending` is false;
3. success includes `result: succeeded`, measured `page_adf_fetch_ms`,
   `copy_detected`, `copy_reason`, shared identity, and `writeback_target`;
4. a rejected `detectCopy` emits exactly one failed event with
   `failure_reason: detect_copy_failed`, no raw message, and no copy verdict;
5. the raw fallback reports `writeback_target: raw`;
6. `sampleRateFor('viewer_adf_scan_completed')` is `1`.

Run and observe the new assertions fail:

```bash
pnpm test:unit src/utils/viewerLoad/deferredCopyCheck.spec.ts \
  src/utils/analytics/eventSampling.spec.ts
```

### Green

Extend `runDeferredCopyCheck` with a typed `macroType: MacroTypeValue` argument.
Measure elapsed time immediately around `detectCopy` with a monotonic clock.
Preserve the existing verdict/writeback/cleanup behavior, then make one
non-throwing call to `trackAnalyticsEvent` with the approved contract.

Do not add the event to `EVENT_SAMPLE_RATES`; the default rate of `1` is the
approved rollout behavior.

Re-run the focused tests and commit:

```bash
git add src/utils/viewerLoad/deferredCopyCheck.ts \
  src/utils/viewerLoad/deferredCopyCheck.spec.ts \
  src/utils/analytics/eventSampling.spec.ts
git commit -m "feat(analytics): report deferred ADF scan completion"
```

## Task 5: Wire the resolved macro type

**Files:**

- Modify `src/forgeIndex.ts`
- Modify the narrowest existing `forgeIndex` test/harness if one covers the
  dispatch; otherwise rely on the typed helper tests plus build validation.

At the existing fire-and-forget dispatch, pass the resolved diagram type as a
`MacroTypeValue`, with the same Sequence-family fallback already used by editor
journey analytics. Do not move the dispatch or introduce an `await`.

Run:

```bash
pnpm test:unit src/utils/viewerLoad/deferredCopyCheck.spec.ts \
  src/components/Viewer/GenericViewer.spec.ts
pnpm build:lite
```

Commit:

```bash
git add src/forgeIndex.ts
git commit -m "feat(viewer): identify deferred ADF completion"
```

## Task 6: Local validation

Run the repository validation workflow in proportion to the change:

```bash
pnpm test:unit src/utils/analytics/renderIdentity.spec.ts \
  src/utils/analytics/trackRenderTime.spec.ts \
  src/utils/analytics/eventSampling.spec.ts \
  src/utils/viewerLoad/deferredCopyCheck.spec.ts \
  src/components/Viewer/GenericViewer.spec.ts
pnpm test:unit
pnpm lint
pnpm build:lite
```

Compare any pre-existing failures with a clean `origin/main` worktree. Run
`git diff --check`, inspect the final diff, and verify no unrelated or private
data entered public files.

## Task 7: Ship and merge

Use the repository branch-shipping workflow:

1. push the feature branch;
2. open a PR describing the telemetry gap, event contract, tests, and rollout
   gate without naming any tenant;
3. wait for the surviving `pull_request` CI run on the head SHA;
4. treat the duplicate cancelled `push` run as expected;
5. merge only after required checks pass;
6. verify main's staging deployment and draft releases succeed.

## Task 8: Staging UI spot check

Write the spot-check assertions before opening the browser.

Target a Lite staging page with a known same-page duplicate:

- confirm `zenumlDebug` and deployed merge commit;
- intercept and hold the exact page-ADF GET;
- assert the diagram is visibly rendered while the response is held;
- release the response and assert the duplicate warning appears without a
  remount;
- capture screenshot/snapshot evidence;
- intercept `macro_viewed` and `viewer_adf_scan_completed`, asserting equal
  `instance_nonce`, `result: succeeded`, `copy_detected: true`, and a numeric
  `page_adf_fetch_ms`.

Mark any undrivable UI assertion skipped with its blocker; unit tests cannot
substitute for UI evidence.

## Task 9: Lite release and production validation

Release Lite with the repository release workflow. Reuse the fresh draft
release created by merged CI when eligible. Run Lite production PVT, then a
release-delta spot check on the existing internal canary:

- UI still renders;
- `macro_viewed.adf_deferred` is true;
- completion event arrives with the same nonce and the released version/commit;
- the natural page-ADF response remains outside the render dependency.

Do not widen production during the release turn.

## Task 10: Staged production rollout

Keep the explicit internal canary rule above percentage rules. After 24 hours
of healthy completion telemetry, add a production `Everyone` rule at 10%, then
advance to 50% and 100% with at least 24 hours per stage.

At each gate:

- query visible-tab events only;
- segment render duration by `cache_state` and build commit;
- join render/completion signals by `instance_nonce` and `time_origin`;
- stop on scan failures, missing completion signals beyond expected iframe
  teardown, copy-warning regression, or render regression;
- disable the percentage rule on failure while retaining staging and the
  explicit internal canary for diagnosis.

After Lite remains healthy at 100%, repeat staging/canary/percentage rollout
for Diagramly and Full. AsyncAPI is N/A for this Sequence-family path.
