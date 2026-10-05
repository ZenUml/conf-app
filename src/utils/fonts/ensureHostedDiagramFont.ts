// Self-hosts IBM Plex Sans for the sequence diagram renderer.
//
// @zenuml/core sets `.zenuml { font-family: "IBM Plex Sans", Helvetica, ... }`
// and registers the face itself from a `data:` URL, awaited before each
// render. The Forge Custom UI CSP has `font-src 'self' <atlassian hosts>` and
// no `data:`, so that load is refused, core measures text with Helvetica, and
// it caches those widths and never retries. A same-origin woff2 is allowed, so
// we register the identical face (byte-for-byte the file core embeds) first;
// core then finds the family already loaded and measures with it.
//
// Must therefore resolve BEFORE the first zenuml.render().
import plexUrl from '@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2?url';
import { setDiagramFontState, type DiagramFontValue } from './diagramFontState';

export const FONT_LOAD_TIMEOUT_MS = 1500;

let pending: Promise<DiagramFontValue> | undefined;
let timedOut = false;

async function load(): Promise<DiagramFontValue> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    return 'fallback';
  }
  try {
    const face = new FontFace('IBM Plex Sans', `url(${plexUrl}) format('woff2')`, {
      weight: '400',
      style: 'normal',
    });
    const loaded = await face.load();
    if (timedOut) return 'fallback';
    document.fonts.add(loaded);
    return 'plex';
  } catch {
    return 'fallback';
  }
}

/**
 * Idempotent, memoised, never rejects. Resolves 'plex' once the hosted face is
 * registered, or 'fallback' on any failure or after FONT_LOAD_TIMEOUT_MS.
 */
export function ensureHostedDiagramFont(): Promise<DiagramFontValue> {
  if (pending) return pending;
  timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DiagramFontValue>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve('fallback');
    }, FONT_LOAD_TIMEOUT_MS);
  });
  pending = Promise.race([load(), timeout]).then((value) => {
    clearTimeout(timer);
    setDiagramFontState(value);
    return value;
  });
  return pending;
}

export function _resetForTesting(): void {
  pending = undefined;
  timedOut = false;
}
