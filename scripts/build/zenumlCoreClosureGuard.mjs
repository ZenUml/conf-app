// Build guard: the 3.5 MB @zenuml/core renderer must load only on demand.
//
// It fails the build when:
// - no chunk contains the renderer module (a core upgrade renamed
//   `dist/zenuml.esm.mjs`, so this guard would otherwise check nothing);
// - an entry chunk contains the renderer, or a lazily loaded chunk that is not
//   the renderer's own (for example the editor's `Workspace`) contains it;
// - an entry or lazily loaded chunk reaches a renderer chunk through static
//   imports.
// Allowed static importers: @mermaid-js/mermaid-zenuml's diagram definition
// chunk, which Mermaid itself loads lazily for a `zenuml` diagram, and core's
// own lazily loaded parts (e.g. `dist/cloud-icons-*.js`), which only core
// imports and so only load after it.
//
// What it protects: vite.config.mjs drops @zenuml/codemirror-extensions'
// linter module (which imports all of core) by its package-private path. If a
// release renames that file, the rule stops matching and core would silently
// return to every editor's eager imports; this check fails instead.

const CORE_MODULE = /[/\\]@zenuml[/\\]core[/\\]dist[/\\]zenuml\.esm\.m?js$/;
const ALLOWED_IMPORTER =
  /[/\\]@mermaid-js[/\\]mermaid-zenuml[/\\]dist[/\\]chunks[/\\][^/\\]+[/\\]zenuml-definition-[^/\\]+\.mjs$/;

const CORE_PACKAGE = /[/\\]@zenuml[/\\]core[/\\]dist[/\\]/;

const containsCore = (chunk) => Object.keys(chunk.modules || {}).some((id) => CORE_MODULE.test(id));
const isLoadRoot = (chunk) => chunk.isEntry || chunk.isDynamicEntry;

/** Returns one message per problem; an empty array means the bundle is fine. */
export function findZenumlCoreClosureViolations(bundle) {
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const coreChunks = chunks.filter(containsCore);
  if (coreChunks.length === 0) {
    return ['no chunk contains @zenuml/core/dist/zenuml.esm.(m)js; update CORE_MODULE in this guard'];
  }
  const problems = [];
  const coreNames = new Set();
  for (const c of coreChunks) {
    const ownsCore = c.isDynamicEntry && !c.isEntry && CORE_MODULE.test(c.facadeModuleId || '');
    if (ownsCore) {
      coreNames.add(c.fileName);
    } else if (isLoadRoot(c)) {
      problems.push(`${c.fileName} bundles the renderer into its own chunk`);
    } else {
      // A shared chunk holding core; whoever imports it statically is flagged below.
      coreNames.add(c.fileName);
    }
  }
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const reachesCore = (start) => {
    const seen = new Set();
    const stack = [...(start.imports || [])];
    while (stack.length) {
      const name = stack.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      if (coreNames.has(name)) return true;
      stack.push(...(byName.get(name)?.imports || []));
    }
    return false;
  };
  for (const c of chunks) {
    if (!isLoadRoot(c) || coreNames.has(c.fileName)) continue;
    if (ALLOWED_IMPORTER.test(c.facadeModuleId || '')) continue;
    if (!c.isEntry && CORE_PACKAGE.test(c.facadeModuleId || '')) continue;
    if (reachesCore(c)) problems.push(`${c.fileName} statically imports the renderer`);
  }
  return problems;
}

export function zenumlCoreClosureGuard() {
  return {
    name: 'zenuml-core-closure-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const problems = findZenumlCoreClosureViolations(bundle);
      if (problems.length > 0) {
        this.error(
          `@zenuml/core's renderer must load on demand (dynamic import): ${problems.join('; ')}. ` +
            'If @zenuml/codemirror-extensions was upgraded, check the zenuml-linter treeshake rule in ' +
            'vite.config.mjs still matches its linter module.',
        );
      }
    },
  };
}
