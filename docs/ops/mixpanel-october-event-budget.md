# October 2026 Mixpanel event budget

This temporary policy applies from `2026-10-01T00:00:00Z` up to but not
including `2026-11-01T00:00:00Z`. New event decisions after that boundary use
the prior rates automatically. It changes telemetry volume, not product behavior
or Forge feature flags.

The browser's typed and legacy trackers both use
`src/utils/analytics/eventSampling.ts`. Its explicit
`OCTOBER_REDUCED_EVENTS` set is the full reviewed allowlist of conf-app
success/info names; each receives **one tenth of its current rate** (for
example, 1 → 0.1, 0.1 → 0.01, 0.05 → 0.005). The dynamic legacy
`create_attachment<diagramType>` family follows the same rule. This is a
single sampling decision at the final absolute rate. Kept events carry that
rate in `sample_rate`, so event totals can be estimated as
`count / sample_rate`. The legacy `error` category still bypasses sampling.

Seven named diagnostics stop during the window:
`cohorts_refreshed`, `copy_for_ai_impression`,
`editor_global_replace_observed`, `report_macro_metrics`,
`snapshot_backfill_skipped`, `viewport_control_used`, and
`whats_new_banner_evaluated`. The source allowlist preserves every name in the
reviewed `retain_current_frequency` plan, plus additional failure/error and
feedback/survey/CSAT names. Core macro create, edit, save, publish and paywall
events, `macro_viewed`, `snapshot_created`, and explicit feedback remain at
their prior rates. Events not explicitly listed in either October set retain
their prior rate, including unknown names from other products sharing the
Mixpanel project. The catalog also declares some names currently emitted only
by backend code; listing one here does not change its backend transport.

`macro_viewed` keeps its existing trigger, name, properties, and 100% event
rate through September, October, and November. For historical comparison,
hold the production site, product, and user population filters constant.
Project-wide totals are not directly comparable across the earlier CI staging
isolation change, because new staging test arrivals are now suppressed.

The related feature-success signals
`diagram_attribution_shown`, `diagram_audience_registration_succeeded`,
`related_diagrams_lookup_succeeded`, `related_token_indicators_shown`, and
`whats_new_banner_shown` all use the same one-tenth *relative* change. Their
existing base rates still differ. `copy_for_ai_impression` is stopped and its
menu-open event is reduced; the low-volume `copy_for_ai_clicked` action stays
at its current full rate to preserve the existing wire assertion and action
signal. Unique-user discovery and feature funnels
for October are incomplete. Multiplying a sampled event count by
`1 / sample_rate` estimates event occurrences, **not** unique users or joined
funnels. Compare October trends with the policy boundary and both transport
rates in view.

Forge export telemetry has a separate transport and table in
`src/lib/exportSampling.js`. Its `macro_export_requested` and
`macro_export_succeeded` rates change from 0.05 to 0.005 during October;
`macro_export_failed` stays at 0.1. Its import payload carries the final
absolute rate. Cloudflare service imports and other Mixpanel products are
outside this policy. The browser catalog contains some export names, but the
Forge export handler uses its own sampler and does not use the browser table.

This is a volume policy, not an observed fee reduction. A cost estimate needs
actual post-release arrivals, the independent backend transports, and the
project's billing totals.
