import * as htmlToImage from 'html-to-image';

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
  filter?: (node: Node) => boolean;
  skipFonts?: boolean;
  /** Defaults to `window.devicePixelRatio`, matching html-to-image. */
  pixelRatio?: number;
}

/** Keep interactive UI chrome out of both export previews and downloaded PNGs. */
export function filterExportCaptureNode(node: Node): boolean {
  return (node as Element).hasAttribute?.('data-export-exclude') !== true;
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

export async function captureBlob(
  node: HTMLElement,
  options: CaptureBlobOptions = {},
): Promise<Blob | null> {
  const svg = await htmlToImage.toSvg(node, options);
  const svgDataUrl = prepareSequenceCaptureSvg(svg, node);
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
