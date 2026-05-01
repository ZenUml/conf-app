# Paywall Redesign — Message-Pitch Modal

**Date:** 2026-04-30
**Owner:** PM (eagle.xiao@gmail.com)
**Status:** Plan ready, not started

## Context

Current paywall has two structural problems:

1. **Bypass:** `shouldBlockActions` is checked only in `src/components/Viewer/GenericViewer.vue:264`. The Confluence page-editor flow (`src/forge-embed-editor.ts`) and the centralized save path (`src/model/ContentProvider/Persistence.ts:saveToPlatform`) bypass it silently. 5/8 colesgroup users blocked in viewer-mode successfully save via page editor on the same day.
2. **Conversion gap:** Last 30 days for colesgroup show 33 `paywall_triggered` events but only 1 `upgrade_cta_clicked` (`product_option: undefined`) and zero `upgrade_modal_shown` events. The funnel collapses between block and modal-view, not between click and Stripe.

## Buyer persona constraint (foundational)

The actual buyer is an EM, Director, or GM — an organizational role with no Confluence-API-visible identity. Site admins and space admins are the wrong target. Therefore: **we cannot identify or notify the buyer programmatically.** The user must do that work; our job is to make their pitch as effortless as possible.

## Design

When a user attempts to edit an existing macro in a saturated space, show a modal containing:

- A pre-written, copy-ready message describing the limit, the $299/space upgrade, the requester, and the existing Stripe link
- Three actions: `[ Copy message ]`, `[ Open in email ]`, `[ Continue editing ]`
- No self-attestation, no fake "Notify admin" button, no hard block
- Cadence: **every edit attempt past the limit** (no throttling), per PM decision — the gate fires when the user tries to open an existing macro for editing, before the editor mounts

`Continue editing` always succeeds — workflow continuity is preserved. Conversion pressure comes from the recurring friction of seeing the modal each time, plus the artifact (pre-written message) lowering activation energy for the user to escalate to their EM/Director/GM.

Other dismissal paths (Escape, backdrop click, × button, and upgrade-CTA clicks that open external URLs) close the modal but do **NOT** grant edit access — the gate stays in place and the user must explicitly click `Continue editing` to mount the editor. Only the explicit button fires `paywall_continued_editing`. This is what makes "users abandoning saves" (Stage 4 decision row) a distinct, measurable outcome — without this distinction, every modal show collapses into either a paid conversion or a silent bypass.

## Stages

---

### Stage 1: Telemetry Fix

**Goal:** Establish reliable baseline measurement before changing anything else.

**Why first:** We cannot optimize what we cannot measure. The current data shows 0 `upgrade_modal_shown` events despite 33 `paywall_triggered` — either the event isn't firing or we're tracking it wrong. Cannot ship new modal variants on top of broken eventing.

**Tasks:**
- Investigate why `upgrade_modal_shown` returns 0 results in Mixpanel for the past 30 days
- Trace `UpgradePromptRouter.vue` logic to confirm which variant (LegacyPrompt / HeavyCreatorPrompt / BystanderNotice / ComparisonView) renders for colesgroup users
- Fix `product_option: undefined` on `upgrade_cta_clicked` events — the tracking call in LegacyPrompt's children (MarketplacePricingCard, EnterpriseBundleCard) likely doesn't pass `product_option`
- Add a unit test that verifies `upgrade_modal_shown` fires when modal becomes visible
- Add a unit test that verifies `upgrade_cta_clicked` includes `product_option`

**Success Criteria:**
- `upgrade_modal_shown` fires reliably and is observable in Mixpanel
- `upgrade_cta_clicked` events include `product_option: marketplace | enterprise_bundle`
- New colesgroup data shows `upgrade_modal_shown` count ≥ `paywall_triggered` count (modal shows on every block)

**Tests:**
- Unit: render UpgradePromptRouter with various props, assert tracked events
- Manual: set localStorage mocks, trigger modal, verify event in Mixpanel Live View

**Status:** Not Started

---

### Stage 2: Pre-Edit Gate in Page-Editor Path

**Goal:** Both edit paths (viewer Edit button and Confluence page editor) enforce the same paywall rule **before the user invests any editing effort**.

**Why next:** The architectural fix is independent of UI changes. Closing the bypass is necessary for any subsequent UX experiment to produce meaningful signal.

**Critical UX constraint:** Block MUST be pre-edit. Blocking at save would discard user work — unacceptable. The viewer-mode check at `GenericViewer.vue:edit()` already follows this pattern (intercepts the Edit click before the editor opens). The page-editor flow needs an equivalent pre-mount gate.

**Where the gate goes:**

| Entry point | When it runs | Action |
|-------------|--------------|--------|
| `GenericViewer.vue:edit()` | Viewer Edit button click | Already gated — leave unchanged |
| `forge-embed-editor.ts:initializeMacro()` | Page editor opens macro | **NEW** gate before `mountRoot()` |
| `Persistence.ts:saveToPlatform()` | Save action | **Never gate here** — would destroy in-flight work |

**Tasks:**
- In `forge-embed-editor.ts:initializeMacro()`, before calling `mountRoot()`:
  - If `customContentId` is present (editing existing macro) AND `shouldBlockActions` is true: render the message-pitch modal (Stage 3 component) instead of the editor
  - If `customContentId` is absent (creating new macro): proceed normally — creates remain unblocked, consistent with current policy
- The same check must be replicated for any other Forge entry point that opens an editor (audit `src/forge-*.ts` files for parallel patterns)
- Verify `Full` app users are never blocked (existing `isLite()` short-circuit in `useCustomerSuccessService` must already handle this — confirm it does)
- Add tracking event `paywall_blocked_edit` with `action_type` ∈ {`viewer`, `page_editor`} to distinguish entry points

**Success Criteria:**
- A user blocked in viewer mode is also blocked when opening the same macro via page editor — without losing any in-flight work, because the block happens before the editor renders
- Creating a new macro in a saturated space remains allowed
- Full app users see no behavioral change
- `paywall_blocked_edit` events appear with both `action_type` values after rollout

**Tests:**
- Unit: `initializeMacro` short-circuits to modal when `shouldBlockActions=true` AND `customContentId` is present
- Unit: `initializeMacro` proceeds normally when `customContentId` is absent (new macro creation), even in saturated space
- Unit: `saveToPlatform` remains unchanged — no new gating logic added there
- Integration: simulated page-editor open of an existing macro in a saturated space renders the message-pitch modal; "Continue editing" then mounts the editor and a subsequent save succeeds
- Regression: existing viewer-mode tests pass; existing save tests pass (no save-path gate added)

**Status:** Not Started

---

### Stage 3: Message-Pitch Modal

**Goal:** Replace existing upgrade prompt with the shareable-pitch modal.

**Tasks:**
- New component `src/components/UpgradePrompt/MessagePitchModal.vue`
  - Editable textarea pre-filled with template:
    ```
    Hi [manager],

    Our team has hit the free-tier limit on ZenUML in the {spaceName}
    space. {n} of us are actively maintaining diagrams there.

    Upgrading is $299/year for this space — no admin permissions needed,
    anyone with a card can activate it: {stripeUrl}

    Happy to discuss.
    ```
  - `{spaceName}`, `{n}` (per-space user count from MacroMetrics), `{stripeUrl}` interpolated
  - Three buttons: `Copy message` (clipboard write), `Open in email` (mailto: link), `Continue editing` (close modal)
- Update `UpgradePromptRouter.vue` to route to MessagePitchModal as the new default for `personaAwarePaywallEnabled` tenants
- New tracking events:
  - `paywall_message_copied`
  - `paywall_message_emailed`
  - `paywall_continued_editing`
- Use the **existing static `buy.stripe.com` URL** in the message template — Stripe metadata fix is explicitly deferred

**Success Criteria:**
- Modal shows on every edit attempt past the limit (no throttling) — fires pre-edit, before the editor mounts; never at save time (per Stage 2 UX constraint)
- All three buttons fire correct tracking events
- Copy button puts the rendered message on the clipboard with no placeholders remaining
- Email button opens user's default mail client with subject + body prefilled

**Tests:**
- Unit: render with various space/macro counts, assert message text correctness
- Unit: clipboard mock — assert correct content written
- Unit: tracking events fire with expected properties on each button click
- E2E (Playwright preview project): full save → modal → copy → continue editing flow

**Status:** Not Started

---

### Stage 4: Rollout & Observation

**Goal:** Determine whether the new flow drives meaningful share/escalation activity, and whether it converts.

**Rollout cohort:** Existing CSS tenants only (colesgroup, airwallex, zeptonow). No CSS expansion until Stage 4 produces signal.

**Observation window:** 4–6 weeks.

**Daily monitoring:**
- `paywall_triggered` (volume baseline)
- `upgrade_modal_shown` (must equal triggers; sanity check)
- `paywall_message_copied` (primary intent signal)
- `paywall_message_emailed` (secondary intent signal)
- `paywall_continued_editing` (volume of dismissals)
- New `SPACE_LICENSE_KV` activations (conversion outcome)

**Decision branches at end of window:**

| Pattern | Interpretation | Next move |
|---------|---------------|----------|
| Copy/Email click rate > 20% of triggers, ≥1 conversion | Mechanism working | Plan Stage 5 (Stripe UX), expand cohort |
| Copy/Email click rate > 20%, 0 conversions | Manager-side persuasion failing | Iterate message copy; investigate landing-page UX |
| Click rate < 10% | Motivation insufficient under "every edit attempt" cadence | Stronger friction — consider hard block escalation after N continues |
| Modal shown but trigger count drops | Users abandoning saves | UX too aggressive — throttle to once-per-session |

**Success Criteria:**
- 6 weeks of clean data with all events firing correctly
- Either: ≥1 conversion attributable to message-share path, OR a clear directional finding for the next iteration

**Status:** Not Started

---

### Stage 5 (Conditional): Stripe Auto-Fill

**Goal:** Remove the manual domain/space-key entry friction at Stripe checkout.

**Trigger condition:** Stage 4 produces `paywall_message_copied` ≥ 30/month AND `share_link_visited` ≥ 10/month.

**Until trigger fires, this stage stays deferred.** With current click volume (1 in 30 days), even a perfect Stripe flow would not move conversion meaningfully.

**Tasks (when triggered):**
- Build `/upgrade/{cloudId}/{spaceKey}` landing page
- Server-side endpoint `POST /api/create-checkout-session` that creates a Stripe Checkout Session with `metadata: { cloudId, spaceKey }` pre-injected
- Update message-pitch URL to the new landing page instead of raw Stripe link
- E2E test: full Stripe checkout in test mode, webhook fires, license activates in `SPACE_LICENSE_KV`

**Status:** Deferred (gated by Stage 4 metrics)

---

## What this plan explicitly does NOT do

- Does not add per-user save caps (5/10/20 saves per month) — commitment is measured directly via copy/email actions, not via save-volume proxy
- Does not require self-attestation ("I have notified...") — judged dishonest and dark-pattern-adjacent
- Does not auto-detect or notify admins — programmatically impossible (buyer = EM/Director/GM, no Confluence identity)
- Does not expand CSS to additional tenants until Stage 4 produces signal
- Does not fix the Stripe metadata bridge until Stage 4 metrics justify it

## Ordering note

Stages 1, 2, 3 must ship before Stage 4 observation begins. Stage 5 is conditional on Stage 4 outcomes.

Total estimate: 1–2 weeks of engineering for Stages 1–3; 4–6 weeks of observation for Stage 4.
