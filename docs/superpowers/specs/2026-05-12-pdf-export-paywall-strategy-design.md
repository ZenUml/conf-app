# PDF/Word Export Telemetry Audit — Paywall Decision Support

**Date:** 2026-05-12 (Phase 2 + Phase 3 results added 2026-05-15)
**Status:** **Closed — recommendation: abandon** (see §7d). Telemetry continues to land; no export paywall surface to be built.
**Current strategy source:** [`docs/paywall-strategy.md`](../../paywall-strategy.md) (see §5 open question on export-adjacent surface)
**Variant:** ZenUML Lite only
**Related work:** Existing editor paywall (`UpgradePrompt`, `advocacy_message_copied`), export telemetry in `src/export.js`

---

## 1. Problem statement

The current Lite paywall exists in the editor flow, where a blocked save can lead to `paywall_triggered` and, occasionally, `advocacy_message_copied`. That channel is real, measurable, and already in production.

The export path is different. The code already emits `macro_export_requested`, `macro_export_succeeded`, and `macro_export_failed` from `src/export.js`. What we do **not** yet know is:

1. how much export traffic comes from the Lite cohort that is actually affected by space restrictions,
2. whether the dominant failure mode is truly anonymous public-page export, and
3. whether an export-adjacent upgrade surface is worth building at all.

This spec is therefore a telemetry and decision-support spec, not a commitment to ship a paywall inside the exported document.

---

## 2. Decision we are making

**Should we invest in an export-adjacent upgrade surface for ZenUML Lite, and if so, where should that surface live?**

Decision rule:

> **Proceed only if export telemetry shows enough restricted-space volume to justify a new surface, and only if the upgrade action can be captured outside the generated PDF/Word document.**

The output of this work is a yes/no recommendation and a placement recommendation. It is not a design for watermarking or embedding a CTA in the rendered PDF itself.

---

## 3. What the code already does

`src/export.js` already:

- extracts `format`, `cloudId`, `clientDomain`, `spaceKey`, and `accountId` from the export payload,
- emits `macro_export_requested` before any attachment lookup,
- emits `macro_export_succeeded` when the attachment resolves,
- emits `macro_export_failed` with a structured `failure_reason`,
- records `used_asuser_fallback`, `fallback_http_status`, and `fallback_error_name` when the `asApp()` → `asUser()` fallback path is used.

That means the right next step is not “add telemetry”; the right next step is to validate and interpret the telemetry we already have.

---

## 4. What we learned during the brainstorm

### 4.1 Viewer paywall was rejected

The original question started as “should we show paywalls to viewers?” That remains a bad trade for the same reasons:

| Concern | Detail |
|---|---|
| Core experience | Viewing is the primary job for most users |
| CSAT risk | Adding friction to reading is the highest-brand-risk option |
| ROI | The best case is weaker than editor-side friction capture |

Viewer paywall stays out of scope.

### 4.2 Export is still interesting, but only if the surface is real

Export is a higher-intent action than passive viewing. But the surface we can reasonably influence is the export flow itself, not the contents of the PDF after Confluence has generated it.

That distinction matters:

- We can log export attempts and outcomes.
- We can potentially present an upgrade prompt in the export UI or surrounding Confluence UI.
- We cannot assume we can safely turn the returned ADF into a persuasive paywall surface without proving that Confluence will render it consistently across export modes.

---

## 5. Export telemetry questions

These are the questions the next phase must answer:

| Question | Why it matters |
|---|---|
| How many exports are successful vs failed by `format`? | Separates real usage from broken-path noise |
| How many failures are `needs_authentication`, `attachments_api_404`, and `attachment_not_found`? | Tells us whether failures are permission-driven, page-state-driven, or something else |
| How often does `asUser()` rescue an `asApp()` 404? | Indicates how much of the “failure” surface is actually recoverable |
| How much export traffic comes from Lite, CSS-enrolled, restricted spaces? | Determines whether an export-adjacent surface is worth building for this cohort |
| Can we attach a measurable upgrade action to the export journey outside the generated document? | Determines whether the UX is viable at all |

---

## 6. Current architecture and constraints

### 6.1 `src/export.js`

The export resolver is already the right instrumentation point. It has access to:

- the export format,
- tenant identity (`clientDomain` / `cloudId`),
- space identity (`spaceKey`),
- the page id,
- the custom content id,
- the fallback path used when `asApp()` cannot read the attachment.

That is enough for an audit.

### 6.2 What the resolver does not prove

The resolver does **not** prove:

- that a 401/403 is an anonymous export,
- that the exporting user is on Lite,
- that the page belongs to a restricted space,
- or that a CTA inside the generated PDF would be seen by the right buyer.

Those are assumptions that need validation, not premises to build on.

---

## 7. Phased plan

| Phase | Action | Cost | Exit criteria |
|---|---|---|---|
| **1 — Audit existing telemetry** | Verify `macro_export_requested`, `macro_export_succeeded`, and `macro_export_failed` are landing in Mixpanel with the expected properties. Confirm breakdown by `client_domain`, `format`, and `failure_reason`. | ~0.5 day | Payloads visible and queryable |
| **2 — Classify failure modes** | Measure the split between `needs_authentication`, `attachments_api_404`, `attachment_not_found`, and unexpected errors. Check how often `asUser()` rescues `asApp()` 404s. | ~0.5 day | Failure taxonomy documented |
| **3 — Measure cohort volume** | Cross-reference export volume with CSS-enrolled Lite tenants and restricted spaces. Determine whether the reachable cohort is large enough to justify a new surface. | ~1 day | Volume estimate recorded by cohort |
| **4 — Decide placement** | If the volume is real, decide whether the upgrade action should live in the export dialog, a post-export page flow, or be abandoned. Do not assume the PDF/Word output itself is the right place. | ~0.5 day | Placement recommendation written |
| **5 — Only then design** | If Phase 4 is positive, write a separate implementation spec for the chosen surface. | deferred | New spec, if warranted |

---

## 7a. Phase 2 results (run 2026-05-15, 30-day window)

**Outcome volumes**

| Event | Count | Note |
|---|---|---|
| `macro_export_requested` | 3,092 | |
| `macro_export_succeeded` | 2,658 | 86.0% of requests |
| `macro_export_failed` | 724 | 23.4% of requests |

> Outcomes (succeeded + failed = 3,382) exceed requested (3,092). Likely a property/time-attribution skew on the requested event; not investigated further since the failure analysis below is independent of the request count.

**Failure taxonomy**

| `failure_reason` | Count | % of failures | Interpretation |
|---|---|---|---|
| `attachment_not_found` | 517 | 71.4% | Image not yet generated — viewer never rendered the macro, so the PNG attachment doesn't exist. UX issue, not a paywall opportunity. |
| `unexpected_error` | 142 | 19.6% | Uncaught exceptions in the export handler. Needs separate triage; not a monetization signal. |
| `attachments_api_404` | 56 | 7.7% | API returned 404 even after `asUser()` fallback. Possible page-restriction edge cases. |
| `missing_custom_content_id` | 8 | 1.1% | Payload didn't carry a customContentId. Frontend bug or malformed payload. |
| `attachments_api_429` | 1 | 0.1% | Rate limited. Noise. |
| `needs_authentication` | **0** | **0%** | **Hypothesis refuted** — anonymous / unauthenticated public-page export is not a measurable failure mode in this window. |

**asUser() fallback rescue rate**

`asApp()` returned 404 → `asUser()` fallback was attempted on **182 occasions** (136 succeeded + 46 failed):

| Outcome | Count | % of fallback attempts |
|---|---|---|
| asUser rescued the 404 → export succeeded | 136 | 74.7% |
| asUser also failed → `attachments_api_404` or `attachment_not_found` | 46 | 25.3% |

Without the fallback, those 136 successful exports would have been `attachments_api_404` failures. The fallback meaningfully reduces the failure surface.

---

## 7b. Implications

1. **The original "anonymous public-page export" thesis is dead.** Zero `needs_authentication` failures over 30 days. There is no measurable cohort of unauthenticated public-page exporters to convert.
2. **The biggest failure bucket is a product bug, not a paywall surface.** 71% of failures are `attachment_not_found` — the diagram image was never generated because no viewer rendered the macro. This is a fix-the-product problem (e.g., generate the attachment server-side on first export request, or document the "open the page first" requirement in the export UI), not a monetization problem.
3. **`unexpected_error` (20%) warrants its own triage.** The `error_name` and `error_stack` properties on these events should narrow this down quickly; not blocking the strategy question.
4. **`asUser()` fallback is paying its rent.** 75% rescue rate on what would otherwise be 404 failures.

Recommendation per §8 *Decision branches*: **"Restricted-space export volume is small or mostly outside Lite → Do not build a new export surface"** — Phase 3 should confirm by cohort-segmenting the 724 failures and 2,658 successes, but the absence of any auth-failure signal makes it likely Phase 3 confirms abandon.

---

## 7c. Phase 3 results (run 2026-05-15, 30-day window)

**CSS-enrolled customer cohort (the closest thing to "addressable Lite tenants"):**

| Domain | succeeded | failed | total | failure rate |
|---|---|---|---|---|
| colesgroup | 340 | 19 | 359 | 5.3% |
| mcoproduct | 120 | 8 | 128 | 6.3% |
| vin3s | 108 | 16 | 124 | 12.9% |
| airwallex | 71 | 21 | 92 | 22.8% |
| linemanwongnai | 47 | 4 | 51 | 7.8% |
| xendit | 48 | 2 | 50 | 4.0% |
| zeptonow | 18 | 2 | 20 | 10.0% |
| **CSS customer total** | **752** | **72** | **824** | **8.7%** |
| Overall (all domains) | 2,658 | 724 | 3,382 | 21.4% |

**CSS-customer slice = 24.3% of total exports.** CSS-enrolled tenants have a ~2.5× lower failure rate than the long tail, consistent with the Phase 2 finding that the dominant failure is `attachment_not_found` — mature instances have their attachments already generated.

**Lite identification limitation:** the export events emit no `product_type` property (the Forge resolver in `src/export.js` doesn't tag exports with the variant). Mixpanel cannot directly distinguish Lite from Full/Diagramly exports. The CSS list above is a strict subset of Lite; the true Lite total is larger but unmeasurable without an instrumentation change. Even the generous case (assume the entire long tail is Lite) does not change the strategic answer below — the failure mix is the same.

**Addressable failures, optimistic upper bound:**

If we converted 100% of the 72 CSS-customer failures into upgrade actions — implausibly high — that's 2.4 failures per day across all CSS tenants. With realistic conversion rates (existing advocacy CTA copy rate ~7-15% of triggers), the export-adjacent surface yields well under 1 upgrade lead per week. The editor-path advocacy surface already produces meaningfully more.

---

## 7d. Phase 3 conclusion — ABANDON

Convergent evidence supports `§8 — "Restricted-space export volume is small or mostly outside Lite → Do not build a new export surface"`:

1. **Phase 2 killed the auth thesis.** 0 `needs_authentication` failures over 30 days.
2. **The dominant failure is a product bug, not a paywall.** 71% of failures are `attachment_not_found` — fix the viewer-pre-render dependency or document it; don't monetize it.
3. **The addressable cohort is small.** Even generously, CSS-customer failures are ~2/day. Editor-path advocacy already captures more intent than any plausible export surface could.
4. **`asUser()` fallback is already paying.** 75% of `asApp()` 404s are silently rescued. Most of the remaining noise will resolve as instances mature.

**Recommendation:** Stop the audit at Phase 3. Do not advance to Phases 4–5. Redirect the export effort to:
- Triage `unexpected_error` (142 events / 20% of failures) for actionable bugs
- Consider auto-regenerating PNG attachments on export request when missing, removing the `attachment_not_found` UX surprise
- Treat the export instrumentation in `src/export.js` as long-lived telemetry; it's working as intended

---

## 8. Decision branches

| Finding | Recommendation |
|---|---|
| Restricted-space export volume is small or mostly outside Lite | Do not build a new export surface |
| Most “failures” are recoverable `asApp()` 404s | Treat them as attachment-access noise, not a monetization opportunity |
| The only viable UX is inside the exported PDF/Word document | Stop; that is not yet a proven or safe surface |
| Export UI or surrounding Confluence UI can capture an upgrade action cleanly | Write a separate implementation spec for that surface |

---

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Misclassifying auth failures as anonymous exports | Medium | Bad sizing and bad strategy | Validate failure reasons against payloads and fallback telemetry |
| Building on an in-doc CTA that Confluence renders inconsistently | Medium | Broken or invisible UX | Prefer a surface outside the generated document |
| Overestimating export volume from noisy logs | Medium | False positive business case | Use the existing Mixpanel export events as the source of truth |
| Confusing export telemetry with editor paywall telemetry | High | Wrong KPI | Keep export measurement separate from `advocacy_message_copied` |

---

## 10. Out of scope

- Showing a paywall inside the generated PDF/Word body
- Watermarking the exported PNG itself
- Changing the editor paywall flow
- Optimizing `advocacy_message_copied` copy for the export path
- Marketplace/Stripe CTA design

---

## 11. Open questions

1. Do we want to pursue any export-adjacent surface at all if it cannot live in the generated document?
2. Is `needs_authentication` actually the right signal to treat as anonymous export, or do we need a separate classification pass on raw payloads?
3. If a new surface is justified, should it be the export dialog, a pre-export upsell, or a post-export follow-up in Confluence?

---

## 12. Success criteria

This work succeeds if it produces:

1. a clear export failure taxonomy,
2. a quantified estimate of reachable Lite export volume,
3. a recommendation on whether an export-adjacent surface is worth building,
4. and, if yes, the correct placement for that surface.

The work fails if it proceeds directly to a PDF/Word paywall implementation without proving the surface and the audience first.
