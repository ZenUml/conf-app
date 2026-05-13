# PDF/Word Export Telemetry Audit — Paywall Decision Support

**Date:** 2026-05-12
**Status:** Draft (reframed after code review)
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
