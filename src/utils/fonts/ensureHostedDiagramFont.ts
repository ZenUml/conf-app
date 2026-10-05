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
// Registered as a CSS `@font-face` rule (a <style data-diagram-font> element),
// not via the FontFace API, on purpose: html-to-image only discovers fonts from
// `@font-face` rules in document.styleSheets (it never reads document.fonts),
// so PNG exports run with `skipFonts: false` and embed this same woff2 as a
// data: URL. `plexUrl` is the Vite asset URL, possibly relative (`base: './'`);
// a <style> in the document resolves it against the document base.
//
// Must therefore resolve BEFORE the first zenuml.render().
import plexUrl from '@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2?url';
import { setDiagramFontState, type DiagramFontValue } from './diagramFontState';

export const FONT_LOAD_TIMEOUT_MS = 1500;

const FAMILY = 'IBM Plex Sans';

let pending: Promise<DiagramFontValue> | undefined;
let styleEl: HTMLStyleElement | undefined;

function removeStyle(): void {
  styleEl?.remove();
  styleEl = undefined;
}

function hasLoadedFace(): boolean {
  for (const face of document.fonts as unknown as Iterable<FontFace>) {
    if (face.family.replace(/^["']|["']$/g, '') === FAMILY && face.status === 'loaded') return true;
  }
  return false;
}

async function load(): Promise<DiagramFontValue> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    return 'fallback';
  }
  try {
    const el = document.createElement('style');
    el.setAttribute('data-diagram-font', '');
    el.textContent =
      `@font-face{font-family:"${FAMILY}";src:url(${plexUrl}) format("woff2");font-weight:400;font-style:normal}`;
    document.head.appendChild(el);
    styleEl = el;
    await document.fonts.load(`16px "${FAMILY}"`);
    // The timeout removes the element; a late success must not switch fonts mid-session.
    if (styleEl !== el || !hasLoadedFace()) {
      if (styleEl === el) removeStyle();
      return 'fallback';
    }
    return 'plex';
  } catch {
    removeStyle();
    return 'fallback';
  }
}

/**
 * Idempotent, memoised, never rejects. Resolves 'plex' once the hosted face is
 * loaded, or 'fallback' on any failure or after FONT_LOAD_TIMEOUT_MS.
 */
export function ensureHostedDiagramFont(): Promise<DiagramFontValue> {
  if (pending) return pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DiagramFontValue>((resolve) => {
    timer = setTimeout(() => {
      removeStyle();
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
  removeStyle();
}
