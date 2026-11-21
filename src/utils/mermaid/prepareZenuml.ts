// Readies @zenuml/core before Mermaid draws a `zenuml` diagram.
//
// @mermaid-js/mermaid-zenuml calls core's synchronous `renderToSvg()`, which
// measures text with whatever font is loaded and draws only the participant
// icons already loaded (cloud icons such as `@VPC`/`@RDS` load on demand).
// The plugin resolves to the app's own @zenuml/core (pnpm override in
// package.json), so loading fonts and icons here reaches the same module
// instance the plugin renders with.
//
// This runs inside the Mermaid render queue, which every Mermaid render in the
// iframe shares, so every wait is bounded and a stalled fetch never holds up
// the renders queued behind it. Two budgets, because the two waits differ:
// - Importing core downloads the 3.5 MB renderer chunk. The plugin imports
//   that same chunk to draw, so a slow download delays this diagram either
//   way; the budget is long so slow connections still get icons.
// - Fonts and icons (`FontFace.load()`, icon fetches; core sets no timeout)
//   are small. Their budget starts once core is loaded. Past it the diagram
//   draws with fallback metrics and labels instead of icons.
import { configureDiagramFonts } from '@/utils/fonts/configureDiagramFonts';

type ZenumlCore = {
  default: Parameters<typeof configureDiagramFonts>[0];
  ensureDiagramFontsLoaded(): Promise<void>;
  ensureDiagramIconsLoaded(code: string): Promise<void>;
};

export const IMPORT_CORE_TIMEOUT_MS = 15000;
export const LOAD_ASSETS_TIMEOUT_MS = 3000;

// Mermaid detects the type after removing front matter and directives; the
// plugin's own detector is /^\s*zenuml/ on that remainder.
const ZENUML_SOURCE = /^\s*(?:---\r?\n[\s\S]*?\r?\n---\s*)?(?:%%.*(?:\r?\n|$)\s*)*zenuml\b/;

export function isZenumlMermaidSource(source: string): boolean {
  return ZENUML_SOURCE.test(source);
}

const TIMED_OUT = Symbol('timed out');

/** Resolves with the promise's value, or TIMED_OUT after `ms`. Never rejects. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise.catch(() => TIMED_OUT), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

let fontsConfigured = false;

export async function prepareZenumlForMermaid(
  source: string,
  importCore: () => Promise<ZenumlCore> = () => import('@zenuml/core') as unknown as Promise<ZenumlCore>,
): Promise<void> {
  if (!isZenumlMermaidSource(source)) return;
  let core: ZenumlCore | typeof TIMED_OUT;
  try {
    core = await within(importCore(), IMPORT_CORE_TIMEOUT_MS);
  } catch {
    return; // importCore threw synchronously; the plugin still renders.
  }
  if (core === TIMED_OUT) return;
  try {
    if (!fontsConfigured) {
      configureDiagramFonts(core.default);
      fontsConfigured = true;
    }
    // Both never reject (core contract); a missing icon falls back to its label.
    await within(Promise.all([core.ensureDiagramFontsLoaded(), core.ensureDiagramIconsLoaded(source)]), LOAD_ASSETS_TIMEOUT_MS);
  } catch {
    // Preparation is an enhancement; the plugin still renders without it.
  }
}

export function __resetPrepareZenumlForTests(): void {
  fontsConfigured = false;
}
