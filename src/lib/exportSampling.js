// src/lib/exportSampling.js
//
// Sampling for the export events, which are emitted from the Forge backend
// functions (src/export.js, src/asyncapi-export.js) straight to the Mixpanel
// /import endpoint. That path never touches the browser bundle, so
// src/utils/analytics/eventSampling.ts does NOT apply to it — these two tables
// are separate on purpose, and each is the single source of truth for its own
// transport. Keep the semantics identical: a keep-probability in [0, 1], and
// every emitted event stamped with `sample_rate` so a count extrapolates as
// `count / sample_rate`.
//
// Why these three are sampled (quota reduction, 2026-08-26): the account is
// over its monthly Mixpanel allowance, and the export family was the largest
// product contributor at 208,256 events in the 2026-08-19..25 week — 32.7% of
// all volume, more than macro_viewed. The events are not user-initiated
// clicks: `exportMacro` is invoked by Confluence when it renders a macro for
// a page export, measured at 12,407 invocations/day on Lite production alone.
// Nothing here asks a per-occurrence question; requested/succeeded feed volume
// trends and failed feeds a failure composition, all of which survive
// extrapolation.
//
// `macro_export_failed` keeps twice the rate of the success paths so the
// failure-reason breakdown keeps usable counts in its smaller buckets.

export const EXPORT_EVENT_SAMPLE_RATES = {
  macro_export_requested: 0.05,
  macro_export_succeeded: 0.05,
  macro_export_failed: 0.1,
};

/** Keep-probability for an export event name. Unlisted names always emit. */
export function exportSampleRateFor(eventName) {
  if (Object.prototype.hasOwnProperty.call(EXPORT_EVENT_SAMPLE_RATES, eventName)) {
    return EXPORT_EVENT_SAMPLE_RATES[eventName];
  }
  return 1;
}

/**
 * Decide whether to emit. Returns null to drop, or the properties to merge
 * into the event (a `sample_rate` stamp when the event was sampled).
 *
 * `random` is injectable so tests are deterministic.
 */
export function decideExportSample(eventName, random = Math.random) {
  const rate = exportSampleRateFor(eventName);
  if (rate >= 1) return {};
  if (rate <= 0) return null;
  if (random() >= rate) return null;
  return { sample_rate: rate };
}
