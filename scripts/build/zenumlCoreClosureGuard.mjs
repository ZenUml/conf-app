// Build guard: the 3.5 MB @zenuml/core renderer chunk must load only on demand.
//
// It fails the build when an entry chunk or a lazily loaded chunk (the editor's
// `Workspace`, each viewer) reaches the renderer through static imports. The
// one allowed static importer is @mermaid-js/mermaid-zenuml's diagram
// definition, which Mermaid itself loads lazily for a `zenuml` diagram.
//
// What it protects: vite.config.mjs drops @zenuml/codemirror-extensions'
// linter module (which imports all of core) by its package-private path. If a
// release renames that file, the rule stops matching and core would silently
// return to every editor's eager imports; this check fails instead.

const CORE_MODULE = /[/\\]@zenuml[/\\]core[/\\]dist[/\\]zenuml\.esm\.m?js$/;
const ALLOWED_IMPORTER = /[/\\]@mermaid-js[/\\]mermaid-zenuml[/\\]/;

export function findZenumlCoreClosureViolations(bundle) {
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const coreChunks = new Set(
    chunks.filter((c) => Object.keys(c.modules || {}).some((id) => CORE_MODULE.test(id))).map((c) => c.fileName),
  );
  if (coreChunks.size === 0) return [];
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const reachesCore = (start) => {
    const seen = new Set();
    const stack = [...(start.imports || [])];
    while (stack.length) {
      const name = stack.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      if (coreChunks.has(name)) return true;
      stack.push(...(byName.get(name)?.imports || []));
    }
    return false;
  };
  return chunks
    .filter((c) => (c.isEntry || c.isDynamicEntry) && !coreChunks.has(c.fileName))
    .filter((c) => !ALLOWED_IMPORTER.test(c.facadeModuleId || ''))
    .filter(reachesCore)
    .map((c) => c.fileName);
}

export function zenumlCoreClosureGuard() {
  return {
    name: 'zenuml-core-closure-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const violations = findZenumlCoreClosureViolations(bundle);
      if (violations.length > 0) {
        this.error(
          `@zenuml/core's renderer is statically imported by: ${violations.join(', ')}. ` +
            'It must load on demand (dynamic import). If @zenuml/codemirror-extensions was upgraded, ' +
            'check the zenuml-linter treeshake rule in vite.config.mjs still matches its linter module.',
        );
      }
    },
  };
}
