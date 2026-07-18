// src/utils/analytics/publishTiming.ts
//
// Measures the user-perceived macro publish latency: the interval from the
// moment the user clicks Publish/Save in the editor to the moment the editor
// begins its redirect (view.submit() / view.close()). This is a WIDER window
// than saveToPlatform's `save_duration_ms` — it also spans the ~500ms
// pre-submit delay, the save-time attachment race, and the macro-config
// writeback, i.e. everything the user waits through before the editor closes.
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

import { trackAnalyticsEvent } from "./trackAnalyticsEvent";
import type { AnalyticsProperties } from "./types";
import type { MacroTypeValue } from "./catalog";

let publishClickedAt: number | null = null;

// Record the click instant. Called at the start of each save handler, which
// runs synchronously with the Publish button click (EventBus/postMessage
// dispatch is sub-millisecond relative to the hundreds-to-thousands of ms this
// metric measures).
export function markPublishClicked(): void {
  publishClickedAt = performance.now();
}

// Emit macro_publish_completed with the click→redirect latency, then clear the
// mark. No-ops if no publish click was marked (e.g. a plain cancel/close).
// Call at the redirect choke point, immediately before view.submit()/close().
export function trackPublishCompleted(
  props: { macro_type: MacroTypeValue } & Partial<AnalyticsProperties>,
): void {
  if (publishClickedAt == null) return;
  const publish_duration_ms = Math.round(performance.now() - publishClickedAt);
  publishClickedAt = null;
  trackAnalyticsEvent("macro_publish_completed", {
    feature_area: "macro",
    surface: "editor",
    publish_duration_ms,
    ...props,
  });
}

// Test-only: reset the module-level mark between cases.
export function _resetPublishTimingForTesting(): void {
  publishClickedAt = null;
}
