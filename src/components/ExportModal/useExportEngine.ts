import { captureBlob } from '@/model/captureBlob';
import { saveAs } from 'file-saver';
import {
  VIEWBOX_REF_W,
  EDGE_PADDING,
  SANS_FONT_FAMILY,
  MONO_FONT_FAMILY,
  computeArrowheadPath,
  computeNotePosition,
  computeCalloutPath,
  CALLOUT_MAX_TEXT_WIDTH,
} from './overlayGeometry';
import type { Annotation } from './useAnnotations';
import { cropCanvasToBox, measureCaptureCrop } from './captureCrop';

export type RenderResult = { ok: true; blob: Blob } | { ok: false; reason: 'no_capture_node' | 'blob_null' };
export type ExportResult = { ok: true } | { ok: false; reason: 'no_capture_node' | 'blob_null' };
export type ClipboardExportResult = { ok: true } | { ok: false; reason: 'no_capture_node' | 'blob_null' | 'clipboard_denied' };

const MAX_FILENAME_LENGTH = 60;
const DEFAULT_FILENAME = 'zenuml-diagram-export.png';

export function slugifyFilename(title: string): string {
  const slug = (title ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/-+$/g, '');
  return slug ? `${slug}.png` : DEFAULT_FILENAME;
}

export function isClipboardExportSupported(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

export interface ExportOptions {
  background: string;
  note: {
    text: string;
    position: string;
    fontSize: number;
    color: string;
  };
  arrow: {
    type: string;
    label: string;
    color: string;
    thickness: number;
  };
  watermark?: {
    text: string;
    opacity: number;
    fontSize: number;
    color: string;
    position: 'diagonal' | 'bottom-right';
  } | null;
  callout?: {
    text: string;
    fontSize: number;
    color: string;
    bgColor: string;
    position: { x: number; y: number } | null;
    tipPosition: { x: number; y: number } | null;
  } | null;
  arrowPoints?: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
  notePoint?: { x: number; y: number } | null;
  annotations?: Annotation[];
}

function resolveBgColor(background: string): string | undefined {
  if (background === 'transparent') return undefined;
  if (background === 'white') return '#ffffff';
  if (background === 'warm') return '#fffbf0';
  if (background === 'cool') return '#f0f4ff';
  return background;
}

export function buildOverlaySvg(w: number, h: number, options: ExportOptions): string {
  const scale = w / VIEWBOX_REF_W;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  const shadowStd = 2 * scale;
  const shadowDy = 1 * scale;
  parts.push(`<defs><filter id="ds" x="-20%" y="-20%" width="140%" height="140%">`);
  parts.push(`<feDropShadow dx="0" dy="${shadowDy}" stdDeviation="${shadowStd}" flood-color="rgba(0,0,0,0.3)" flood-opacity="1"/>`);
  parts.push(`</filter></defs>`);

  if (options.annotations !== undefined) {
    for (const annotation of options.annotations) {
      appendAnnotation(parts, annotation, w, h, scale);
    }
  } else if (options.note.text) {
    let nx: number, ny: number, anchor: string;
    const fontSize = options.note.fontSize * scale;
    if (options.notePoint) {
      nx = options.notePoint.x * w;
      ny = options.notePoint.y * h;
      anchor = 'middle';
    } else {
      const pos = computeNotePosition(options.note.position, w, h, fontSize, EDGE_PADDING * scale);
      nx = pos.x;
      ny = pos.y;
      anchor = pos.anchor;
    }
    appendNote(parts, options.note.text, nx, ny, fontSize, options.note.color, anchor);
  }

  if (options.annotations === undefined && options.arrowPoints) {
    const pts = options.arrowPoints;
    appendArrow(parts, pts.start, pts.end, options.arrow.type, options.arrow.label, options.arrow.color, options.arrow.thickness, w, h, scale);
  }

  if (options.annotations === undefined && options.callout?.position && options.callout.text) {
    appendCallout(
      parts,
      options.callout.position,
      options.callout.tipPosition,
      options.callout.text,
      options.callout.fontSize,
      options.callout.color,
      options.callout.bgColor,
      w,
      h,
      scale,
    );
  }

  if (options.watermark?.text) {
    const escaped = escapeXml(options.watermark.text);
    const padding = 16 * scale;
    const diagonal = options.watermark.position === 'diagonal';
    const { fontSize, fitAttributes } = fitWatermark(
      options.watermark.text,
      options.watermark.fontSize * scale,
      diagonal,
      w,
      h,
      padding,
    );
    if (diagonal) {
      parts.push(`<text x="${w / 2}" y="${h / 2}" font-size="${fontSize}" fill="${options.watermark.color}" opacity="${options.watermark.opacity / 100}" font-family="${MONO_FONT_FAMILY}" font-weight="500" text-anchor="middle" dominant-baseline="central" transform="rotate(-45, ${w / 2}, ${h / 2})"${fitAttributes}>${escaped}</text>`);
    } else {
      parts.push(`<text x="${w - padding}" y="${h - padding}" font-size="${fontSize}" fill="${options.watermark.color}" opacity="${options.watermark.opacity / 100}" font-family="${MONO_FONT_FAMILY}" font-weight="500" text-anchor="end"${fitAttributes}>${escaped}</text>`);
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

/** Never shrink a watermark below this; past it, fit by compressing glyphs. */
const MIN_WATERMARK_FONT_SIZE = 8;
/** Cap height of a line, as a multiple of font size. */
const WATERMARK_LINE_HEIGHT = 1.2;

/**
 * Size a watermark so it fits inside the image it is stamped on.
 *
 * The diagonal watermark is drawn centred and rotated -45°, so its footprint is
 * not its text width: a string of length L and line height H occupies
 * (L + H)/√2 in BOTH axes. On a shallow, wide diagram that overflowed the top
 * and bottom edges, and the ends were silently cut off — "Internal review -
 * Confidential" lost characters at both ends, while the shorter default
 * "Confidential" happened to fit, which is why it went unnoticed.
 *
 * The fix keeps the whole string: shrink the font until the footprint fits, and
 * only if that would take it below MIN_WATERMARK_FONT_SIZE fall back to
 * compressing the glyphs via textLength. Nothing is ever clipped silently.
 */
export function fitWatermark(
  text: string,
  requestedFontSize: number,
  diagonal: boolean,
  w: number,
  h: number,
  padding: number,
): { fontSize: number; fitAttributes: string } {
  const available = diagonal
    // (L + H)/√2 <= min(w, h)/2 - padding, per axis, for a -45° rotation about
    // the centre; solved for L.
    ? Math.SQRT2 * (Math.min(w, h) - 2 * padding) - requestedFontSize * WATERMARK_LINE_HEIGHT
    : w - 2 * padding;
  if (available <= 0) return { fontSize: requestedFontSize, fitAttributes: '' };

  const measured = measureTextWidth(text, requestedFontSize, MONO_FONT_FAMILY);
  if (measured <= available) return { fontSize: requestedFontSize, fitAttributes: '' };

  const fontSize = Math.max(
    MIN_WATERMARK_FONT_SIZE,
    requestedFontSize * (available / measured),
  );
  const refit = measureTextWidth(text, fontSize, MONO_FONT_FAMILY);
  const fitAttributes = refit > available
    ? ` textLength="${roundSvgNumber(available)}" lengthAdjust="spacingAndGlyphs"`
    : '';
  return { fontSize: roundSvgNumber(fontSize), fitAttributes };
}

function appendAnnotation(
  parts: string[],
  annotation: Annotation,
  w: number,
  h: number,
  scale: number,
): void {
  if (annotation.type === 'note') {
    if (!annotation.text) return;
    const x = annotation.position.x * w;
    const y = annotation.position.y * h;
    const fontSize = annotation.fontSize * scale;
    appendNote(parts, annotation.text, x, y, fontSize, annotation.color, 'middle');
    return;
  }

  if (annotation.type === 'arrow') {
    appendArrow(parts, annotation.position, annotation.end, annotation.arrowType, annotation.text, annotation.color, annotation.thickness, w, h, scale);
    return;
  }

  if (annotation.type === 'rectangle') {
    const x = roundSvgNumber(Math.min(annotation.position.x, annotation.end.x) * w);
    const y = roundSvgNumber(Math.min(annotation.position.y, annotation.end.y) * h);
    const width = roundSvgNumber(Math.abs(annotation.end.x - annotation.position.x) * w);
    const height = roundSvgNumber(Math.abs(annotation.end.y - annotation.position.y) * h);
    const fill = annotation.bgColor || 'none';
    const strokeWidth = annotation.thickness * scale;
    parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${annotation.color}" stroke-width="${strokeWidth}"/>`);
    return;
  }

  if (annotation.type === 'callout') {
    if (!annotation.text) return;
    const hasTip = annotation.position.x !== annotation.end.x || annotation.position.y !== annotation.end.y;
    const tip = hasTip ? annotation.end : null;
    appendCallout(
      parts,
      annotation.position,
      tip,
      annotation.text,
      annotation.fontSize,
      annotation.color,
      annotation.bgColor || 'none',
      w,
      h,
      scale,
    );
  }
}

function appendNote(
  parts: string[],
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  anchor: string,
): void {
  parts.push(`<text x="${x}" y="${y}" font-size="${fontSize}" fill="${color}" font-family='${SANS_FONT_FAMILY}' font-weight="500" text-anchor="${anchor}" dominant-baseline="central" filter="url(#ds)">${escapeXml(text)}</text>`);
}

function appendArrow(
  parts: string[],
  start: { x: number; y: number },
  end: { x: number; y: number },
  type: string,
  label: string,
  color: string,
  thickness: number,
  w: number,
  h: number,
  scale: number,
): void {
  const sx = start.x * w;
  const sy = start.y * h;
  const ex = end.x * w;
  const ey = end.y * h;
  const angle = Math.atan2(ey - sy, ex - sx);
  const t = thickness * scale;

  parts.push(`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${t}" stroke-linejoin="round"/>`);

  const isLeftOnly = type === '←';
  const isDouble = type === '←→';
  if (!isLeftOnly) {
    parts.push(`<path d="${computeArrowheadPath(ex, ey, angle, t)}" fill="${color}" stroke="${color}" stroke-linejoin="round"/>`);
  }
  if (isDouble || isLeftOnly) {
    parts.push(`<path d="${computeArrowheadPath(sx, sy, angle + Math.PI, t)}" fill="${color}" stroke="${color}" stroke-linejoin="round"/>`);
  }

  if (label) {
    const midX = (sx + ex) / 2;
    const midY = (sy + ey) / 2;
    const labelOffset = 14 * scale;
    const perpX = -Math.sin(angle) * labelOffset;
    const perpY = Math.cos(angle) * labelOffset;
    const labelFontSize = (12 + thickness) * scale;
    parts.push(`<text x="${midX + perpX}" y="${midY + perpY}" font-size="${labelFontSize}" fill="${color}" font-family='${SANS_FONT_FAMILY}' text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>`);
  }
}

function appendCallout(
  parts: string[],
  position: { x: number; y: number },
  tip: { x: number; y: number } | null,
  text: string,
  fontSizeValue: number,
  color: string,
  bgColor: string,
  w: number,
  h: number,
  scale: number,
): void {
  const cx = position.x * w;
  const cy = position.y * h;
  const tipPx = tip ? { x: tip.x * w, y: tip.y * h } : null;
  const fontSize = fontSizeValue * scale;
  const textWidth = measureTextWidth(text, fontSize, SANS_FONT_FAMILY);
  const availableTextWidth = CALLOUT_MAX_TEXT_WIDTH * scale;
  const fitAttributes = textWidth > availableTextWidth
    ? ` textLength="${roundSvgNumber(availableTextWidth)}" lengthAdjust="spacingAndGlyphs"`
    : '';
  const calloutPath = computeCalloutPath(cx, cy, scale, tipPx, {
    textWidth,
    fontSize,
  });
  parts.push(`<path d="${calloutPath}" fill="${bgColor}" stroke="#94a3b8" stroke-width="${1 * scale}" stroke-linejoin="round"/>`);
  parts.push(`<text x="${cx}" y="${cy}" font-size="${fontSize}" fill="${color}" font-family='${SANS_FONT_FAMILY}' text-anchor="middle" dominant-baseline="central"${fitAttributes}>${escapeXml(text)}</text>`);
}

function roundSvgNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Width of the label as the exported SVG will draw it. A 2d canvas with the
 * same font stack is the only measurement available before the SVG exists, and
 * it is what keeps the exported callout box the same size as the one the user
 * saw in the preview. Falls back to a per-character estimate where no canvas
 * context is available (jsdom, a locked-down worker).
 */
export function measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
  if (!text) return 0;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`;
      const measured = ctx.measureText(text).width;
      if (measured > 0) return measured;
    }
  } catch {
    // fall through to the estimate
  }
  return text.length * fontSize * 0.55;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgToImage(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

async function renderPngBlob(options: ExportOptions, node: HTMLElement | null | undefined): Promise<RenderResult> {
  const captureNode = node ?? (document.querySelector('.screen-capture-content') as HTMLElement | null);
  if (!captureNode) {
    console.warn('[useExportEngine] .screen-capture-content not found');
    return { ok: false, reason: 'no_capture_node' };
  }

  const effectiveBg = resolveBgColor(options.background);

  // captureBlob, not htmlToImage.toBlob: the library's raster step resolves
  // only from inside a requestAnimationFrame callback, which a rendering-
  // throttled (offscreen) Forge iframe never services — see model/captureBlob.ts.
  const blob = await captureBlob(captureNode, {
    backgroundColor: effectiveBg ?? undefined,
    skipFonts: true,
  });
  if (!blob) {
    console.warn('[useExportEngine] capture returned null');
    return { ok: false, reason: 'blob_null' };
  }

  const img = await createImageBitmap(blob);
  const source = document.createElement('canvas');
  source.width = img.width;
  source.height = img.height;
  const sourceCtx = source.getContext('2d')!;

  if (effectiveBg) {
    sourceCtx.fillStyle = effectiveBg;
    sourceCtx.fillRect(0, 0, source.width, source.height);
  }
  sourceCtx.drawImage(img, 0, 0);

  // Crop before the overlay is drawn: annotation coordinates are normalised
  // against the (equally cropped) preview, so they must scale to the final
  // image rather than to the capture node's layout column.
  const cropBox = measureCaptureCrop(captureNode);
  const captureScale = captureNode.offsetWidth ? source.width / captureNode.offsetWidth : 1;
  const canvas = (cropBox && cropCanvasToBox(source, cropBox, captureScale)) ?? source;
  const ctx = canvas.getContext('2d')!;

  const svgString = buildOverlaySvg(canvas.width, canvas.height, options);
  const svgImg = await svgToImage(svgString);
  ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);

  const pngBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!pngBlob) {
    console.warn('[useExportEngine] canvas.toBlob returned null');
    return { ok: false, reason: 'blob_null' };
  }

  return { ok: true, blob: pngBlob };
}

export function useExportEngine() {
  async function exportDiagram(
    options: ExportOptions,
    diagramTitle: string,
    node?: HTMLElement | null,
  ): Promise<ExportResult> {
    const rendered = await renderPngBlob(options, node);
    if (!rendered.ok) return rendered;
    saveAs(rendered.blob, slugifyFilename(diagramTitle));
    return { ok: true };
  }

  async function exportDiagramToClipboard(
    options: ExportOptions,
    node?: HTMLElement | null,
  ): Promise<ClipboardExportResult> {
    const rendered = await renderPngBlob(options, node);
    if (!rendered.ok) return rendered;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': rendered.blob })]);
      return { ok: true };
    } catch (e) {
      console.warn('[useExportEngine] clipboard write failed:', e);
      return { ok: false, reason: 'clipboard_denied' };
    }
  }

  return { exportDiagram, exportDiagramToClipboard };
}
