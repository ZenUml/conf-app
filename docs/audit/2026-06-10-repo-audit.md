# Repository Audit — conf-app (ZenUML Confluence Cloud Add-on)

**Date:** 2026-06-10 · **Auditor:** Claude (principal-engineer audit, 6 parallel exploration agents + direct verification) · **Scope:** analysis only, no code modified · **Branch:** `worktree-repo-audit` (worktree of `main` @ 430ddcb3)

Every Critical/High finding was independently verified by direct file reads or commands, not just agent reports. Two agent claims were **refuted** during verification and are noted inline.

---

## 1. Executive Summary

**Overall health grade: B-.** This is a production Forge app with real paying tenants, a green test suite (84 files / 666 tests, all passing in ~50s), a sophisticated sharded Playwright E2E pipeline with auth deduplication, correctly implemented JWT validation on its main write path, 100% parameterized SQL, and an unusually mature, data-first performance program (Phase 0b instrumentation shipped, DrawIO/Mermaid already code-split). What pulls it below B: several backend endpoints are publicly writable with no authentication, CI enforces neither lint nor typecheck (so 257 `any`-escapes and 141 lint warnings accumulate unchecked), and three god modules (`ApWrapper2.ts` 1,406 lines, `forgeIndex.ts` 858 lines, and ~60–70% triplicated save/recovery logic across the `forge-*-editor.ts` entry files) concentrate the highest-risk logic in the least-tested files.

**Top 3 risks:**
1. **Unauthenticated write endpoints** — `/diagram-likes/*` accepts arbitrary writes with client-supplied `userAccountId`; `/api/metrics/evaluation` appends unauthenticated JSON to R2 (`functions/_middleware.ts:5-10`, `functions/diagram-likes/toggle.ts:6`, `functions/api/metrics/evaluation.ts:20`).
2. **Zero unit coverage on the entry points** — `forgeIndex.ts`, `forge-graph-editor.ts`, `forge-swagger-editor.ts` (the macro load/save/recovery critical path, including ZEN-1170 orphan-recovery logic) are tested only by E2E, which doesn't gate draft PRs.
3. **No CI quality gates** — no `eslint`, no `vue-tsc`, no coverage threshold in any workflow; type/lint erosion compounds silently.

**Top 3 opportunities:**
1. One shared editor-lifecycle module replaces ~800 lines of triplicated entry-point code and makes the recovery logic testable once.
2. A single CI job (lint + typecheck, ~2 min, parallel to unit tests) freezes quality erosion permanently.
3. A deletion pass (dead deps, dead endpoints, dead configs, personal-site workflow) removes ~1,500+ lines and several stale dependencies at near-zero risk.

---

## 2. Repo Map

**Purpose:** Confluence Cloud add-on providing six diagram macro types (Sequence/ZenUML, Mermaid, PlantUML, DrawIO Graph, OpenAPI, Embed), shipped in three build variants (Lite/free, Full/paid, Diagramly-branded) from one codebase via `PRODUCT_TYPE`. Maturity: **production service** with paying tenants, a paywall, and analytics-driven growth work.

**Stack:** Vue 3 + TypeScript + Vite frontend (Forge Custom UI, runs in sandboxed iframes) · React 17 embedded only for the Swagger editor surface · Cloudflare Pages Functions + D1 (SQLite) + KV + R2 backend · Atlassian Forge platform (manifest.yml; Connect entries retained only as migration bridge) · pnpm · Vitest + Playwright · GitHub Actions.

**Control flow (macro view):** Confluence loads Forge iframe → `index.html` → `src/forgeIndex.ts` (routes by extension context: viewer / editor / settings / byline / banner) → content loaded via `CompositeContentProvider` fallback chain (custom content → content property → macro body) over `ApWrapper2` (Confluence REST via `@forge/bridge`) → type-specific viewer/editor component. Saves go to Confluence custom content (system of record); D1 holds telemetry only.

**Key directories:**

| Path | One-liner |
|---|---|
| `src/` | Vue app: `forgeIndex.ts` entry + `forge-*-editor.ts` per-type editor entries, `components/`, `model/` (ApWrapper2, ContentProvider chain, Diagram), `utils/`, `services/`, `composables/` + `hooks/` (redundant pair) |
| `functions/` | Cloudflare Pages Functions: lifecycle webhooks, custom-content version mirror, likes, AI title, paywall/licensing, admin; `public/_routes.json` is the routing allowlist |
| `functions/migrations/` | 14 D1 migrations (indexed analytics fact table, retention purges) |
| `tests/e2e-tests/` | Separate Playwright package: 40 specs, 6 projects, 4-shard CI with deduped OTP auth |
| `tests/export-modal/` | 1,014-line standalone Playwright spec — **not run in CI** |
| `public/drawio/` | **155MB vendored DrawIO** (1,375 SVGs, 658 PNGs) served as static assets |
| `forge-console/`, `website/`, `workers/cron-aggregate/` | Live sibling projects: admin console, marketing site, analytics cron worker |
| `.github/workflows/` | build-test-deploy, e2e (reusable), release, smoke, staging-deploy, plus one personal dev workflow (`e2e-test-ruixiang.yml`) |
| `docs/` | Well-organized ADRs, policies, debugging guides; root also carries 5 working `.md` docs (some stale) |

**Surprises:** (1) `manifest.yml` is rewritten by `yq` in CI per variant rather than templated; (2) all Vue imports are aliased through `@vue/compat` (`vite.config.mjs` alias) — a migration shim still in the production bundle; (3) six `functions/api/analytics/*` endpoints exist but are absent from `_routes.json`, making them unreachable in production; (4) `sandbox.html` + preset system is a genuinely good local-dev harness.

---

## 3. Audit Report

Legend: severity **C**ritical / **H**igh / **M**edium / **L**ow · [F] = fact (verified) · [J] = judgment.

### 3.1 Security — the ugliest part; fix first

| # | Sev | Finding | Evidence | Consequence |
|---|---|---|---|---|
| S1 | **H** [F] | `/diagram-likes/*` (index, query, toggle, user-likes) has **no authentication**. Not in `AUTHENTICATED_PATHS`; handlers trust client-supplied `userAccountId`, `clientDomain`, `diagramCustomContentId`. All four routes are publicly exposed in `_routes.json`. | `functions/_middleware.ts:5-10`; `functions/diagram-likes/toggle.ts:6-52`; `public/_routes.json` | Anyone can forge likes as any user, enumerate per-user activity across tenants, and spam unbounded rows into D1. |
| S2 | **H** [F] | `/api/metrics/evaluation` accepts **unauthenticated POST** and appends arbitrary JSON to R2 (hourly JSONL files), no schema or body-size validation. | `functions/api/metrics/evaluation.ts:20-56` | Analytics poisoning + unbounded R2 growth from any internet client. |
| S3 | M [F] | `/admin/metrics-inspect` has no auth — discloses per-domain/space cache state and diagnosis. | `functions/admin/metrics-inspect/index.ts:99` | Tenant-usage enumeration (`zenuml.com/admin/metrics-inspect` is also the documented internal tool — it's open). |
| S4 | M [F] | No payload-size limits on `diagramly/chat` (unbounded `messages[]`) or `ai-generate-title` (unbounded `dsl`, CORS `*`). | `functions/diagramly/chat.ts:6-25`; `functions/ai-generate-title.ts:55-77` | Memory/cost abuse vector on LLM-backed endpoints. |
| S5 | M [J] | `/uninstalled` processes requests without auth when no JWT present ("Connect migration bridge"). | `functions/uninstalled.ts:17-26` | Spoofable lifecycle events pollute analytics; acceptable only if consciously retained — document or close. |
| S6 | L [F] | Sentry `tracesSampleRate: 1.0` in production middleware. | `functions/_middleware.ts:41` | Cost + noise; standard is 0.01–0.1. |
| S7 | L [F] | `wrangler-dev.toml:15` carries a partially-masked ngrok token prefix (`2piBMy4QpL0xxxxx`). | `wrangler-dev.toml:15` | If the prefix is real, rotate; replace with full placeholder. |
| — | — | **Refuted:** an agent flagged a committed `FORGE_API_TOKEN` as Critical. Verified false — `.claude/settings.local.json` is untracked (`git ls-files`), and `git grep ATATT` over tracked files is empty. The token exists only in a local untracked file. | verified by command | No committed secrets found. |

**Strengths:** JWT validation is done right — `jose` JWKS verification against Atlassian, app-ID allowlist, tenant bound to the verified token (`functions/utils/authenticate.ts:7-18`). All 59 D1 queries use parameterized binds; zero interpolation [F]. `forge-upload-attachment.ts:66-134` correctly defends against confused-deputy (validates user page access before app-authenticated write). Stripe webhook HMAC, cron secret, and page-capture token are all properly implemented.

### 3.2 Architecture & design

| # | Sev | Finding | Evidence | Consequence |
|---|---|---|---|---|
| A1 | **H** [F+J] | `ApWrapper2.ts` is a 1,406-line god module (~74 methods) mixing ≥5 concerns: REST v1/v2 client, custom-content CRUD/search, orphan recovery, macro/user/space context, license/variant checks, error telemetry. Accessed as a global singleton (`globals.apWrapper`) from 21 files; `globals` imported by ~70 files. | `src/model/ApWrapper2.ts:45-1406`; `src/model/globals/` | Its interface is nearly as complex as its implementation — a **shallow** module at the system's most important seam. Every test must mock all concerns; REST format changes ripple everywhere. Deletion test: complexity would reappear in 21 callers — it earns its existence, but not its shape. |
| A2 | **H** [F] | `forgeIndex.ts` (858 lines) mixes bootstrap orchestration with a 7-fallback document-loading state machine (`loadHeavyComponents`, lines 144–517, 12+ branches, incl. nested ternary type inference at 241-251). | `src/forgeIndex.ts:144-517` | Highest-complexity logic in the app, zero unit tests (see T1); every new extension type grows it. |
| A3 | **H** [F] | ~60–70% duplication across `forge-graph-editor.ts` (412L), `forge-swagger-editor.ts` (410L), `forge-embed-editor.ts` (186L): save-and-exit, ZEN-1170 orphan recovery, legacy content-property fallback, journey tracking, close guards, deferred `view.submit` are reimplemented per file. | `forge-graph-editor.ts:58-165,276-363` vs `forge-swagger-editor.ts:88-170` vs `forge-embed-editor.ts:24-92` | Recovery bugfixes must land 3×; divergence is a data-loss risk class (ZEN-1170 was exactly this kind of bug). |
| A4 | M [F] | Four coexisting state mechanisms: Vuex `store2`, composables, global singletons (`globals`, `forgeGlobal`, EventBus), and raw `window.diagram`/`window.graphXml`/`window.editor` mutation. Swagger editor reads/writes `window.diagram` while Editor.vue dispatches Vuex. | `src/model/store2/ExtendedStore.ts:7-66`; `src/forge-swagger-editor.ts:81-196`; `src/forge-graph-editor.ts:78-101` | No single source of truth for the diagram being edited; the exact pattern that breeds save/draft inconsistency bugs. |
| A5 | M [F] | React-in-Vue boundary is porous: React components read Vuex directly and depend on `window.editor`, rather than receiving props through a facade. | `src/components/react/SwaggerEditor.tsx`; `src/forge-swagger-editor.ts:81` | Neither framework surface is independently replaceable or testable. |
| A6 | L [F] | `src/composables/` and `src/hooks/` are duplicate concepts (1 file in hooks/). | `src/hooks/useCSATState.ts` | Navigational noise. |

**Strengths:** The ContentProvider chain is a genuinely **deep** seam — `CompositeContentProvider` (58L) orchestrates three interchangeable storage adapters behind a tiny `load()` interface; real seam, two-plus adapters, passes the deletion test (`src/model/ContentProvider/CompositeContentProvider.ts:13-40`). No circular imports; services layer cleanly between model and components. Three-variant build from one tree is well executed. Defensive recovery design (orphan probes, legacy fallback, `LegacyLoadBlockedSaveError`) shows the right instincts — it just lives in 3 copies.

### 3.3 Testing

| # | Sev | Finding | Evidence | Consequence |
|---|---|---|---|---|
| T1 | **H** [F] | Zero unit tests for the entry points: `forgeIndex.ts`, `forge-graph-editor.ts`, `forge-swagger-editor.ts`, `forge-embed-editor.ts`, `Workspace.vue` — i.e., the load/save/recovery critical path. Covered only by E2E, which **skips draft PRs** (`if: github.event.pull_request.draft == false`). | grep over spec files; `.github/workflows/build-test-deploy.yml:76-78` | The most dangerous logic (7-fallback loader, orphan recovery) has the weakest fastest-feedback coverage. Untestability is caused by A3/A4 (window globals, no injection). |
| T2 | **H** [F] | Backend handlers untested: `forge-installed.ts` (0 tests), `forge-user-behavior.ts` (only the mapping fn, not `onRequest`/auth), all 4 `diagram-likes/*` handlers (0 tests). | `tests/unit/forgeUserBehavior.spec.ts` imports `mapForgeUserBehaviorEvent` only | JWT-validation and D1-mutation regressions ship undetected. |
| T3 | M [F] | No coverage thresholds: v8 provider configured but no `lines/functions/branches` keys; CI runs `pnpm test:unit` without `--coverage`. | `vite.config.mjs:227-252`; `build-test-deploy.yml:58` | Coverage can only ratchet down. |
| T4 | M [F] | `tests/export-modal/export-modal.spec.ts` (1,014 lines, own Playwright config) is referenced by no CI workflow. | `tests/export-modal/`; grep over workflows | A large user-visible feature has an orphaned regression suite. |
| T5 | M [J] | Mock-heavy specs assert mock choreography rather than behavior in places — e.g., the version-conflict retry test hardcodes the retry sequence in mocks. | `src/model/ApWrapper2.spec.ts:116-147` | Tests survive real regressions when the bridge contract drifts. |
| T6 | L [F] | Hard-coded sleeps in E2E (incl. one `waitForTimeout(45000)`); all `.skip`s are documented/conditional, not rot. | `tests/e2e-tests/tests/insert/spot-check-metrics-fix.spec.ts` | Minor flake/wall-clock risk. |

**Strengths:** 666 green tests in 50s. E2E pipeline is well above average: 4-shard, single deduped OTP login with cached storageState, multi-variant (Lite/Full/Diagramly), trace-on-retry. Several genuinely behavioral suites: `closeGuard.spec.ts`, `space-license.spec.ts` (asserts HTTP contract), `forge-custom-content.spec.ts` (asserts race-safety SQL shapes).

### 3.4 DevEx & CI/CD

| # | Sev | Finding | Evidence | Consequence |
|---|---|---|---|---|
| D1 | **H** [F] | No lint, no typecheck, no coverage gate in any workflow — `grep -rn "lint\|vue-tsc\|typecheck" .github/workflows/` returns nothing. `vue-tsc` is installed but there is no `typecheck` script in package.json. | verified by command; `package.json` | The 141 current lint warnings and 257 `any`-escapes (Q3) grow monotonically. |
| D2 | M [F] | Variant manifest is produced by `yq` edit chains in two workflows with no post-edit validation; `forge install` steps run `continue-on-error: true`. | `staging-deploy.yml:48-94`; `release.yml:59-88` | A malformed manifest or failed install is silently swallowed until prod. |
| D3 | L [F] | Personal-developer cruft on main: `e2e-test-ruixiang.yml` (hardcodes `danshuitaihejie.atlassian.net`) + `forge:all:ruixiang` script — also a client-privacy-policy violation (real tenant hostname in public repo). | `.github/workflows/e2e-test-ruixiang.yml`; `package.json:59` | Policy breach (see `docs/policies/client-privacy.md`) + CI noise. |
| D4 | L [F] | Dead legacy `.eslintrc.js` beside the live flat `eslint.config.mjs`; duplicate `forge variables set` block for the Full app in release.yml (lines 110-111 ≡ 124-125); sequential smoke-test jobs that could parallelize. | `.eslintrc.js`; `release.yml:110-125`; `smoke-test.yml` | Confusion + minutes wasted. |
| D5 | L [F/J] | Setup friction: `wrangler:link` symlink step absent from README; `scripts/forgex` undocumented; `vite.config.mjs` shells out to git via `execSync` on every build (fails on shallow clones). | `package.json:30`; `vite.config.mjs:15-23` | Onboarding paper cuts. |

**Strengths:** Feature-branch CI is deliberately lean (full/diagramly builds gated to main — halves per-push minutes); E2E auth dedup saves ~1 min/run; concurrency groups prevent duplicate-run waste (documented in CLAUDE.md); `block-external-prs.yml` is correct hygiene.

### 3.5 Code quality

| # | Sev | Finding | Evidence | Consequence |
|---|---|---|---|---|
| Q1 | M [F] | Duplication: A3 above, plus `ForgeGraphViewer.vue` vs `ForgeGraphViewerEmbed.vue` ~70% shared (byte-identical `goToPage()`), and ExportModal/OverlayLayer split state. | `ForgeGraphViewer.vue:101-105` vs `ForgeGraphViewerEmbed.vue:124-128` | Double-maintenance. |
| Q2 | M [F] | Dead code: `functions/lib/jsuri.js` (460L, zero imports — verified by grep), six unreachable `functions/api/analytics/*.ts` (absent from `_routes.json` allowlist — in production these paths return the SPA HTML fallback). | verified by command; `public/_routes.json` | ~1,000+ lines of attack-surface-adjacent dead weight. **Note:** an agent claimed `AtlasDocExample1.js` is dead — refuted; it is a fixture imported by `AtlasDocFormat.spec.ts:2`. It's *misplaced* (556 fixture lines in `src/`), not unused. |
| Q3 | M [F] | Type-safety erosion: ~257 `any` escapes (~72 `: any`, ~168 `as any`, mostly `ApWrapper2.ts`, entry files) + 39 `@ts-ignore`/`@ts-expect-error`. `strict: true` is on, but nothing enforces it end-to-end (no typecheck script/CI — D1). | `tsconfig.json:3`; grep counts | Strict mode without a gate decays. |
| Q4 | L [F] | 8–9 `.js` files in `src/` (createDemoPage.js 401L, export.js, page-capture.js, compress.js…) outside TS coverage; Options API and `<script setup>` roughly 31/38 split. | file listing | Inconsistency, not defects. |

**Strengths:** Error handling on the save path is exemplary — classify → `trackEvent('save_failed', …)` → toast → keep editor open (`forge-graph-editor.ts:74-95`); no empty catches found in critical paths; class-vs-function conventions are consistent.

### 3.6 Performance

The dimension is **healthy and unusually well-managed** — instrumentation-first (Phase 0b sub-phase timers shipped: `renderPerf.ts`, wired at `forgeIndex.ts:56` and viewers), DrawIO already lazy-loaded only on the graph path (`src/utils/drawio/loadDrawioViewer.ts`, clean `index.html`), Mermaid served from `vendor/` outside the Rollup graph (`src/utils/mermaid/loadMermaid.ts:18-29`), context memoized, KV metrics cache with TTL, D1 analytics table fully indexed (`migrations/0014`), retention purges in place. Two real defects:

| # | Sev | Finding | Evidence |
|---|---|---|---|
| P1 | M [F] | `iframeToPng()` adds a `window` `message` listener per call and never removes it — accumulates across saves on multi-macro pages. | `src/model/Attachment.ts:132-146` |
| P2 | M [F/J] | `IgnoreEsc.ts` unconditionally swallows Escape via `document`-level listener with no mode gating. | `src/utils/IgnoreEsc.ts:1-8` |
| P3 | L [J] | `context` and `fetch` awaits are sequential in boot; already identified as Lever B in `RENDERING_PERF_PLAN.md` — correctly deferred pending Phase 1 data. | `forgeIndex.ts:52-185` |

### 3.7 Dependencies

| # | Sev | Finding | Evidence |
|---|---|---|---|
| X1 | M [F] | All Vue imports aliased through `@vue/compat` (`vite.config.mjs:107`) — migration shim still in prod bundle; blocks Vue ≥3.5. A migration handoff doc already exists in `docs/analysis/`. | `vite.config.mjs:107` |
| X2 | M [F/J] | `swagger-editor` ^4 is unmaintained upstream (v5+ exists); paired with React 17 pin and Atlaskit. Contained to the OpenAPI editor surface. | `package.json:121,113-114` |
| X3 | L [F] | Dead/wrong deps: `flag` (unused), `@types/jest` (Vitest project), Babel trio + `babel.config.js` (Vite uses esbuild), `@types/mermaid` ^8 vs `mermaid` ^11, `typescript`+`vite` in `dependencies` instead of `devDependencies`. | `package.json:71-72,102,109,126-127,140` |

### 3.8 Documentation

Mostly healthy: `docs/` has real ADRs/policies, CLAUDE.md is excellent and current. Issues, all Low [F]: `IMPLEMENTATION_PLAN.md` (20KB) marked complete but lingering — house convention says delete; `CHANGELOG.md` is an empty husk; README omits the `wrangler:link` setup step and still documents the manual drawio cleanup that CI now automates.

---

## 4. Improvement Strategy

### Theme 1 — Close the open backdoors (security)
**Explains:** S1–S5. **Target state:** every route in `_routes.json` is either JWT-authenticated via middleware, secret-gated, or explicitly documented as public with size limits. Identity fields (`userAccountId`) always come from the verified token, never the body. **Principle:** the routing allowlist *is* the attack surface; audit it as one artifact.

### Theme 2 — Make quality enforcement mechanical (CI gates)
**Explains:** D1, T3, T4, Q3, the 141 warnings. **Target state:** PR CI fails on eslint errors and `vue-tsc --noEmit` failures; coverage reported on every PR with a ratchet (current % becomes the floor); export-modal suite has a CI home. **Principle:** humans (and AI agents) don't reliably keep discipline a workflow can keep for free — this repo is heavily agent-edited, which makes mechanical gates *more* valuable, not less.

### Theme 3 — One copy of the dangerous logic (deepen the editor-lifecycle seam)
**Explains:** A1–A3, T1, much of Q3. **Target state:** a single `editorLifecycle` module (load-with-recovery → edit → save-and-exit → close-guard) with the per-type differences passed as a small config/adapter — turning three shallow copy-paste entries into one deep module with one test suite. `ApWrapper2` splits along its natural seams (REST client / content store / macro context / recovery), consumed via injection rather than the `globals` singleton. **Principle:** depth = lots of behavior behind a small interface; the interface is the test surface. The ContentProvider chain already shows this codebase knows how — extend the same pattern up one layer.

### Theme 4 — Prefer less code (deletion pass)
**Explains:** Q2, D3, D4, X3, doc staleness. **Target state:** zero unreachable endpoints, zero unused deps, zero dead configs, zero personal-site workflows, zero "complete" plan files. **Principle:** every dead line is a line an agent or a new contributor must read and rule out.

### Explicitly NOT fixing (trade-offs)
1. **Vuex → Pinia migration** — high churn, near-zero user value; instead just freeze the rule "no new `window.*` state" and route new state through composables.
2. **React-in-Vue removal / swagger-editor v5 upgrade** — contained to one macro type; do it only when the OpenAPI macro gets product investment. The facade wrapper (props in, callbacks out) is the cheap 20% worth doing if the surface is touched anyway.
3. **Eliminating all 257 `any`s** — not worth a campaign; the CI typecheck gate stops growth, and refactors (Theme 3) retire the worst clusters organically.
4. **80% coverage targets** — arbitrary; ratchet from current baseline instead.
5. **Restructuring `_routes.json`/Pages architecture, ContentProvider chain, E2E pipeline, perf program** — all healthy; don't touch.

### Definition of done — measurable signals
- CI fails on eslint errors and `vue-tsc` errors (verifiable: a PR with a type error goes red).
- Zero High security findings: every `_routes.json` route classified authenticated/secret/public-with-limits in `docs/policies/`.
- `diagram-likes` writes require a verified Forge JWT; `userAccountId` taken from token.
- One shared editor-lifecycle module imported by all three editor entries; its spec covers the orphan-recovery and legacy-fallback branches; entry files each < 150 lines.
- Coverage % reported on PRs and ≥ the recorded baseline.
- `git grep` zero hits for: jsuri, `flag` import, `@types/jest`, `.eslintrc.js`, ruixiang, `api/analytics` (unless re-routed deliberately).

---

## 5. Task Plan

### Milestone 0 — Safety net (before touching behavior)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M0.1 | **Add CI quality job**: `eslint` (`--max-warnings` at current count to ratchet) + new `"typecheck": "vue-tsc --noEmit"` script, run parallel to unit tests on PRs. Fix or suppress whatever typecheck surfaces first run. | `.github/workflows/build-test-deploy.yml`, `package.json` | PR with lint error or type error fails CI; baseline branch passes | M | Low (CI-only) | — |
| M0.2 | **Coverage report + ratchet**: run `vitest --coverage` in CI, record baseline, fail below it. | `vite.config.mjs`, workflow | Coverage visible on PRs; floor enforced | S | Low | M0.1 |
| M0.3 | **Characterization tests for backend handlers** about to change: `diagram-likes/*` `onRequest` (current behavior incl. missing-auth), `forge-installed`, `forge-user-behavior` handler level. | `functions/**/*.spec.ts` | Handlers covered for method/auth/validation/DB paths | M | Low | — |
| M0.4 | **Wire export-modal suite into CI** (nightly or PR-on-touch). | workflow, `tests/export-modal/` | Suite runs automatically somewhere | S | Low | — |

### Milestone 1 — Critical & correctness fixes

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M1.1 | **Authenticate diagram-likes** (sketch below). Add `/diagram-likes` to `AUTHENTICATED_PATHS`; take `userAccountId` from verified token; update frontend caller to send the Forge invocation token (pattern exists in other authed calls). | `functions/_middleware.ts`, `functions/diagram-likes/*`, frontend like caller | Unauthenticated POST → 401; E2E like flow green; M0.3 tests updated | M | **Medium** (could break likes for old clients — verify token already sent) | M0.3 |
| M1.2 | **Protect `/api/metrics/evaluation`**: shared-secret header (like cron) or JWT + schema validation + body-size cap; same size caps on `diagramly/chat`, `fix-diagram`, `ai-generate-title`. | `functions/api/metrics/evaluation.ts`, `functions/diagramly/*` | Unauthenticated/oversized POST rejected | S | Low–Med (find the legit caller first) | — |
| M1.3 | **Gate `/admin/metrics-inspect`** behind `ADMIN_API_SECRET` (pattern from `api/space-license.ts:204-209`); update the internal `/metrics` skill/tooling to pass it. | `functions/admin/metrics-inspect/index.ts` | 401 without secret | S | Low | — |
| M1.4 | **Fix `iframeToPng` listener leak** (named listener, remove on resolve, add timeout-reject). | `src/model/Attachment.ts:132-146` | Listener count stable across repeated exports; unit test | S | Low | — |
| M1.5 | **Gate Escape suppression to editor mode**. | `src/utils/IgnoreEsc.ts` | Escape works on viewer-only pages; still suppressed in fullscreen editor | S | Low–Med (verify which surfaces import it) | — |
| M1.6 | Sentry `tracesSampleRate` → 0.1; decide `/uninstalled` optional-auth (keep documented or close). | `functions/_middleware.ts:41`, `functions/uninstalled.ts` | Config changed; decision recorded in docs/policies | S | Low | — |

### Milestone 2 — High-leverage improvements

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M2.1 | **Extract shared editor lifecycle** (sketch below): one module owning load-with-recovery, save-and-exit, close-guard, journey tracking; three thin per-type adapters. | new `src/model/editorLifecycle.ts`, `forge-{graph,swagger,embed}-editor.ts` | Entries < 150 lines each; lifecycle spec covers recovery branches; full E2E insert+edit suite green for all macro types | **XL → break down** (per-editor sub-tasks) | **High** — this is the save path; rely on M0 gates + E2E | M0.* |
| M2.2 | **Split ApWrapper2 phase 1**: extract orphan-recovery + REST request layer into separate modules; ApWrapper2 delegates (no caller changes yet). | `src/model/ApWrapper2.ts` → `src/model/recovery/`, `src/model/confluenceRest.ts` | Existing 1,190-line spec still green; new modules independently testable | L | Medium | M0.1 |
| M2.3 | **Deletion pass** (quick-win batch, see below). | many | `git grep` checks in §4 pass; build + tests green | S–M | Low | — |
| M2.4 | **Dependency hygiene**: move `typescript`/`vite` to devDeps; bump `@types/mermaid`; remove Babel trio + config, `flag`, `@types/jest`. | `package.json` | Install + build + tests green | S | Low | — |
| M2.5 | **Validate manifest after yq edits** in CI (`forge lint` or YAML schema check); drop `continue-on-error` from install steps; dedupe release.yml full-app block. | `staging-deploy.yml`, `release.yml` | Broken manifest fails CI before deploy | M | Low | — |

### Milestone 3 — Quality & polish

| ID | Task | Effort | Notes |
|---|---|---|---|
| M3.1 | Begin `@vue/compat` removal per existing `docs/analysis/` handoff doc | XL → break down | Unblocks Vue 3.5+; do after M2.1 lands |
| M3.2 | Merge `src/hooks/` into `src/composables/`; move `AtlasDocExample1.js` fixture next to its spec; convert `src/*.js` stragglers to TS | S | |
| M3.3 | Add DiagramLikes indexes (composite on query columns) — do with M1.1 if convenient | S | |
| M3.4 | Dedupe ForgeGraphViewer/Embed pill navigation; React facade for SwaggerEditor (props in, callbacks out) | M | Only when those surfaces are next touched |
| M3.5 | Docs sync: README (`wrangler:link`, drawio step), delete IMPLEMENTATION_PLAN.md, fix or delete CHANGELOG.md; parallelize smoke-test.yml | S | |

### Quick wins (do immediately — all S effort, high signal)
1. **Delete `e2e-test-ruixiang.yml` + `forge:all:ruixiang`** — also resolves a client-privacy policy violation (D3).
2. **Delete dead code batch**: `functions/lib/jsuri.js`, `functions/api/analytics/*` (after Open Question 2), `.eslintrc.js` (Q2/D4).
3. **Sentry sample rate** 1.0 → 0.1 (S6).
4. **`iframeToPng` leak fix** (P1).
5. **Add `typecheck` script + CI lint job** (M0.1) — the single highest-leverage small change in this plan.
6. **Gate `/admin/metrics-inspect`** (M1.3).

### Implementation sketches — top 3 tasks

**M1.1 Authenticate diagram-likes.**
Approach: middleware-first. (1) Add `'/diagram-likes'` to `AUTHENTICATED_PATHS` (`functions/_middleware.ts:5`) — `authenticate.ts` already returns the verified payload; thread it into context (other authed handlers show the pattern). (2) In `toggle.ts`/`user-likes.ts`, derive `userAccountId` from the token's context, keep body value only as a cross-check during transition. (3) Frontend: find the like-calling code and confirm it already attaches the Forge invocation token (the custom-content calls do); if not, add it.
Gotchas: **deployed old clients** — Forge frontends update on release but cached iframes linger; consider one release where auth failure is logged-not-rejected, then enforce. Keep `isNewDiagram` early-return (`toggle.ts:14-18`) intact. Add the M0.3 characterization tests *before* the change and flip the auth assertions after.

**M0.1 CI quality gates.**
Approach: add a `quality` job parallel to `build` in `build-test-deploy.yml`: `pnpm lint --max-warnings=141` (ratchet number down over time) and `pnpm typecheck` (new script: `vue-tsc --noEmit`).
Gotchas: first `vue-tsc` run will surface a backlog (it's never been run in CI; `vue-tsc` 1.8 is old against TS 5.x — may need a bump to vue-tsc ^2). If the backlog is large, scope the first gate via `tsconfig` `include` to `src/model`, `src/utils`, `functions/` and widen per-PR. Keep the job out of the E2E critical path so merge latency doesn't grow.

**M2.1 Shared editor lifecycle.**
Approach: characterize first — write a spec against the *current* `forge-graph-editor.ts` flows by extracting its functions un-renamed into `editorLifecycle.ts` (graph is the richest variant). Shape: `createEditorLifecycle({ diagramType, extractContent, applyContent, validate })` returning `{ load, saveAndExit, registerCloseGuard }`; ZEN-1170 recovery, legacy fallback, journey tracking, and the deferred `view.submit` timing live inside once. Then port swagger (delete its copy; the React mount stays — only lifecycle moves), then embed.
Gotchas: the **500ms deferred `view.submit` setTimeout** exists in all three with subtly different surroundings — diff carefully, it's load-bearing for Confluence config persistence. `window.diagram`/`window.graphXml` writes must keep exact timing until A4 is addressed — wrap, don't remove. Land as three PRs (one per editor), each gated on the full insert+edit E2E suite for that macro type; never combine.

---

## 6. Open Questions

1. **Diagram-likes: secure it or delete it?** Before spending M1.1, check Mixpanel/D1 for actual like activity. If usage is ~zero, deleting the feature (4 endpoints + table + UI) beats securing it — less code, same risk reduction.
2. **`functions/api/analytics/*` intent**: unreachable in production (not in `_routes.json`). Are these consumed only by local `wrangler pages dev` tooling / `forge-console`, or abandoned? Determines delete vs. route-and-gate.
3. **Who calls `/api/metrics/evaluation`?** Need the legitimate producer identified before locking it down (feature-flag SDK? frontend?).
4. **OpenAPI macro investment**: is the Swagger/OpenAPI macro a growth surface or maintenance-mode? Decides whether swagger-editor v4 + React 17 (X2, A5) is "contained risk, leave it" or a planned migration.
5. **`@vue/compat` removal timing**: the handoff doc exists in `docs/analysis/` — is anything besides Vuex helpers still using compat-mode APIs? (If only Vuex `mapState` helpers, the removal is much smaller than feared.)
6. **`/uninstalled` optional auth**: how many legacy-Connect-era installs still hit it without a JWT? If zero in the last 90 days (D1 can answer), close the bypass.
7. **Coverage ratchet floor**: what baseline does the team accept as the never-go-below number after the first `--coverage` run?

---

*Verification basis: 666/666 unit tests pass (84 files, 49.6s) and `pnpm lint` = 0 errors / 141 warnings, run in this worktree on 2026-06-10. All Critical/High findings re-verified by direct file reads; two agent claims (committed secret, dead AtlasDocExample1.js) refuted and corrected above.*
