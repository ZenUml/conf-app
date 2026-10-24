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

/** Install the loader before the engine's first render. Idempotent. */
export function installPlantUmlStdlibLoader(): void {
  (globalThis as StdlibGlobals).PLANTUML_STDLIB_LOADER = plantumlStdlibLoader;
}
