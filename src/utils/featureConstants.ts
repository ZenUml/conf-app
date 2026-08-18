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
 */
export function isSecondDiagramPromptEnabled(): boolean {
  return import.meta.env.VITE_SECOND_DIAGRAM_PROMPT_ENABLED === 'true';
}
