/**
 * Render PlantUML in the viewer's own browser with @plantuml/core (ADR-0010).
 *
 * WHY. Every other PlantUML path sends the diagram source to www.plantuml.com,
 * a third party, in the URL of a GET (deflate is an encoding, not encryption).
 * This engine is the official PlantUML build compiled to JavaScript: the source
 * never leaves the iframe.
 *
 * Three decisions are load-bearing, all measured in the ADR's spike:
 *
 *  - viz-global.js (Graphviz as WebAssembly) is NOT loaded. Under a CSP without
 *    'wasm-unsafe-eval' (the Full and Diagramly manifests grant neither that
 *    nor 'unsafe-eval'; Lite grants 'unsafe-eval'), loading it turns class
 *    diagrams into PlantUML's "An error has occurred!" crash page.
 *    Without it the engine lays out with Smetana, its built-in Java port of
 *    Graphviz, and class diagrams render under `script-src 'self'`.
 *  - PLANTUML_STDLIB_BASE is left unset and PLANTUML_STDLIB_LOADER answers
 *    instead (./stdlib.ts): a library we host (C4) arrives as data from our
 *    own chunk; any other `!include <lib/...>` gets "cannot include" rather
 *    than a fetch to plantuml.github.io, which would just be a different third
 *    party. URL and local-file includes fail the same way: the engine has no
 *    network access of its own.
 *  - The engine measures text with a canvas, so it needs a real browser:
 *    jsdom cannot run it, and unit tests mock this module's import.
 *
 * A syntax error is not a failure here: the engine draws it as an SVG carrying
 * "Syntax Error?" and "[From textarea (line N)]", the same markers the server's
 * SVG had, and validate.ts reads them unchanged.
 */
import type { PlantUmlLocalFailureReason, PlantUmlUnresolvedInclude } from '@/utils/analytics/catalog';
import { installPlantUmlStdlibLoader } from './stdlib';

export class PlantUmlLocalRenderError extends Error {
  constructor(
    public readonly reason: PlantUmlLocalFailureReason,
    message: string,
    /** For reason=include: which kind of include the engine could not resolve. */
    public readonly unresolvedInclude?: PlantUmlUnresolvedInclude,
  ) {
    super(message);
    this.name = 'PlantUmlLocalRenderError';
  }
}

type RenderToString = (
  lines: string[],
  onSuccess: (svg: string) => void,
  onError: (message: string) => void,
) => void;

let engine: Promise<RenderToString> | null = null;

function loadEngine(): Promise<RenderToString> {
  installPlantUmlStdlibLoader();
  engine ??= import('@plantuml/core').then(
    (m) => m.renderToString as RenderToString,
    (err) => {
      engine = null; // a failed chunk load may succeed on the next render
      throw new PlantUmlLocalRenderError('load_failed', `PlantUML engine failed to load: ${err?.message ?? err}`);
    },
  );
  return engine;
}

// Optional data the engine reads from globals, each loaded only when the
// source asks for it: themes.js alone is 320 KB, emoji.js 1.8 MB.
const OPTIONAL_DATA: ReadonlyArray<[RegExp, () => Promise<unknown>]> = [
  [/^\s*!theme\b/m, () => import('@plantuml/core/themes.js')],
  [/<&[\w-]+>/, () => import('@plantuml/core/openiconic.js')],
  [/<:[\w-]+:>/, () => import('@plantuml/core/emoji.js')],
];

async function loadOptionalData(code: string): Promise<void> {
  await Promise.all(OPTIONAL_DATA.filter(([needs]) => needs.test(code)).map(([, load]) => load()));
}

// PlantUML's crash page and its unresolved-include message are both drawn as a
// "successful" SVG; they are failures of this renderer, not of the diagram.
// Every error page carries the `[From textarea (line N)]` header, so a label
// that merely says "cannot include" is not mistaken for one.
const CRASH_MARKER = 'An error has occurred!';
const ERROR_PAGE_MARKER = /\[From textarea \(line \d+\)/;
const INCLUDE_MARKER = /cannot include\b/;
// What follows "cannot include": `&lt;lib/...&gt;` in the SVG's escaped text, a
// URL, or a file path.
const UNRESOLVED_KIND = /cannot include\s+(&lt;|<|https?:\/\/)?/;

function unresolvedKind(svg: string): PlantUmlUnresolvedInclude {
  const opener = UNRESOLVED_KIND.exec(svg)?.[1];
  if (opener === '&lt;' || opener === '<') return 'stdlib';
  if (opener) return 'url';
  return 'local';
}

function classify(svg: string): string {
  if (svg.includes(CRASH_MARKER)) {
    throw new PlantUmlLocalRenderError('engine_error', 'The PlantUML engine crashed on this diagram');
  }
  if (ERROR_PAGE_MARKER.test(svg) && INCLUDE_MARKER.test(svg)) {
    throw new PlantUmlLocalRenderError(
      'include', 'This diagram uses an !include library that is not available yet', unresolvedKind(svg));
  }
  return svg;
}

// Validation and render ask for the same source moments apart (validate, then
// the viewer's render). Share one engine run: in-flight renders are joined and
// a result is reused briefly. A failure is not kept.
const RESULT_TTL_MS = 5000;
const renders = new Map<string, { svg: Promise<string>; at: number }>();

export function renderPlantUmlLocally(code: string): Promise<string> {
  const source = code.trim();
  const now = Date.now();
  for (const [key, entry] of renders) {
    if (now - entry.at >= RESULT_TTL_MS) renders.delete(key);
  }
  const cached = renders.get(source);
  if (cached) return cached.svg;

  const svg = (async () => {
    const [renderToString] = await Promise.all([loadEngine(), loadOptionalData(source)]);
    const raw = await new Promise<string>((resolve, reject) => {
      renderToString(source.split('\n'), resolve, (message) =>
        reject(new PlantUmlLocalRenderError('engine_error', `PlantUML engine error: ${message}`)));
    });
    return classify(raw);
  })();
  renders.set(source, { svg, at: now });
  svg.catch(() => renders.delete(source));
  return svg;
}

/** Test hook: forget shared results and the loaded engine. */
export function resetPlantUmlEngine(): void {
  renders.clear();
  engine = null;
}
