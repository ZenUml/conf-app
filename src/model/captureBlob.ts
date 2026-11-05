import * as htmlToImage from 'html-to-image';
import { getDiagramFontState } from '../utils/fonts/diagramFontState';
import { awaitExternalIcons } from '../utils/graph/externalIconState';

/**
 * DOM -> PNG Blob, without html-to-image's `toBlob()`.
 *
 * WHY THIS EXISTS. `htmlToImage.toBlob()` never settles for a Forge macro whose
 * iframe is scrolled out of the top-level viewport, so the macro writes no
 * `zenuml-<ccId>.png` snapshot and every PDF export of that page prints
 * "Diagram image not yet generated...".
 *
 * The library's raster step is `createImage()` in
 * `node_modules/html-to-image/es/util.js`:
 *
 *     img.onload = () => { img.decode().then(() => {
 *       requestAnimationFrame(() => resolve(img));   // <- only resolve path
 *     }); };                                          // <- no rejection handler
 *
 * Two never-settling paths, both real:
 *  1. Chrome throttles the rendering lifecycle of a cross-origin iframe that is
 *     offscreen, and a throttled frame runs NO requestAnimationFrame callbacks.
 *     Every Forge macro below the fold is such a frame, so `resolve` is never
 *     reached. Measured on lite-stg 2026-08-19 with a CDP-injected probe: an
 *     offscreen macro frame ran 29 rAF callbacks in 33s and its capture never
 *     settled; a macro in the viewport on the same page ran 3,911 and captured
 *     in ~20ms. Timers keep running (throttled to ~1Hz), which is why the rest
 *     of the macro still works and only the capture hangs.
 *  2. `decode()` has no rejection handler, so a decode failure also leaves the
 *     promise pending forever.
 *
 * WHAT WE KEEP. `toSvg()` does the hard part — deep clone, inline every
 * computed style, embed images/pseudo-elements, serialise to an SVG data URL —
 * and none of it depends on the frame being rendered (layout still runs in a
 * throttled frame; the offscreen probe produced a correctly sized 734x150 SVG).
 * Only the final raster is reimplemented here: load the image, draw it, encode.
 * No animation frame is involved, and a decode failure degrades to "draw it
 * anyway" instead of hanging.
 */

export interface CaptureBlobOptions {
  backgroundColor?: string;
  skipFonts?: boolean;
  /** Overrides html-to-image's font embedding; filled with the hosted Plex face when omitted. */
  fontEmbedCSS?: string;
  /** Defaults to `window.devicePixelRatio`, matching html-to-image. */
  pixelRatio?: number;
}

/**
 * Remove only the opaque canvas/frame surfaces emitted by @zenuml/core.
 *
 * The source DOM is deliberately not touched: html-to-image has already
 * cloned and serialised it at this point. Participant fills, borders and
 * shadows use different classes and remain unchanged.
 */
export function prepareSequenceCaptureSvg(svg: string, source: HTMLElement): string {
  if (!source.matches('.zenuml') && !source.querySelector('.zenuml')) return svg;

  const comma = svg.indexOf(',');
  const isDataUrl = svg.startsWith('data:') && comma !== -1;
  const sourceMarkup = isDataUrl
    ? (svg.slice(0, comma).includes(';base64')
      ? atob(svg.slice(comma + 1))
      : decodeURIComponent(svg.slice(comma + 1)))
    : svg;

  const documentView = source.ownerDocument?.defaultView;
  const parser = documentView ? new documentView.DOMParser() : new DOMParser();
  const parsed = parser.parseFromString(sourceMarkup, 'image/svg+xml');
  const surfaces = parsed.querySelectorAll('.bg-skin-canvas, .bg-skin-frame');
  surfaces.forEach((surface) => {
    const style = surface.getAttribute('style') ?? '';
    const next = /(?:^|;)\s*background-color\s*:/i.test(style)
      ? style.replace(/background-color\s*:[^;]*/i, 'background-color: transparent')
      : `${style}${style && !style.trim().endsWith(';') ? ';' : ''}background-color: transparent;`;
    surface.setAttribute('style', next);
  });
  const serialised = new XMLSerializer().serializeToString(parsed);
  return isDataUrl ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised)}` : serialised;
}

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

async function fetchAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`captureBlob: image ${url} returned ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(`captureBlob: could not read image ${url}`));
    reader.readAsDataURL(blob);
  });
}

/**
 * Embed every `<image>` URL of a capture SVG as a data URL.
 *
 * An SVG drawn as an image cannot load external resources, so an un-embedded
 * icon comes out as a broken-image glyph. html-to-image means to embed them, but
 * it writes `href.baseVal`, and in Chromium that does not change the
 * `xlink:href` attribute that DrawIO emits, so the serialised SVG keeps the URL.
 * Rejects when an icon cannot be fetched: no PNG is better than a saved PNG with
 * a broken icon, which would never be captured again for the same content.
 */
export async function inlineCaptureSvgImages(svg: string): Promise<string> {
  const comma = svg.indexOf(',');
  const markup = decodeURIComponent(svg.slice(comma + 1));
  if (!markup.includes('<image')) return svg;

  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const hrefOf = (image: Element) => image.getAttributeNS(XLINK_NAMESPACE, 'href') ?? image.getAttribute('href') ?? '';
  const images = [...parsed.querySelectorAll('image')].filter((image) => {
    const href = hrefOf(image);
    return href && !href.startsWith('data:');
  });
  if (images.length === 0) return svg;

  const dataUrls = new Map(await Promise.all(
    [...new Set(images.map(hrefOf))].map(async (url) => [url, await fetchAsDataUrl(url)] as const),
  ));
  images.forEach((image) => {
    const dataUrl = dataUrls.get(hrefOf(image))!;
    image.removeAttribute('href');
    image.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', dataUrl);
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(parsed))}`;
}

// @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
const CANVAS_DIMENSION_LIMIT = 16384;

/**
 * Load an image URL, settling on EVERY outcome.
 *
 * `decode()` is best-effort: it makes the later `drawImage` synchronous-safe,
 * but a rejection must not block the capture — that is failure path 2 above.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(() => resolve(img), () => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error('captureBlob: capture SVG failed to load'));
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
  });
}

/** html-to-image's `getImageSize`: content box plus horizontal/vertical borders. */
function measure(node: HTMLElement): { width: number; height: number } {
  const win = node.ownerDocument?.defaultView ?? window;
  const px = (prop: string) => {
    const raw = win.getComputedStyle(node).getPropertyValue(prop);
    const n = raw ? parseFloat(raw.replace('px', '')) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  return {
    width: node.clientWidth + px('border-left-width') + px('border-right-width'),
    height: node.clientHeight + px('border-top-width') + px('border-bottom-width'),
  };
}

/** html-to-image's `checkCanvasDimensions`: shrink proportionally past the cap. */
function clampCanvas(canvas: HTMLCanvasElement): void {
  const { width, height } = canvas;
  if (width <= CANVAS_DIMENSION_LIMIT && height <= CANVAS_DIMENSION_LIMIT) return;
  if (width > height) {
    canvas.height = Math.max(1, Math.round(height * (CANVAS_DIMENSION_LIMIT / width)));
    canvas.width = CANVAS_DIMENSION_LIMIT;
  } else {
    canvas.width = Math.max(1, Math.round(width * (CANVAS_DIMENSION_LIMIT / height)));
    canvas.height = CANVAS_DIMENSION_LIMIT;
  }
}

/** Core's data-URI Plex face, only when the hosted face loaded; never rejects. The core chunk is already cached by then. */
async function getDiagramFontEmbedCss(): Promise<string | undefined> {
  if (getDiagramFontState() !== 'plex') return undefined;
  try {
    return await (await import('@zenuml/core')).getDiagramFontFaceCss();
  } catch {
    return undefined;
  }
}

export async function captureBlob(
  node: HTMLElement,
  options: CaptureBlobOptions = {},
): Promise<Blob | null> {
  // A Graph diagram whose icons come through the backend proxy is not captured
  // until they have loaded, and not at all when they could not: an SVG drawn as
  // an image cannot fetch them, and a PNG saved with broken icons is never
  // captured again for the same content. Diagrams without such icons skip this.
  await awaitExternalIcons(node.matches?.('[data-diagram-capture-root]') ? node : node.querySelector('[data-diagram-capture-root]'));
  // Every export path funnels through here. `fontEmbedCSS` takes priority over
  // `skipFonts` in html-to-image, so other web fonts stay un-embedded as before
  // while the hosted diagram font (the one layout was measured with) is kept.
  const fontEmbedCSS = options.fontEmbedCSS ?? (await getDiagramFontEmbedCss());
  const svg = await htmlToImage.toSvg(node, fontEmbedCSS ? { ...options, fontEmbedCSS } : options);
  const svgDataUrl = await inlineCaptureSvgImages(prepareSequenceCaptureSvg(svg, node));
  const img = await loadImage(svgDataUrl);

  const measured = measure(node);
  // naturalWidth/Height is the fallback for a node the layout reports as empty
  // (the serialised SVG still carries the size html-to-image computed).
  const width = measured.width || img.naturalWidth;
  const height = measured.height || img.naturalHeight;
  const ratio = options.pixelRatio || window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  clampCanvas(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('captureBlob: 2d canvas context unavailable');
  if (options.backgroundColor) {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 1);
  });
}

export default captureBlob;
