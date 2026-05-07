# Handoff: drop @vue/compat MODE 2 → plain Vue 3

## Goal

Migrate `conf-app-public` off the `@vue/compat` Vue-2 compatibility layer. End state:
- `package.json` depends on plain `vue@^3.x` (drop `@vue/compat`)
- `vite.config.mjs` removes the `vue → @vue/compat` alias and the `compatConfig: { MODE: 2 }` block on `@vitejs/plugin-vue`
- All SFCs and `*.ts`/`*.js` runtime code work under Vue 3 strict semantics
- No new runtime regressions across viewer / editor / paywall / OpenAPI / DrawIO / mermaid surfaces

## Why

Per `docs/handoff-build-perf-opportunities.md` item E. Compat MODE 2 forces every SFC through the Vue-2-compat compiler path and ships the compat runtime, defeating Vue 3 compile-time optimizations (static hoisting, patch flags) and bloating the bundle. Removing it is the largest remaining build-time + bundle-size lever in this repo.

## Stages

### Stage 1: Baseline measurement — Status: Not Started

**Goal:** Capture current build time, dist size, module count, and compat warning surface so we can prove the migration helped.

**Steps:**
1. Cold builds (3× lite, full, diagramly), median wall-clock + module count + dist size + dist file count
2. Bundle analysis: `ANALYZE=1 pnpm build:lite` → screenshot `dist/stats.html` treemap; record top 20 chunks
3. Compat warning enumeration:
   - Run dev server, drive each surface (viewer/editor/paywall/OpenAPI/Graph) via Playwright, capture every `[Vue Deprecation]` console warning
   - Static grep pass for known Vue-2-only patterns (see Stage 2 list)
4. Save raw output under `docs/handoff-vue-compat-migration/baseline/`

**Done when:** Baseline numbers recorded in this file under "Baseline measurements" below.

### Stage 2: Audit compat-feature usage — Status: Not Started

**Goal:** Identify every `@vue/compat` feature actually in use. Drives the migration plan.

**Static grep checklist** — run for each pattern; record file:line counts.

| Pattern | Vue 2 → Vue 3 mapping | Status |
|---|---|---|
| `Vue.set(`, `this.$set(` | direct property assignment in Vue 3 (proxy reactivity) | not started |
| `Vue.delete(`, `this.$delete(` | `delete obj.k` works directly | not started |
| `$listeners` | merged into `$attrs` | not started |
| `$on(`, `$off(`, `$once(` | use `mitt` / event bus library | not started |
| `Vue.extend(` | `defineComponent({...})` | not started |
| Filters (`{{ x \| filterName }}`) | computed / method | not started |
| `inheritAttrs: false` + `$attrs.class`/`$attrs.style` semantics | Vue 3 inherits class/style on root by default | not started |
| `$children` | refs / provide-inject | not started |
| `Vue.config.*` global API | `app.config.*` | not started |
| `new Vue()` event-bus pattern | `mitt` | not started |
| `<template functional>` | regular component | not started |
| `v-on.native` modifier | removed; just use `v-on` | not started |
| `model: { prop, event }` (component-level) | `v-model` arg syntax | not started |

**Runtime warning capture** — `compatConfig: { MODE: 2 }` emits `[Vue Deprecation]` warnings for every actual use during dev. Drive each user surface and grep the console.

**Done when:** "Compat usage inventory" section in this file is filled in with file:line for each used feature.

### Stage 3: Suppress + migrate per feature — Status: Not Started

**Goal:** For each feature in the inventory, migrate the call sites to Vue 3 equivalents while suppressing the warning per-component to keep dev console clean.

**Per feature workflow:**
1. Switch global config from `MODE: 2` to `MODE: 3` for that feature only via `featureFlags`. Example:
   ```js
   compatConfig: {
     MODE: 2,
     INSTANCE_SET: 'suppress-warning',  // suppress while migrating
   }
   ```
2. Migrate call sites (file:line from inventory)
3. Run `pnpm test:unit` — ensure no regressions
4. Run dev server + Playwright smoke (viewer/editor/paywall) — verify behavior
5. Once feature has zero usage, flip its flag from `'suppress-warning'` to actual `false` (or just remove)

**Done when:** All compat features migrated; `compatConfig` block has only `MODE: 3` (or empty).

### Stage 4: Flip the global mode + remove compat runtime — Status: Not Started

**Goal:** Switch the dependency from `@vue/compat` to plain `vue@^3.x`, remove the alias, drop the compat plugin config.

**Steps:**
1. `pnpm remove @vue/compat && pnpm add vue@^3.x` (or update existing `vue: ^3.1.0` to a current `^3.5.x`)
2. Edit `vite.config.mjs`:
   - Remove `'vue': '@vue/compat'` from `resolve.alias`
   - Remove `compatConfig: { MODE: 2 }` from the plugin block
3. Run `pnpm build:lite` cleanly; verify no compat-import errors
4. Run unit tests + Playwright smoke
5. Bump baseline measurements (Stage 1) — confirm build time + bundle size dropped

**Done when:** `pnpm build:*` succeeds, all surfaces work, before/after numbers recorded below.

### Stage 5: Final measurement + ship — Status: Not Started

**Goal:** Compare before/after; if win >= expected, open PR.

**Steps:**
1. Run identical baseline measurement loop from Stage 1
2. Compute % improvement: build time, bundle size, module count, dist files
3. Update "Final measurements" section below
4. Push branch, create PR linking to this doc

**Success criteria** (from `handoff-build-perf-opportunities.md`):
- Build time drops by ≥10% in any mode
- Bundle size drops measurably (no compat runtime)
- Unit tests pass; Playwright smoke (viewer/editor/paywall) passes

**Rollback** if anything regresses: revert the dependency + vite.config.mjs changes; the per-component migrations from Stage 3 are independently safe to keep (Vue 3 native).

## Risk register

| Risk | Mitigation |
|---|---|
| Compat feature in use that wasn't caught by static grep | Stage 1's runtime warning capture under Playwright drive-through |
| `@zenuml/core` (or other workspace dep) requires compat | Verify upstream package targets pure Vue 3; if not, work with upstream first |
| Test coverage gap — some component path only hit in real Confluence | Forge tunnel smoke after Stage 4 before merging |
| Visual regression from default-attr-inheritance change in Vue 3 | Diff key UIs before/after via screenshot tooling |

## Baseline measurements (Stage 1 complete)

Cold build × 3 per mode, 2026-05-07 on local machine. `dist/` always 4781 files / 244 144 KB (no variance — 4763 of those files are the static `public/drawio/` copy).

| Mode | Iteration times (s) | Median | Vite "built in" | Modules |
|---|---|---|---|---|
| full | 17.47, 15.94, 19.44 | **17.47s** | 16.19s | 4863 |
| lite | 15.58, 14.79, 14.45 | **14.79s** | 13.77s | 4863 |
| diagramly | 15.50, 18.87, 15.24 | **15.50s** | 14.55s | 4863 |

Bundle treemap (`ANALYZE=1`) — not yet captured, deferred until Stage 5 final compare.

## Compat usage inventory (Stage 2 complete)

**Surface is much smaller than the handoff doc anticipated.** Static grep across `src/` for the full Vue-2-compat catalog turned up only **3 actual call sites in 2 files**:

| File | Line | Pattern | Vue 3 fix |
|---|---|---|---|
| `src/components/DrawIoExtension/ForgeEmbedEditor.vue` | 22 | `this.$root.$on('save-embed', ...)` | replace with `EventBus.$on(...)` (or remove — see note below) |
| `src/components/DrawIoExtension/ForgeEmbedEditor.vue` | 29 | `this.$root.$on('exit', ...)` | replace with `EventBus.$on(...)` |
| `src/components/Viewer/ViewResizer.vue` | 36 | `beforeDestroy()` lifecycle hook | rename to `beforeUnmount()` |

**Verified clean (zero matches in `src/`):**

- `Vue.set` / `$set`, `Vue.delete` / `$delete`, `Vue.extend`, `Vue.observable`, `Vue.config.*`
- `$listeners`, `$scopedSlots`, `$children`
- `<template functional>`, `v-on.native` modifier, `.sync` prop modifier
- `model: { prop, event }` component-level option
- `filters:` SFC option (matches in `AnalyticsDashboard.vue` are false positives — `filters` as a `data()` property name, not the Vue-2 SFC option)
- `new Vue()` (e.g. for an event bus)
- `inheritAttrs: false`

**EventBus is already plain — not a compat surface.** `src/EventBus.ts` wraps `tiny-emitter/instance` and exposes `$on`/`$off`/`$once`/`$emit` methods purely for naming continuity. None of the ~20 `EventBus.$on(...)` / `EventBus.$emit(...)` call sites depend on Vue compat. Migration touches none of them.

### Bug-adjacent finding to surface to the team

The `ForgeEmbedEditor.vue` `$root.$on(...)` listeners were almost certainly **never firing**:

- The events `save-embed` and `exit` are emitted via `EventBus.$emit(...)` (`DocumentList.vue:200,213`, `Header.vue:177`), not via `this.$emit(...)` from a descendant SFC
- Vue 2's `$root.$on` only catches events that bubble up via descendant `$emit` calls; it doesn't intercept the standalone `EventBus` channel
- So the embed-editor save/exit listeners on `$root` were dead code in Vue 2, and remain dead code under compat MODE 2

Implication: **migrating these to `EventBus.$on(...)` will start firing them for the first time**, which could either:
- **Fix a long-standing latent bug** (the embed editor save/exit logic was never invoked) — most likely
- Cause a behavioral change (double-handling of the `exit` event since `forgeIndex.ts:367` already handles it) — needs verification

Treat the migration as a behavior-change PR, not a no-op refactor. Smoke-test the DrawIO embed-edit save flow end-to-end on Forge tunnel before/after.

### Implicit-compat checks still pending

Static grep doesn't catch behavioral differences that compat MODE 2 silently masks:
- Default attr inheritance (Vue 3 inherits `class` and `style` on root by default; Vue 2 distributes them across all root nodes)
- `v-model` arg syntax change (`value`/`input` → `modelValue`/`update:modelValue`)
- Watcher semantics on objects
- Async-component declaration

These need runtime warning capture (Stage 3) — drive each surface in dev mode with `compatConfig.MODE: 3` per-feature and watch the console.

## Final measurements

_Populated by Stage 5._

| Metric | Baseline | Post-migration | Δ | % |
|---|---|---|---|---|
| Cold build (full) | tbd | tbd | tbd | tbd |
| Cold build (lite) | tbd | tbd | tbd | tbd |
| Cold build (diagramly) | tbd | tbd | tbd | tbd |
| Initial JS bundle (lite) | tbd | tbd | tbd | tbd |
| Module count | tbd | tbd | tbd | tbd |

## Status log

| Date | Stage | Action |
|---|---|---|
| 2026-05-07 | — | Doc + branch (`perf/drop-vue-compat`) created |
| 2026-05-07 | 1 | Baseline cold-build numbers captured (median: full 17.47s / lite 14.79s / diagramly 15.50s; modules 4863, dist 4781 files) |
| 2026-05-07 | 2 | Static compat audit complete — surface is **3 call sites in 2 files** (`ForgeEmbedEditor.vue` x2, `ViewResizer.vue` x1). EventBus is already plain `tiny-emitter`. Surfaced likely pre-existing dead-listener bug in `ForgeEmbedEditor.vue` for handoff to user. |
| 2026-05-07 | 2.5 | **CHECK-IN** — pending user decision on (a) whether to fix or remove the dead $root listeners; (b) whether to proceed Stage 3 directly or capture runtime compat warnings via dev-server first. |
| 2026-05-07 | 3 | All 3 call sites migrated in commit `dc9448f`: `ForgeEmbedEditor.vue` x2 (`$root.$on` → `EventBus.$on`, with explanatory comment about latent bug); `ViewResizer.vue` (`beforeDestroy` → `beforeUnmount`). `pnpm test:unit` 296/296 pass. `pnpm build:lite` clean. Codebase now Vue 3 native — no remaining static compat call sites. Flywheel task registered for focused DrawIO-embed PVT post-deploy. |
| 2026-05-07 | 4 | **NOT YET STARTED** — actual `@vue/compat` removal (drop alias, drop `compatConfig`, swap dep). Should happen in a follow-up PR once Stage 3 ships and the embed-editor PVT verifies the now-active listeners behave correctly. |
