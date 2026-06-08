# Upgrade / Paywall Events

Full event descriptions, properties, and trigger sources are in [events-catalog.md](events-catalog.md) under the **Upgrade / paywall** section.

## Quick-reference table

| Event | Trigger |
|---|---|
| `paywall_triggered` | Paywall gate fires (fullscreen viewer or page editor) |
| `paywall_blocked_create` | Create blocked because space is at the macro limit |
| `upgrade_modal_shown` | Upgrade modal becomes visible |
| `upgrade_modal_dismissed` | User closes the modal without acting |
| `paywall_continue_used` | User clicks "Continue editing" (decrements grace counter) |
| `paywall_attempts_exhausted` | Grace counter reaches 0 — user locked out |
| `paywall_banner_shown` | Paywall warning banner renders (pageBanner iframe) |
| `paywall_banner_dismissed` | User dismisses the warning banner |
| `space_admin_active` | Space admin detected active (once per 30 days per space) |
| `advocacy_message_copied` | User copies the pre-drafted advocacy message |
| `advocacy_draft_preview_clicked` | User expands/collapses the draft preview |
| `extension_request_clicked` | User clicks the extension-request button |

## `UIComponent` enum values

`header_badge`, `tooltip`, `viewer_notice`, `banner`, `modal` — defined in `src/utils/upgradeTracking.ts`.

## Source files

- `src/utils/upgradeTracking.ts` — `trackUpgradeEvent` wrapper, `UpgradeEventName` enum
- `src/utils/paywall/mountPaywallGate.ts` — `paywall_triggered`, `paywall_blocked_create`
- `src/components/UpgradePrompt/useUpgradeTracking.ts` — modal shown/dismissed/copy/preview/request
- `src/components/UpgradePrompt/UpgradePrompt.vue` — continue/exhausted
- `src/components/UpgradePrompt/PaywallWarningBanner.vue` — banner shown/dismissed/copy/request
- `src/utils/paywall/spaceAdminProbe.ts` — `space_admin_active`
