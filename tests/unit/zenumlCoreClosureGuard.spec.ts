import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs build helper without types
import { findZenumlCoreClosureViolations } from '../../scripts/build/zenumlCoreClosureGuard.mjs';

const CORE = '/repo/node_modules/.pnpm/@zenuml+core@4.13.1/node_modules/@zenuml/core/dist/zenuml.esm.mjs';

function chunk(fileName: string, opts: { imports?: string[]; modules?: string[]; isEntry?: boolean; isDynamicEntry?: boolean; facade?: string } = {}) {
  return {
    type: 'chunk',
    fileName,
    imports: opts.imports ?? [],
    modules: Object.fromEntries((opts.modules ?? []).map((id) => [id, {}])),
    isEntry: opts.isEntry ?? false,
    isDynamicEntry: opts.isDynamicEntry ?? false,
    facadeModuleId: opts.facade ?? null,
  };
}

const bundleOf = (...chunks: ReturnType<typeof chunk>[]) => Object.fromEntries(chunks.map((c) => [c.fileName, c]));

describe('findZenumlCoreClosureViolations', () => {
  const core = chunk('assets/zenuml.esm-abc.js', { modules: [CORE], isDynamicEntry: true, facade: CORE });
  const mermaidDefinition = chunk('assets/zenuml-definition-x.js', {
    imports: [core.fileName],
    isDynamicEntry: true,
    facade: '/repo/node_modules/@mermaid-js/mermaid-zenuml/dist/chunks/zenuml-definition.mjs',
  });

  it('accepts a bundle where the renderer loads only on demand', () => {
    const workspace = chunk('assets/Workspace-1.js', { imports: ['assets/shared.js'], isDynamicEntry: true, facade: '/repo/src/components/Workspace.vue' });
    const shared = chunk('assets/shared.js');
    const entry = chunk('assets/index-1.js', { isEntry: true, imports: ['assets/shared.js'] });
    expect(findZenumlCoreClosureViolations(bundleOf(core, mermaidDefinition, workspace, shared, entry))).toEqual([]);
  });

  it('flags the editor when the codemirror linter brings core back through a shared chunk', () => {
    const linter = chunk('assets/zenuml-linter.js', { imports: [core.fileName] });
    const workspace = chunk('assets/Workspace-1.js', { imports: [linter.fileName], isDynamicEntry: true, facade: '/repo/src/components/Workspace.vue' });
    expect(findZenumlCoreClosureViolations(bundleOf(core, linter, workspace))).toEqual(['assets/Workspace-1.js']);
  });

  it('flags an entry chunk that imports core statically', () => {
    const entry = chunk('assets/index-1.js', { isEntry: true, imports: [core.fileName] });
    expect(findZenumlCoreClosureViolations(bundleOf(core, entry))).toEqual(['assets/index-1.js']);
  });
});
