# Deferred ADF Scan Completion Telemetry

**Status:** Approved for implementation on 2026-07-17

## Context

The `viewer-adf-scan-deferred` flag removes the page-ADF copy scan from the
Sequence/Mermaid/PlantUML viewer's blocking render path. `macro_viewed` is
intentionally captured at first render, so a scan that completes later cannot
reliably contribute `page_adf_fetch_ms` to that event.

Production validation established both sides of this behavior:

- a controlled Playwright intercept held the page-ADF response while the
  Mermaid UI rendered, proving that the viewer no longer waits for the scan;
- all seven deferred `macro_viewed` events in the validation sample omitted
  `page_adf_fetch_ms`, leaving background completion time and outcome
  unobservable.

The current internal production canary remains enabled while this gap is
closed. Broader production rollout must wait for the completion signal and the
late-copy UI assertion described below.

## Goals

- Emit one typed analytics event for every deferred ADF scan after it settles.
- Correlate the event with its originating `macro_viewed` event.
- Measure scan duration for both success and failure outcomes.
- Record whether the late verdict found a copy and whether the reactive store
  or raw-document fallback received the result.
- Preserve the existing non-blocking render and fail-open viewer behavior.
- Validate the user-visible late-copy warning before widening production.

## Non-goals

- Do not delay or duplicate `macro_viewed`.
- Do not change copy-detection rules, editor safety checks, or persistence.
- Do not change Graph, OpenAPI, Embed, or AsyncAPI viewer behavior.
- Do not broaden any production flag as part of the telemetry code change.
- Do not add permanent full-volume telemetry without a later sampling review.

## Approaches considered

### 1. Separate completion event — selected

Emit `viewer_adf_scan_completed` after the deferred scan and state writeback
settle. This keeps the render event truthful, makes late work observable, and
does not add a dependency to the critical path.

### 2. Delay `macro_viewed`

Capture the render duration immediately but wait to send `macro_viewed` until
the scan completes. This avoids another event, but couples the core readership
signal to background work and risks losing it if the Forge iframe closes.

### 3. Separate success and failure events

Use distinct completion and failure names. This simplifies failure alerting but
adds catalog and query complexity without improving the initial rollout
decision. A single event with a bounded `result` property is sufficient.

## Event contract

Register the event and properties before behavioral wiring, as the first code
commit of the implementation branch. This design document lands separately so
the repository rule that analytics vocabulary is the first feature commit
remains satisfied.

### `viewer_adf_scan_completed`

**Trigger:** exactly once for each `runDeferredCopyCheck` invocation, after
`detectCopy` settles and `copyCheckPending` has been cleared on the chosen
writeback target.

**Sampling:** 100% during the staged rollout. The current sampler is keyed only
by event name, so this event must remain at 100% until a separately designed
follow-up can sample successful outcomes while retaining every failure.

**Required call-site properties:**

- `feature_area: "macro"`
- `surface: "viewer"`
- `macro_type: "sequence" | "mermaid" | "plantuml"`
- `result: "succeeded" | "failed"`
- `adf_deferred: true`
- `page_adf_fetch_ms: number`
- `instance_nonce: string`
- `time_origin: number`
- `writeback_target: "store" | "raw"`

**Outcome properties:**

- `copy_detected: boolean` on success
- `copy_reason?: "cross-page" | "same-page-duplicate"` when a copy is found
- `failure_reason: "detect_copy_failed"` on failure; raw exception messages
  must not be sent

The standard tracker continues to enrich page, macro, custom-content, product,
environment, app version, and app commit identifiers.

## Architecture and data flow

### Shared render identity

Move the iframe-scoped instance nonce and time origin into a small analytics
identity module. Both `trackRenderTime` and the deferred completion path read
the same immutable identity, making this join reliable:

`macro_viewed.instance_nonce = viewer_adf_scan_completed.instance_nonce`

The module has no dependency on rendering or the Vue store.

### Deferred completion

`runDeferredCopyCheck` records a monotonic start time immediately before
`detectCopy`. Whether detection resolves or rejects, it:

1. computes `page_adf_fetch_ms`;
2. applies the verdict when present;
3. clears `copyCheckPending` through the reactive store proxy when the mounted
   diagram matches, otherwise through the existing raw-document fallback;
4. emits `viewer_adf_scan_completed` with the bounded outcome properties.

The tracking call remains fire-and-forget. Analytics initialization or delivery
failure cannot reject the copy scan, prevent state cleanup, or affect rendering.

### Macro type

`forgeIndex.ts` passes the already-resolved Sequence-family macro type to
`runDeferredCopyCheck`. The completion helper does not infer product routing
from module keys or inspect Forge context.

## Error handling

- `detectCopy` rejection preserves current behavior: `isCopy` stays unknown,
  the pending marker clears, and the viewer remains usable.
- The existing console warning remains available for local diagnosis.
- Analytics records only `failure_reason: "detect_copy_failed"`; it never sends
  response bodies, exception text, page content, or tenant names.
- Store import/write failure uses the existing raw-document fallback and records
  `writeback_target: "raw"`.
- The completion event is emitted from a final, non-throwing path so every
  settled deferred invocation makes one best-effort attempt.

## Verification

### Automated tests

- Catalog/type test: the new event name and bounded properties compile.
- Sampling test: the event defaults to a 100% keep rate during rollout.
- Identity test: `macro_viewed` and completion paths use the same nonce and time
  origin within one iframe module instance.
- Completion success test: one event, measured duration, copy verdict, reason,
  store writeback, and pending marker cleared before tracking.
- Completion failure test: one failed event with safe reason, measured duration,
  no copy verdict, and pending marker cleared.
- Raw fallback test: one event with `writeback_target: "raw"`.
- Existing GenericViewer late-verdict regression tests remain green.

### Staging UI spot check

Use a Lite staging page containing a known same-page duplicate:

1. enable `zenumlDebug` and confirm the deployed release commit;
2. intercept and hold the page-ADF request;
3. verify the diagram renders while the request is held and capture UI evidence;
4. release the response;
5. verify the duplicate warning appears without remounting;
6. capture the matching completion event with `result: "succeeded"`,
   `copy_detected: true`, and the same instance nonce as `macro_viewed`.

If Forge iframe automation cannot drive an assertion, mark it skipped with the
specific blocker rather than passing it from unit evidence.

## Release and rollout

1. Merge through the normal PR pipeline and verify staging deployment.
2. Release Lite and run production PVT plus a release-delta spot check.
3. Keep the existing internal production canary while completion telemetry is
   observed for 24 hours.
4. Add a production `Everyone` rule below the canary rule at 10%, then 50%, then
   100%, holding each stage for at least 24 hours.
5. At every gate, require no material scan-failure signal and compare visible-tab
   render duration by cache state against the flag-off cohort.
6. Stop expansion and disable the percentage rule if failures appear or render
   performance regresses.
7. Repeat the staged process for Diagramly and Full after Lite is stable.
   AsyncAPI is not applicable because it does not expose the Sequence-family
   viewer path.

After the rollout reaches 100%, review whether the volume warrants a separate
outcome-aware sampling change. That follow-up must keep failures fully
observable and is outside this design's scope.
