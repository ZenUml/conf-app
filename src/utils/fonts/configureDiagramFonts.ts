// Points @zenuml/core at the diagram font files this app serves itself.
//
// Core's own `data:` font load is refused by the Forge CSP, so without these
// URLs text is measured with fallback metrics. Core awaits the font inside
// `render()` and clears its width cache once it arrives, so callers only need
// to configure the URLs before the first render. The woff2/ttf stay separate
// hashed assets (core's licence files ship beside them in dist/fonts/).
import plexUrl from '@zenuml/core/fonts/IBMPlexSans-Regular-Latin1.woff2?url';
import msSansUrl from '@zenuml/core/fonts/MS-Sans-Serif.ttf?url';

type FontConfigurable = {
  setDiagramFontUrl(url: string | null, family?: 'IBM Plex Sans' | 'MS Sans Serif'): void;
};

export function configureDiagramFonts(zenUml: FontConfigurable): void {
  zenUml.setDiagramFontUrl(plexUrl);
  zenUml.setDiagramFontUrl(msSansUrl, 'MS Sans Serif');
}
