---
name: pvt-paywall-banner
description: >
  Validate the persistent Lite paywall page banner for unpaid, over-limit spaces.
  Covers author/admin targeting, Plan and usage navigation, absence of dismissal,
  immediate reloads with legacy dismissal markers, and banner priority.
  Triggers on "pvt-paywall-banner", "test paywall banner", "validate warning banner".
---

# PVT — Paywall Page Banner

The banner appears for an unpaid Lite space with **more than 100 macros** and
an enabled effective paywall policy. The viewer must have authored a macro in
the past 30 days or administer the space. Paid/exempt spaces and unrelated
readers remain ineligible. The banner has **no close button or impression
frequency limit**. Editing remains unblocked.

## Setup

Use the **spot-check** skill to write the plan, confirm the deployed commit and
operate the real Forge iframe. Use Lite staging for branch checks and the Lite
production app for post-release checks. Full/Diagramly do not write the targeting
marker. Apply mocks only on a controlled test page and only in the app's Forge
origin, never the top-level Confluence origin.

Reuse `tests/e2e-tests/helpers/pageBanner.ts::showWarningBanner`: it seeds
`mockCSSEnabled=true`, `mockSpacePaid=false`, `mockMacroCount=101`, and recent
macro-author activity. The macro writes the targeting marker; the page-banner
host reads it on a subsequent page load. Wait for the marker/banner rather
than relying on fixed delays. For the admin case, use an actual test space
admin and verify the probe result, with no recent authoring marker.

Markers share the same domain/space identity:

- `paywallWarning:<domain>:<space>`: targeting and effective policy.
- `paywallActivity:<domain>:<space>`: recent create/edit activity.
- `paywallBanner:<domain>:<space>`: impression analytics only (`showCount`,
  `lastShownAt`). Older records may contain `dismissedAt`; it is ignored.

## Checks

Capture a screenshot or snapshot for each UI assertion.

1. **Author:** banner contains "101 of 100", shows `paywall-banner-plan-usage`,
   has no `paywall-banner-dismiss`, and no space-purchase button.
2. **Navigation:** click View plan and usage and verify the destination app page
   actually loads. A click event alone does not prove arrival.
3. **Persistence:** reload immediately and verify the banner remains visible.
   Seed the existing impression key with `showCount: 100`, current `lastShownAt`
   and current legacy `dismissedAt`; reload and verify it still appears.
4. **Admin:** without recent authoring, the eligible space admin sees the banner,
   Plan and usage, and `paywall-banner-unlock-space`. Check the purchase target
   without completing a payment.
5. **Eligibility:** at 100 macros or fewer, a paid space, an exempt policy, or a
   non-admin with no recent authoring, the paywall banner is absent. Another
   eligible banner may occupy the slot, so do not equate absence of this banner
   with closure of the entire host.
6. **Priority:** with both paywall eligibility and a fresh CSAT signal, the host
   shows paywall. Once the space is ineligible for paywall, normal CSAT selection
   resumes. There is no dismissal-based path to make room for CSAT.

## Analytics

Verify send-side event evidence where ingestion may lag:

- `paywall_banner_shown`: each eligible mount, `surface=page_banner`, with
  `show_count`, optional `hours_since_last_shown`, and audience/count context.
  These properties describe impressions; they never suppress one.
- `plan_usage_viewed`: `surface=page_banner` means CTA click; `surface=dashboard`
  is emitted by the destination. Keep those two meanings separate.
- `paywall_bundle_cta_clicked`: space-admin purchase CTA.
- `paywall_banner_dismissed`: historical only; no longer emitted by this banner.

## Cleanup and scope

Remove only the mocks/markers injected for this test, in the Forge origin.
Do not clear an entire browser profile. The local Storybook preview can verify
the component layout, but cannot replace the live Forge host checks above.

CI covers the live host in `tests/e2e-tests/tests/insert/paywall-page-banner.spec.ts`.
The eligibility matrix and legacy-marker behavior live in
`src/utils/paywall/warningBanner.spec.ts`; the component and CTA checks live in
`src/components/UpgradePrompt/PaywallWarningBanner.spec.ts`.
