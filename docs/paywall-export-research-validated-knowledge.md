# Paywall export research — validated knowledge

**Date assembled:** 2026-05-16
**Sources:** in-session empirical probes (forge logs, Mixpanel raw event export, REST API matrix, controlled tunnel test), Atlassian Forge documentation, Mixpanel raw event data over the 2026-05-09 to 2026-05-15 window.
**Companion docs:**
- Strategy: `docs/paywall-strategy.md`
- Audit spec: `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md`
- Corrections log (what was wrong before): `docs/superpowers/specs/2026-05-15-paywall-research-framing-corrections.md`

This doc captures what is **empirically true and validated**. It does not contain inferences, guesses, or hypotheses-to-test. Read this first when picking up the work. The corrections doc has the journey; this doc has the destination.

---

## 1. How Atlassian invokes `adfExport`

### 1.1 The export surface taxonomy

`payload.exportType` is set by Atlassian's runtime to one of these values (the documented enum is `pdf | word | other`, but production emits more). Endpoint-to-exportType mapping verified by `console.log` probe in `src/export.js` + forge logs read-back:

| Triggering surface | `payload.exportType` |
|---|---|
| User clicks "Export to PDF" from the page menu (`/wiki/spaces/flyingpdf/pdfpageexport.action`) | `pdf` |
| User clicks "Export to Word" from the page menu (`/wiki/exportword`) | `word` |
| REST `GET /wiki/rest/api/content/{id}?expand=body.view` | `other` |
| REST `GET /wiki/rest/api/content/{id}?expand=body.styled_view` | `other` |
| REST `GET /wiki/rest/api/content/{id}?expand=body.export_view` | `email` |
| Other production-emitted values (caller not yet probe-attributed) | `feed`, `diff`, `html_export` |

### 1.2 Endpoints that do NOT invoke `adfExport`

| Endpoint | Why it doesn't fire | Verified by |
|---|---|---|
| `GET /wiki/api/v2/pages/{id}?body-format=atlas_doc_format` | Returns the raw `extension` node (unexpanded macro reference) | No log entry from `console.log` probe |
| `GET /wiki/rest/api/content/{id}?expand=body.anonymous_export_view` (without auth) | `asUser()` fallback inside the resolver can't authenticate → returns the macro's own error doc, not a render-pipeline rejection | No probe log entry |

### 1.3 Atlassian's documented triggers ([UI Kit upgrade guide](https://developer.atlassian.com/platform/forge/ui-kit/upgrade-to-ui-kit-latest))

> "In order for UI Kit macros to export to word document, page history, or via the REST API, you need to specify an `adfExport` function."

Maps to the empirical table above: Word, page-history (probably part of `other`), and REST API (`body.view` / `body.styled_view` / `body.export_view`).

---

## 2. ADF response shapes that work in the export pipelines

Spike findings from `src/export.js#createMediaDocument` modifications. All tests on `lite-dev.atlassian.net`, dev env.

| ADF shape | PDF export | Word export | REST `body.view` (`other`) | REST `body.export_view` (`email`) |
|---|---|---|---|---|
| Single root `mediaSingle` (baseline) | ✅ image renders | ✅ image renders | ✅ image renders | ✅ image renders |
| `mediaSingle` + sibling `paragraph` (multi-root, with footer + link) | ✅ footer renders cleanly with clickable link | ❌ entire macro export errors out — "We've encountered an issue exporting this macro" | ✅ footer renders | ✅ footer renders |
| `mediaSingle` containing `caption` child node (single-root) | ❌ caption silently dropped — PDF identical to baseline | ✅ no error, but caption silently dropped — Word identical to baseline | (same — silently dropped) | (same — silently dropped) |

**The right code shape** for the export footer is therefore a conditional response keyed on `payload.exportType`:

```js
function createMediaDocument(downloadLink, exportType) {
  const mediaSingle = {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [{ type: "media", attrs: { type: "external", url: downloadLink } }],
  };
  const content = [mediaSingle];
  if (exportType !== "word") {
    content.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Diagram by ZenUML Lite — " },
        { type: "text", text: "upgrade", marks: [{ type: "link", attrs: { href: "..." } }] },
        { type: "text", text: " ↗" },
      ],
    });
  }
  return { type: "doc", version: 1, content };
}
```

Coverage: ~95% of all `macro_export_succeeded` events (pdf + other + email + feed + diff + html_export). Word alone (4.5%) stays at baseline.

---

## 3. Who is actually being touched

### 3.1 Identity attribution: every export event has a real `accountId`

Across 2,827 `macro_export_succeeded` events / 7 days, **zero** were missing `account_id`. Atlassian's runtime always attaches the user identity whose OAuth scope is acting (the page-load user, the integration's token holder, the email-render trigger, etc.).

### 3.2 Real 7-day weekly unique counts

Pulled directly from a 7-day Mixpanel Export API window — **do not linear-extrapolate from a 3-day window**, the same users repeat across days and the naive `× 7/3` overstates uniques by ~50%.

| Cohort | Distinct accountIds / week |
|---|---|
| Triggered ≥1 `macro_export_succeeded` | **1,773** |
| Of those, also had `macro_viewed` in the same window (human exporters) | 1,239 (70%) |
| Of those, had at least one export within ±1 minute of one of their views (live-banner reachable) | 1,239 (≈100% of human exporters, same set at ±1 min) |
| Exporter-only (zero `macro_viewed` in window — integration accounts) | 534 (30%) |

### 3.3 Co-temporal density — how tight is the export-to-view coupling?

For users with both events (per-user raw event analysis, 10-account deep sample):

| Time band relative to nearest view | % of export events |
|---|---|
| ≤1 second | 11% |
| ≤5 seconds | 36% |
| ≤10 seconds | 41% |
| ≤30 seconds | **77%** ← sharp inflection point |
| ≤1 minute | 77% (no additional events between 30s and 1m) |
| ≤5 minutes | 77% (no additional events between 1m and 5m) |
| ≥1 hour | 21% (the async cohort) |
| ≥24 hours | 14% |

The distribution is bimodal: ~77% within ±30 seconds (in-session render), ~23% hours-to-days away (background integration / scheduled job). Median nearest-view delta: 18 seconds.

### 3.4 Format share (7-day production)

| `format` | Events | % of total | Behind-the-scenes consumer |
|---|---|---|---|
| `other` | 2,281 | 83.5% | `body.view` + `body.styled_view` — third-party integrations, Rovo, mobile, anonymous public-page render |
| `email` | 209 | 7.6% | `body.export_view` — likely email-notification body rendering, email-style integrations |
| `word` | 123 | 4.5% | User-clicked Word export |
| `pdf` | 75 | 2.7% | User-clicked PDF export |
| `feed` | 28 | 1.0% | (uncharacterised — probably RSS / page-feed widget) |
| `diff` | 15 | 0.5% | (uncharacterised — probably version-compare view) |
| `html_export` | 2 | <0.1% | (uncharacterised — likely legacy HTML export) |

---

## 4. Forge tunnel — what it does and doesn't proxy

Empirically verified 2026-05-16 with side-by-side control experiment in a single tunnel session.

| Function type | Proxied by tunnel? | Evidence |
|---|---|---|
| Custom UI resolver (`invoke()` from iframe) | ✅ (per Atlassian docs) | Documented |
| Web trigger | ✅ | `tunnel-test-trigger` invocation logged in tunnel terminal: `invocation: ... tunnel-test-trigger.handler` + console.log content |
| Frontend iframe assets (dist/) | ✅ | Documented |
| **`adfExport` function (macro export pipeline)** | **❌** | Zero log lines from `console.log` probe in `src/export.js` after PDF export; the rendered PDF used deployed code, not local code |

**Operational rule:** any change to `src/export.js` (or any `adfExport`-handler file) requires `forge deploy -e development` to take effect on dev. `forge tunnel` won't proxy it.

This is also captured at `.claude/skills/forge-tunnel/skill.md` (Key constraints section).

---

## 5. Strategy — the validated framing

### 5.1 Two-funnel strategy

Lite monetisation runs on two complementary funnels that target different humans and stack additively:

| Funnel | Trigger moment | Audience | Conversion event |
|---|---|---|---|
| **Friction funnel** (shipped) | User tries to edit/create in a space ≥100 macros | The editing engineer | `advocacy_message_copied` |
| **Nudge funnel** (in design) | User successfully exports a macro | Document audience (manager, buyer) + the exporter | TBD — Phase 5 endpoint click |

### 5.2 Two-layer nudge surface

| Layer | Reach (real weekly humans) | What it catches |
|---|---|---|
| **Live in-product banner** (fires on the user's next iframe load after the resolver writes a recent-export marker to KV) | ~1,240 | The 77% in-session cohort whose export happens during their active Confluence session |
| **In-doc footer + QR baked into the artefact** | ~1,770 (full exporter cohort) | The 23% async cohort + the document audience (anyone who opens the forwarded PDF / email / integration view) |

Both surfaces send to the same upgrade URL endpoint; the click endpoint logs `cloudId`, `pageId`, `customContentId`, `accountId`, `format`, and a UTM source. That log becomes the empirical attribution for `format=other` and the per-cohort conversion data the strategy needs.

### 5.3 What this surface is NOT

- **NOT** a paywall on exports. Hard-blocking working exports is a different decision with a CSAT cliff; not in scope.
- **NOT** a failure-recovery surface. Export failures (74% are `attachment_not_found` — a product bug to fix) are not the strategic opportunity.
- **NOT** an editor-path duplicate. The friction funnel reaches the engineer; the nudge funnel reaches the engineer + everyone they share the artefact with.

---

## 6. Mixpanel — how to query it correctly

### 6.1 Identity matching across event types

Frontend events (`macro_viewed`, `paywall_triggered`, etc.) populate `properties.$user_id` and `properties.distinct_id`. **They do NOT populate `properties.account_id`.**

Backend export events (`macro_export_*` from `src/export.js`) populate ALL of `properties.account_id`, `properties.$user_id`, and `properties.distinct_id` (with the same value).

**For cross-event-type joins via the Mixpanel Export API**, filter on `properties["$user_id"]`. Filtering on `properties["account_id"]` silently drops every frontend event.

### 6.2 Weekly uniques: pull a real 7-day window

Linear extrapolation from a 3-day window overstates by ~50% because users repeat across days. Use `from_date=YYYY-MM-DD&to_date=YYYY-MM-DD` over a real 7-day window:

```bash
set -a; source .env.mixpanel; set +a
curl -s --user "$API_Secret:" -G "https://data.mixpanel.com/api/2.0/export" \
  --data-urlencode "from_date=YYYY-MM-DD" \
  --data-urlencode "to_date=YYYY-MM-DD" \
  --data-urlencode 'event=["macro_export_succeeded"]' \
  -o /tmp/exports-7d.jsonl
```

### 6.3 Funnel reports are loose; raw events are tight

Mixpanel's Funnels report counts users who completed step 1 anywhere in the window and step 2 anywhere in the conversion window — it does NOT enforce session-tight co-occurrence. For tight temporal claims (X within Y seconds of Z), pull raw events and analyse per-user locally.

### 6.4 The Mixpanel MCP `filter.clauses` field is unreliable

In several runs, `client_domain equals "lite-dev.atlassian.net"` filters returned identical totals to no filter. Cross-verify any MCP-filtered query against another method before drawing a conclusion. Breakdowns work; filters sometimes silently no-op.

---

## 7. The Mixpanel project + key resources

| Resource | Value |
|---|---|
| Project ID | `3373228` |
| API endpoint | `https://data.mixpanel.com/api/2.0/export` (US region) |
| Auth | HTTP Basic with `API_Secret` from `.env.mixpanel` |
| Production D1 | `conf-zenuml-prod` |
| KV namespace | `fe9042cb20994651b0a2ef9e68f9037c` |
| Dev env name | `development` |
| Dev installation ID (lite-dev) | `08a64b00-853b-461e-ae5c-9eb640d3be69` |
| Test page (kept for re-use) | `https://lite-dev.atlassian.net/wiki/spaces/SD/pages/8355841/Export+footer+spike+2021` |

---

## 8. Methodological discipline (what to do next time)

1. **Don't generalise from one observation.** If a single test fails one surface, isolate that surface before claiming a class of behaviour. (Word breakage was generalised to "all HTML conversion" — wrong.)
2. **Test before retracting too.** If empirical evidence contradicts the docs, run a clean test before changing position. (I retracted the "tunnel doesn't proxy adfExport" claim based on doc reading; the clean test reaffirmed the original.)
3. **Aggregate analytics lie about session structure.** Funnels are directional. For any temporal claim (X within Y of Z), pull raw events and analyse per-user.
4. **Identity unification is fragile.** Two events with the "same user" may use different distinct_id paths. Verify the matching field on both sides.
5. **Negative spike results are hypotheses, not conclusions.** "It didn't work in my test" needs follow-up: was the bundling fresh, was the right surface hit, was the log channel right.
6. **Check docs first, then verify empirically.** Docs can be incomplete (adfExport isn't listed as an exception in tunnel docs, but empirically is). Use them as a starting hypothesis, not a final answer.
7. **Pull real time windows.** Don't linear-extrapolate user uniques across time.
