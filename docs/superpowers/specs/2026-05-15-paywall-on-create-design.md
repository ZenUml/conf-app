# Paywall on macro CREATE — design

**Status:** approved, ready to ship
**Date:** 2026-05-15
**Variant scope:** Lite only (Full / Diagramly bypass via `useCustomerSuccessService.isLite()`)

## Goal

Extend the existing edit-path paywall to also gate the **create** path. Today, a Lite tenant that has hit the 100-macro space limit only sees the paywall when re-opening an existing macro; users discover they can bypass it by inserting a new macro of the same type. Close that hole.

## Data justification (last 30 days, Mixpanel project 3373228)

- `macro_create_succeeded` = 5,771 events / 727 unique users
- `macro_save_succeeded` (= true edit volume across all types) = 4,285 / 583 unique users
- `paywall_blocked_edit` = 737 (only 17% of edits, because most spaces are below the 100-macro limit)
- Creates : Edits ≈ 1.35 : 1 — closing the create hole adds ~35% more high-intent touchpoints

## Behaviour

Mirror the existing edit-blocked pattern (`src/forgeIndex.ts:152-200`, parallel branches in `forge-graph-editor.ts`, `forge-embed-editor.ts`, `forge-swagger-editor.ts`):

1. When the editor is about to mount AND `isNew === true` AND `shouldBlockActions === true`:
   - Mount the editor wrapped in `PageEditorPaywallGate` (same component used for edit)
   - Fire `paywall_blocked_create` + `paywall_triggered` (action_type `page_editor_create`)
2. Soft block — match existing edit behaviour. The user can dismiss the modal with "Continue editing", but `shouldBlockActions` still blocks the actual save in `Persistence.ts`. (Persistence already short-circuits when `shouldBlockActions` is true. Verify this is true; if not, add the guard.)
3. Same modal copy as edit path. Single new event name to distinguish create-path from edit-path in analytics.

## Files

| File | Change |
|---|---|
| `src/utils/paywall/preEditGate.ts` | Add `isPageEditorCreateBlocked(shouldBlockActions): boolean` (just returns `shouldBlockActions`; semantic clarity at call sites) |
| `src/utils/upgradeTracking.ts` | Add `PAYWALL_BLOCKED_CREATE = 'paywall_blocked_create'` to `UpgradeEventName` |
| `src/utils/analytics/catalog.ts` | Add `'paywall_blocked_create'` to `AnalyticsEventName` union |
| `src/forgeIndex.ts` | Add create-branch gate in `isSequence` block (and `isGraph`/`isEmbed` branches if they reuse this entrypoint) |
| `src/forge-graph-editor.ts` | Add create-branch gate (parallel to `if (isPageEditorEditBlocked(...))` at line 203) |
| `src/forge-embed-editor.ts` | Add create-branch gate (parallel to line 137) |
| `src/forge-swagger-editor.ts` | Add create-branch gate (parallel to line 257) |
| Spec files (if existing for preEditGate) | Add unit test for `isPageEditorCreateBlocked` |

## Verification

- `pnpm test:unit` passes
- Local: set `localStorage.mockCSSEnabled='true'`, `mockMacroCount='100'`, `mockSpacePaid='false'` → opening a NEW macro should show the paywall modal over a mounted editor
- `paywall_blocked_create` shows up in network requests to Mixpanel
- Existing edit-path paywall still fires `paywall_blocked_edit` (regression check)
- Full / Diagramly variants are unaffected (`shouldBlockActions` returns false because `isLite()` is false)

## Out of scope

- Hard-blocking the save itself (current edit path is soft — 77% continue rate is acceptable as the baseline)
- View-path paywall (refuted by data — 90% of viewers aren't creators)
- Heavy-user behavioural targeting (separate, larger initiative)
- PDF/Word export gating (separate initiative, Option 1A)
- PNG download watermark (separate trivial change, Option 1B)
