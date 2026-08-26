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
  // --- Dropped (rate 0) -----------------------------------------------------
  // Quota reduction 2026-08-26: the account is over its monthly Mixpanel
  // allowance. This event is a SECOND COPY of data we already keep in full.
  // `maybeSendFirstSeenPing` POSTs every ping to /forge-user-behavior, which
  // writes AnalyticsEventFact in D1 and archives the raw event to R2, and that
  // handler deliberately does not forward to Mixpanel. Measured over
  // 2026-08-19..25: D1 held 73,592 rows across 781 domains and 31,595 accounts
  // while Mixpanel recorded 62,392 — the durable copy is the more complete one.
  // Dropping the Mixpanel emission loses no census data; query D1 instead.
  app_first_seen: 0,

  // EAG-64 renderer prefetch. The rollout is validated (100% on Diagramly +
  // Lite); warm-vs-cold render is already measured via macro_viewed.cache_state
  // (trackRenderTime.ts), so the dedicated attempt/outcome telemetry no longer
  // earns its volume (~1 per deploy per browser × the whole install base). The
  // prefetch BEHAVIOUR is untouched — only its analytics are suppressed.
  renderer_prefetch_started: 0,
  renderer_prefetch_completed: 0,

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
