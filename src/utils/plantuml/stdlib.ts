/**
 * Serve the PlantUML standard library to the in-browser engine (ADR-0010).
 *
 * `!include <C4/C4_Context>` makes @plantuml/core ask for one bundle per
 * library (`c4.min.js`). Left alone, it would inject a script tag for it; with
 * PLANTUML_STDLIB_LOADER set, it asks this callback instead, and the library
 * arrives as data from our own lazy chunk: no script from another origin, no
 * request leaves the iframe. See ./stdlib/README.md for what is hosted and how
 * the JSON is produced.
 *
 * A library we do not host is declined with `err`, which the engine reports as
 * "cannot include"; engine.ts classifies that as an include failure and the
 * viewer falls back to the server for that one diagram.
 */

interface StdlibBundle {
  lib: string;
  files: Record<string, unknown>;
  json: Record<string, unknown>;
  info: unknown;
}

type Loader = (url: string, ok: () => void, err: (message: string) => void) => void;

/** Library id (the bundle's file name) → its lazily imported data. */
const HOSTED_LIBRARIES: Record<string, () => Promise<{ default: StdlibBundle }>> = {
  c4: () => import('./stdlib/c4.json') as Promise<{ default: StdlibBundle }>,
};

type StdlibGlobals = {
  PLANTUML_STDLIB_LOADER?: Loader;
  PLANTUML_STDLIB?: Record<string, unknown>;
  PLANTUML_STDLIB_JSON?: Record<string, unknown>;
  PLANTUML_STDLIB_INFO?: Record<string, unknown>;
};

function publish(bundle: StdlibBundle): void {
  const g = globalThis as StdlibGlobals;
  (g.PLANTUML_STDLIB ??= {})[bundle.lib] = bundle.files;
  (g.PLANTUML_STDLIB_JSON ??= {})[bundle.lib] = bundle.json;
  (g.PLANTUML_STDLIB_INFO ??= {})[bundle.lib] = bundle.info;
}

export const plantumlStdlibLoader: Loader = (url, ok, err) => {
  const lib = /([\w-]+)\.min\.js$/.exec(url)?.[1];
  const load = lib ? HOSTED_LIBRARIES[lib] : undefined;
  if (!load) {
    err(`PlantUML library not hosted: ${url}`);
    return;
  }
  load().then(
    (module) => { publish(module.default); ok(); },
    (error) => err(`PlantUML library ${lib} failed to load: ${error?.message ?? error}`),
  );
};

/**
 * GitHub URL includes of C4-PlantUML, rewritten to the hosted library.
 *
 * The engine has no network access and never hands a URL include to
 * PLANTUML_FILE_LOADER (measured: "cannot include" without a call), so
 * `!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml`
 * can only be honoured by rewriting it to `!include <C4/C4_Container>` before
 * rendering. Production uses exactly this form (ADR-0010: 105 such lines, all
 * `master`, five files). The rewrite is one line for one line, so line numbers
 * in error messages still match the author's source. Only top-level files the
 * hosted library has are rewritten; anything else is left for the fallback.
 *
 * The hosted copy is one release (see ./stdlib/README.md), while a URL may name
 * another ref. engine.ts treats a syntax error in a rewritten diagram as an
 * include failure, so a version mismatch falls back to the server, which
 * fetches the ref the author asked for.
 */
const C4_URL_INCLUDE = new RegExp(
  String.raw`^([ \t]*)!(include|include_once|include_many|includeurl)[ \t]+` +
  String.raw`https?://(?:raw\.githubusercontent\.com/plantuml-stdlib/C4-PlantUML|github\.com/plantuml-stdlib/C4-PlantUML/raw)` +
  String.raw`/(?:refs/(?:heads|tags)/)?[^/\s]+/(C4(?:_[A-Za-z]+)?)\.puml[ \t]*\r?$`,
  'gm',
);
const HOSTED_C4_FILES = new Set(['c4', 'c4_component', 'c4_container', 'c4_context', 'c4_deployment', 'c4_dynamic', 'c4_sequence']);

export function rewriteHostedIncludes(code: string): { source: string; rewritten: boolean } {
  let rewritten = false;
  const source = code.replace(C4_URL_INCLUDE, (line, indent: string, directive: string, file: string) => {
    if (!HOSTED_C4_FILES.has(file.toLowerCase())) return line;
    rewritten = true;
    // !includeurl has no library form; plain !include is its equivalent.
    const kept = directive === 'includeurl' ? 'include' : directive;
    return `${indent}!${kept} <C4/${file}>`;
  });
  return { source, rewritten };
}

/** Install the loader before the engine's first render. Idempotent. */
export function installPlantUmlStdlibLoader(): void {
  (globalThis as StdlibGlobals).PLANTUML_STDLIB_LOADER = plantumlStdlibLoader;
}
