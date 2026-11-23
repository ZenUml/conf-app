import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs build helper without types
import { findZenumlCoreClosureViolations } from '../../scripts/build/zenumlCoreClosureGuard.mjs';

const CORE = '/repo/node_modules/.pnpm/@zenuml+core@4.13.1/node_modules/@zenuml/core/dist/zenuml.esm.mjs';
const MERMAID_DEFINITION =
  '/repo/node_modules/.pnpm/@mermaid-js+mermaid-zenuml@1.0.0/node_modules/@mermaid-js/mermaid-zenuml/dist/chunks/mermaid-zenuml.core/zenuml-definition-ZCSB3OVJ.mjs';
const WORKSPACE = '/repo/src/components/Workspace.vue';

type Opts = { imports?: string[]; modules?: string[]; isEntry?: boolean; isDynamicEntry?: boolean; facade?: string };
function chunk(fileName: string, opts: Opts = {}) {
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

const core = chunk('assets/zenuml.esm-abc.js', { modules: [CORE], isDynamicEntry: true, facade: CORE });
const mermaidDefinition = chunk('assets/zenuml-definition-x.js', {
  imports: [core.fileName],
  isDynamicEntry: true,
  facade: MERMAID_DEFINITION,
});

describe('findZenumlCoreClosureViolations', () => {
  it('accepts a bundle where the renderer loads only on demand', () => {
    const shared = chunk('assets/shared.js');
    const workspace = chunk('assets/Workspace-1.js', { imports: [shared.fileName], isDynamicEntry: true, facade: WORKSPACE });
    const entry = chunk('assets/index-1.js', { isEntry: true, imports: [shared.fileName] });
    expect(findZenumlCoreClosureViolations(bundleOf(core, mermaidDefinition, workspace, shared, entry))).toEqual([]);
  });

  it('flags the editor when the codemirror linter brings core back through a shared chunk', () => {
    const linter = chunk('assets/zenuml-linter.js', { imports: [core.fileName] });
    const workspace = chunk('assets/Workspace-1.js', { imports: [linter.fileName], isDynamicEntry: true, facade: WORKSPACE });
    expect(findZenumlCoreClosureViolations(bundleOf(core, linter, workspace))).toEqual([
      'assets/Workspace-1.js statically imports the renderer',
    ]);
  });

  it('flags an entry chunk that imports core statically', () => {
    const entry = chunk('assets/index-1.js', { isEntry: true, imports: [core.fileName] });
    expect(findZenumlCoreClosureViolations(bundleOf(core, entry))).toEqual(['assets/index-1.js statically imports the renderer']);
  });

  it('fails when no chunk contains the renderer module (core renamed its dist file)', () => {
    const renamed = chunk('assets/zenuml-abc.js', {
      modules: ['/repo/node_modules/@zenuml/core/dist/zenuml.renamed.mjs'],
      isDynamicEntry: true,
    });
    const problems = findZenumlCoreClosureViolations(bundleOf(renamed));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no chunk contains @zenuml\/core/);
  });

  it('flags core folded into the editor chunk itself', () => {
    const workspace = chunk('assets/Workspace-1.js', { modules: [WORKSPACE, CORE], isDynamicEntry: true, facade: WORKSPACE });
    expect(findZenumlCoreClosureViolations(bundleOf(workspace))).toEqual([
      'assets/Workspace-1.js bundles the renderer into its own chunk',
    ]);
  });

  it('flags core folded into an entry chunk', () => {
    const entry = chunk('assets/index-1.js', { modules: ['/repo/src/forgeIndex.ts', CORE], isEntry: true });
    expect(findZenumlCoreClosureViolations(bundleOf(entry))).toEqual(['assets/index-1.js bundles the renderer into its own chunk']);
  });

  it('allows only the mermaid-zenuml definition chunk, not the rest of that package', () => {
    const detector = chunk('assets/mermaid-zenuml-core.js', {
      imports: [core.fileName],
      isDynamicEntry: true,
      facade: '/repo/node_modules/@mermaid-js/mermaid-zenuml/dist/mermaid-zenuml.core.mjs',
    });
    expect(findZenumlCoreClosureViolations(bundleOf(core, mermaidDefinition, detector))).toEqual([
      'assets/mermaid-zenuml-core.js statically imports the renderer',
    ]);
  });
  it("allows core's own lazily loaded parts to import the renderer chunk", () => {
    const icons = chunk('assets/cloud-icons-abc.js', {
      imports: [core.fileName],
      isDynamicEntry: true,
      facade: '/repo/node_modules/.pnpm/@zenuml+core@4.13.1/node_modules/@zenuml/core/dist/cloud-icons-w-sGmXgI.js',
    });
    expect(findZenumlCoreClosureViolations(bundleOf(core, icons))).toEqual([]);
  });

  it('still flags an entry chunk even if its facade is a core file', () => {
    const entry = chunk('assets/index-1.js', {
      isEntry: true,
      imports: [core.fileName],
      facade: '/repo/node_modules/@zenuml/core/dist/cloud-icons-x.js',
    });
    expect(findZenumlCoreClosureViolations(bundleOf(core, entry))).toEqual(['assets/index-1.js statically imports the renderer']);
  });
});
