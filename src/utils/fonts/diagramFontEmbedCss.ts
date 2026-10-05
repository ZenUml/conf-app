// @font-face CSS for html-to-image's `fontEmbedCSS`, so PNG exports use the
// same IBM Plex Sans the on-screen diagram was laid out with.
//
// Exports run with `skipFonts: true`, and the capture SVG is rasterised through
// an <img>, which cannot see the page's FontFace registrations. Without the
// face inside the SVG the text falls back to Helvetica while layout used Plex
// widths. A `data:` font inside an SVG image is not blocked by the page CSP.
//
// The woff2 stays a separate hashed asset (same URL as ensureHostedDiagramFont,
// so the fetch is an HTTP-cache hit); it is only base64-encoded at export time.
import plexUrl from '@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2?url';
import { getDiagramFontState } from './diagramFontState';

let pending: Promise<string | undefined> | undefined;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function build(): Promise<string | undefined> {
  try {
    const res = await fetch(plexUrl);
    if (!res.ok) return undefined;
    const b64 = toBase64(await res.arrayBuffer());
    return `@font-face{font-family:"IBM Plex Sans";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:400;font-style:normal}`;
  } catch {
    return undefined;
  }
}

/** Undefined unless the hosted face loaded; never rejects. Memoised once the face is known loaded. */
export function getDiagramFontEmbedCss(): Promise<string | undefined> {
  if (getDiagramFontState() !== 'plex') return Promise.resolve(undefined);
  pending ??= build();
  return pending;
}

export function _resetDiagramFontEmbedCssForTesting(): void {
  pending = undefined;
}
