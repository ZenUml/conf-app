// src/utils/analytics/publishTiming.ts
//
// Measures the user-perceived macro publish latency: the interval from the
// moment the user clicks Publish/Save in the editor to the moment the editor
// begins its redirect (view.submit() / view.close()). This is a WIDER window
// than saveToPlatform's `save_duration_ms` — it also spans the post-save work
// (snapshot upload, D1 mirror sync, the save-time attachment race, the
// writeback context lookup), i.e. everything the user waits through before the
// editor closes. The graph, openapi and embed editors additionally wait a fixed
// 500 ms setTimeout before the redirect; the sequence family and asyncapi do
// not.
//
// Usage (per save flow):
//   markPublishClicked()            // at the save-handler entry (≈ the click)
//   ...save, attachment, writeback...
//   trackPublishCompleted({ ... })  // immediately before view.submit()/close()
//
// A single publish is in flight per editor iframe (each editor guards against
// double-submit while saving), so one module-level timestamp suffices. Every
// trackPublishCompleted is preceded by a markPublishClicked in the SAME save
// invocation, so a failed save that leaves the mark set can never bleed into a
// later emit — the next attempt re-marks at its own entry.
//
// Per-step timings: the steps that make up the wait record themselves with
// recordPublishStep()/recordPublishFlag() as they finish, and
// trackPublishCompleted attaches whatever was recorded. This is pure
// instrumentation — recording never awaits, throws, or reorders the close
// path. A step that did not run records nothing, so its property is ABSENT
// from the event rather than 0. Property definitions: types.ts, next to
// `publish_duration_ms`.
//
// Known limit: saves that are not a publish (the 'updateContent' autosave, the
// asyncapi viewer) also run saveToPlatform and so call recordPublishStep.
// Outside a publish that is a no-op (no click is marked). The guard is per
// STEP, not per save: a step that started before the click is dropped, but a
// later step of that same save (say, an autosave's mirror sync that begins after
// the click) is still counted, as is any step of a non-publish save that starts
// after the click. Not guarded against.

import { trackAnalyticsEvent } from "./trackAnalyticsEvent";
import type { AnalyticsProperties } from "./types";
import type { MacroTypeValue } from "./catalog";

let publishClickedAt: number | null = null;

// Steps timed in ms, and the one recorded as a flag. Their value types come
// from AnalyticsProperties (types.ts), so the spread into the event below stays
// type-checked against the catalog.
export type PublishTimedStep =
  | "snapshot_ms"
  | "mirror_sync_ms"
  | "attachment_capture_ms"
  | "attachment_ack_ms"
  | "writeback_context_ms";
export type PublishFlag = "attachment_timed_out";
type PublishStepProps = Pick<AnalyticsProperties, PublishTimedStep | PublishFlag>;

let publishSteps: PublishStepProps = {};

// Record the click instant. Called at the start of each save handler, which
// runs synchronously with the Publish button click (EventBus/postMessage
// dispatch is sub-millisecond relative to the hundreds-to-thousands of ms this
// metric measures).
export function markPublishClicked(): void {
  publishClickedAt = performance.now();
  // A new attempt starts clean: steps recorded by an earlier attempt that
  // failed (and so never emitted) must not be reported for this one.
  publishSteps = {};
}

// Record how long one step of the in-flight publish took, in ms. `startedAt` is
// the performance.now() reading taken when the step began; the duration runs to
// now. Call it when the step finishes (success or failure alike).
//
// No-ops when no publish is in flight (no click marked), and drops a step that
// started before the click — it belongs to something else (an autosave still
// running), not to this publish.
export function recordPublishStep(step: PublishTimedStep, startedAt: number): void {
  if (publishClickedAt == null || startedAt < publishClickedAt) return;
  publishSteps[step] = Math.round(performance.now() - startedAt);
}

// Record a yes/no fact about the in-flight publish (e.g. whether the
// attachment-backup cap fired). Same no-op rule as recordPublishStep.
export function recordPublishFlag(flag: PublishFlag, value: boolean): void {
  if (publishClickedAt == null) return;
  publishSteps[flag] = value;
}

// Emit macro_publish_completed with the click→redirect latency and the
// per-step timings recorded since the click, then clear the mark. No-ops if no
// publish click was marked (e.g. a plain cancel/close). Call at the redirect
// choke point, immediately before view.submit()/close().
export function trackPublishCompleted(
  props: { macro_type: MacroTypeValue } & Partial<AnalyticsProperties>,
): void {
  if (publishClickedAt == null) return;
  const publish_duration_ms = Math.round(performance.now() - publishClickedAt);
  const steps = publishSteps;
  publishClickedAt = null;
  publishSteps = {};
  trackAnalyticsEvent("macro_publish_completed", {
    feature_area: "macro",
    surface: "editor",
    publish_duration_ms,
    ...steps,
    ...props,
  });
}

// Test-only: reset the module-level mark between cases.
export function _resetPublishTimingForTesting(): void {
  publishClickedAt = null;
  publishSteps = {};
}
