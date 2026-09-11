# Paywall — Status & Roadmap (ZenUML Lite)

**Last updated:** 2026-09-02 · **Variant scope:** Lite only (Full/Diagramly bypass via `isLite() === false`) · **Day-to-day monitoring:** `.claude/skills/paywall/SKILL.md`

This is the single source of truth for the Lite paywall. It replaces the former separate strategy / export-research / extension-flow / page-banner docs (folded in here 2026-06-03; full history in git).

---

## Strategy in one paragraph

Lite monetization runs on **two complementary upgrade funnels**, picked by *who* you reach, not where the trigger fires. The **friction funnel** blocks editing/creating in spaces ≥100 macros and converts the (usually non-buyer) engineer into an advocate who forwards an upgrade ask. The **nudge funnel** rides every successful export (PDF/Word/PNG) to reach the document's *audience* — managers, customers, budget owners. They target different humans, so they stack additively. (The old "export = failure-recovery" thesis is dead: 0 auth-failure events / 30d, and 71% of export failures are a product bug, not an upgrade moment.)

---

## ✅ Shipped (brief)

The **friction funnel is fully shipped and instrumented**: per-space 100-macro soft-block on edit + create (modal over a mounted editor, dismissable), an 85-macro inline warning, a viewer "Upgrade" badge, persistence-layer save block, an **advocacy-only** modal (`Copy upgrade request` → `advocacy_message_copied`), a 3-attempt continue gate (15 before 2026-08-16), a **Forge page-banner** warning that reaches editors *while browsing* (over-limit spaces only — strictly `> 100` macros, there is no 85–99 banner band; 7-day snooze on dismiss plus a 1 / 24h / 24h / 7d impression taper since 2026-09-07; defers CSAT), space-license + Stripe-webhook bypass, and CSS-flag enrollment.

| Shipped surface | Event | Ref |
|---|---|---|
| Edit / create soft-block modal | `paywall_blocked_edit` / `paywall_blocked_create` + `paywall_triggered` | PR #89 (create path) |
| Advocacy CTA (marketplace/sales CTAs removed — were 0% click) | `advocacy_message_copied` | — |
| 3 continue-attempts gate (localStorage, per `clientDomain:spaceKey:userAccountId`) | `paywall_continue_used`, `paywall_attempts_exhausted` | `src/utils/paywall/continueAttempts.ts` |
| Page-banner warning (over-limit `> 100` only, 7-day snooze, impression taper, CSAT defer) | `paywall_banner_shown` / `_dismissed` (+ `show_count`, `hours_since_last_shown`), `surface: page_banner` | PRs #201–#210; taper 2026-09-07 |
| Space-admin activity probe (Phase 5a; Lite, 30d throttle) | `space_admin_active` (`is_space_admin: true`, `surface: page_banner`) | `src/utils/paywall/spaceAdminProbe.ts` |
| Export Phase-1 telemetry | `macro_export_requested` / `_succeeded` / `_failed` | `src/export.js` |

---

## Soft-paywall mechanics (how the continue-attempts gate actually works)

**Architecture:** Pure Forge — no Connect code. The paywall fires at editor mount on Lite for every save path (slash-menu insert, page-editor edit, view-mode Edit, fullscreen viewer). Publish does NOT trigger it.

**Gate location:** Access is gated at the modal via the counter, not at the persistence layer. `saveToPlatform` deliberately has **no** `shouldBlockActions` check. The "save is gated in the persistence layer" code comments in `UpgradePrompt.vue` are misleading wording — ignore them.

**Flow:**

1. On editor mount, if the space is over-threshold and the tenant is on the CSS flag, the paywall modal appears.
2. The modal shows a **"Continue editing without upgrading (N)"** button, where N = `remainingAttempts`.
3. Each click decrements N, dismisses the modal, and lets the user reach the editor and **save normally**. Saves persisting during the grace window is BY DESIGN, not a leak.
4. When N reaches 0, the button is replaced by non-clickable **"Request extension to continue editing"** (`canContinueEditing = remainingContinueAttempts > 0` in `UpgradePrompt.vue`) — the modal can no longer be dismissed into the editor, and the user is locked out of editing.

**Constants and storage:**

| Item | Value / Location |
|---|---|
| `DEFAULT_CONTINUE_ATTEMPTS` | `3` — `src/utils/paywall/continueAttempts.ts`. Lowered from 15 on 2026-08-16 (PR #479, the free continue-editing default cut from 15 to 3). A stored balance is never rewritten, so a user who first hit the gate before that date can still hold up to 15. |
| localStorage key format | `paywallContinueAttempts:<clientDomain>:<spaceKey>:<userAccountId>` (each part URL-encoded) |
| State fields | `remainingAttempts`, `firstTriggeredAt`, `lastUsedAt`, `exhaustedAt` |
| Events | `paywall_continue_used` (each click), `paywall_attempts_exhausted` (N hits 0) |

**Known client-side weak spot:** the counter is `localStorage`-keyed per `clientDomain:spaceKey:userAccountId`, so clearing storage or using an incognito window resets N to the default (3 since 2026-08-16). This is a deliberate soft-paywall tradeoff — not a bug to patch without a product decision.

**Testing on staging:** on `lite-stg`, the large over-threshold space is **`SD`** (~1230 macros). When the paywall modal appears, click **"Continue editing"** to proceed — do NOT hunt for `localStorage` overrides (`mockSpacePaid` etc.) to suppress it.

---

## 🔜 Future tasks

### A. Nudge funnel (export) — *the strategically larger bet; in design, no code yet*

The gating decision below blocks all nudge-funnel code.

1. **[Phase 4] Placement & rendering decision** — the spike (v1–v4) converged on a **conditional ADF response keyed on `payload.exportType`**: emit a footer paragraph for everything *except* `word` (Word's MHTML pipeline errors on multi-root). Covers ~95% of `macro_export_succeeded`. Confirm and ship in `src/export.js#createMediaDocument`. Alternatives still open: PNG watermark (reserve fallback, format-agnostic), post-export Confluence message.
2. **[Phase 4] Upgrade hook** — decide what upgrading visibly unlocks from the artefact (no Lite watermark / higher-res PNG / batch export / brand customization). **Product call needed.**
3. **[Phase 5] Attribution telemetry** — ship `macro_export_nudge_included` (format + tenant breakdown) so the click endpoint can attribute the `format=other` (83.5%) cohort in Mixpanel. Log `cloudId`, `pageId`, `customContentId`, `accountId`, `format`, UTM on every nudge click.
4. **[Phase 5] Two-layer surface** — (a) live in-product banner on the next iframe load after a recent-export KV marker (~1,240 weekly in-session humans); (b) in-doc footer/QR baked into the artefact (~1,770 full exporter cohort + the document audience).

### B. Friction funnel — banner fatigue, personalization, rollout

5. **[Phase 4] Banner fatigue** ✅ *shipped 2026-09-07.* Before: the only suppression was the 7-day snooze after ×, so non-dismissers saw the banner on every page load (30d to 2026-09-07: 366 users, median 16 impressions, p90 121, 109 users ≥ 40). Now `isTaperGapMet` in `src/utils/paywall/warningBanner.ts` reads the `showCount` / `lastShownAt` the dismissal marker already recorded: 1st impression immediately, 2nd and 3rd ≥ 24h apart, 4th onwards ≥ 7 days apart (≈ 7/person/month max). Snooze still applies on top. Legacy markers with no `lastShownAt` fail open. Every banner event carries `show_count` (ordinal of this impression) and `hours_since_last_shown`. Priority order `paywall > CSAT > unplaced` is already implemented in `src/routes/pageBanner.ts` / `src/utils/banners/priority.ts`. **Sequencing decision:** the taper shipped *before* the Phase 5b admin audience is switched on, so the buyer cohort is never nagged uncapped.
6. **[Phase 5a] Space-admin activity measurement** ✅ *shipped; **read back 2026-07-28**.* `space_admin_active` probe on the page-banner load (`src/utils/paywall/spaceAdminProbe.ts`): Lite-only, throttled once/30d per `domain:space`, fires only when the current user is a space admin.
   **Go/no-go answer — decisive GO on reach.** 60d (2026-05-29 → 07-28), Mixpanel 3373228:
   - **24,388** unique space admins observed across **709** external Lite tenants; **5,021** within the 19 CSS-enrolled tenants — against **358** unique users the banner's author-only gate actually reached, and **642** who hit the paywall.
   - **These admin counts are 10%-sampled floors** (`space_admin_active: 0.1` in `utils/analytics/eventSampling.ts`; the paywall funnel events are NOT sampled). True unique-admin population is roughly an order of magnitude higher. Corrected 2026-07-28 — an earlier revision compared the sampled 5,021 against the unsampled 358 as if both were exact.
   - Cutting the other way, `space_admin_active` counts admin of *any* current space: ~21% of events come from personal `~accountId` spaces, and the event carries no macro count, so it does not tell you the space was over the limit.
   - **Net: the reach gap is real and almost certainly larger than 5,021-vs-358, but the exact reachable population is unknown.** Getting it requires joining `space_admin_active` (domain×space×user) against per-space macro counts from `metrics-inspect`; the 10% sampling makes that join sparse. The 5b gate itself is correctly narrow — it fires only for an admin *of the current space* when *that* space is over-limit, unpaid and CSS-enrolled — so the sizing looseness is in the estimate, not the targeting.
   **But reach is only part of the problem:** 206 of the 642 paywall-hitters (**32%**) had fired `space_admin_active` somewhere and still converted zero times.
   **Do not read that overlap as "the buyer was present" — investigated 2026-07-28 and it does not hold.** On `airwallex`, 81 of 98 paywall-hitters looked like admins by that measure, but only **18 administered the space that actually blocked them**, and a Confluence *space* admin cannot buy the Marketplace SKU at all (that needs a site/org admin, which nothing in `src/` detects). The real blocker there is **(e): the upgrade modal has no purchase surface** — `UpgradePrompt.vue` offers only copy-a-message, ask-us-for-a-free-extension, and continue-anyway; the Marketplace URL and the $299 price exist only *inside the copied advocacy text*. `MarketplacePricingCard.vue` / `EnterpriseBundleCard.vue` were deleted in `05b5287f` (2026-05-12). Note `upgrade_cta_clicked: 0` is a **measurement artifact** of that same commit removing the emitter — buy-intent is currently unmeasurable, not measured-as-zero.
7. **[Phase 5b] Space-Admin copy personalization** ✅ *built 2026-07-28, ships inert behind `paywall-admin-banner-enabled` (Lite Forge flag, fail-closed).*
   - **Audience gate** — `isWarningBannerVisible(..., isSpaceAdmin)` waives the 30-day recent-authorship requirement for a space admin of an over-limit space, and **only** that requirement (CSS, unpaid, over-limit and the 7-day snooze all still apply). The authorship gate was what structurally excluded admins.
   - **Verdict plumbing** — the probe now persists `isAdmin`/`adminCount` into its marker so the banner's *synchronous* setup-time gate can read it; a Phase-5a marker with no verdict counts as due for re-probe, so the rollout is not stalled 30 days. `forgeIndex` already awaits the probe before `decidePageBanner()`, so an admin is reached on the same load, not the next.
   - **Copy branch** — admin sees "You administer this space…" plus **"Unlock this space — $299/yr"** (Enterprise Bundle checkout) and keeps "Request extension"; the "Copy admin message" advocacy relay is removed for this audience, being circular for an admin and the exact hop that has produced 0 conversions in 15 months. Rationale for the Bundle over the Marketplace upgrade: a *space* admin is not a *site* admin, and only the Bundle is purchasable without one (we cannot detect site admin at all — no such check exists in `src/`).
   - **Cost discipline** — `decidePageBanner()` stays fully synchronous; the flag is awaited in `handlePageBannerRoute` only for the new `paywall-admin` choice, i.e. on impressions that did not exist before 5b. A user who already qualified as an author is untouched and pays nothing.
   - **Measurement** — `banner_audience` (`editor` | `space_admin`) + `is_space_admin` on every banner event, and a new `paywall_bundle_cta_clicked` (with `bundle_price_usd`) that is distinct from `extension_request_clicked` (asks us for free time) and `advocacy_message_copied` (asks someone else to act). **Success = bundle CTA clicks and Stripe purchases from the `space_admin` audience**, not banner impressions.
7b. **[Phase 5c] Restore the modal's purchase surface** ✅ *built 2026-07-28 (stacked on 5b).* Between `05b5287f` (2026-05-12, which deleted `MarketplacePricingCard.vue` / `EnterpriseBundleCard.vue` as "orphan pricing UI") and this change, `UpgradePrompt.vue` offered **no way to buy anything**: copy-a-message, ask-us-for-free-time, or continue-anyway. The Marketplace URL and the $299 price survived only *inside the copied advocacy text*. Now two rails, ordered by who can actually complete them and placed **above** the advocacy draft:
   - **Enterprise Bundle** (primary) — per-space, card payment, `no_admin_permission_required: true`; anyone in front of the modal can finish it. Emits `paywall_bundle_cta_clicked` with `ui_component: modal`.
   - **Full plan** (secondary) — covers every space but needs a Confluence **site** admin. Emits the new `paywall_marketplace_cta_clicked`.
   Splitting the rails is the point: it distinguishes *wanted to buy but lacked the rights* from *did not want to buy*, which a single CTA cannot. It also **restores measurability** — the same 2026-05-12 commit removed the `upgrade_cta_clicked` emitter, so every later reading of that event's 0 was an absent emitter, not absent demand. Do not cite pre-2026-07-28 buy-intent numbers as evidence of anything.

8. **[Phase 6] Operational rollout** — enable a small CSS cohort first (pilot tenant primary). Monitor support-ticket volume, `extension_request_clicked`, `admin_message_copied`, attempt exhaustion, save volume before/after, continue-editing rate, advocacy copy rate. Tune attempt count, dismissal windows, warning threshold, CTA order, copy.

### C. Cross-funnel — ship regardless

9. **Failure-taxonomy debt** — triage `unexpected_error` (142/mo, 20% of export failures); kill `attachment_not_found` (517/mo, 71%) by auto-regenerating the PNG on export when missing.

### D. Open strategic questions

10. **Hard-block on create?** Edit is soft (77% continue rate accepted); are create-blocked users higher-intent enough to hard-block without unacceptable CSAT damage?
11. **Pricing-card placement** above the advocacy draft — re-test once a steady-state advocacy baseline exists.
12. **A/B copy variants** — D2 shipped; D1 (recipient-agnostic) and D3 (no illustration) are candidates if advocacy copy rate flattens.

### E. Deprioritized (on the radar, not scheduled)

- **#63** PDF/Word export as a paywall surface — the candidate that out-ranked viewer paywall.
- **#64** Viewer paywall on restricted Lite spaces — deprioritized ~8 weeks (view:edit ≈70:1; view friction is the highest CSAT risk). Revisit only if the editor paywall hits a proven ceiling AND PDF export under-delivers.

### Intentionally NOT gated

Viewer reading · export-as-friction (hard block — CSAT cliff) · failed-export recovery (it's a bug to fix) · heavy-user behavioural targeting · hard block on save (77% continue is the accepted baseline).

---

## Validated build reference (empirically confirmed — read before building the nudge funnel)

**`adfExport` export surfaces** (`payload.exportType`, verified by probe + forge logs): PDF menu→`pdf`; Word menu→`word`; REST `body.view`/`body.styled_view`→`other`; `body.export_view`→`email`; plus production-emitted `feed`/`diff`/`html_export`. Format share (7d): `other` 83.5%, `email` 7.6%, `word` 4.5%, `pdf` 2.7%. Does **not** fire for `atlas_doc_format` or unauthenticated `anonymous_export_view`.

**ADF response shape rule:** multi-root (`mediaSingle` + sibling `paragraph` footer) renders in every pipeline **except Word** (errors out). `caption` child nodes are silently dropped everywhere. → conditional footer on `exportType !== "word"`.

**Forge tunnel does NOT proxy `adfExport`.** Any `src/export.js` change needs `forge deploy -e development` to take effect on dev — `forge tunnel` won't pick it up. (Also in `.claude/skills/forge-tunnel/skill.md`.)

**Mixpanel query discipline:** backend export events carry `account_id` + `$user_id` + `distinct_id`; frontend events (`macro_viewed`, `paywall_triggered`) carry only `$user_id`/`distinct_id` (**no** `account_id`). Cross-event joins must filter on `$user_id`. Pull real 7-day windows — don't `×7/3`-extrapolate uniques (~50% overstatement). The MCP `filter.clauses` field silently no-ops sometimes; cross-verify with breakdowns.

**Reach (real weekly uniques):** 1,773 distinct exporters/week; 1,239 (70%) also viewed in-window (human, live-banner reachable, 77% export within ±30s of a view); 534 (30%) integration-only.

Full empirical journey + methodology: `private/research/2026-05-12-pdf-export-paywall-strategy-design.md`, `private/research/2026-05-15-paywall-research-framing-corrections.md`.

---

## Rollout mechanism (friction funnel)

Shipped to **Lite tenants on the CSS flag** (not all Lite). CSS = Cloudflare KV map keyed by subdomain prefix (`tenant-a`, not `tenant-a.atlassian.net`).

| Resource | Value |
|---|---|
| KV namespace | `fe9042cb20994651b0a2ef9e68f9037c` |
| Flag check | `src/composables/useCustomerSuccessService.ts` |
| Read / Write | `python3 .claude/skills/paywall/scripts/css_flag.py get` / `put '<json>'` |

**Enroll** if ≥1 space ≥100 macros, install ≥14d, ≥3 viewers/30d, ≥5 saves/7d · **Monitor** if top space 50–99 · **Skip** if top space <50 or <3 viewers. Order by top-space macro count desc. The nudge funnel has **no** enrollment — when it ships it applies to all Lite exports (not gated on space size).

---

## Code map

| Topic | File |
|---|---|
| CSS flag / thresholds | `src/composables/useCustomerSuccessService.ts` |
| Friction-funnel gate predicates | `src/utils/paywall/preEditGate.ts` (`isPageEditorEditBlocked`, `isPageEditorCreateBlocked`) |
| Editor entry points (→ `PageEditorPaywallGate`) | `src/forgeIndex.ts`, `src/forge-graph-editor.ts`, `src/forge-embed-editor.ts`, `src/forge-swagger-editor.ts` |
| Continue-attempts | `src/utils/paywall/continueAttempts.ts` |
| Page-banner markers / route / component | `src/utils/paywall/warningBanner.ts`, `src/routes/paywallBanner.ts`, `src/components/...PaywallWarningBanner.vue` |
| Friction modal | `src/components/UpgradePrompt/UpgradePrompt.vue` |
| Event names | `src/utils/upgradeTracking.ts` · catalog `src/utils/analytics/catalog.ts` |
| Nudge-funnel resolver | `src/export.js` |
| Space license / Stripe | `functions/api/space-status.ts`, `functions/api/space-license.ts`, `functions/api/stripe-webhook.ts` |
| Pricing tiers + cost formula | `docs/pricing-model.yml` |
| Per-event reference | `docs/upgrade-tracking-event-reference.md` |

**Event-name note:** for windows spanning 2026-04-28, query both `view_macro`/`macro_viewed`; for `upgrade_action_blocked`/`paywall_triggered` query both across 2026-04-29. After those dates the new names suffice.
