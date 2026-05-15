# Paywall research — framing corrections log

**Date:** 2026-05-15 to 2026-05-16 (one extended research session)
**Author of errors:** Claude (this assistant)
**Caught by:** the user (Peng), in real time
**Purpose:** every framing or numerical mistake I made during the export-paywall research, paired with the empirical truth and the corrected conclusion. The strategy doc (`docs/paywall-strategy.md`) and audit spec (`docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md`) reflect the corrected view; this file exists so future readers can see how the picture evolved and why.

---

## How to read this document

Each entry has:

- **What I said** — the framing I committed to
- **Why it was wrong** — the empirical or logical flaw
- **What's actually true** — the corrected statement
- **Strategic impact** — whether it materially changed a decision, or was a noise correction

Errors are roughly ordered by impact, not chronology.

---

## A. Big framing reversals (changed strategic direction)

### A1. The export audit was framed as *failure-recovery* instead of *success-as-nudge*

- **What I said.** The audit asked "can we convert failed exports into upgrade actions?" I sized the failure cohort (724 / 30 d), found that 71% were `attachment_not_found` (a product bug) and 0% were `needs_authentication` (the original thesis), and recommended **abandon**.
- **Why it was wrong.** The failure cohort was always the smaller opportunity. The strategic surface is every *successful* export — a value-realisation moment where the user just got what they wanted.
- **What's actually true.** Successful exports are ~2,700 / week (vs ~21 addressable failures); each export produces a shared artefact that reaches the exporter AND a downstream audience.
- **Strategic impact.** Flipped the audit from "abandon" to "advance to Phase 4". This is the single most important correction. The whole `paywall-strategy.md` §2 (nudge funnel) exists because of it.

### A2. "Word breaks multi-root → in-doc footer is half-viable"

- **What I said.** Spike v1 showed Word export errors out with multi-root ADF. I framed this as forcing a binary: ship to PDF only (2.7% of cohort, too small) or pivot to PNG watermark.
- **Why it was wrong.** I generalised the Word failure to the entire HTML-conversion family. Without testing, I assumed `body.view` / `body.export_view` / `body.styled_view` would also reject multi-root.
- **What's actually true** (Spike v4). Multi-root renders cleanly in `body.view`, `body.export_view`, `body.styled_view`. Only Word's MHTML pipeline specifically rejects it. The v3 conditional shape (`exportType !== "word" → multi-root + footer`) covers ~95% of all formats.
- **Strategic impact.** Major. Took the in-doc footer from "PDF-only sliver" back to "95% of the cohort", which restored the viability of the multi-root approach as the primary surface.

### A3. "`other` is mostly headless / machine-only"

- **What I said.** Once I learned `other` was 84% of all exports, I leaned toward "this is probably background indexing / search crawlers / Atlassian internal pipelines — not user-visible".
- **Why it was wrong.** I was inferring from the name and the bulk volume; I had no empirical attribution.
- **What's actually true.** A `FORMAT-PROBE` log + REST endpoint matrix proved `body.view` and `body.styled_view` fire `exportType=other`. These endpoints are consumed by third-party integrations, Atlassian Intelligence / Rovo, mobile rendering, anonymous public-page rendering, email-notification body composition, etc. — all user-visible surfaces.
- **Strategic impact.** Large. The `other` cohort is the addressable bulk of the nudge surface; without this empirical proof I would have stuck with the "small PDF-only" reach number.

### A4. "User is cold at render time — exports fire long after viewing"

- **What I said.** I cited a Mixpanel funnel showing 42-hour average gap from `macro_viewed` to `macro_export_succeeded` and concluded the user is offline when adfExport runs. I then said the QR/link is the *only* hook because the user can't be reached at render time.
- **Why it was wrong.** The 42-hour figure was the cross-window average across all users; it lumped human exporters with integration-only accountIds and counted views very loosely. Also: my first per-user timeline analysis used the wrong filter (`properties.account_id` vs `properties.$user_id`) and silently dropped every frontend event, which reinforced the false conclusion.
- **What's actually true.** With the corrected filter, 77% of export events fire within ±30 seconds of a same-user `macro_viewed` event. There is a sharp bimodal split: tight-cluster (in-session, ~77%, median 18 s gap) and distant-cluster (~23%, >1 h away). The user IS active at render time in three out of four exports.
- **Strategic impact.** Pivotal. Made the **live in-product banner** strategy viable. Without the corrected analysis we would have shipped only the in-doc footer/QR.

### A5. "Build a paywall on top of exports"

- **What I said (early).** Treated this as a paywall design problem, looking for ways to gate exports or convert failures.
- **Why it was wrong.** The user's pivot — *just put a link and a QR in the export, say "I don't know what app you saw this in, click to help me improve it"* — reframed the whole thing from "paywall" to "humble engineering ask + telemetry hook + secondary upgrade signal". That framing is more honest, lower-pressure, and produces empirical attribution as a side effect of the click endpoint.
- **What's actually true.** The right object isn't a paywall on the export surface; it's a **soft nudge artefact** baked into every Lite export that doubles as our attribution channel.
- **Strategic impact.** Reframes the entire Phase 5 design from gating mechanic to engagement mechanic.

---

## B. Numerical / methodological errors

### B1. Linear `× 7/3` extrapolation for weekly uniques

- **What I said.** Used 3-day data multiplied by `7/3 ≈ 2.33` to estimate weekly unique users.
- **Why it was wrong.** User behaviour is highly repeat-driven over a 7-day window. The same users active on day 1 are typically active on day 4. Naive linear extrapolation double-counts the regulars.
- **What's actually true.** Real 7-day pull: **1,773 weekly exporters** vs the linear estimate of 3,742. Overstatement: ~53%.
- **Numbers that need correction across the strategy/spec docs:**
  - Step 1 (unique exporters / week): ~1,770, not ~3,700
  - Step 2 (banner-reachable / week): ~1,240, not ~2,500
  - Combined reach: ~1,770 / week (not ~3,700)
- **Strategic impact.** The absolute numbers in the strategy doc need to be halved; the *percentages* (69% banner-reachable, 31% async backstop) are still correct.

### B2. Mixpanel `where` filter on `account_id` for frontend events

- **What I said.** Filtered the Mixpanel Export API with `properties["account_id"]=="..."` to fetch event timelines for chosen accountIds.
- **Why it was wrong.** Backend export events have a `properties.account_id` field. **Frontend events (`macro_viewed`, etc.) do NOT have `account_id` in `properties`; they only have `$user_id` and `distinct_id`.** My filter silently dropped every frontend event.
- **What's actually true.** Use `properties["$user_id"]=="..."` to match both event families. After fixing, the per-user timelines showed real frontend activity (`macro_viewed`, `attachment_upload_skipped`, `click`, etc.) within ±30 seconds of exports.
- **Strategic impact.** Caused the false "users have no frontend activity around exports" conclusion (A4). Once fixed, restored the live-banner viability.

### B3. Mixpanel MCP filter clauses are silently ignored in some cases

- **What I said.** Used the `filter.clauses` field on `Run-Query` to scope queries to specific `client_domain` or `format` values.
- **Why it was wrong.** Empirically the clauses had no effect in several runs — `client_domain equals "lite-dev.atlassian.net"` returned the same total as no filter. The MCP wrapper or Mixpanel side appears not to honour all clause shapes consistently.
- **What's actually true.** Always cross-verify Mixpanel MCP query results against another method (raw export, manual breakdown) before drawing conclusions. Use breakdowns instead of filters where possible.
- **Strategic impact.** Smaller — caused some intermediate confusion but no strategic decision rested on it.

### B4. "Tunnel does NOT proxy `adfExport`" — itself a wrong claim, self-corrected 2026-05-16

- **What I originally said.** I claimed `adfExport` runs server-side on Atlassian's export pipeline and bypasses the tunnel entirely. I told the user the only way to spike was `forge deploy -e development`.
- **Why that was wrong.** I drew this conclusion from a single ad-hoc observation (PDF rendered the deployed code, not my local changes; no log in the tunnel output). I did NOT consult the docs before publishing the claim.
- **What the docs actually say** ([Forge Tunneling](https://developer.atlassian.com/platform/forge/tunneling/)). The tunnel proxies "non-UI functions, such as Custom UI resolvers and web triggers"; source code changes auto-rebundle. `adfExport` is structurally a function module ( `function: { key, handler }` in the manifest), so the general principle says it IS proxied. The docs don't list it as an exception.
- **What likely explained my observation** instead of a tunnel limitation:
  - The tunnel showed `ENOENT: dist/` warnings on first run — Forge bundled an incomplete artifact.
  - Logs from tunnelled invocations go to the **tunnel terminal**, not to `forge logs`. I was looking at `forge logs` for the probe output, so I would have missed the live log.
  - I had the tunnel running, then edited `src/export.js`, then triggered the export — but never verified the rebundle had completed or the in-memory handler matched my edits.
- **Honest current state.** Not actually settled. Two paths to settle: (a) re-run a clean tunnel test with a fresh `dist/` and a probe that watches the tunnel terminal in real time; or (b) trust the docs as written. Either way the original "deploy is the only path" claim was over-confident and is hereby retracted.
- **Strategic impact.** Cost ~3 deploys during the spike that could have been tunnel rebundles. Doesn't change the strategy doc, only the operational guidance for future spikes on adfExport.

### B5. "ADF `caption` would solve the Word problem"

- **What I said.** Hypothesised that putting the footer inside `mediaSingle` as a `caption` child (single root) would render in both PDF and Word.
- **Why it was wrong.** Confluence's export pipelines accept the `caption` node syntactically but **silently drop the text content during rendering**. Neither PDF nor Word renders caption text.
- **What's actually true** (Spike v2). Caption is a non-starter. The correct approach is the v3 conditional (multi-root for non-Word; baseline for Word).
- **Strategic impact.** Eliminated one false path. No big damage; would have cost time later if untested.

### B6. The Mixpanel funnel report's avg_time figures

- **What I said.** Quoted "70% of users view a macro within 1 h after export, average 1.6 h" from a Mixpanel funnels report.
- **Why it was wrong.** The funnel matches events across the entire window, not within a session. The "70% within 1 h" overcounted because the funnel saw any `macro_viewed` event by the same user anywhere in the 24 h conversion window. The per-user raw-event analysis showed the real co-occurrence is much tighter (±30 s for 77%) but also has a long async tail (>1 h or days for the rest).
- **What's actually true.** Use Mixpanel funnels for directional signal only. For precise temporal relationships pull raw events via the Export API and analyse locally.
- **Strategic impact.** Initially led to a confused intermediate claim about session co-occurrence. The user caught this and pushed me to do the per-user analysis instead.

---

## C. What is now hard-proven vs still inferred

### Hard-proven (empirical evidence on record)

- `body.view` → `exportType="other"` (forge logs probe, 2026-05-15)
- `body.styled_view` → `exportType="other"` (same probe)
- `body.export_view` → `exportType="email"` (same probe)
- `/wiki/exportword` → `exportType="word"` (same probe)
- PDF export menu click → `exportType="pdf"` (same probe)
- Multi-root ADF renders cleanly in `body.view`, `body.export_view`, `body.styled_view`, and PDF export (Spike v4)
- Multi-root ADF causes the macro export to error in Word's MHTML pipeline only (Spikes v1, v3 baseline comparison)
- `caption` inside `mediaSingle` is accepted but text content silently dropped in both PDF and Word (Spike v2)
- Every `macro_export_succeeded` event carries a populated `account_id` (zero null across 2,827 events / 7 d)
- For users with both events, 77% of their exports occur within ±30 s of one of their `macro_viewed` events; sharp bimodal split with a long async tail >1 h
- Real 7-day unique-exporter count: 1,773 (not the 3,742 linear extrapolation predicted)
- Of those 1,773, 1,239 (70%) are reachable by a live banner (have ±1-min co-occurrence)

### Still inferred (best-guess, not proven by direct probe)

- *Which* third-party tools / Atlassian features consume `body.view` vs `body.export_view` for which user actions. We know the endpoint-to-exportType mapping; we don't have ground-truth attribution from inside Atlassian's stack about who calls each endpoint and when.
- That `exportType="email"` is dominated by Confluence email notifications. The name is suggestive, but I couldn't catch a real email-notification firing during a deliberate Share + comment action within the probe window.
- That the integration-only accountIds (320 / week) are OAuth-token service accounts vs dormant real users. Plausible but not verified.
- That 1.6 events per user (for `format=other`) is "broad real-user distribution" rather than something else. Reasonable but not air-tight.

### Yet to be proven (deferred to production telemetry)

- That a Lite-only `macro_export_nudge_included` event in production will correlate `format` values with `paywall_triggered` / `advocacy_message_copied` / `upgrade_clicks` to give per-cohort conversion attribution.
- That the live in-product banner ships and produces a measurable upgrade-click rate at the 30–50% banner-shown × 5–8% click range.

---

## D. Current strategic conclusion (as of 2026-05-16, post-corrections)

Carrying through all corrections above:

1. **Export nudge surface is alive.** Multi-root ADF works in ~95% of formats; the v3 conditional shape is the right code change.
2. **`other` is a real user-visible cohort**, served by `body.view` / `body.styled_view` REST consumers — Rovo, integrations, mobile, email body rendering, anonymous public-page views.
3. **Most exporters are real humans active at render time.** 77% co-occur within ±30 s; 70% are reachable by an in-product live banner on their next macro view.
4. **Real weekly addressable surface (corrected):** ~1,240 banner-reachable Lite users + ~530 backstopped by in-doc QR/footer = **~1,770 unique humans per week**.
5. **Layered design:** live banner (precise, in-session, high-intent) + in-doc footer/QR (backstop, async, captures forwarded artefacts).
6. **Telemetry hook on the click endpoint** doubles as empirical attribution for the inferred items in §C — users tell us which surface they saw.

Strategy doc `docs/paywall-strategy.md` and audit spec `docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md` reflect this corrected view. Earlier commits on the `worktree-docs-paywall-strategy-dual-funnel-framing` branch contain intermediate (wrong) framings — preserved for audit-trail.
