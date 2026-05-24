# Upgrade Tracking Events — Quick Reference

Canonical event names match `src/utils/analytics/catalog.ts` and `src/utils/upgradeTracking.ts`.

## Lite paywall (current modal)

The paywall modal (`UpgradePrompt.vue`) is **advocacy-only**. In-modal intent is captured when the user successfully copies the templated message.

| Scenario | Mixpanel `event` / name | Notes |
|----------|-------------------------|--------|
| Modal shown | `upgrade_modal_shown` | `trigger_source`, upgrade context from `getUpgradeContext()` |
| User copies advocacy text (clipboard succeeds) | `advocacy_message_copied` | `ui_component: modal` |
| User toggles draft preview | `advocacy_draft_preview_clicked` | `ui_component: modal`, `expanded` |
| Modal dismissed (backdrop / Escape / flow that calls close) | `upgrade_modal_dismissed` | `time_spent` (seconds) |
| Continue without upgrading | `paywall_continued_editing` | Footer CTA |

## Viewer / editor (not the modal)

| Scenario | Event |
|----------|--------|
| Clicks **Upgrade** in viewer header (Lite) | `paywall_triggered` with `action_type: header_badge`, `ui_component: viewer_notice` |
| Blocked at edit gate | `paywall_blocked_edit` / `paywall_triggered` per entry point |

## Session / tenant signals

| Scenario | Event |
|----------|--------|
| CSS flag enabled or paid space detected | `upgrade_feature_enabled` (from `useCustomerSuccessService.ts`) |

## `UIComponent` enum

- `header_badge`, `tooltip`, `viewer_notice`, `banner`, `modal` — see `src/utils/upgradeTracking.ts`

## Legacy SQL examples

Historical dashboards may still reference removed event names from older app versions. Prefer Mixpanel Lexicon / Insights for current production names.
