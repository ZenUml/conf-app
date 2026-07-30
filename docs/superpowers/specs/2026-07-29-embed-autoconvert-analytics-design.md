# Embed AutoConvert Analytics Design

**Date:** 2026-07-29
**Status:** Approved for implementation

## Problem

The Lite production app can turn a pasted ZenUML deeplink into an Embed macro, but successful use is invisible in analytics. The only shipped feature-specific event, `embed_autoconvert_cross_tenant_rejected`, covers one rejection path. It cannot answer whether an autoconverted macro was detected or whether its referenced diagram loaded.

The landing-page Worker cannot fill this gap: Confluence intercepts a matching paste before requesting the URL, and Worker request-path logging is intentionally disabled for client privacy.

## Goals

- Establish a typed Mixpanel denominator whenever the Embed viewer actually uses `autoConvertLink`.
- Record whether the referenced same-tenant diagram resolved successfully.
- Record stable, low-cardinality failure reasons.
- Preserve the existing cross-tenant rejection event and runtime behavior.
- Follow the repository's `trackAnalyticsEvent` lifecycle conventions and automatic context enrichment.

## Non-goals

- Logging the raw deeplink, cloud ID, page title, diagram body, or errors containing customer content.
- Counting the original paste action exactly. `autoConvertLink` persists in page ADF, so the viewer observes it again on later page renders.
- Adding analytics to ordinary configured Embed macros.
- Changing matching, authorization, fallback, rendering, or error UI behavior.

## Event contract

| Event | Trigger | Key properties |
|---|---|---|
| `embed_autoconvert_detected` | The Embed viewer has no configured `customContentId` and receives a top-level `autoConvertLink`. Fires once per viewer initialization. | Standard enriched context; `feature_area: macro`; `surface: viewer`; `macro_type: embed`; `source: autoconvert_link`; parsed `custom_content_id` when available; `is_same_site` when determinable. |
| `embed_autoconvert_target_resolved` | A valid accepted link resolves to custom content containing a diagram value. This is not a visual-render success claim. | Same properties, with `custom_content_id` and `is_same_site: true` when the current cloud ID is available. |
| `embed_autoconvert_failed` | AutoConvert resolution cannot proceed or complete. | Same properties plus `failure_reason`: `invalid_url`, `target_missing`, or `fetch_failed`. |
| `embed_autoconvert_cross_tenant_rejected` | Existing event: the parsed cloud ID differs from the current site. It remains the terminal outcome for this case; no duplicate `embed_autoconvert_failed` is emitted. | Add `source: autoconvert_link`, parsed `custom_content_id`, and `is_same_site: false`. |

Every detected initialization produces exactly one terminal event: `succeeded`, `failed`, or `cross_tenant_rejected`.

The tracker already enriches events with `client_domain`, `user_account_id`, `product_type`, `environment_type`, `app_version`, `app_commit`, `page_id`, and `macro_uuid`. The implementation must not duplicate or bypass that mechanism. Because `custom_content_id` is absent from config on this path, the parsed ID is supplied explicitly.

## Interpretation

`embed_autoconvert_detected` proves that Confluence created or retained an Embed macro carrying `autoConvertLink`; it does not uniquely count paste actions. `embed_autoconvert_target_resolved` proves that the app resolved a valid diagram document; it does not independently prove pixels were visible.

For adoption reporting:

- Event total = autoconverted macro render attempts.
- Unique user = people who viewed an autoconverted macro.
- Unique `client_domain` = tenants where the feature was observed.
- Distinct `(page_id, macro_uuid)` pairs approximate persisted autoconverted macro instances and avoid treating repeat page views as new conversions.

This explicit interpretation prevents a render-time signal from being reported as an exact paste count.

## Runtime flow

The existing precedence remains unchanged:

1. Use configured `customContentId` when present; emit no AutoConvert events.
2. Otherwise, if `autoConvertLink` is present, emit `detected` and parse it.
3. Invalid link: emit `failed` with `invalid_url`; preserve existing fallback behavior.
4. Cross-tenant link: emit the existing rejection event and never fetch.
5. Same-tenant link: fetch the referenced custom content.
6. Valid diagram value: emit `target_resolved` and continue the existing render flow.
7. Empty/missing value: emit `failed` with `target_missing`, then continue existing orphan/fallback handling.
8. Thrown fetch: emit `failed` with `fetch_failed`, then rethrow so existing viewer error handling remains unchanged.

## Analytics registration and commit order

The feature branch's first commit registers the three new event names in `src/utils/analytics/catalog.ts` and adds the typed `is_same_site` property plus event-specific documentation in `src/utils/analytics/types.ts`. Runtime instrumentation follows in a later commit.

All events remain unsampled because feature adoption volume is expected to be low and the events form a lifecycle funnel.

## Testing

A focused Vitest suite around the Embed viewer load callback will mock Forge context, custom-content fetch, and `trackAnalyticsEvent`. It will verify:

- same-tenant resolution emits `detected` then `target_resolved`;
- an invalid link emits `detected` then `failed: invalid_url`;
- missing content emits `detected` then `failed: target_missing`;
- a thrown fetch emits `detected` then `failed: fetch_failed` and preserves the throw;
- cross-tenant input emits `detected` then `cross_tenant_rejected`, performs no fetch, and does not emit generic failure;
- an ordinary configured Embed macro emits no AutoConvert lifecycle events.

Validation will run the focused tests, the analytics type-checking tests, TypeScript checking, and lint on changed files. No UI assertion is claimed by these telemetry tests.
