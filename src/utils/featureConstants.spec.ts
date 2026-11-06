// @vitest-environment node
//
// esbuild (invoked below via Vite's transformWithEsbuild) asserts
// `new TextEncoder().encode('') instanceof Uint8Array` and refuses to run if
// it's false. The suite's default jsdom/happy-dom environment patches
// TextEncoder in a way that breaks that invariant. Running this file under
// the plain `node` environment avoids the patched global.
import { describe, expect, it } from 'vitest';
import { transformWithEsbuild } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Regression test for a real defect found in the 2026-08-19 overnight
 * verification run: vite.config.mjs's `define` block sets
 * VITE_SECOND_DIAGRAM_PROMPT_ENABLED to `JSON.stringify(<boolean>)`. Vite's
 * `define` substitutes that value TEXTUALLY, so `JSON.stringify(true)`
 * becomes the source token `true` (a boolean literal) — never the quoted
 * string `"true"`.
 *
 * The previous implementation compared with `=== 'true'` (a string), which
 * compiles to `true === 'true'` when the constant is flipped ON — always
 * `false`. The guard could never be true no matter how the constant was
 * set. This was invisible to every other spec in this suite because
 * SecondDiagramPrompt.spec.ts mocks `isSecondDiagramPromptEnabled` directly
 * (see that file's top-of-file comment) — none of them exercise the actual
 * `import.meta.env` comparison against the real shape `define` produces.
 *
 * This test can't just import the module and flip an env var: featureConstants.ts's
 * own doc comment explains why (vitest bakes the same `define` literal as
 * `pnpm build:*`, so nothing at runtime can un-bake it). Instead it runs the
 * REAL transform (`vite`'s `transformWithEsbuild`, the same engine `vite
 * build` uses) against the actual source file, passing a `define` map
 * shaped exactly like vite.config.mjs's — `JSON.stringify(<boolean>)` — so
 * this test fails the same way a real `pnpm build:lite` with the constant
 * flipped ON would fail, and would have caught this defect before it ever
 * reached a deploy.
 */
describe('isSecondDiagramPromptEnabled — define contract', () => {
  const source = readFileSync(path.join(__dirname, 'featureConstants.ts'), 'utf-8');

  async function transformWithDefine(enabled: boolean) {
    const { code } = await transformWithEsbuild(source, 'featureConstants.ts', {
      loader: 'ts',
      // Mirrors vite.config.mjs's define entry verbatim: JSON.stringify(<boolean>).
      define: {
        'import.meta.env.VITE_SECOND_DIAGRAM_PROMPT_ENABLED': JSON.stringify(enabled),
      },
    });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    return mod.isSecondDiagramPromptEnabled() as boolean;
  }

  it('resolves true when define bakes in the boolean literal `true` (vite.config.mjs\'s documented ON procedure)', async () => {
    expect(await transformWithDefine(true)).toBe(true);
  });

  it('resolves false when define bakes in the boolean literal `false` (the committed default)', async () => {
    expect(await transformWithDefine(false)).toBe(false);
  });
});
