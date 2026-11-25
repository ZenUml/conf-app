# Per-site staged paywall enforcement (Lite)

**Date:** 2026-11-13
**Status:** Draft for review
**Scope:** Lite variant only. Full, Diagramly and AsyncAPI are unchanged.

Tenant names are placeholders (`example-tenant`). The rollout record for a real site lives in
the private handbook, not in this file.

## Summary

Add one server-managed policy per Confluence site that turns enforcement on in dated stages:
a notice first, then a watermark on diagrams in over-limit spaces, then a block on new diagrams
in those spaces, then (optionally) a metered block on edits. Absent policy means today's
behaviour: banner only, no watermark, no block.

The watermark comes before any block (decided 2026-11-14) because it reaches readers, who were
never under pressure, and it stops no work. See "Viewer watermark".

The policy is an operational control for a named site. It is not a fleet rollout flag.

## Context

| Fact | Evidence |
|---|---|
| Editing is never blocked on any Lite site | `shouldBlockActions = computed(() => false)` in `src/composables/useCustomerSuccessService.ts` since `85ffb57d` (2026-09-06) |
| The gate plumbing still exists | `src/utils/paywall/preEditGate.ts`, `mountPaywallGate.ts`, `UpgradePrompt.vue`, `continueAttempts.ts` |
| The only per-site enforcement today is Fullscreen recovery | KV key `fullscreen-recovery:policy:<cloudId>`, `docs/ops/fullscreen-recovery.md` |
| A dated notice was once sent to a customer and the date could not be enforced | Removing a `PAYWALL_EXEMPTIONS` entry changes the banner only |
| The banner's purchase button loses most clicks before checkout | Measured 2026-08-07 → 2026-11-12: 119 `paywall_bundle_cta_clicked`, 17 Stripe Checkout Sessions with a `client_reference_id` (6 of them internal sites). Reproduced on staging 2026-11-13: the click opens Atlassian's "Opening external page on buy.stripe.com" warning; a session exists only after **Continue** |
| The page banner must not sell | Forge pageBanner guideline: banners "must not be used to upsell or cross-promote apps"; promotional use risks removal from Marketplace. The banner's Stripe "Unlock this space" button (added 2026-07-28) breaks this and is being removed in a separate PR |
| Blocking does reduce editing in blocked spaces | Registered A/B on one large site, 2026-08-25 → 09-22: licensed spaces 307 edits (8 weeks before) → 360 (4 weeks after); still-blocked spaces 263 → 35. See "Risks" for the displacement caveat |

Two consequences drive this design:

1. A block is a real lever, so it must be dated, announced and reversible per site.
2. Pressure without a working purchase path produced extension requests and no revenue.
   The purchase path is therefore a precondition, not a follow-up.

## Goals

- Enforce on one named site without changing any other site.
- Make the effective date visible in the product before it takes effect.
- Block the growth of free usage first (new diagrams), not the maintenance of existing content.
- Keep every failure fail-open: a missing or unreadable policy never blocks.
- Measure each stage and the purchase path end to end.

## Non-goals

- No block on viewing or on export.
- No gate in the persistence layer. `saveToPlatform` stays ungated (Confluence is the system of
  record; see `docs/features/paywall.md`).
- No change to the published 100-diagram limit, the price, or `PAYWALL_EXEMPTIONS` semantics.
  Enforcement starts at 150, above the published limit (see "Enforcement threshold reached").
- No fleet default. A site without a policy keeps the banner-only behaviour.

## Policy contract

KV namespace `KV_FEATURE_FLAGS`, key `paywall-enforcement:policy:<cloudId>`:

```json
{
  "stage": "notice",
  "effectiveAt": "2026-12-08T00:00:00Z",
  "nextStage": "block_create",
  "reviewedBy": "owner",
  "note": "private handbook reference"
}
```

| Field | Rule |
|---|---|
| `stage` | `notice`, `watermark`, `block_create` or `block_edit`. Any other value: treat the policy as absent. Stages are cumulative: each stage keeps the effects of the stages before it |
| `effectiveAt` | ISO instant. For `notice` it is the date shown to users. For a block stage it is when the block starts; before it, the site behaves as `notice` |
| `nextStage` | Shown in the notice copy only. It never advances the stage by itself |
| Stage change | A human writes the key. No job advances a stage automatically |

Read failure, malformed JSON, or an unknown stage: no enforcement.

## Decision model

Evaluated per space, on the server, with the site identity from the verified FIT. The model was
rebuilt on 2026-11-15 by Specification by Example: each concept is decided once, and the tables
below are the examples the unit tests run (`functions/service/paywallEnforcement.spec.ts`).

```
policy (KV) + clock ───────────► 1. stage in force   none | notice | watermark | block_create | block_edit
space count ───────────────────► 2. threshold reached yes | no | unknown
product, licence, paid rail,
exemption ─────────────────────► 3. covered          yes | no | unknown
                                        │
                                        ▼
                         4. enforcement = stage in force
                            only if covered = no AND threshold reached = yes
                            otherwise off
                                        │
                                        ▼
                         5. effects, read from the enforcement stage alone
```

Two rules keep the model small:

- **One number test.** `count >= ENFORCEMENT_THRESHOLD` (150) appears in concept 2 and nowhere
  else. Banner,
  watermark, create block and edit meter never compare a count; they read the stage.
- **Unknown is never yes.** An unknown count, an unreadable licence or an unreadable exemption
  list gives `off` (fail open).

### 1. Stage in force

The pilot policy in these examples is `effectiveAt = 2026-12-08T00:00:00Z`.

| Policy value | Now (UTC) | Stage in force |
|---|---|---|
| key absent | any | none |
| not JSON, or not an object | any | none |
| `stage = "block_all"` (unknown stage) | any | none |
| `effectiveAt` missing or not a date | any | none |
| `stage = notice` | 2026-11-20 | notice |
| `stage = notice` | 2026-12-09 | notice |
| `stage = watermark` | 2026-12-07 23:59:59 | notice |
| `stage = watermark` | 2026-12-08 00:00:00 | watermark |
| `stage = block_create` | 2026-12-07 23:59:59 | notice |
| `stage = block_create` | 2026-12-08 00:00:00 | block_create |
| `stage = block_edit` | 2026-12-08 00:00:00 | block_edit |

### 2. Enforcement threshold reached

Two numbers, two jobs:

| Number | Value | Job |
|---|---|---|
| Published limit (`MACROS_LIMIT`) | 100 | What Lite covers per space. Shown to the reader ("of 100"). Never compared with a count by this decision |
| Enforcement threshold (`ENFORCEMENT_THRESHOLD`) | 150 | Where this decision starts. The only number a count is compared with |

| Space count | Threshold reached |
|---|---|
| 0 | no |
| 99 | no |
| 100 | no (at the published limit, inside the buffer) |
| 101 | no |
| 149 | no |
| 150 | yes |
| 151 | yes |
| 2,282 | yes |
| space missing from the metrics entry | unknown |
| not a whole number, or negative | unknown |

**Buffer of 50 (owner decision, 2026-11-15).** The space count comes from a cache and can be
wrong by a few diagrams (see "Stale macro count"). Enforcement at exactly 100 would put a mark on
a space that a recount shows at 97. Starting at 150 means every space that gets enforcement is
over the published limit even if the count is off by up to 50. Every enforcement surface (dated
banner, watermark, create block, edit meter) uses this one test.

Not changed by this decision: the surfaces that already exist and use 100 (banner severity,
Fullscreen gate on client and server, Plan-and-usage, headless classification). They state or
classify against the published limit. Whether the Fullscreen gate also moves to 150 is open
decision 6.

History: the 2026-11-14 rule that gave the watermark its own test (`count > MACROS_LIMIT`) is
withdrawn, and so is the 2026-11-15 morning rule `count >= MACROS_LIMIT`. The strip title stays
"Lite diagram limit reached"; it is true for every enforced space.

### 3. Covered

| Fact | Covered |
|---|---|
| Product is not Lite | yes |
| `"*": true` in `PAYWALL_EXEMPTIONS` | yes |
| The site's domain is `true` in `PAYWALL_EXEMPTIONS` | yes |
| Space licence active and not expired (`SPACE_LICENSE_KV`) | yes |
| User licence active and not expired, for this viewer | yes, for this viewer only |
| Full or Diagramly install inside the 45-day paid-rail window | yes |
| Space licence present, `expiresAt` in the past | no |
| None of the above, and every read succeeded | no |
| Licence record malformed, or the exemption list or the paid-rail read failed | unknown |
| `PAYWALL_EXEMPTIONS` key absent, not an object, or holding a non-boolean value | unknown (same rule as the Fullscreen gate; the key must hold at least `{}` for enforcement to run) |

### 4. Enforcement

| Stage in force | Threshold reached | Covered | Enforcement |
|---|---|---|---|
| none | yes | no | off |
| watermark | no | no | off |
| watermark | unknown | no | off |
| watermark | yes | yes | off |
| watermark | yes | unknown | off |
| notice | yes | no | notice |
| watermark | yes | no | watermark |
| block_create | yes | no | block_create |
| block_edit | yes | no | block_edit |

### 5. Effects

Stages are cumulative. Each effect is a fixed property of the stage.

| Enforcement | Dated banner | Watermark + strip | Create a diagram | Edit a diagram |
|---|---|---|---|---|
| off | no (the existing banner rules apply) | no | allowed | allowed |
| notice | yes | no | allowed | allowed |
| watermark | yes | yes | allowed | allowed |
| block_create | yes | yes | request gate (shared `edit` grant) | allowed |
| block_edit | yes | yes | request gate (shared `edit` grant) | request gate: no editor until the user's request is saved; then 7 days |

### End-to-end examples

Site policy `stage = watermark`, `effectiveAt = 2026-12-08T00:00:00Z`, product Lite unless stated.

| # | Space count | Licence / cover | Now | Enforcement | A reader sees |
|---|---|---|---|---|---|
| 1 | 2,282 | none | 2026-12-09 | watermark | diagram + watermark + strip |
| 2 | 150 | none | 2026-12-09 | watermark | diagram + watermark + strip ("150 of 100") |
| 3 | 149 | none | 2026-12-09 | off | diagram only |
| 3a | 100 | none | 2026-12-09 | off | diagram only (at the published limit, inside the buffer) |
| 4 | unknown | none | 2026-12-09 | off | diagram only |
| 5 | 2,282 | space licence, active | 2026-12-09 | off | diagram only |
| 6 | 2,282 | space licence, expired 2026-11-06 | 2026-12-09 | watermark | diagram + watermark + strip |
| 7 | 2,282 | user licence for this viewer | 2026-12-09 | off for this viewer | diagram only |
| 8 | 2,282 | paid-rail window | 2026-12-09 | off | diagram only |
| 9 | 2,282 | site domain exempt | 2026-12-09 | off | diagram only |
| 10 | 2,282 | exemption list unreadable | 2026-12-09 | off | diagram only |
| 11 | 2,282 | none | 2026-12-01 | notice | diagram only; the banner shows the date |
| 12 | 2,282 | none, but the site has no policy key | 2026-12-09 | off | diagram only |
| 13 | 2,282 | product Full | 2026-12-09 | off | the Full licence notice rules apply, not these |

## Behaviour by stage

| Surface | notice | watermark | block_create | block_edit |
|---|---|---|---|---|
| View, inline and Fullscreen | unchanged | diagram visible, watermark over it, notice strip under it | same as watermark | same as watermark |
| Export and stored PNG | unchanged | unchanged, no watermark | unchanged, no watermark | unchanged, no watermark |
| Edit an existing diagram | allowed | allowed | allowed | request gate in place of the editor (see "Edit request gate") |
| Create a new diagram in an over-limit space | allowed | allowed | edit request gate in place of the editor; one `edit` grant covers creating and editing | same as block_create |
| Create in a space under 150 | allowed | allowed | allowed | allowed |
| Page banner (information only, one link: "View plan and usage") | dated notice | "diagrams in this space carry a watermark" | "new diagrams are paused" | "editing is limited" |
| Plan-and-usage page | purchase options | purchase options | purchase options | purchase options |

The table shows a space where enforcement is on (see "Decision model": threshold reached, not covered).

Examples for a site with `stage = block_create`, `effectiveAt = 2026-12-08`:

| Space | Diagrams | Licence | Date | Action | Outcome |
|---|---|---|---|---|---|
| A | 2,282 | none | 2026-12-01 | insert a new diagram | allowed, banner shows the date |
| A | 2,282 | none | 2026-12-08 | insert a new diagram | edit request gate; after the request is saved, the editor opens for 7 days from the first save |
| A | 2,282 | none | 2026-12-08 | edit an existing diagram | allowed |
| A | 2,282 | space licence | 2026-12-08 | insert a new diagram | allowed |
| B | 91 | none | 2026-12-08 | insert a new diagram | allowed |
| A | count read fails | none | 2026-12-08 | insert a new diagram | allowed (fail-open) |

## Design

```
editor mount
    │
    ▼
/api/space-status  (FIT → cloudId, accountId, spaceKey)
    │  existing: isPaid, decisionKnown, source
    │  new:      enforcement { stage, effectiveAt, count, limit, effects }   (absent = off)
    ▼
useCustomerSuccessService
    shouldBlockCreate / shouldBlockEdit   (replaces the constant false)
    ▼
preEditGate → PaywallGate → UpgradePrompt (create variant: no continue button)
```

- **Server.** `functions/api/space-status.ts` already authenticates the FIT and reads the
  licence. It adds the decision table above and returns `enforcement`. The response stays
  `private` and short-lived; a stage change reaches a session within the existing cache window.
- **Contract.** `enforcement` is present only when enforcement is on. The client never compares
  a count and never reads the clock for this decision; it reads `effects`.

  ```json
  { "isPaid": false, "decisionKnown": true,
    "enforcement": { "stage": "watermark", "effectiveAt": "2026-12-08T00:00:00Z",
                     "count": 2282, "limit": 100,
                     "effects": { "datedBanner": true, "watermark": true,
                                  "blockCreate": false, "requestEdit": false,
                                  "meterEdit": false } } }
  ```
- **Effect name.** `requestEdit` (was `meterEdit`). The server emits both names and the client accepts either, because the Forge frontend and the Pages backend deploy at different times; drop `meterEdit` after both are on the new build.
- **Client.** `shouldBlockActions` splits into `shouldBlockCreate` and `shouldBlockEdit`.
  `isPageEditorCreateBlocked` and `isPageEditorEditBlocked` take the matching value. With no
  `enforcement` in the response both stay `false`, which is today's behaviour.
- **Notice.** `PaywallWarningBanner` gains a dated variant. It bypasses the 7-day snooze once
  per stage change so a dismissed banner does not hide a new date. The banner states facts
  (count, limit, date, stage) and links only to the Plan-and-usage page. It has no purchase,
  quote or checkout control (Forge pageBanner guideline, see Facts).
- **Trust boundary.** The block is a client gate, as before. It is a commercial control, not a
  security control. A user who removes it locally can still save; that is accepted.

## Viewer watermark

**Why first.** Measured on the pilot site, 30 days to 2026-11-14, all spaces:

| Group | Users | Under pressure before |
|---|---|---|
| Readers (`macro_viewed`) | 1,236 | mostly no |
| Saved an edit (`macro_save_succeeded`) | 177 | yes: banner, and the edit block until 2026-09-06 |
| Created a diagram (`macro_create_succeeded`) | 217 | yes |
| Saw the page banner | 273 | yes |

A block reaches the same authors the banner and the earlier block already reached, and that
produced no purchase. The watermark reaches every reader and stops no work, so usage (the reason
to buy) is not reduced.

**What is not known.** No watermark has a conversion result yet: the Full notice went live on two
sites on 2026-11-11. Whether Atlassian restricts a payment watermark in a free app is not checked.

**Reuse.** `LicenseWatermark.vue` and `LicenseNoticeStrip.vue` (Full "No active license" notice)
already render outside `.screen-capture-content`, so export and the stored PNG stay clean. This
stage adds a second basis to the same components; it does not add a second watermark.

**Decision at view time.**

```
viewer mount (Lite)
    │
    ▼
/api/space-status  → enforcement { stage, effectiveAt, count, limit, effects }, isPaid
    │   no `enforcement` in the response, or effects.watermark = false → no watermark
    ▼
GenericViewer.showLicenseNotice  (basis = site_policy_limit_reached)
    ▼
LicenseWatermark + LicenseNoticeStrip (Lite copy)
```

- The diagram renders first; the watermark is added when the decision arrives. A slow or failed
  call never delays or hides the diagram.
- Guest and anonymous viewers: `space-status` needs a valid FIT and reads `accountId` only when it
  is present. Whether the call succeeds for them is not tested; on failure they see no watermark.
- The Full gate (`licenseNoticeBasis`) is unchanged. It returns `null` for every non-Full product
  today, so the Lite basis is a separate branch.
- This is an exception for a named site. The 2026-11-02 decision "the watermark is for Full, not
  Lite" stays the fleet rule.

**Copy (decided 2026-11-14: candidate B).**

| Part | Text |
|---|---|
| Watermark headline | `UPGRADE REQUIRED` |
| Watermark line 2 | `<count> of 100 Lite diagrams in this space` |
| Watermark line 3 | `Ask your Confluence admin to upgrade` |
| Strip title | Lite diagram limit reached |
| Strip body | This diagram stays viewable. This space has `<count>` diagrams and Lite covers 100 per space. Ask your Confluence admin to upgrade to Full to remove the watermark. |
| Strip button | View plan and usage |

`<count>` is the space's diagram count from the same response that makes the decision, with a
thousands separator. The limit comes from `MACROS_LIMIT`, not a literal. The smallest count a
reader can see is 150 ("150 of 100").

The Full copy (`NO ACTIVE LICENSE`, "subscribe to Full") is wrong on Lite: Lite has no Forge
licence and the reader's site did not let a subscription lapse. Constraints the choice had to meet:

| Constraint | Reason |
|---|---|
| Headline ≤ 17 characters at the designed size | `NO ACTIVE LICENSE` is the widest that fits (Figma `383:377`) |
| Three lines, one width | Owner decision 2026-11-15. Lines 2 and 3 are each sized at render time to the measured width of the headline, so the block reads as one stamp whatever the count's digit count or the system font. Stacked headline is 74 units (the two-line Full watermark stays at 96 / 30). Measured in Storybook, macOS system font: all three lines 752 units wide; rotated block spans y 12–406 of the 430-unit area |
| Watermark covers the diagram only | The watermark is laid over the capture node's box, not the whole canvas. Before 2026-11-15 it was centred on the canvas, which also holds the notice strip, so its lower lines sat under the strip on a short diagram. Applies to the Full watermark too |
| States a fact the reader can check | The owner rejected `UNLICENSED` on 2026-11-02: the customer did nothing wrong |
| Names who can act | A reader cannot pay |
| Points to Full through the Confluence admin, not to a per-space purchase | A site with many over-limit spaces pays less for Full than for one Bundle per space |
| Uses the words already in the product | The Fullscreen gate says "has reached the free limit of 100 diagrams"; the public FAQ says "Once a space reaches that threshold". The banner and Plan-and-usage say "over the … limit", which is not true at exactly 100 |

Candidates considered (count shown is an example):

| # | Headline | Second line | Result |
|---|---|---|---|
| A | `OVER LITE LIMIT` | 2,282 of 100 diagrams · Ask your Confluence admin to upgrade to Full | Fallback: states the fact but not the action |
| B | `UPGRADE REQUIRED` | 2,282 of 100 Lite diagrams in this space / Ask your Confluence admin to upgrade (two lines since 2026-11-15) | **Chosen** |
| C | `PAYMENT REQUIRED` | Over the Lite limit · Ask your Confluence admin to subscribe to Full | Rejected: Lite is a free app |
| D | `NO ACTIVE LICENSE` | Payment required · Ask your Confluence admin to subscribe to Full | Rejected: not true on Lite |

The 100-diagram limit is published on zenuml.com (checked 2026-11-15): `confluence/faq`
("limited to 100 diagrams per Confluence space. Once a space reaches that threshold, a paywall
prompt appears"), `confluence/install`, `upgrade` and `confluence/diagram-types`. Enforcement
starts at 150, so it never acts before the published threshold. Open before release: the FAQ names a paywall prompt only. Add the
watermark to it before the `watermark` stage reaches a customer, so "required" has a published
term behind it.

## Purchase path (precondition)

A block that leads to a button users abandon repeats the May–September result. Before any site
moves past `watermark`:

| Problem observed 2026-11-13 | Change |
|---|---|
| Atlassian warning dialog before `buy.stripe.com` | Open a `zenuml.com` URL that answers 302 to the Payment Link with `client_reference_id` intact. `zenuml.com` opened with no dialog when measured 2026-08-10; re-measure before relying on it |
| Banner says "Upgrade to Full", button sells one space; and a banner may not sell at all | Remove the banner button. The Plan-and-usage page and the block dialog show two named options: this space, or every space |
| Checkout shows the legal entity name, tax on top of $299, and asks for domain and space again | Show "billed by …, tax may apply" before the redirect; prefill or drop the two custom fields |
| No way to buy for many spaces or to pay by invoice | The block dialog offers "Request a quote" (existing Request-Full flow) next to card checkout |

The redirect endpoint records one server-side event per hit, so click → checkout loss becomes
measurable without a Stripe export.

## Analytics (defined before code)

| Event | Trigger | Key properties |
|---|---|---|
| `paywall_enforcement_notice_shown` | dated banner rendered | `enforcement_stage`, `effective_at`, `days_to_effective`, `banner_audience`, `surface` |
| `paywall_gate_evaluated` (existing) | editor mount | add `enforcement_stage`, `enforcement_active`, `paywall_policy_source = site_policy` |
| `license_notice_shown` (existing) | the watermark and strip render | on Lite: `license_notice_basis = site_policy_limit_reached`, `enforcement_stage`, `macro_count`, `surface`. Lite sent `license_notice_evaluated` here too until 2026-11-19; it was a duplicate and was removed |
| Strip button click (reuse the existing license-notice click event; confirm its name in `catalog.ts`) | strip button clicked | `license_notice_basis`, action = plan and usage, `surface` |
| `paywall_blocked_create` (existing, re-enabled) | create blocked | add `enforcement_stage`, `macro_type`, `action_type` |
| `paywall_blocked_edit` (existing, re-enabled) | edit gated | add `enforcement_stage`, `remaining_attempts_before` |
| `paywall_quote_requested` | "Request a quote" clicked | `enforcement_stage`, `surface`, `spaces_over_limit` |
| `paywall_checkout_redirected` | redirect endpoint hit (server) | `client_reference_id`, `surface`, `enforcement_stage` |

Add the names to `src/utils/analytics/catalog.ts` and `types.ts` in the first commit.

## Rollout for one site

| Day | Action | Check before the next step |
|---|---|---|
| T−21 | Write `stage = notice` with `effectiveAt = T` | `paywall_enforcement_notice_shown` fires for space admins and editors of over-limit spaces |
| T−21 → T | Answer every request as a quote; no free extension | Each reply recorded in the private handbook |
| T | Write `stage = watermark` | `license_notice_shown` on over-limit spaces only; views and edits unchanged week on week; export carries no watermark |
| T+30 | Review: purchase, open commercial thread, or neither | Owner decides: hold, set a date for `block_create`, or delete the key |
| later, dated | Write `stage = block_create`, only after the purchase path changes ship | `fullscreen_recovery_gate_shown` with `feature = edit`, `edit_target = new_diagram` > 0; edits of existing diagrams unchanged week on week |

Rollback at any point: delete the key. The next `space-status` read returns no enforcement.

## Success and guardrails

| Kind | Measure |
|---|---|
| Success | A paid licence, or a commercial thread with someone who can buy |
| Guardrail | Edits of existing diagrams in over-limit spaces do not fall more than the site-wide trend |
| Guardrail | No uninstall; viewer counts hold |
| Stop | Support load above what one person can answer within 2 working days |

## Risks

| Risk | Note |
|---|---|
| Create displacement | Users can create in a space under 150 or open a new space. In the A/B, edits in blocked spaces fell while licensed spaces rose, and blocked spaces stayed low for five weeks after the block was lifted for everyone. A per-space limit invites this; v1 measures it (creates in spaces under 150, count of spaces at 150 or more) and does not prevent it |
| Many requesters, no buyer | Past extension requests came from different people each time. Replies must ask who owns Confluence apps |
| Stale macro count | A space that shrank with no later save can keep a higher count in the cache. Count unknown or under 150 is fail-open. The buffer of 50 covers an error up to 50; a space that shrank from 150 or more to under 100 with no later save is still marked |
| Decision cached for 5 minutes | `/api/space-status` answers with `private, max-age=300`. After `effectiveAt` passes or the policy key changes, a viewer can keep the earlier decision for up to 5 minutes. The result is late, not wrong |
| Shared staging slot | Forge staging is one slot; validate on the candidate build only |
| Watermark has no conversion evidence | The Full notice is days old on two sites. Read its result before the T+30 review |
| Watermark not named in the published term | The mark tells every reader that an upgrade is due. The 100-diagram limit is published (see "Viewer watermark"), but the FAQ names a paywall prompt only. Add the watermark to the FAQ before the `watermark` stage reaches a customer |
| Readers cannot buy | Reader-to-admin relay produced no purchase in 15 months of banner use. The watermark is a stronger and more public signal, but the path from reader to buyer is still one message long |

## Validation

Storybook (dated banner, create-block dialog) → Forge tunnel → CI-deployed staging, with
screenshots at each stage. Staging uses the `SD` space on `lite-stg` and a policy key for that
site's cloudId. No manifest change is expected, so the release is a minor version; confirm from
the `forge deploy` output.

## Related change: keep the Fullscreen questionnaire answers

This is independent of the enforcement policy and can ship on its own.

**Problem.** The first screen of the Fullscreen recovery gate asks "How will you use Fullscreen?"
(four choices, optional note). The answer is written to analytics only when the user later submits
an email address. On the one pilot site, 2026-10-28 → 2026-11-13:

| Step | Users |
|---|---|
| Saw the gate | 115 |
| Answered the questionnaire (clicked **Contact support**, which needs at least one choice) | 15 |
| Submitted an email | 4 |
| Answers we can read | 4 |

Eleven users answered and left at the email step. Eighteen went to Plan and usage. Their choices
were never recorded.

**Change.** Record the choice at the moment the user leaves the questionnaire screen, whichever
way they leave it.

| Event (existing) | When | Properties to add |
|---|---|---|
| `fullscreen_recovery_action_selected`, `recovery_action = contact_support` | **Contact support** clicked | `scenario_codes` (array of the four codes), `has_note` (boolean) |
| `fullscreen_recovery_action_selected`, `recovery_action = plan_usage` | **Plan and usage** clicked from the questionnaire screen | `scenario_codes` (may be empty), `has_note` |
| `fullscreen_recovery_action_selected`, `recovery_action = return_inline` | **Back to diagram** clicked from the questionnaire screen | `scenario_codes` (may be empty) |

Rules:

- Codes only. The note text never goes to analytics; it stays encrypted in D1 and exists only
  after a submit.
- No new event and no new screen. The user sees no difference.
- `scenario_codes` keeps the same name and shape as on `fullscreen_recovery_request_submitted`,
  so one breakdown covers both.
- Add the properties to `src/utils/analytics/types.ts` in the first commit.

Examples:

| User does | Recorded today | Recorded after the change |
|---|---|---|
| Ticks "Present this diagram to others", clicks Contact support, closes at the email step | `action_selected`, no choice | `action_selected` with `scenario_codes = ["present"]`, `has_note = false` |
| Ticks nothing, clicks Back to diagram | `action_selected`, no choice | `action_selected` with `scenario_codes = []` |
| Ticks two choices, types a note, submits an email | `request_submitted` with both codes, `has_note = true` | unchanged, plus the same codes on the earlier `action_selected` |

Validation: Storybook interaction test on the gate story (assert the event payload), then tunnel
and staging on `lite-stg` `SD`, reading the event in Mixpanel. No UI change, so the visual
evidence is the unchanged gate plus the captured event.

## Edit request gate (`block_edit`)

Decided 2026-11-16 (owner): editing on a site at `block_edit` is gated the way Fullscreen is gated
by the Fullscreen recovery gate. It replaces the "metered (3 continues, then locked)" effect this
spec had before. The continue-attempts meter gave us nothing to follow up and reset with the
browser's storage; the request gate records the use, a reply address and a server-side grant.

```
Click Edit ──► enforcement = block_edit? ──no──► editor opens
                      │ yes
                      ▼
                 Edit gate (in place of the editor)
                      │ use + reply email + consent
                      ▼
                 request saved ──► editor opens ──► first successful save starts 7 days
                                                            │
                                                            ▼
                                              expired ──► "Continue the conversation"
```

Design: [Conf App Figma, 06.10E](https://www.figma.com/design/xyLOTL0IvXNszqFCKCdAp0/Conf-App?node-id=617-3649).

### One gate, two features

There is one recovery gate. `feature` is a parameter: `fullscreen` (shipped) or `edit`. The panel
layout, the five views, the request and grant state machine, the storage table, the support mail
and the support tool are shared. Only the items in this table differ.

| Item | `fullscreen` | `edit` |
|---|---|---|
| Who turns it on | KV `fullscreen-recovery:policy:<cloudId>` | this spec's site policy, when enforcement is `block_edit` |
| Where the gate shows | Fullscreen viewer | editor modal, for an existing diagram |
| Grant starts | first successful Fullscreen opening | first successful save |
| Use options | inspect details, present, discuss, other | fix or update, keep documentation current, prepare for a review or release, other |
| Consent / policy version | `fullscreen-contact-v1` | `edit-contact-v1` |
| Copy | "Fullscreen" wording | "editing" wording; "This site has reached the free limit of N diagrams" with N from the policy |

### Examples

Site at `block_edit`, product Lite, space not covered. One user.

| # | The user's edit request | Now | Click Edit shows | Save |
|---|---|---|---|---|
| E1 | none | any | gate, view "How will you edit this diagram?" | not reachable |
| E2 | saved, never saved a diagram since | any | gate, view "Editing is ready", button "Open editor" | allowed; the first success starts the 7 days |
| E3 | activated 2026-12-08 09:00 | 2026-12-15 08:59 | editor | allowed |
| E4 | activated 2026-12-08 09:00 | 2026-12-15 09:00 | gate, view "Your temporary editing access has ended" | not reachable |
| E5 | any | recovery lookup fails or times out | editor (fail open) | allowed |
| E6 | none | any, product Full or Diagramly | editor | allowed |
| E7 | none | any, site at `watermark` or `block_create` (Edit on an existing diagram) | editor | allowed |
| E8 | none, a second user on the same site | any | gate (the grant is personal: one request per user per feature) | not reachable |
| E9 | Fullscreen request active, no edit request | any | gate (a Fullscreen grant does not open the editor) | not reachable |

Rules that follow:

- The server decides. The client never compares a count or a date.
- Reading stays available in every row.
- The gate applies to editing an existing diagram from `block_edit`, and to creating a new diagram
  from `block_create`. Owner decision 2026-11-25: creating uses this same gate, not a hard block, and
  one `edit` request and grant per user covers both (no separate `create` feature, no migration).
  The 7-day request is the grace period, so `block_create` needs no dated banner first.
  `edit_target` (`existing_diagram` | `new_diagram`) on the recovery events tells the two apart.
- Support extends or closes an edit request with the same tool and the same rules as a
  Fullscreen request.

### Delivery

1. Refactor, no behaviour change: the gate component, the shared contract and the service take a
   `feature`; `fullscreen` is the only value. Existing tests stay green.
2. Analytics events for `edit`, then the `edit` feature: storage accepts `feature = 'edit'`, the
   policy source above, the editor entry, mail and support copy.
3. Storybook, tunnel, staging. No site is at `block_edit` until its policy key is written, which is
   a separate, confirmed step.

## Open decisions

1. Days between notice and block (this draft: 21).
2. Resolved 2026-11-16 (owner): `block_edit` is used, and it is the Fullscreen-style request gate,
   not the continue-attempts meter. See "Edit request gate".
3. Whether a site-wide Stripe price exists for sites with many over-limit spaces, or those sites
   are sent to the Marketplace Full plan only.
4. Whether the Fullscreen recovery policy stays on for a site that also has this policy.
5. Resolved 2026-11-15: the 100-diagram limit is published on zenuml.com; enforcement starts at
   150, above it (see "Viewer watermark"). Still open: add the watermark to the FAQ text before
   the `watermark` stage reaches a customer.

6. Whether the Fullscreen gate (today at the published limit, 100) also moves to the enforcement
   threshold of 150. This spec does not change it.
