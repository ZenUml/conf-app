# Paywall Strategy — ZenUML Lite

**Last updated:** 2026-05-15
**Variant scope:** Lite only. Full and Diagramly bypass via `useCustomerSuccessService.isLite() === false`.
**Operational monitoring:** `.claude/skills/paywall/SKILL.md`

---

## 0. The strategy in one paragraph

Lite monetization runs on **two complementary upgrade funnels**, not one. Pick the funnel by who you're trying to reach, not by where the trigger fires:

| Funnel | Trigger moment | Audience | Volume signal | Conversion event |
|---|---|---|---|---|
| **Friction funnel** | User tries to edit/create a macro in a space ≥ 100 macros | The editing engineer (rarely the buyer) | `paywall_triggered`, `paywall_blocked_edit`, `paywall_blocked_create` | `advocacy_message_copied` (engineer forwards templated request to budget owner) |
| **Nudge funnel** | User successfully exports a macro to PDF/Word/PNG | The document's audience — managers, customers, decision-makers — **plus** the exporter | `macro_export_succeeded` (~2,667/30d total, 752 in CSS cohort) | TBD by Phase 4 — likely an in-doc footer link, click → upgrade flow |

The friction funnel is shipped and instrumented; the nudge funnel is in design (audit reframed 2026-05-15, advancing to Phase 4). They target different humans, so they're additive — running both does not double-friction the same user.

**What this framing replaces:** an earlier framing treated "the paywall" as a single editor-side artefact, and treated export only as a *failure-recovery* surface (convert export errors into upgrade actions). The failure thesis is dead — Phase 2 of the export audit found 0 auth-failure events over 30 days and showed that 71% of failures are a product bug, not an upgrade moment. The strategically larger surface was always the *successes*.

---

## 1. Friction funnel — what's shipped

The friction funnel enforces a per-space soft limit of 100 macros on Lite tenants enrolled in the **CUSTOMER_SUCCESS_SERVICE** (CSS) flag. Per-space, not per-tenant: a tenant with 5,000 macros across 100 spaces is unaffected unless one single space crosses the threshold.

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
| **CSS flag off** | Default state — friction funnel logic short-circuits to `false` |
| **Full / Diagramly variant** | `isLite()` returns false; all gates inert |

---

## 2. Nudge funnel — in design (Phase 4 next)

Every successful Lite export is a value-realization moment that produces a shared artefact (PDF / Word / PNG). The artefact reaches the document's audience — often the manager, customer, or budget owner the friction funnel can only reach indirectly through advocacy forwarding.

### Volume that justifies the surface

| Cohort | Successful exports (30d) | Per day |
|---|---|---|
| CSS customer (≈ confirmed Lite) | 752 | ~25 |
| All tenants (likely 60-80% Lite) | 2,667 | ~89 |

Each export is opened by the exporter and typically forwarded to additional readers — the surface multiplies through sharing.

### Why this funnel is *additive* to friction

- **Different audiences.** The friction funnel reaches the engineer. The nudge funnel reaches the engineer + everyone the doc gets shared with — managers, customers, prospects.
- **No friction added.** The export still works exactly as today. The nudge sits on the produced artefact, not on the path to producing it.
- **Different intent profile.** Friction-funnel targets are blocked-and-frustrated. Nudge-funnel targets just received the value the tool produces — a positive emotional moment for an upgrade ask.

### Phase 4 — what's open

1. **Placement.** Spike (2026-05-15, four iterations v1–v4) converged on a **conditional ADF response keyed on `payload.exportType`**: emit a footer paragraph for everything except `exportType === "word"`, which gets baseline single-root only. v4 proved by direct REST inspection of `body.view` / `body.export_view` / `body.styled_view` that the multi-root response renders correctly in the renderer family used by all formats *other than* Word's MHTML pipeline. Effective coverage: ~95% of `macro_export_succeeded` events (PDF + other + email + feed + diff + html_export). Word stays clean. Full results in `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md` §7e.
2. **What `other` actually is.** Best inference after v4: third-party integrations + Atlassian Intelligence / Rovo + mobile / lightweight renderers, all calling `body.export_view`-class endpoints. We can't *prove* this without a production telemetry property; recommended Phase 5 ships a `macro_export_nudge_included` event with format/tenant breakdowns so this attribution lands in Mixpanel immediately.
3. **Copy tone.** "Value-moment nudge", not "you've been blocked".
4. **Upgrade hook.** What specifically the upgrade unlocks that's visible from the artefact — no Lite watermark, higher resolution, batch export, brand customization. TBD by product.
5. **PNG watermark as reserve.** If production data after staged rollout contradicts the v4 finding (e.g. complaints from a Lite tenant that an integration broke, or the new event shows low real-user reach), the PNG-watermark approach remains viable as a fallback: bake the upgrade callout into the rendered PNG before responding, works identically across all formats, medium engineering effort.

Full audit results in `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md` §7a–7d.

### What this funnel is *not*

- **Not** hard-blocking exports — that's a Lite-feature-scope decision, a CSAT-cliff conversation, and a separate spec.
- **Not** a failure-recovery surface — the export-failure cohort is small (~21 addressable failures/mo) and dominated by a product bug to fix (`attachment_not_found`), not an upgrade trigger.
- **Not** an editor-path duplicate — the nudge fires on the *output*, not on the act of producing it.

---

## 3. What is intentionally NOT gated

| Surface | Decision | Rationale |
|---|---|---|
| **Viewer (reading macros)** | Out of scope | Reading is the primary job for most users. Friction on view is the highest CSAT risk with the weakest conversion case. |
| **Export as friction** (block exports for Lite) | Out of scope | Different from the nudge funnel above. Hard-blocking working exports is a CSAT cliff and a Lite-feature-scope decision, not a paywall mechanic. |
| **Failed-export recovery as a paywall** | Out of scope (decision: 2026-05-15) | The audit reframe: 0 auth failures; dominant failure is a product bug. Fix the bug; don't paywall the broken state. |
| **Heavy-user behavioural targeting** | Out of scope | Separate, larger initiative if it's ever pursued. |
| **Hard block on save** | Out of scope | Current 77% "continue editing" rate after the modal is the accepted soft-block baseline. |

---

## 4. Rollout mechanism (friction funnel)

The friction funnel is shipped to **all Lite tenants on the CSS flag** — not the entire Lite cohort. CSS is a Cloudflare KV map keyed by subdomain prefix (e.g. `tenant-a`, not `tenant-a.atlassian.net`).

| Resource | Value |
|---|---|
| KV namespace | `fe9042cb20994651b0a2ef9e68f9037c` |
| Flag check | `useCustomerSuccessService.ts` |
| Read | `python3 .claude/skills/paywall/scripts/css_flag.py get` |
| Write | `python3 .claude/skills/paywall/scripts/css_flag.py put '<json>'` |

Enrollment policy (full version in the paywall skill, §4 *Interpret the table*):

- **Enroll** if at least one space ≥ 100 macros, install ≥ 14d, ≥ 3 viewers in 30d, ≥ 5 saves in 7d.
- **Monitor** if top space is 50–99 macros.
- **Skip** if top space < 50 macros or fewer than 3 viewers — zero friction-funnel surface area, enrolling would be invisible noise.

Order enrollments by top-space macro count descending — most likely to trigger soonest.

The **nudge funnel has no enrollment mechanism**. When it ships, it will apply to all Lite exports — independent of CSS, because it's not gated on space size.

---

## 5. Variant scope and code paths

| Variant | Friction funnel | Nudge funnel (when shipped) | Notes |
|---|---|---|---|
| Lite | Yes (when on CSS) | Yes (all Lite exports) | All friction gates in §1 apply; nudge surface applies to every successful export |
| Full | No | No | `isLite()` short-circuits |
| Diagramly | No | No | Same as Full |

Code entry points for the **friction funnel** (all four go through `PageEditorPaywallGate` for the soft-block modal):

| File | Branch |
|---|---|
| `src/forgeIndex.ts` | Sequence + Mermaid editors (edit and create branches) |
| `src/forge-graph-editor.ts` | DrawIO editor (edit and create branches) |
| `src/forge-embed-editor.ts` | Embed editor (edit and create branches) |
| `src/forge-swagger-editor.ts` | OpenAPI/Swagger editor (edit and create branches) |

The gate predicates live in `src/utils/paywall/preEditGate.ts`:
- `isPageEditorEditBlocked(customContentId, shouldBlockActions)` — edit path
- `isPageEditorCreateBlocked(shouldBlockActions)` — create path

Code entry point for the **nudge funnel**: `src/export.js` (Forge resolver returning ADF). When the funnel ships, the nudge will be assembled here — see Phase 4 (§2).

---

## 6. Open strategic questions

### Nudge funnel (export)

1. **Phase 4 — placement and rendering.** Footer line in ADF? Watermark on PNG? Post-export Confluence message? Each has different reach and rendering risk to validate. This is the gating decision before any code change.
2. **Upgrade hook.** What specifically does upgrading unlock that the document's reader sees as removed/improved? "No Lite watermark", "higher resolution PNG", "batch export", "brand customization" — needs product call.

### Friction funnel (editor)

3. **Hard block on create.** Edit path is soft (77% continue rate is acceptable). Create is also soft today, mirroring edit. Are create-blocked users qualitatively different (newer, higher-intent) such that hard-blocking creates would convert more without unacceptable CSAT damage?
4. **Pricing-card placement.** The advocacy modal currently has no pricing cards. Earlier variants kept demoted, no-CTA cards above the advocacy button. Does pricing context above the draft change advocacy copy rates? Worth re-testing once we have a steady-state baseline.
5. **A/B copy variants.** D2 is shipped. D1 (recipient-agnostic) and D3 (no illustration) are candidates if advocacy copy rate flattens.

### Cross-funnel

6. **Failure taxonomy debt.** Independent of the nudge-funnel decision: `unexpected_error` (142/mo, 20% of export failures) needs triage, and `attachment_not_found` (517/mo, 71% of failures) should be killed by auto-regenerating the PNG on export when missing. Ship these regardless.

---

## 7. Recent material changes

| Date | Change | Reference |
|---|---|---|
| 2026-05-15 | Export paywall audit reframed — failure-recovery thesis dead; success-as-nudge thesis adopted; advancing to Phase 4 | Spec §7c–7d |
| 2026-05-15 | Create-path gate shipped — `paywall_blocked_create` event added (friction funnel extension) | PR #89 |
| 2026-05-12 | Export Phase 1 telemetry shipped (`macro_export_requested` / `_succeeded` / `_failed`) | `src/export.js` |
| 2026-05-08 | Advocacy CTA redesign: marketplace/enterprise buttons removed, single Copy CTA + `advocacy_message_copied` event added | PR history |
| 2026-04-29 | Event rename `upgrade_action_blocked` → `paywall_triggered` (auto-distributed as Forge minor) | — |

For windows that span 2026-04-28 always query both event names; for windows entirely after 2026-04-29, `paywall_triggered` alone is sufficient.

---

## 8. References

| Topic | File |
|---|---|
| Day-to-day monitoring + A/B impact | `.claude/skills/paywall/SKILL.md` |
| Per-event reference | `docs/upgrade-tracking-event-reference.md` |
| Export audit spec (nudge funnel design path) | `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md` |
| Pricing tiers + cost formula | `docs/pricing-model.yml` |
| Thresholds + CSS flag check | `src/composables/useCustomerSuccessService.ts` |
| Friction-funnel gate predicates | `src/utils/paywall/preEditGate.ts` |
| Friction-funnel modal | `src/components/UpgradePrompt/UpgradePrompt.vue` |
| Event names | `src/utils/upgradeTracking.ts` |
| Space license endpoint | `functions/api/space-status.ts`, `functions/api/space-license.ts` |
| Stripe webhook | `functions/api/stripe-webhook.ts` |
| Nudge-funnel resolver | `src/export.js` |
