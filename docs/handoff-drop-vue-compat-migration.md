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

## Baseline measurements

_Populated by Stage 1._

| Metric | full | lite | diagramly |
|---|---|---|---|
| Cold build median | tbd | tbd | tbd |
| Module count | tbd | tbd | tbd |
| Dist files | tbd | tbd | tbd |
| Dist size | tbd | tbd | tbd |
| Top 5 chunks (lite) | tbd | — | — |
| Compat warnings observed | tbd | — | — |

## Compat usage inventory

_Populated by Stage 2._

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
| 2026-05-07 | — | Doc + branch created |
