# ADR-0005: Feasibility & risk of enabling the AsyncAPI macro in Lite and Full

**Status**: Accepted for **Lite** (Option A) — shipped in PR #537. Full and Diagramly unchanged.
**Date**: 2026-08-19 (analysis) / 2026-08-28 (decision)
**Related**: `scripts/forge-wizard.mjs`, `vite.config.mjs`, `manifest.yml`, `src/forgeIndex.ts`, `src/model/ApWrapper2.ts`, `src/macro-count-snapshot.ts`

## Context

Today the AsyncAPI macro (`zenuml-asyncapi-macro`, custom content `async-api-doc`, the
"My API Documents" space page) ships **only** in the `asyncapi` product variant. This ADR
answers whether the same macro can be surfaced in the **Lite** and **Full** variants, at what
risk, and what the smallest correct change is — so a later dispatch can execute a slice without
re-deriving the analysis. The analysis below was written before the decision; see **Decision** at
the foot of this document for what was actually adopted and what it costs.

The headline finding: the codebase treats "AsyncAPI" as a **whole-variant identity**
(`import.meta.env.PRODUCT_TYPE === 'asyncapi'`), not as one macro type among several. The macro
is compiled out of Lite/Full **three independent ways** — enabling it means reversing all three,
plus a CSP relaxation. The version/consent cost is low; the security and build-weight costs are
real and permanent.

## How the macro is currently removed from Lite/Full (three mechanisms)

1. **Manifest strip (deploy time).** `scripts/forge-wizard.mjs` applies `yq` `manifestEdits` that
   `del` the asyncapi macros (`test("zenuml-asyncapi")`), the `async-api-doc` custom content, and
   the `zenuml-asyncapi-dashboard-page` space page for lite/full/diagramly
   (`scripts/forge-wizard.mjs:41-58, 94-115, 201-215`). **This strip logic is duplicated** in
   `.github/workflows/release.yml` and `.github/workflows/staging-deploy.yml` (7 occurrences each).
   CLAUDE.md records a prior incident (#383/#460) where these copies drifted from the wizard and
   shipped a manifest nobody intended — any change here must touch all three files in lockstep.

2. **Tree-shake gate (build time).** Every `forge-asyncapi-*` code path is behind
   `import.meta.env.PRODUCT_TYPE === 'asyncapi'`, a literal Vite replaces via `define`. The
   dispatch at `src/forgeIndex.ts:994` (`else if (isAsyncApi && import.meta.env.PRODUCT_TYPE ===
   'asyncapi')`) short-circuits in lite/full, so the dynamic `import("@/forge-asyncapi-*")` is
   dead-code-eliminated and `@asyncapi/parser` / `@asyncapi/react-component` never enter those
   bundles. The dashboard route is gated the same way (`src/forgeIndex.ts:117-124`).

3. **Studio asset copy (build time).** `vite.config.mjs:255-257` copies
   `static/asyncapi-studio/` → `dist/asyncapi-studio/` **only when `PRODUCT_TYPE === 'asyncapi'`**.
   Lite/Full builds never run `build:studio` and never carry the Studio iframe app. The variant
   also gets ~6 asyncapi-only Vite treatments: CJS interop for `readable-stream/qs/avsc/...`
   (`vite.config.mjs:116-135`), `transformMixedEsModules` (`:145-147`), `fs`→`src/stubs/empty-fs.ts`
   and `stream`→`stream-browserify` aliases (`:182-188`), and `nodePolyfills` (`:215-222`).

## Measured bundle cost (this ADR built it)

Built locally on 2026-08-19 via `scripts/build-studio.sh` (submodule pinned to
`@asyncapi/studio@1.0.1`, SHA `e827058`). The Cypress dev-dependency's postinstall must be skipped
(`CYPRESS_INSTALL_BINARY=0`) or the Studio monorepo install fails behind the proxy — a CI caveat if
this is ever wired into the lite/full pipelines.

**AsyncAPI Studio static export = 9.9 MB total** (134 files), of which **8.9 MB is JS** (116
files). A single 4.6 MB chunk carries Monaco + the AsyncAPI parser. This is the **editor** app,
served in a same-origin iframe and loaded on demand when a user opens the asyncapi editor
(`AsyncApiStudioEditor.tsx` → `<iframe src="./asyncapi-studio/index.html">`). It copies into
`dist/` for the whole variant regardless of use.

Separately, the **viewer** path (`@asyncapi/react-component` + `@asyncapi/parser`, both already in
`dependencies`) bundles as dynamic-import chunks pulled when a user **views** an asyncapi macro.
Not measured here (would require a full lite build with the gate opened), but it is additional to
the 9.9 MB and is the part that touches the main Custom UI bundle graph.

**Accurate cost framing:** neither payload loads for users who never touch an asyncapi macro —
both are dynamic-import gated. The 9.9 MB is dead weight in the *deployed CDN assets* (bigger
deploys, longer CI), and the per-user runtime cost lands only on asyncapi interactions. The one
cost that *is* global to every user of the variant is the CSP relaxation below.

## Risks, ranked

### 1. Security — CSP `unsafe-eval` on the flagship iframe (highest, unavoidable)
AsyncAPI Studio compiles JSON-Schema validators at runtime via `new Function()`, so the asyncapi
variant grants `permissions.content.scripts = ["unsafe-eval"]` (`scripts/forge-wizard.mjs:324-333`).
Lite/Full ship **without** it today. The manifest comment is explicit that scoping it to the
standalone app *"keeps the blast radius scoped to this single app's sandboxed iframe."* Enabling
the macro spreads `unsafe-eval` to the flagship apps' iframes for **every install and every macro
view**, a permanent XSS→code-exec surface widening, to serve a feature few will use. This applies
to Option A and Option B alike and is the load-bearing objection.

### 2. Build fragility on the primary product pipelines
The asyncapi build is a stack of workarounds (fs stubs, CJS interop, node polyfills, a git
submodule pinned to 1.0.1 because "newer upstream versions regressed under Forge's nested iframe",
and a Cypress-postinstall landmine). Applying all of it to `build:lite` / `build:full` moves that
fragility onto the pipelines we least want to destabilize, and adds a submodule checkout + Next.js
build to every lite/full CI run.

### 3. Studio ↔ host sync is a fragile bridge
The editor syncs the spec through a same-origin iframe with a 1 s `localStorage['document']` poll
and a synthetic Ctrl+S to flush Monaco (`AsyncApiStudioEditor.tsx:83-143`). This is the mechanism
that *requires* the same-origin Studio assets and `unsafe-eval`; carrying it into the flagship apps
carries its failure modes too.

### 4. Product / marketplace positioning
The asyncapi variant is a separate paid listing ("AsyncAPI for Confluence", its own `APP_ID`).
Bundling the capability free into Lite/Full cannibalizes that listing.

### 5. Version / admin-consent cost — LOW (a genuine mitigant)
Adding macro modules and changing content-CSP options are **minor** bumps for these
Connect-migrated apps (per the `manifest.yml` `permissions:` note and CLAUDE.md's version rules —
"Modifying content permissions CSP options … does not require admin approval"). No scope, dynamic
web-trigger, or remotes change is involved, so installs **auto-upgrade with no admin re-consent
wall**. The risk is in the code, not the rollout.

## The persistence question — and why the "union refactor" is avoidable

The variant equates AsyncAPI with a distinct custom-content namespace:
`ApWrapper2.getContentKey()` returns `'async-api-doc'` only when `forgeGlobal.isAsyncApi`
(`src/model/ApWrapper2.ts:234-238`), and `customContentTypesForVariant()` is an **either/or** —
`['async-api-doc']` for asyncapi, `['zenuml-content-sequence','zenuml-content-graph']` otherwise
(`:34-37`). Naively un-stripping the `async-api-doc` module in lite/full would make asyncapi docs
invisible to macro enumeration, the paywall count, the ADF copy-scan, the byline, staleness hints,
and agent-link search — all of which enumerate the sequence/graph types only.

**But that refactor is not required**, because of how the write path already works. Every diagram
type in lite/full is stored under **one** key — `zenuml-content-sequence` — discriminated by the
body's `diagramType` field (`getContentKey()` returns `zenuml-content-sequence` for non-asyncapi;
`src/lite-full-conversion.ts:79-81` confirms "`getContentKey()` writes every diagram type under
`zenuml-content-sequence`, so 2103 of 2104 mirrored graph bodies live there"). OpenAPI, Mermaid,
and PlantUML are *already* just `diagramType` values inside `zenuml-content-sequence`
(`src/model/ApWrapper2.ts:61-68`). The asyncapi save path flows through the same variant-aware
plumbing — `saveToPlatform` → `ApWrapper2.createCustomContentV2` → `getCustomContentType()`
(`src/forge-asyncapi-editor.ts:135`), which in lite/full resolves to `zenuml-content-sequence`
automatically. The viewer/editor read by content-id, not by type
(`getCustomContentByIdV2`), and neither depends on `forgeGlobal.isAsyncApi`.

This yields two implementation options.

### Option A — AsyncAPI as a `diagramType` under the shared content type (recommended)
Do **not** un-strip the `async-api-doc` module or the dashboard. Ship only the macro. Asyncapi
content lands in `zenuml-content-sequence` (body `diagramType: 'AsyncAPI'`), exactly like OpenAPI.

- **Paywall counts it for free.** `LITE_CUSTOM_CONTENT_TYPES` (the D1 snapshot backend,
  `src/macro-count-snapshot.ts:14-17`) already enumerates `zenuml-content-sequence`, so asyncapi
  diagrams count toward the Lite 100-macro limit with zero changes. No revenue leak.
- **Enumeration, copy-scan, byline, staleness, agent-link search** all already cover
  `zenuml-content-sequence` — no `customContentTypesForVariant()` union needed.
- **Analytics** already accepts `macro_type: 'asyncapi'` (`src/utils/analytics/catalog.ts:27`).
- **No dashboard, no `async-api-doc` module, no namespace split.** The union-refactor is avoided.

### Option B — reuse the `async-api-doc` module in Lite/Full (not recommended)
Only needed for cross-variant document compatibility or dashboard parity, neither of which the
core "enable the macro" goal requires. It forces `customContentTypesForVariant()` to return the
**union** `['zenuml-content-sequence','zenuml-content-graph','async-api-doc']` for lite/full and
audits every one of its ~7 consumers (`ApWrapper2.ts:853, 981, 1109, 1145, 1226, 1373`), plus the
`ac:my-api:async-api-doc` prefix is hardwired to the asyncapi Connect key
(`ApWrapper2.ts:240-253`) and would resolve under a different key per variant. Higher surface,
higher correctness risk, no benefit for the stated goal.

## Concrete change set for Option A (smallest correct slice)

1. **`scripts/forge-wizard.mjs`** — for lite/full, stop stripping `zenuml-asyncapi-macro` (keep
   stripping `async-api-doc`, the dashboard space page, and the Connect lifecycle block). Mirror
   the identical edit in `.github/workflows/release.yml` **and**
   `.github/workflows/staging-deploy.yml`.
2. **CSP** — add `permissions.content.scripts = ["unsafe-eval"]` for lite/full (minor version bump;
   see risk #1 for the security cost this buys).
3. **`src/forgeIndex.ts:994`** — widen the dispatch gate so lite/full reach the asyncapi branch
   (the `isAsyncApi` context flag at `:318` is already macro-derived and correct per variant).
4. **`vite.config.mjs`** — apply the asyncapi-only blocks (optimizeDeps interop, commonjs options,
   `fs`/`stream` aliases, `nodePolyfills`, and the `static/asyncapi-studio` → `dist` copy) to the
   lite/full builds, and run `build:studio` before `build:lite`/`build:full` in `package.json` and
   CI (with `CYPRESS_INSTALL_BINARY=0`).
5. **Backend** — no change required. `functions/` special-cases asyncapi only for analytics
   product-type identification; the lite→full conversion queue explicitly rejects AsyncAPI
   (`functions/conversion/service.ts:13`), which is acceptable for a first ship but worth a
   follow-up decision.
6. **Analytics** — none required; `macro_type: 'asyncapi'` already exists in the catalog.

The lowest-risk pilot is **Full-only, macro-only, behind a Forge feature flag** (Full has no
paywall, so risk-2/paywall considerations are moot there), with Option A's storage model. Even so,
risk #1 (`unsafe-eval` on the flagship iframe) and risk #2 (Studio weight + submodule in the
primary build) apply regardless of variant and are the reasons the capability was deliberately
quarantined to a standalone app in the first place.

## Decision

**Adopt Option A for Lite only** (PR #537). Lite ships `zenuml-asyncapi-macro`; content is stored
under the shared `zenuml-content-sequence` type discriminated by `diagramType`, so the paywall
count, enumeration, copy-scan, byline and agent-link search cover it with no persistence refactor.
The `async-api-doc` custom content, the embed macro and the dashboard space page stay
asyncapi-variant-only. **Full and Diagramly are explicitly NOT included** — they keep the broad
`test("zenuml-asyncapi")` strip and gain neither the Studio assets nor the CSP relaxation.

Costs accepted with this decision, both permanent and both stated above rather than discovered
later:

- **`unsafe-eval` in Lite's content CSP** (risk #1). `permissions.content` is app-level in
  `manifest.yml`, so this applies to every Lite Custom UI iframe on every install — including
  sequence/mermaid/graph macro views that render user-authored content — not just the Studio
  editor. Scoping it narrower would require a separate Forge app, which is what the asyncapi
  variant already is. This is the load-bearing cost of the decision.
- **~9.9 MB of Studio assets in every Lite deploy** plus the submodule checkout and Next.js build
  in the Lite pipeline (risk #2). Neither payload loads for users who never open an asyncapi
  macro; the cost is deploy weight and CI time.
- **Marketplace overlap** with the paid "AsyncAPI for Confluence" listing (risk #4), accepted
  deliberately: the standalone app keeps the dashboard, the embed macro and the cross-page
  `async-api-doc` document model, none of which Lite gets.

### Lite → Full migration: handled, with one deliberate skip

Lite→Full macro and custom-content migration is run **on demand**
(`src/lite-full-conversion.ts`, driven by the `ConversionJob` queue in
`functions/conversion/`). Two of its three moving parts already handle AsyncAPI generically, and
one deliberately does not:

- **Custom content — works.** Lite files AsyncAPI under the shared `zenuml-content-sequence` type
  (Option A above), and `fullContentTypeForLiteType()` rewrites the Lite prefix to the Full one
  with no per-type knowledge. Nothing to add.
- **Macro key — works, *because* the key is suffixed.** `mapLiteMacroKey()` accepts any
  `zenuml-*-lite` key and strips the suffix. This is why the macro is declared as
  `zenuml-asyncapi-macro${LITE_KEY_SUFFIX}` rather than a bare literal: without the `-lite`
  suffix the key fails that check and every AsyncAPI macro is silently counted as
  `macrosSkippedUnknownKey` and left behind.
- **Rendering on Full — the blocker.** Full ships **no** `zenuml-asyncapi-macro` module (the
  full/diagramly `manifestEdits` strip it via `test("zenuml-asyncapi")`). Converting would rewrite
  the page ADF to point at a module Full cannot resolve and republish the page, replacing a
  working diagram with a broken macro. So `mapLiteMacroKey()` returns `null` for asyncapi and the
  executor counts it as `macrosSkippedAsyncApi` — the same treatment the embed macro already gets,
  and strictly better than manufacturing broken macros. The diagrams stay as working Lite macros.

**To lift:** ship `zenuml-asyncapi-macro` in Full, then delete the asyncapi guard in
`mapLiteMacroKey()` (and its test). Key mapping, content-type mapping and CQL discovery are
already generic, so that is the only code change — at the cost of extending the `unsafe-eval`
relaxation and the Studio build weight to Full.

Correction to an earlier draft of this ADR: it cited `functions/conversion/service.ts:13` as
evidence that the conversion queue "explicitly rejects AsyncAPI". That line rejects the AsyncAPI
**app's FIT** from operating the queue and says nothing about AsyncAPI **diagrams**; there is no
diagramType filter anywhere in the conversion path.
