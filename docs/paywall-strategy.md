# Paywall — Status & Roadmap (ZenUML Lite)

**Last updated:** 2026-06-03 · **Variant scope:** Lite only (Full/Diagramly bypass via `isLite() === false`) · **Day-to-day monitoring:** `.claude/skills/paywall/SKILL.md`

This is the single source of truth for the Lite paywall. It replaces the former separate strategy / export-research / extension-flow / page-banner docs (folded in here 2026-06-03; full history in git).

---

## Strategy in one paragraph

Lite monetization runs on **two complementary upgrade funnels**, picked by *who* you reach, not where the trigger fires. The **friction funnel** blocks editing/creating in spaces ≥100 macros and converts the (usually non-buyer) engineer into an advocate who forwards an upgrade ask. The **nudge funnel** rides every successful export (PDF/Word/PNG) to reach the document's *audience* — managers, customers, budget owners. They target different humans, so they stack additively. (The old "export = failure-recovery" thesis is dead: 0 auth-failure events / 30d, and 71% of export failures are a product bug, not an upgrade moment.)

---

## ✅ Shipped (brief)

The **friction funnel is fully shipped and instrumented**: per-space 100-macro soft-block on edit + create (modal over a mounted editor, dismissable), an 85-macro inline warning, a viewer "Upgrade" badge, persistence-layer save block, an **advocacy-only** modal (`Copy upgrade request` → `advocacy_message_copied`), a 15-attempt continue gate, a **Forge page-banner** warning that reaches editors *while browsing* (85–99 band, 7-day snooze, defers CSAT), space-license + Stripe-webhook bypass, and CSS-flag enrollment.

| Shipped surface | Event | Ref |
|---|---|---|
| Edit / create soft-block modal | `paywall_blocked_edit` / `paywall_blocked_create` + `paywall_triggered` | PR #89 (create path) |
| Advocacy CTA (marketplace/sales CTAs removed — were 0% click) | `advocacy_message_copied` | — |
| 15 continue-attempts gate (localStorage, per `domain:space:user`) | `paywall_continue_used`, `paywall_attempts_exhausted` | — |
| Page-banner warning (85–99 band, 7-day snooze, CSAT defer) | `paywall_banner_shown` / `_dismissed`, `surface: page_banner` | PRs #201–#210 |
| Export Phase-1 telemetry | `macro_export_requested` / `_succeeded` / `_failed` | `src/export.js` |

---

## 🔜 Future tasks

### A. Nudge funnel (export) — *the strategically larger bet; in design, no code yet*

The gating decision below blocks all nudge-funnel code.

1. **[Phase 4] Placement & rendering decision** — the spike (v1–v4) converged on a **conditional ADF response keyed on `payload.exportType`**: emit a footer paragraph for everything *except* `word` (Word's MHTML pipeline errors on multi-root). Covers ~95% of `macro_export_succeeded`. Confirm and ship in `src/export.js#createMediaDocument`. Alternatives still open: PNG watermark (reserve fallback, format-agnostic), post-export Confluence message.
2. **[Phase 4] Upgrade hook** — decide what upgrading visibly unlocks from the artefact (no Lite watermark / higher-res PNG / batch export / brand customization). **Product call needed.**
3. **[Phase 5] Attribution telemetry** — ship `macro_export_nudge_included` (format + tenant breakdown) so the click endpoint can attribute the `format=other` (83.5%) cohort in Mixpanel. Log `cloudId`, `pageId`, `customContentId`, `accountId`, `format`, UTM on every nudge click.
4. **[Phase 5] Two-layer surface** — (a) live in-product banner on the next iframe load after a recent-export KV marker (~1,240 weekly in-session humans); (b) in-doc footer/QR baked into the artefact (~1,770 full exporter cohort + the document audience).

### B. Friction funnel — banner fatigue, personalization, rollout

5. **[Phase 4] Banner fatigue & full priority order** — 100+ band gets a shorter **24h** suppression window; taper repeats via `showCount`/`lastShownAt`; finalize priority `restore/recovery > paywall warning > CSAT`. Keep windows data-tunable.
6. **[Phase 5] Space-Admin personalization** — validate current user via `SpaceAdminResolver` (don't rely on `space_admin_count`); track `is_space_admin`; branch copy (admin → "request extension or upgrade"; non-admin → "ask a space admin"); consider showing earlier to admins.
7. **[Phase 6] Operational rollout** — enable a small CSS cohort first (pilot tenant primary). Monitor support-ticket volume, `extension_request_clicked`, `admin_message_copied`, attempt exhaustion, save volume before/after, continue-editing rate, advocacy copy rate. Tune attempt count, dismissal windows, warning threshold, CTA order, copy.

### C. Cross-funnel — ship regardless

8. **Failure-taxonomy debt** — triage `unexpected_error` (142/mo, 20% of export failures); kill `attachment_not_found` (517/mo, 71%) by auto-regenerating the PNG on export when missing.

### D. Open strategic questions

9. **Hard-block on create?** Edit is soft (77% continue rate accepted); are create-blocked users higher-intent enough to hard-block without unacceptable CSAT damage?
10. **Pricing-card placement** above the advocacy draft — re-test once a steady-state advocacy baseline exists.
11. **A/B copy variants** — D2 shipped; D1 (recipient-agnostic) and D3 (no illustration) are candidates if advocacy copy rate flattens.

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
