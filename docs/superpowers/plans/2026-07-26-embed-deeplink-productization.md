# Embed Deeplink — Productization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 1 uses superpowers:test-driven-development.

**Goal:** Ship "paste a diagram link → the diagram appears on this page" across all four variants, and make the linked-vs-independent choice something the user never has to answer up front. Closes the measured 104-second manual workaround (view source → copy → change page → insert macro → paste → save).

**Predecessor:** `2026-07-16-embed-autoconvert-deeplink-spike.md` — GO on all four questions. The matcher, the parser and the viewer fallback all have working code on `spike/embed-autoconvert-deeplink` (never merged, commit `cda5c537`).

**Blocking predecessor:** Phase 0 below. Its outcome sets the paste default; do not start Task 3 without it.

## Why (measured, 2026-07-26)

| Finding | Number |
|---|---|
| New macros created within 60 min of a View Source copy that are **byte-identical** to a diagram already in the space | **15 / 64 (23.4%)** vs **21 / 199 (10.6%)** for creates with no copy — Fisher one-sided p = 0.010 |
| Same, ≥0.80 similarity | 24 / 64 (37.5%) vs 32 / 199 (16.1%), p = 0.0004 |
| Of the 15 exact clones, source diagram is on a **different page** | **14** |
| Median age of the reused source diagram | 4.1 days |
| Post-copy **edits** to existing macros (i.e. paste-into-existing) | median similarity 0.99, median length delta **+0** — does not happen |

Candidate pool was every macro ever created in the same space (6,282 diagrams, back to 2022-02), so these are lower bounds — a cross-space reuse would not be counted.

**What the data does NOT say:** whether users want a live reference or an independent copy. Embed's own usage numbers cannot answer it — the embed save path wrote an empty placeholder until PR #326 (2026-07-12) and the viewer showed "Unknown diagram type" until PR #324 (2026-07-11), so ~75 of the last 90 days measured a broken feature. Treat all pre-2026-07-12 embed volume as void.

## Architecture

`autoConvert.matchers` on the embed macro modules (manifest-level; **not** runtime-flaggable — see Constraints). Pasted URL lands in the page ADF as `parameters.autoConvertLink` with `hasBeenAutoConverted: true` and survives forever, so the viewer derives `customContentId` per render with no config write. Deeplinks are minted from the viewer's bottom pill. A landing route on Cloudflare Pages makes the URL resolve outside Confluence.

**Tech Stack:** Forge manifest, Vue/TS Custom UI (`src/forge-embed-viewer.ts`, `src/components/Viewer/GenericViewer.vue`), Vitest, Playwright, Cloudflare Pages Functions, `pnpm forge:*` scripts.

## Global Constraints

- **Forge-only** — no `AP.*`, no Connect APIs (`docs/policies/forge-only.md`).
- **Do NOT touch `permissions.scopes`.** Module-only manifest changes stay a **minor** bump (spike confirmed: 16.118.0), so no admin consent wall.
- **Feature branch.** Never commit to `main` except this `.md` (`docs/policies/git-workflow.md`).
- **Analytics is the first commit** (CLAUDE.md hard rule) — Task 1 precedes all behaviour.
- **Staging via CI/CD only; production needs explicit approval.** Local deploys go to the personal dev env only.
- **Client privacy** — no real tenant names in any file in this repo.
- **autoConvert cannot be percentage-rolled-out.** A matcher exists in the deployed manifest or it does not; there is no per-tenant switch, and flagging the *viewer* off while the matcher is on produces a macro that inserts and renders nothing — strictly worse than no conversion. **The environment ladder (dev → staging → prod) is the rollout mechanism, and the matcher ships LAST.** Everything else must be verified before Task 6.

## Decision Gates

**Gate A — what does a pasted link produce?** Set by Phase 0.
- `REVERSIBLE` (an embed can become an editable independent diagram at acceptable cost) → **paste produces an embed**, escape hatch per Task 5.
- `NOT REVERSIBLE` → **paste produces a clone**. The only argument for embed-as-default was reversibility; without it, default to the thing that is always editable. Task 5 inverts: no escape hatch, and the embed macro keeps its existing picker-only entry point.

**Gate B — does an embed count toward the Lite 100-macro space limit?** Task 0 Step 3. This is a pricing lever, not an implementation detail: if embeds are free and clones are not, Lite users get silently steered, and every post-launch measurement of "what users prefer" becomes an artifact of the quota. Decide it deliberately and record the decision here before Task 6.

---

## Phase 0 — Escape-hatch spike (BLOCKING)

Runs first, as its own spike doc and branch (`spike/embed-to-copy-escape-hatch`, never merged, lite-dev only, 1-day timebox).

Established facts it starts from:
- Macro config is written **only** by the editor surface via `view.submit()` (`src/forge-embed-editor.ts:120`). The viewer has no config-write path.
- The embed editor is a picker, not an editor — `ForgeEmbedEditor.vue` renders `<DocumentList />` and nothing else. It cannot edit DSL.
- Changing a macro's *type* means replacing the extension node in the page ADF (the "ADF-insertion trap" the 2026-07-16 spike deliberately avoided). Whether that is unsupported or merely unattempted is unknown.

Questions:
1. **Q1** — Can `view.submit` turn a `zenuml-embed-macro` node into a regular diagram macro? (Expected NO; confirm.)
2. **Q2** — If not: repoint the embed macro's `customContentId` at a freshly forked custom content and swap its editor from the picker to the DSL editor. Does that yield a fully editable diagram? (Cheap path; semantically "an embed macro that is really a normal macro".)
3. **Q3** — Is replacing the extension node from inside a macro genuinely unsupported, or just not yet done?
4. **Q4** — Does `Cmd+Z` after autoconvert revert to a plain link? (5 minutes; bundle it in. autoConvert has no Confluence-native URL/inline/card switcher, so undo is the only escape at paste time.)

Output: a filled Findings table and **Gate A** set to `REVERSIBLE` or `NOT REVERSIBLE`.

---

### Task 0: Preconditions

**Files:** none (recon + decisions recorded in this doc).

- [ ] **Step 1: Confirm Gate A is set**

Phase 0's findings table is filled and Gate A is recorded below. If not, STOP.

> **Gate A result:** _(unfilled)_

- [ ] **Step 2: Confirm the deeplink host**

`https://confluence.zenuml.com/d/<cloudId>/<contentId>` currently 404s (spike Q3). Determine which Cloudflare Pages project (or a new one) owns `confluence.zenuml.com` and whether the hostname already has DNS.

Run: `npx wrangler pages project list`
Expected: record which project serves that hostname, or note that it must be created. Feeds Task 7.

- [ ] **Step 3: Decide Gate B (Lite quota)**

The paywall reads `customerSuccess.macrosCreated` (`src/utils/paywall/mountPaywallGate.ts:52`), sourced from MacroMetrics KV. An embed save creates **no new CustomContent record** (`src/forge-embed-editor.ts`, `saveEmbedAndExit` comment), so an embed most likely does not count today — verify against the KV metric's computation before relying on it.

Run: `/metrics <a lite tenant domain> <space>` (metrics skill) and compare the reported count against the space's known macro count.
Expected: a definite yes/no on whether embeds are counted, recorded below with the deliberate decision.

> **Gate B result:** _(unfilled)_

---

### Task 1: Analytics contract (FIRST commit — CLAUDE.md hard rule)

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (the `AnalyticsEventName` union, next to the `viewer_source_*` block ~line 197)
- Modify: `src/utils/analytics/types.ts` (properties, next to `has_edit_permission` ~line 152)

**Interfaces:**
- Produces: the event names every later task fires. No behaviour ships before these names exist.

- [ ] **Step 1: Add the event names**

```ts
// Embed deeplink (docs/superpowers/plans/2026-07-26-embed-deeplink-productization.md).
// A ZenUML diagram deeplink pasted into the editor autoconverts into the embed
// macro; the viewer derives customContentId from parameters.autoConvertLink.
| "deeplink_copied"              // viewer pill -> clipboard
| "embed_autoconvert_rendered"   // pasted link resolved and rendered
| "embed_autoconvert_failed"     // link parsed but content unreachable
| "embed_foreign_site"           // deeplink cloudId != this site
| "embed_copy_offered"           // escape hatch shown (Gate A = REVERSIBLE only)
| "embed_copy_accepted"          // user took the independent copy
```

- [ ] **Step 2: Add the properties**

```ts
// Embed deeplink. `link_source` = where the copied link came from ('viewer_pill'
// | 'fullscreen'); `resolution` = how the viewer found the target
// ('config' | 'autoconvert_link'); `is_same_site` guards the cross-tenant case.
link_source?: 'viewer_pill' | 'fullscreen';
resolution?: 'config' | 'autoconvert_link';
is_same_site?: boolean;
```

- [ ] **Step 3: Typecheck the touched files and commit**

Run: `pnpm test:unit -- src/utils/analytics`
Expected: PASS. The repo-wide typecheck baseline is known-red — compare to `main` before blaming this change.

```bash
git checkout -b feat/embed-deeplink origin/main
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git commit -m "analytics(embed): register deeplink autoconvert events before implementation"
```

---

### Task 2: Port the deeplink parser (TDD)

**Files:**
- Create: `src/utils/embedDeeplink.ts`, `src/utils/embedDeeplink.spec.ts` — lift from `spike/embed-autoconvert-deeplink` (`caeb1ada`), then extend.

**Interfaces:**
- Produces: `parseEmbedDeeplink(url): { cloudId, contentId } | undefined` — consumed by Task 3.

- [ ] **Step 1: Cherry-pick the spike's parser + tests**

```bash
git cherry-pick caeb1ada
pnpm test:unit -- src/utils/embedDeeplink.spec.ts
```
Expected: PASS (3 tests).

- [ ] **Step 2: Add the productization cases (write failing first)**

New cases the spike did not cover: uppercase cloudId normalises to lowercase; a URL with a trailing path segment (`/d/<cloud>/<id>/extra`) must NOT parse; a contentId longer than 20 digits must NOT parse (guards against pathological input reaching `getCustomContentByIdV2`).

Run: `pnpm test:unit -- src/utils/embedDeeplink.spec.ts`
Expected: FAIL first, then PASS after tightening `DEEPLINK_RE`.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(embed): harden deeplink parser for productization"
```

---

### Task 3: Viewer resolves a pasted link

**Files:**
- Modify: `src/forge-embed-viewer.ts` (`loadDiagram()`, lines 11–26)
- Test: `src/components/Viewer/ForgeEmbedViewer.spec.ts`

**Interfaces:**
- Consumes: `parseEmbedDeeplink`.
- Produces: an autoconverted macro renders with zero configuration; fires `embed_autoconvert_rendered` / `embed_autoconvert_failed` / `embed_foreign_site`.

**Gate A dependency:** if Gate A = `NOT REVERSIBLE`, this task instead forks the source into a new custom content on first render and the "embed" framing is dropped — rewrite this task from Phase 0's findings before starting.

- [ ] **Step 1: Write the failing tests**

Three cases: (a) no `customContentId` but a valid same-site `autoConvertLink` → resolves and renders, fires `embed_autoconvert_rendered` with `resolution: 'autoconvert_link'`; (b) foreign cloudId → does not fetch, fires `embed_foreign_site`, renders the Task 4 card; (c) `customContentId` present → unchanged behaviour, `resolution: 'config'`.

Run: `pnpm test:unit -- src/components/Viewer/ForgeEmbedViewer.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Port `cda5c537`'s fallback, minus the `[spike]` logging, plus the analytics calls. Keep the cloudId guard — never fetch cross-tenant. Q1's answer says the link persists in ADF, so **derive per render; do not write config.**

- [ ] **Step 3: Verify and commit**

Run: `pnpm test:unit -- src/components/Viewer/ForgeEmbedViewer.spec.ts src/utils/embedDeeplink.spec.ts` → PASS
Run: `pnpm build:lite` → succeeds

```bash
git commit -am "feat(embed): resolve a pasted deeplink to its diagram"
```

---

### Task 4: Failure cards

**Files:**
- Modify: `src/components/Viewer/ForgeEmbedViewer.vue` (or the embed viewer's error branch)
- Test: same spec as Task 3

**Interfaces:**
- Produces: two named states replacing today's generic red "This embedded diagram couldn't be loaded… Edit the macro to pick a different diagram."

- [ ] **Step 1: Write the failing tests, then implement**

| State | Copy |
|---|---|
| Foreign site | "This diagram lives on another Confluence site and can't be shown here." |
| Source missing / deleted / restricted | "The source diagram is no longer available." + (Gate A = REVERSIBLE) the Task 5 action |

Embeds multiply the source-failure surface, and we already have orphan pain in telemetry (`customcontent_orphan_observed`, the "Recovered from backup" banner). These cards are not polish — they are the containment.

Run: `pnpm test:unit -- src/components/Viewer/ForgeEmbedViewer.spec.ts` → PASS

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(embed): named failure cards for foreign-site and missing source"
```

---

### Task 5: The escape hatch — Clone lives on Edit, not on a new button

**Gate A = REVERSIBLE only.** If `NOT REVERSIBLE`, skip this task entirely and record why.

**Files:**
- Modify: `src/components/Viewer/GenericViewer.vue` (the `EMBED` chip at line 25; the Edit button at line 63)
- Modify: whichever surface Phase 0 identified as able to perform the fork
- Test: `src/components/Viewer/GenericViewer.spec.ts`

**Interfaces:**
- Produces: `embed_copy_offered` / `embed_copy_accepted`.

**Design rule this task enforces:** never present "Embed" and "Clone" as a pair of choices. The difference is entirely about the future (does this follow the source? does it break if the source is deleted?), which a user cannot evaluate at paste time. So there is **no up-front choice and no new toolbar button**. The distinction surfaces exactly once — when the user clicks Edit on an embed and finds they cannot edit it. That is the moment the difference is legible, and the fix is one click away:

> 🔗 This diagram is embedded from **&lt;page title&gt;**. Changes made there show up here.
> **[Make an editable copy]**  [Open the source]

- [ ] **Step 1: Write the failing tests, then implement**

Asymmetric on purpose: an embed can become a copy, a copy never becomes an embed. Do not build the reverse — a detached copy has no meaningful re-link semantics, and building it doubles the UI for no measured job.

Run: `pnpm test:unit -- src/components/Viewer/GenericViewer.spec.ts` → PASS

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(embed): offer an editable copy at the point Edit is blocked"
```

---

### Task 6: Mint the link, and remove the duplicate copy buttons

**Files:**
- Modify: `src/components/Viewer/GenericViewer.vue` — bottom pill (lines 130–152), `copyCode()` (699), `copyLink()` (741)
- Test: `src/components/Viewer/GenericViewer.spec.ts`

**Interfaces:**
- Produces: `deeplink_copied`; a viewer with **no net-new buttons**.

The viewer already has three "get this diagram elsewhere" affordances and two of them are identical:

| Where | Button | Produces |
|---|---|---|
| Header → Source panel | Copy | DSL text |
| Bottom pill | **Copy code** | DSL text — **same payload** (both call `getCodeFromDiagram`) |
| Bottom pill | **Copy link** | the **page** URL (`_links.base + webui`) — not the diagram |

- [ ] **Step 1: Measure before deleting**

Run a Mixpanel query for the legacy `copy_code` event (fired at `GenericViewer.vue:700`) over 30 days, split by surface, excluding internal domains. Record the volume here. Keep whichever of the two copy affordances is actually used; delete the other. Do not delete on aesthetics alone.

- [ ] **Step 2: Rename for disambiguation, add the diagram link**

- `Copy link` → **`Copy page link`** (it copies the page, and the name is about to collide)
- new pill action **`Copy diagram link`** → the deeplink, fires `deeplink_copied` with `link_source`
- Net button delta after removing the duplicate: **0**

- [ ] **Step 3: Verify and commit**

Run: `pnpm test:unit -- src/components/Viewer/GenericViewer.spec.ts` → PASS

```bash
git commit -am "feat(viewer): copy a diagram deeplink; drop the duplicate copy-code button"
```

---

### Task 7: Landing route

**Files:**
- Create: `functions/d/[cloudId]/[contentId].ts`
- Modify: `public/_routes.json`

**Interfaces:**
- Produces: `https://confluence.zenuml.com/d/<cloudId>/<contentId>` redirects into Confluence and serves an OG preview, so a pasted link is not dead outside the editor.

- [ ] **Step 1: Add the function and the route allowlist entry**

**CRITICAL:** `public/_routes.json` is an explicit allowlist. A path missing from `include` is served as the static SPA HTML fallback — symptom is `GET /d/...` returning 200 `text/html` instead of running the function.

- [ ] **Step 2: Verify locally**

Run: `pnpm wrangler:serve`, then `curl -sI http://localhost:8788/d/<cloud>/<id>`
Expected: a 302 to the Confluence page, **not** `content-type: text/html`.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(embed): landing route for diagram deeplinks"
```

---

### Task 8: Manifest matchers — LAST, and all four variants

**Files:**
- Modify: `manifest.yml:235` (`zenuml-embed-macro${LITE_KEY_SUFFIX}` — covers lite/full/diagramly), `manifest.yml:271` (`zenuml-asyncapi-embed-macro`)

This is the switch that turns the feature on, and it has no runtime gate (see Constraints). Everything above must be green first.

- [ ] **Step 1: Add the matcher to both modules**

```yaml
      autoConvert:
        matchers:
          - pattern: https://confluence.zenuml.com/d/*/*
```
Each `*` matches exactly one path segment, so `/d/<cloudId>/<contentId>` needs two.

- [ ] **Step 2: Verify the version bump stays minor**

Run: `pnpm forge:all:dev`
Expected: deploy succeeds; the reported bump is **minor**. If the CLI reports a major-version change, STOP — something touched scopes.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(embed): autoconvert diagram deeplinks on all variants"
```

---

### Task 9: E2E + ship

**Files:**
- Create: `tests/e2e-tests/tests/embed-deeplink.spec.ts`
- Create/extend: `tests/e2e-tests/helpers/` — the paste + publish + assert-render sequence goes in a helper, not inline (repeated-Playwright-steps rule)

- [ ] **Step 1: Write the E2E**

Cover: mint a deeplink from the viewer pill → paste into a new page → publish → the diagram renders. Plus the foreign-site card.

**Known automation caveat (spike):** a synthesized `Cmd+V` through the Playwright extension relay does not trigger native paste; the spike delivered a synthetic `ClipboardEvent` on the ProseMirror root and the editor consumed it (`defaultPrevented=true`). Use that same approach and comment it, or mark the paste step SKIPPED with the blocker — never mark a UI assertion PASS off a unit test.

- [ ] **Step 2: Validate, submit, land**

Run: `pnpm test:unit && npx playwright test --list tests/e2e-tests/tests/embed-deeplink.spec.ts`
Then: `/validate-branch` → `/submit-branch` → `/land-pr`. Staging deploys via CI only. **Production release needs explicit approval — do not self-authorise.**

---

### Task 10: Measure the gate you could not decide

The plan defaults on an argument (reversibility), not on evidence — no data exists on whether users want linked or independent, and embed's own history is void. So the default ships instrumented and is treated as an experiment.

- [ ] **Step 1: Build the board**

Panels, 30-day window, `is_internal_client_domain = false`:
1. `deeplink_copied` → `embed_autoconvert_rendered` funnel (does the loop close?)
2. `embed_copy_accepted` / `embed_copy_offered` — **the decision metric**
3. `embed_autoconvert_failed` + `embed_foreign_site` rates (containment)
4. Post-launch re-run of the clone measurement — does the 23.4% exact-duplicate rate after a View Source copy fall? That is the workaround being retired, and it is the real success signal.

- [ ] **Step 2: The flip rule, written down before the data arrives**

If `embed_copy_accepted / embed_copy_offered` exceeds **50%** over 30 days with n ≥ 30, the default is wrong: paste should produce a clone. Flip it. Record the threshold now so the call is not re-litigated against whatever number shows up.

Confound to control for: **Gate B**. If embeds do not count toward the Lite 100-macro limit and clones do, Lite tenants' behaviour measures the quota, not the preference. Segment by `product_type` and by paid/unpaid before reading anything.

---

## Findings / decisions log

_(fill as tasks complete)_

| Date | Gate / task | Outcome | Evidence |
|---|---|---|---|
| | Gate A | | |
| | Gate B | | |
