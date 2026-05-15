# PDF/Word Export Telemetry Audit — Paywall Decision Support

**Date:** 2026-05-12 (Phase 2 + Phase 3 results added 2026-05-15; reframed same day)
**Status:** **Open — reframed.** The original audit framed the question as *failure-cohort recovery* (anonymous public-page export → upgrade). That thesis is dead (Phase 2). The right framing is *success-as-nudge-surface*: every successful Lite export = a moment of value-realization, where an in-document or post-export upgrade hint can reach the exporter **and the document's audience** at zero friction. The volume is real (§7c). Phase 4 needs to evaluate placement and ADF rendering consistency.
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

## 7d. Phase 3 conclusion — REFRAME, advance to Phase 4

The original Phase 3 framing — cohort-size the **failures** as a paywall-recovery surface — is the wrong question. Under that framing the audit lands at abandon: the failure-driven thesis is dead (0 auth failures), and the dominant bucket is a product bug to fix, not a wall to monetize.

**But that framing was always the smaller opportunity.** The right strategic question is: *can a successful export carry an upgrade nudge?*

| Surface | 30d volume (CSS customer) | 30d volume (all tenants) | Friction added |
|---|---|---|---|
| Failure-driven (what the audit measured) | ~21 addressable / mo | ~21 addressable / mo | Adds friction to a broken state — bad |
| **Success-as-nudge (the right question)** | **752 / mo** | **2,667 / mo** (likely 60-80% Lite) | **None — export still works exactly as today** |

The success surface is ~35× larger than the addressable-failure surface in the CSS cohort, and it carries downstream amplification: every exported document is opened by the exporter and typically forwarded to a manager / team / customer / decision-maker. **That's the audience the editor-path advocacy CTA is trying to nominate indirectly.**

**Why this matters for the strategic decision:**

1. **Phase 2's findings stand** — the failure taxonomy is real product debt. Triage `unexpected_error` (142/mo); consider auto-regenerating attachments on demand to kill `attachment_not_found`. These are bugs to fix, not paywalls.
2. **The export surface is alive** as a value-moment upgrade signal, NOT as a friction-driven recovery surface.
3. **Math:** at even a 0.5% click-to-upgrade-path rate on 2,000+ Lite-flavored exports/month, the success surface yields ≥10 high-intent leads/month — comparable to or exceeding current editor-path advocacy capture, from a different funnel (document readers and forwarders, not blocked editors).

**Recommendation: advance to Phase 4 with the reframed question.**

Phase 4 needs to evaluate:

1. **Placement options.** Each has different reach and rendering risk:
   - Footer line appended to the returned ADF document (every PDF/Word carries it)
   - Watermark/callout overlaid on the exported PNG (we control the rendering pipeline)
   - Post-export message in the Confluence page near the macro (harder to instrument; Confluence-API dependent)
2. **ADF rendering consistency** across PDF and Word export modes — the §4.2 concern that originally ruled the in-document surface out. This is a design-validation question, not a reason to abandon strategy.
3. **Copy tone** — "value-moment nudge", not "you've been blocked". Targets BOTH the exporter (who got value) and the doc's audience (who may be the budget owner).
4. **What we offer / what we charge for** — the nudge needs to point at a specific upgrade benefit that's tangible from the moment of opening the exported doc (no Lite watermark, batch export, higher resolution, brand customization, etc.). TBD by product.

Phase 5 (design spec) is conditional on Phase 4 producing a viable placement + rendering plan.

**Still out of scope:** hard-blocking successful exports (that's a Lite-feature-scope decision, a different conversation with CSAT implications).

**Independent of this strategy: the Phase 2 failure taxonomy is its own action list** — triage `unexpected_error`, fix `attachment_not_found` by auto-regenerating PNGs on demand. These ship regardless of the paywall decision.

---

## 7e. Phase 4 — in-doc footer placement spike (run 2026-05-15)

Goal: validate whether Confluence renders an ADF paragraph appended after the mediaSingle response from `adfExport`, consistently across PDF and Word export pipelines.

**Spike change** (deployed temporarily to `development` env, reverted in working tree):

```js
function createMediaDocument(downloadLink) {
  return {
    type: "doc",
    version: 1,
    content: [
      { type: "mediaSingle", ... },                      // existing
      { type: "paragraph", content: [                    // appended
        { type: "text", text: "Diagram by ZenUML Lite — " },
        { type: "text", text: "upgrade to remove this footer",
          marks: [{ type: "link",
                    attrs: { href: "https://conf-lite.zenuml.com/upgrade?source=export_footer_spike" }}]},
        { type: "text", text: " ↗" }
      ]}
    ]
  };
}
```

### Result matrix

| Format | Outcome | Evidence | Verdict |
|---|---|---|---|
| **PDF** (`/wiki/spaces/flyingpdf/pdfpageexport.action`) | ✅ Footer rendered directly below diagram. Link clickable in viewer. Typography matches body. | 71KB PDF, single page, footer line present in text content | **Surface works** |
| **Word** (`/wiki/exportword`) | ❌ Entire macro export failed. Confluence substituted error placeholder: *"We've encountered an issue exporting this macro. Please try exporting again later."* | 5.9KB MHTML stub, no diagram image, no footer text, error text present | **Surface broken** |
| Word — baseline (single-node ADF, no footer) | ✅ Diagram renders as embedded image | 62KB MHTML, `<img class="confluence-embedded-image">` present | Pre-existing capability confirmed |

### Operational note: forge tunnel does NOT proxy `adfExport`

The first spike attempt routed `forge tunnel` to local code and exported a PDF. The tunnel logged zero resolver invocations and the PDF rendered the baseline (un-modified) document. This is consistent with Confluence's export pipeline running server-side, bypassing the user's tunnel session.

**Implication:** future `adfExport` changes cannot be spike-tested via `forge tunnel` alone — they require a real deploy (e.g. `forge deploy -e development`) before export can be triggered. The skill `.claude/skills/forge-tunnel/SKILL.md` should grow a caveat for this.

### Interpretation

Confluence's Word export pipeline does not tolerate multi-node ADF documents from `adfExport`. Only a single root-level `mediaSingle` is honored; sibling nodes appear to cause the entire macro export to fail rather than degrade gracefully. PDF tolerates multi-node and renders the appended paragraph cleanly.

This is a placement-level constraint, not a strategy blocker:

| Placement | PDF viable | Word viable |
|---|---|---|
| Paragraph appended to ADF response | ✅ | ❌ |
| Inline caption inside `mediaSingle` (untested) | ? | ? |
| Watermark rendered onto the PNG itself (no ADF change) | ✅ | ✅ |
| Post-export Confluence message via separate channel | ✅ | ✅ |

### Spike v2 — caption nested inside mediaSingle (single-root, ADF spec)

Hypothesis: the Word break in v1 was caused by multi-root content. Move the footer text inside the `mediaSingle` as a `caption` child so the document still has a single root node.

```json
{
  "type": "doc",
  "version": 1,
  "content": [{
    "type": "mediaSingle",
    "attrs": { "layout": "center" },
    "content": [
      { "type": "media", "attrs": { ... } },
      { "type": "caption", "content": [ ...text+link... ] }
    ]
  }]
}
```

| Format | Outcome | Verdict |
|---|---|---|
| PDF | ❌ Caption text **silently dropped** — output identical to baseline (no footer) | **Caption not rendered** |
| Word | ✅ No error, image renders — but caption text also silently dropped | Caption not rendered |

Conclusion: Confluence's export pipelines accept `caption` syntactically (no error) but skip the text content during render. ADF caption inside mediaSingle is not a viable path for the upgrade nudge.

### Spike v3 — conditional ADF keyed on `payload.exportType` (chosen approach)

Atlassian's [macro manifest reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/) confirms `payload.exportType` is `"pdf" | "word" | "other"` and explicitly supports branching:

> *"The specified function can consume the exportType directly from the function's payload in order to specify different views per export type."*

Mixpanel `macro_export_succeeded.format` shows production also emits `email`, `feed`, `diff`, and `html_export` in addition to the documented three values.

v3 returns the v1 multi-root (with footer) for everything **except** `exportType === "word"`, which gets the baseline single-root:

```js
const content = [mediaSingle];
if (exportType !== "word") {
  content.push({ type: "paragraph", content: [ /* footer */ ] });
}
return { type: "doc", version: 1, content };
```

| Format | Outcome | Verdict |
|---|---|---|
| PDF | ✅ Footer renders (71KB PDF, identical to v1) | Confirmed |
| Word | ✅ Baseline rendering, no error (62KB MHTML, identical to baseline) | Confirmed |
| other / email / feed / diff / html_export | ❓ **Untested at spike time** — v3 includes the footer for all of them. Unknown which user-facing surfaces these formats correspond to. | **Phase 4 follow-up** |

### Format-share split (production, 30d window)

| format | events | % of total | Footer in v3? | Visual confirmation? |
|---|---|---|---|---|
| `other` | 2,269 | 83.6% | Yes (untested) | Unknown |
| `email` | 203 | 7.5% | Yes (untested) | Unknown |
| `word` | 123 | 4.5% | No (intentional) | n/a |
| `pdf` | 74 | **2.7%** | Yes (tested) | ✅ |
| `feed` | 28 | 1.0% | Yes (untested) | Unknown |
| `diff` | 14 | 0.5% | Yes (untested) | Unknown |
| `html_export` | 2 | <0.1% | Yes (untested) | Unknown |

**Strategic implication:** PDF is a sliver of the cohort. If `other` is a real user-visible surface (page history view, content preview, Rovo summary, etc.) then v3 already reaches ~95% of the cohort with no Word regression. If `other` is entirely headless/machine-only (search indexing, internal pipelines), then PDF alone is too small to justify the effort.

### Interpretation

Confluence's Word export pipeline does not tolerate multi-node ADF documents from `adfExport`. Only a single root-level `mediaSingle` is honored; sibling nodes appear to cause the entire macro export to fail rather than degrade gracefully. PDF tolerates multi-node and renders the appended paragraph cleanly. Captions inside mediaSingle are accepted but silently dropped — they are not a viable text surface.

The right code shape is the v3 conditional: branch on `payload.exportType` and emit `[mediaSingle, footerParagraph]` for everything except `"word"`. This pattern is documented and supported by Atlassian.

### Updated placement matrix

| Placement | PDF viable | Word viable | Code change |
|---|---|---|---|
| Multi-root paragraph (v1) | ✅ | ❌ | Small |
| Caption inside mediaSingle (v2) | ❌ | ❌ | Small |
| **Conditional on `exportType` (v3)** | ✅ | ✅ baseline | Small |
| Watermark rendered onto the PNG itself | ✅ | ✅ | Medium (touches macro PNG generation pipeline) |
| Post-export Confluence message via separate channel | ✅ | ✅ | Large (new surface to design) |

### Recommendation

Ship the **v3 conditional shape** as the Phase 5 implementation candidate, plus targeted instrumentation:

1. Gate the footer behind `isLite()` (the spike was un-gated; production needs the variant check).
2. Emit a new event when the footer is included in the response (e.g. `export_footer_included` with `format` property) so we can measure how many footers we actually emit per format in production, and learn what `other` represents by the tenants and surfaces hitting it.
3. Hold the rollout to a small CSS subset (one or two tenants) and watch the new event for ~7 days before broader enrollment.
4. Independent of the footer: investigate what `other` is. Candidates: page-history view, Rovo content summary, Confluence search snippet, anonymous page preview. The right way to learn is probably a property survey query (`Get-Property-Values` against `macro_export_succeeded` events with `format=other`) and cross-reference against client-domain patterns.

If the `other` surface turns out to be headless / non-user-visible, the strategic value drops to just PDF (2.7%) plus possibly email (7.5%) — at that point the PNG watermark approach is the only one with material coverage and worth a second spike round.

### Side observations from the spike

- v1, v2, and v3 were each deployed to the `development` Forge env on `lite-dev.atlassian.net` and reverted before this commit. Working tree and dev env are at baseline after this run.
- The spike confirmed end-to-end that the export response *is* the right hook — modifications to `createMediaDocument` flow directly into the exported document. No additional plumbing required.
- A test page exists at `https://lite-dev.atlassian.net/wiki/spaces/SD/pages/8355841/Export+footer+spike+2021` and can be reused for future spike runs.
- `forge tunnel` does not proxy `adfExport` resolver calls; any future spike in this code path requires a real `forge deploy`.

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
