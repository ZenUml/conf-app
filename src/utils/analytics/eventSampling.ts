// src/utils/analytics/eventSampling.ts
//
// Central, build-time event sampling to keep Mixpanel volume under quota.
//
// Both emit paths consult this before calling `mixpanel.track`:
//   - trackAnalyticsEvent (modern) keyed on the AnalyticsEventName
//   - trackEvent          (legacy, utils/window.ts) keyed on the `action` arg
//
// An event maps to a keep-probability in [0, 1]:
//   1 (or absent) — always emit (the default; product, paywall, funnel, error events)
//   0             — never emit (telemetry whose purpose is served; e.g. validated rollouts)
//   0 < r < 1     — emit a random fraction r; the emitted event is stamped with
//                   `sample_rate: r` so downstream extrapolates `count / r`.
//
// Single source of truth: change a rate here, and it takes effect on the next
// deploy across every call site of that event — no per-site edits.

export const EVENT_SAMPLE_RATES: Record<string, number> = {
  // --- Sampled to 10% -------------------------------------------------------
  // High-volume success / info diagnostics. 10% plus `sample_rate` extrapolation
  // is ample for rate/health trends; we do not need every occurrence.
  convert_to_png: 0.1, // model/Attachment.ts — PNG render side-effect
  upload_attachment: 0.1, // model/Attachment.ts — attachment upload (success path)
  attachment_upload_succeeded: 0.1,
  attachment_upload_app_fallback_started: 0.1,
  attachment_upload_app_fallback_succeeded: 0.1,
  attachment_upload_skipped: 0.1,
  sync_custom_content: 0.1, // services/CustomContent.ts (success path)
  update_custom_content: 0.1, // model/ApWrapper2.ts (info path)
  report_macro_metrics: 0.1, // KV metrics reporting
  duplication_detect: 0.1, // model/ApWrapper2.ts — cross/same-page warning probe
  click: 0.1, // generic UI-click telemetry (edit/fullscreen/copy_link/…)
  close_guard_rejected: 0.1, // editor close-guard diagnostic

  // Phase-5a admin-activity probe (spaceAdminProbe.ts). The measurement question
  // — "do admins load Confluence pages on Lite installs?" — is answered (~38k
  // distinct domain×space×admin contexts in 17 days; the 30-day localStorage
  // throttle works, ~86% of triples fire exactly once). The volume is genuine
  // cardinality, not a leak, so sample the signal rather than chase the throttle.
  space_admin_active: 0.1,

  // --- Quota reduction 2026-08-26 -------------------------------------------
  // Fired once per macro view by DiagramAttributionFooter.vue, so it scales
  // with `macro_viewed` and was the joint-largest product event at 62,338 in
  // the 2026-08-19..25 week (9.8% of all volume). Its question — how often the
  // attribution byline is seen, and with which of its two optional fields — is
  // a rate, not a census, so 5% plus `sample_rate` extrapolation answers it.
  diagram_attribution_shown: 0.05,

  // --- Quota reduction 2026-09-07 -------------------------------------------
  // Fires once per eligible viewer INSTANCE, so a page of macros produces one
  // per macro: 80,912 occurrences from 4,414 unique users in the 30 days to
  // 2026-09-07 — 18.3 each, and 19.4% of all billable event volume, which is
  // most of the month's projected overage on its own.
  //
  // Its only consumer is the Copy for AI discovery rate (clicks ÷ impressions),
  // a rate rather than a census, and the click side stays at full fidelity.
  // The rate this event was built to produce is 3.76% (166 ÷ 4,414), first
  // computed on 2026-09-07 — after the demand test it was meant to inform had
  // already concluded on its own denominator.
  //
  // Caveat for whoever reads it next: `sample_rate` extrapolates EVENT counts,
  // not UNIQUE-USER counts. At 10% a user averaging 18.3 impressions still has
  // an ~86% chance of keeping at least one, so the unique-user denominator
  // shrinks by roughly a seventh rather than by nine tenths — but the loss
  // falls hardest on users with a single impression, which biases the
  // denominator toward heavier viewers and makes the measured discovery rate a
  // slight UNDER-estimate. Take the pre-sampling 3.76% as the reference point.
  copy_for_ai_impression: 0.1,
};

// Prefix rules apply when no exact match is found. `create_attachment` is
// emitted as `create_attachment<diagramType>` (e.g. create_attachmentmermaid)
// at forgeIndex.ts, so an exact key cannot cover every variant.
const PREFIX_RULES: ReadonlyArray<readonly [string, number]> = [
  ["create_attachment", 0.1],
];

/** Keep-probability for an event name/action. Defaults to 1 (always emit). */
export function sampleRateFor(name: string): number {
  if (Object.prototype.hasOwnProperty.call(EVENT_SAMPLE_RATES, name)) {
    return EVENT_SAMPLE_RATES[name];
  }
  for (const [prefix, rate] of PREFIX_RULES) {
    if (name.startsWith(prefix)) return rate;
  }
  return 1;
}

export interface SampleDecision {
  /** Whether to emit this occurrence. */
  keep: boolean;
  /** The applied rate — stamp as `sample_rate` when < 1 so volume extrapolates. */
  rate: number;
}

/**
 * Decide whether to emit one occurrence of `name`. `rng` is injectable so tests
 * are deterministic; production uses Math.random.
 */
export function decideSample(
  name: string,
  rng: () => number = Math.random,
): SampleDecision {
  const rate = sampleRateFor(name);
  if (rate >= 1) return { keep: true, rate: 1 };
  if (rate <= 0) return { keep: false, rate: 0 };
  return { keep: rng() < rate, rate };
}
