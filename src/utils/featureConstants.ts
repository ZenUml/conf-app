/**
 * Accessor functions for build-time feature constants.
 *
 * Why this file exists: constants read directly off `import.meta.env.*` are
 * statically replaced by esbuild/Vite's `define` block (vite.config.mjs) at
 * transform time, in BOTH `pnpm build:*` and `vitest --run` — vitest shares
 * the same `defineConfig` object, `define` included. `vi.stubEnv` only
 * overrides values looked up on `process.env`/`import.meta.env` at runtime;
 * it cannot un-bake a literal that the transform already inlined into the
 * compiled module. A spec that does `vi.stubEnv('VITE_X_ENABLED', 'true')`
 * against a component that reads `import.meta.env.VITE_X_ENABLED` directly
 * is therefore stubbing something the component never reads — the component
 * sees the baked-in literal from `define`, not the stub.
 *
 * The fix is a boundary: wrap each such constant in a function here, have
 * call sites call the function instead of reading `import.meta.env`
 * directly, and have specs `vi.mock('@/utils/featureConstants')` and
 * override the function's return value instead of stubbing env. That keeps
 * production behavior identical (still resolved from the real build-time
 * `define` value) while making the constant test-controllable.
 */

/**
 * Onboarding funnel — "second diagram" viewer prompt gate.
 * Defaults OFF (see vite.config.mjs's `define` block and
 * src/components/Viewer/SecondDiagramPrompt.vue for the full rationale).
 *
 * BUG FIXED 2026-08-19 (overnight verification run): vite.config.mjs's
 * `define` entry for this constant is `JSON.stringify(<boolean>)`
 * (`JSON.stringify(true)` / `JSON.stringify(false)`), which Vite substitutes
 * as the literal boolean token `true` / `false` — NOT the quoted string
 * `"true"` / `"false"`. The previous comparison here (`=== 'true'`) therefore
 * compiled to `true === 'true'` when the constant was flipped ON, which is
 * always `false`. The guard could never be true: flipping the vite.config.mjs
 * literal to `JSON.stringify(true)` per its own doc comment and rebuilding
 * never actually enabled the prompt. Confirmed by reading the built output
 * (`dist/assets/GenericViewer-*.js`), where the compiled accessor was
 * `function(){return!1}` — an unconditional `false` — even with the ON build.
 * Fixed by comparing against the boolean `true` to match what `define`
 * actually emits. See featureConstants.spec.ts for a regression test that
 * exercises both literal shapes the way `define` really produces them.
 */
export function isSecondDiagramPromptEnabled(): boolean {
  return import.meta.env.VITE_SECOND_DIAGRAM_PROMPT_ENABLED === true;
}
