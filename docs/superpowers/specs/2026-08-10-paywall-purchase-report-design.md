# Paywall purchase-intent report correction

## Goal

Make dashboard report 2 answer only questions its event data can support.

## Findings

- `paywall_bundle_cta_clicked` and `paywall_marketplace_cta_clicked` are the correct purchase-intent events.
- Modal emissions identify `surface=modal`; they do not, and should not, claim a `banner_audience`.
- `banner_audience` is derived only in the page-banner context. The Marketplace rail is modal-only.
- Internal and staging domains must be excluded from customer analysis.

## Design

Replace report 2 with an external-customer **modal** purchase-rail report:

- Count total CTA events and unique users for both purchase-intent events.
- Filter both metrics to `ui_component=modal`; do not apply a cross-surface
  breakdown, because modal and page-banner emissions use different context
  properties.
- Exclude the project-defined internal and staging domains.
- Keep the report title and description explicit that it compares the two modal
  rails.

Create or retain a separate banner-only report for `paywall_bundle_cta_clicked`,
filter it to `surface=page_banner`, and split by `banner_audience`; it must not
include the Marketplace rail.

## Verification

1. Read the saved dashboard and report definitions after update.
2. Run the equivalent query through Mixpanel MCP with the same external-domain filters.
3. Confirm no current internal test clicks appear in the customer report and that every breakdown is semantically defined.

## Non-goals

- Do not add `banner_audience` to modal CTA events.
- Do not infer Confluence site-admin status, which the app does not detect.
- Do not change paywall gating or purchase UI behavior.
