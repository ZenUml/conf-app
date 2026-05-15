# Paywall Strategy — ZenUML Lite

**Last updated:** 2026-05-15
**Variant scope:** Lite only. Full and Diagramly bypass via `useCustomerSuccessService.isLite() === false`.
**Operational monitoring:** `.claude/skills/paywall/SKILL.md`

---

## 1. What the paywall does today

The paywall enforces a per-space soft limit of 100 macros on Lite tenants enrolled in the **CUSTOMER_SUCCESS_SERVICE** (CSS) flag. It is per-space, not per-tenant: a tenant with 5,000 macros spread across 100 spaces is unaffected unless one single space crosses the threshold.

### Active gates

| Surface | Threshold | Behaviour | Event |
|---|---|---|---|
| Editor — open existing macro | space ≥ 100 macros | Soft block (modal over mounted editor; dismissable as "Continue editing") | `paywall_blocked_edit` + `paywall_triggered` (`action_type: page_editor_edit`) |
| Editor — create new macro | space ≥ 100 macros | Soft block (modal over mounted editor; dismissable) | `paywall_blocked_create` + `paywall_triggered` (`action_type: page_editor_create`) |
| Viewer — header "Upgrade" badge | space ≥ 100 macros | User-initiated open | `paywall_triggered` (`action_type: header_badge`) |
| Frontend warning | space ≥ 85 macros | Inline warning, no modal | n/a |

Persistence enforces the save block independently — even if the user dismisses the modal, the actual save is short-circuited in `Persistence.ts` when `shouldBlockActions === true`. The modal is the user-facing surface; the persistence guard is the forcing function.

### The escape path: advocacy CTA

The modal (`UpgradePrompt.vue`) is **advocacy-only**. There are no in-modal Marketplace or Enterprise Bundle CTAs. The primary action is **Copy upgrade request**, which writes a templated message to the clipboard for the user to forward to whoever owns the tooling budget.

Why: prior CTAs ("Buy on Marketplace", "Contact Sales") had a 0% click rate across multiple consecutive days. The blocked user is an engineer, not the buyer. The advocacy CTA shifts the funnel from "convert this user" to "let this user nominate the buyer".

Intent signal: `advocacy_message_copied` (sole in-modal intent event). `intent_capture_rate = advocacy_copies / paywall_triggered` can exceed 100% — one user may copy to multiple recipients. That is the strongest signal possible, not a data error.

### Bypass mechanisms

| Mechanism | How it bypasses |
|---|---|
| **Space license** (KV `license:{cloudId}:{spaceKey}`) | Persistence and the modal both check this; a valid license disables all gates for that space |
| **Stripe Checkout** | `checkout.session.completed` webhook auto-activates the space license (`functions/api/stripe-webhook.ts`); session metadata must carry `cloudId` and `spaceKey` |
| **CSS flag off** | Default state — paywall logic short-circuits to `false` |
| **Full / Diagramly variant** | `isLite()` returns false; all gates inert |

---

## 2. What is intentionally NOT gated

| Surface | Decision | Rationale |
|---|---|---|
| **Viewer (reading macros)** | Out of scope | Reading is the primary job for most users. Friction on view is the highest CSAT risk with the weakest conversion case. |
| **Export (PDF / Word)** | Open — telemetry audit in progress | Higher-intent than viewing, but the surface inside the generated document is not yet proven. See [§5 Open questions](#5-open-strategic-questions). |
| **PNG watermark** | Out of scope | Trivial change available; not pursued. |
| **Heavy-user behavioural targeting** | Out of scope | Separate, larger initiative if it's ever pursued. |
| **Hard block on save** | Out of scope | Current 77% "continue editing" rate after the modal is the accepted soft-block baseline. |

---

## 3. Rollout mechanism

The paywall is shipped to **all Lite tenants on the CSS flag** — not the entire Lite cohort. CSS is a Cloudflare KV map keyed by subdomain prefix (e.g. `linemanwongnai`, not `linemanwongnai.atlassian.net`).

| Resource | Value |
|---|---|
| KV namespace | `fe9042cb20994651b0a2ef9e68f9037c` |
| Flag check | `useCustomerSuccessService.ts` |
| Read | `python3 .claude/skills/paywall/scripts/css_flag.py get` |
| Write | `python3 .claude/skills/paywall/scripts/css_flag.py put '<json>'` |

Enrollment policy (full version in the paywall skill, §4 *Interpret the table*):

- **Enroll** if at least one space ≥ 100 macros, install ≥ 14d, ≥ 3 viewers in 30d, ≥ 5 saves in 7d.
- **Monitor** if top space is 50–99 macros.
- **Skip** if top space < 50 macros or fewer than 3 viewers — zero paywall surface area, enrolling would be invisible noise.

Order enrollments by top-space macro count descending — most likely to trigger soonest.

---

## 4. Variant scope and code paths

| Variant | Paywall active | Notes |
|---|---|---|
| Lite | Yes (when on CSS) | All gates in §1 apply |
| Full | No | `isLite()` short-circuits all gates |
| Diagramly | No | Same as Full |

Code entry points (all four go through `PageEditorPaywallGate` for the soft-block modal):

| File | Branch |
|---|---|
| `src/forgeIndex.ts` | Sequence + Mermaid editors (edit and create branches) |
| `src/forge-graph-editor.ts` | DrawIO editor (edit and create branches) |
| `src/forge-embed-editor.ts` | Embed editor (edit and create branches) |
| `src/forge-swagger-editor.ts` | OpenAPI/Swagger editor (edit and create branches) |

The gate predicates live in `src/utils/paywall/preEditGate.ts`:
- `isPageEditorEditBlocked(customContentId, shouldBlockActions)` — edit path
- `isPageEditorCreateBlocked(shouldBlockActions)` — create path

---

## 5. Open strategic questions

1. **Export-adjacent surface — reframed (2026-05-15), audit reopened.** The original audit framed the question as *failure-cohort recovery* (anonymous public-page export → upgrade). That thesis is dead — Phase 2 found 0 `needs_authentication` failures over 30 days, and 71% of failures are `attachment_not_found` (a product bug to fix, not a paywall). **The right framing is *success-as-nudge-surface*:** every successful Lite export = a value-realization moment, where an in-document or post-export upgrade hint reaches the exporter and the document's audience at zero friction. Volume: 752 successful exports/30d in the CSS-customer cohort alone (~25/day), ~2,667 across all tenants. At even 0.5% click rate that's ~10 high-intent leads/month from a different funnel than the editor-path. Phase 4 (placement + ADF rendering validation) is next. Full results in `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md` §7a–7d. Phase 2 failure taxonomy is real product debt: ship triage independently of the paywall decision.

2. **Hard block on create.** Edit path is soft (77% continue rate is acceptable). Create is also soft today, mirroring edit. Question: are create-blocked users qualitatively different (newer, higher-intent) such that hard-blocking creates would convert more without unacceptable CSAT damage?

3. **Pricing-card placement.** The advocacy modal currently has no pricing cards. Earlier variants kept demoted, no-CTA cards above the advocacy button (`All Variants Canvas.html` Variant A). Question: does pricing context above the draft change advocacy copy rates? Worth re-testing once we have a steady-state baseline.

4. **A/B copy variants.** D2 is shipped. D1 (recipient-agnostic) and D3 (no illustration) are candidates if advocacy copy rate flattens.

---

## 6. Recent material changes

| Date | Change | Reference |
|---|---|---|
| 2026-05-15 | Create-path gate shipped — `paywall_blocked_create` event added | PR #89 |
| 2026-05-12 | PDF export: Phase 1 telemetry shipped (`macro_export_requested` / `_succeeded` / `_failed`). No paywall on export; decision-support audit still in progress. | `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md`, `src/export.js` |
| 2026-05-08 | Advocacy CTA redesign: marketplace/enterprise buttons removed, single Copy CTA + `advocacy_message_copied` event added | PR history |
| 2026-04-29 | Event rename `upgrade_action_blocked` → `paywall_triggered` (auto-distributed as Forge minor) | — |

For windows that span 2026-04-28 always query both event names; for windows entirely after 2026-04-29, `paywall_triggered` alone is sufficient.

---

## 7. References

| Topic | File |
|---|---|
| Day-to-day monitoring + A/B impact | `.claude/skills/paywall/SKILL.md` |
| Per-event reference | `docs/upgrade-tracking-event-reference.md` |
| Export decision-support spec (still open) | `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md` |
| Pricing tiers + cost formula | `docs/pricing-model.yml` |
| Thresholds + CSS flag check | `src/composables/useCustomerSuccessService.ts` |
| Gate predicates | `src/utils/paywall/preEditGate.ts` |
| Single paywall modal | `src/components/UpgradePrompt/UpgradePrompt.vue` |
| Event names | `src/utils/upgradeTracking.ts` |
| Space license endpoint | `functions/api/space-status.ts`, `functions/api/space-license.ts` |
| Stripe webhook | `functions/api/stripe-webhook.ts` |
| Export telemetry source | `src/export.js` |
