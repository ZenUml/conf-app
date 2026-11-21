// Readies @zenuml/core before Mermaid draws a `zenuml` diagram.
//
// @mermaid-js/mermaid-zenuml calls core's synchronous `renderToSvg()`, which
// measures text with whatever font is loaded and draws only the participant
// icons already loaded (cloud icons such as `@VPC`/`@RDS` load on demand).
// The plugin resolves to the app's own @zenuml/core (pnpm override in
// package.json), so loading fonts and icons here reaches the same module
// instance the plugin renders with.
import { configureDiagramFonts } from '@/utils/fonts/configureDiagramFonts';

type ZenumlCore = {
  default: Parameters<typeof configureDiagramFonts>[0];
  ensureDiagramFontsLoaded(): Promise<void>;
  ensureDiagramIconsLoaded(code: string): Promise<void>;
};

// Mermaid detects the type after removing front matter and directives; the
// plugin's own detector is /^\s*zenuml/ on that remainder.
const ZENUML_SOURCE = /^\s*(?:---\r?\n[\s\S]*?\r?\n---\s*)?(?:%%.*(?:\r?\n|$)\s*)*zenuml\b/;

export function isZenumlMermaidSource(source: string): boolean {
  return ZENUML_SOURCE.test(source);
}

let fontsConfigured = false;

export async function prepareZenumlForMermaid(
  source: string,
  importCore: () => Promise<ZenumlCore> = () => import('@zenuml/core') as unknown as Promise<ZenumlCore>,
): Promise<void> {
  if (!isZenumlMermaidSource(source)) return;
  try {
    const core = await importCore();
    if (!fontsConfigured) {
      configureDiagramFonts(core.default);
      fontsConfigured = true;
    }
    // Both never reject (core contract); a missing icon falls back to its label.
    await Promise.all([core.ensureDiagramFontsLoaded(), core.ensureDiagramIconsLoaded(source)]);
  } catch {
    // Preparation is an enhancement; the plugin still renders without it.
  }
}

export function __resetPrepareZenumlForTests(): void {
  fontsConfigured = false;
}
