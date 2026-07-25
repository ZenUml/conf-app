# Lite Byline Activation — Design

Growth plan for using `confluence:contentBylineItem` to raise Lite active users.
Slots into the dormant-activation program alongside ② user-cohort targeting and ③ the editor
staleness hint (`docs/superpowers/specs/2026-07-18-job-b-editor-staleness-hint-design.md`).

Status: **PROPOSED** — not approved, not started. Phase 0 (baseline) must run before Phase 1 is
committed to.

## Why the byline

Lite today is only *visible* in two places:

1. inside a macro iframe — i.e. on pages that already contain a diagram, and
2. in the page editor's insert menu — which requires already knowing the app exists.

Every other reader, on every other page, never encounters the app. That is the activation
ceiling: installs convert to one or two authors per tenant and stop.

`confluence:contentBylineItem` renders "in the part of the content under the title that includes
metadata about contributors" on **pages and blog posts**
([module reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-content-byline-item/)).
It is the only app-owned affordance in our manifest that reaches **100% of page views** with a
persistent entry point, and unlike `confluence:pageBanner` (already spoken for: single host,
paywall > CSAT priority, deliberately fast-exited) it is a one-line list item rather than an
interruption.

**Thesis:** the byline converts "installed" into "discoverable by every reader on every page",
which is the top of the same funnel item ③ works from the bottom of — non-author → author.

The module is already written and shipping in Diagramly (`manifest.yml` `zenuml-byline-aiaide`,
"Aide", fullscreen modal). Lite strips it in `scripts/forge-wizard.mjs`
(`del(.modules["confluence:contentBylineItem"])`). So the *plumbing* — manifest module, the
`confluence:contentBylineItem` branch in `src/forgeIndex.ts`, a route that mounts its own tree —
already exists and is proven in production. What's missing is a Lite-appropriate payload.

## What the byline does (the affordance)

One item, one job: **"Diagram this page."**

Click → modal (`viewportContainer: modal`, `viewportSize: fullscreen`, same as Diagramly's Aide):

- **Page has diagrams** → index them: title, type, jump-to, open fullscreen, copy source. This is
  the "useful on every page that already works" case and it earns the click that Phase 2 needs.
- **Page has no diagram** → the create path: pick a type, or generate from the page's own text,
  preview, then put it on the page.

The create path is the differentiator. Today becoming an author requires opening the editor and
knowing the slash command. Byline → published diagram should be two clicks from *reading* a page.

## Phasing

Deliberately staged so the riskiest unknown (does anyone click a byline item?) is answered before
the expensive part (writing to customer pages) is built.

### Phase 0 — baseline + kill criteria (no code)

Answer, from data we already have, before building:

| Question | Source |
|---|---|
| Lite installs, active tenants, new/lost per week | `forge-installs` skill (`forge install list` — D1 mirror is known-stale) |
| Distinct Lite authors vs distinct Lite viewers per 28d | Mixpanel `macro_save_succeeded` / `macro_viewed` distinct accountId, project 3373228 |
| Diagram-bearing page views vs total page views per tenant | Mixpanel `macro_viewed`; D1 `page_viewed` only for windows **before 2026-06-06** — see below |
| **Does a byline item get clicked at all?** | Diagramly's `ai_aide_route_accessed`, but only after the mount-semantics check below tells us what that event means |

The last row is the gate, and getting a number for it takes two steps rather than one ratio.

**Step A — mount semantics (do this first).** `ai_aide_route_accessed` fires at the top of
`handleAiAideRoute()` (`src/routes/aiAide.ts:9`), i.e. when the byline iframe **boots**. If the
iframe boots on click, that event is a click; if it boots on page load, it is an impression. Same
event, opposite meaning — so it cannot be used as a numerator until this is settled. The manifest's
`viewportContainer` (popup/modal) implies click-to-open, but infer nothing: load a page on
`dia-stg` under Playwright, never touch the byline, and observe whether the iframe boots
(~30 min, `spot-check` skill). This also answers the load-bearing cost question — eager boot means
the Lite byline mounts a Vue tree on every page load in every tenant.

**Step B — the ratio, from a historical window.** There is **no current tenant-wide page-view
count**: `avi:confluence:viewed:page` was removed 2026-06-06 (`manifest.yml:292`) because it fired
on every page view tenant-wide and accounted for ~98% of billed Forge Functions compute. The
denominator therefore has to come from D1 `page_viewed` rows **predating** that removal, joined
against `ai_aide_route_accessed` from the same window. Stale, but real — and preferable to a
fabricated benchmark.

**Metric shape.** Per-impression CTR is the wrong gate for a *persistent* item: the same link sits
on every page the same user visits, so the denominator inflates with repeat exposure and CTR decays
toward zero no matter how good the feature is. The decision metric is the **28-day distinct-user
open rate** — of users who viewed any page, what share ever opened the byline modal — because the
job here is discovery, a one-time act, not a repeated ad impression. Keep per-impression CTR as a
cost/annoyance signal only.

Kill criteria: below roughly a **1% 28-day distinct-user open rate**, Phase 2's page-write
machinery is not worth its risk — ship Phase 1 only and re-evaluate. That threshold is a judgment
call anchored on "enough opens per tenant per month to measure a conversion rate at all", **not** a
measured benchmark; replace it with a real distribution once Step B lands.

### Phase 1 — the item exists in Lite, modal is read-mostly

Scope:

- Remove the `del(.modules["confluence:contentBylineItem"])` edit from the `lite` entry in
  `scripts/forge-wizard.mjs`; give Lite its own byline key/title/icon (not "Aide", not the
  Diagramly logo — the current `zenuml-byline-aiaide` module is Diagramly-branded and wired to
  `AiAide.jsx` → `diagramlyChat`).
- Branch `src/forgeIndex.ts`'s existing `confluence:contentBylineItem` case on `PRODUCT_TYPE` so
  Lite mounts a new `handleBylineRoute()` and Diagramly keeps `handleAiAideRoute()` untouched.
- Modal v1: list this page's diagrams (custom content by pageId — the same query
  `ApWrapper2` already runs), jump / fullscreen / copy source; plus an "Add a diagram" CTA that
  routes to the page editor (`router.navigate` to `/pages/edit-v2/{id}`) with a one-card
  "type /zenuml" instruction.

No page writes. No AI. The whole point of Phase 1 is to buy the CTR number in *our* app rather
than inferring it from Diagramly's.

### Phase 2 — insert into the page from the modal (the conversion core)

Generate (from page text, via the existing `/diagramly/chat` endpoint — already in
`public/_routes.json`, and Lite prod shares the `conf-lite` Pages project with Diagramly per
`forge-wizard.mjs`, so no new backend target) → preview → **"Add to this page"**.

The write is mechanically proven in this repo: `src/createDemoPage.js` already creates custom
content for a page, builds the Forge ARI ADF extension node
(`extensionType: 'com.atlassian.ecosystem'`, `extensionKey: '<appId>/<environmentId>/static/<macroKey>'`,
see `src/demoPageContent.js`), and PUTs the page body. Required scopes
(`write:page:confluence`, `write:content:confluence`, `write:custom-content:confluence`) are
**already granted** in `manifest.yml`.

Guards this path must carry:

- **Paywall first.** Route through `mountPaywallGate` / `useCustomerSuccessService` before any
  write. A create path that skips the gate is a #302-class fail-open leak by construction.
- **Permission check** — the caller must have edit permission on the page; write `asUser`, not
  `asApp`, so Confluence enforces it and the page history names the right person.
- **Append only, at end of body**, with an explicit version message, and a read-modify-write
  preflight asserting the re-serialized ADF differs from the original *only* by the appended node.
- **Conflict handling** — refuse if the page version changed between read and write.

### Phase 3 — dynamic byline properties (conditional)

`dynamicProperties` can retitle the item at render ("3 diagrams"), which is the strongest possible
in-place signal. It costs a **function invocation on every page render** — see the
`forge-functions-cost` skill and the 100,000 GB-s/month free tier. Only build this if Phase 1/2
CTR justifies it, and only with a measured cost estimate first.

## Version impact (no admin consent)

Adding a module and changing egress-free manifest entries is **not** on the major-version list
(scopes, new `dynamic` web triggers, licensing/providers/remotes — see CLAUDE.md "Forge app
versions"). We add **no scopes** — every API this plan needs is already granted. Expect a **minor**
bump that auto-upgrades to all installs. Confirm at deploy time from `forge deploy` output, which
reports the deployed version.

## Risks

- **No dark launch.** A manifest module cannot be feature-flagged: the moment the version rolls
  out, every Lite tenant sees the item under every page title. A Forge flag can gate what the
  *modal* does, never whether the item appears. Mitigation: staging soak on `lite-stg`, innocuous
  title, and a rehearsed rollback (removing the module is itself a minor, auto-upgrading release).
- **Annoyance → uninstall.** Lower than a banner, but non-zero and un-dismissible per-user. Watch
  install deltas (`forge-installs`) and CSAT for two weeks post-release; treat a rise in uninstalls
  as the rollback trigger.
- **Paywall pressure.** Working as intended, more authors means spaces reach the 100-macro Lite
  limit sooner. That is the monetization path, but it needs the extension/upgrade flow to be
  healthy first — check the `paywall` skill's current lockout volume before shipping Phase 2.
- **Page-write blast radius** (Phase 2 only) — mangling a customer's page body is the worst outcome
  in this plan. Hence append-only + preflight + version-conflict refusal, and E2E coverage on a
  page with tables, other apps' macros, and attachments.

## Analytics (first commit, per project hard rule)

New `AnalyticsEventName` entries (`src/utils/analytics/catalog.ts`), plus `byline` added to the
`Surface` and `EntryPoint` unions and props in `src/utils/analytics/types.ts`:

| Event | Trigger | Key properties |
|---|---|---|
| `byline_opened` | byline modal mounts | `surface: 'byline'`, `page_has_diagram`, `diagram_count`, `macro_type` list |
| `byline_diagram_opened` | user jumps to / fullscreens a listed diagram | `macro_type`, `diagram_count` |
| `byline_create_clicked` | "Add a diagram" clicked | `entry_point: 'byline'`, `macro_type`, `page_has_diagram` |
| `byline_editor_deeplinked` | Phase 1 route to the page editor | `page_has_diagram` |
| `byline_insert_requested` / `_succeeded` / `_failed` | Phase 2 page write | `macro_type`, `failure_reason`, `page_version` |
| `byline_dismissed` | modal closed with no action | `dwell_ms`, `page_has_diagram` |

AI generation inside the modal reuses the existing `ai_generation_requested` / `_succeeded` /
`_failed` names with `surface: 'byline'` rather than minting parallel events.

**North star:** distinct accountIds whose **first-ever** `macro_create_succeeded` /
`macro_save_succeeded` is preceded within 30 minutes by `byline_opened` — the same join shape
item ③ uses for the staleness hint, so the two activation surfaces stay directly comparable.

**Guardrails:** Lite install count delta, CSAT score, `paywall_triggered` rate per tenant,
`byline_dismissed` ÷ `byline_opened`.

## Open decisions (need a call before Phase 1 starts)

1. **Item label.** "Diagram this page" (verb, growth-y) vs "ZenUML" (brand, honest, less clicky).
2. **Blog posts** — include or `displayConditions` them out of scope for v1.
3. **Full/Diagramly** — this design is Lite-only. Full already ships the byline module today but
   Lite-style page indexing might belong there too; out of scope until Lite proves it.
4. Whether Phase 2 ships at all is a Phase 0 output, not a decision to take now.
