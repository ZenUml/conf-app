import * as htmlToImage from 'html-to-image';
import { saveAs } from 'file-saver';
import {
  VIEWBOX_REF_W,
  EDGE_PADDING,
  SANS_FONT_FAMILY,
  MONO_FONT_FAMILY,
  computeArrowheadPath,
  computeNotePosition,
  computeCalloutPath,
} from './overlayGeometry';

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

  if (options.note.text) {
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
    const escaped = escapeXml(options.note.text);
    parts.push(`<text x="${nx}" y="${ny}" font-size="${fontSize}" fill="${options.note.color}" font-family='${SANS_FONT_FAMILY}' font-weight="500" text-anchor="${anchor}" dominant-baseline="central" filter="url(#ds)">${escaped}</text>`);
  }

  if (options.arrowPoints) {
    const pts = options.arrowPoints;
    const sx = pts.start.x * w, sy = pts.start.y * h;
    const ex = pts.end.x * w, ey = pts.end.y * h;
    const angle = Math.atan2(ey - sy, ex - sx);
    const t = options.arrow.thickness * scale;
    const color = options.arrow.color;

    parts.push(`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${t}" stroke-linejoin="round"/>`);

    const isLeftOnly = options.arrow.type === '←';
    const isDouble = options.arrow.type === '←→';
    if (!isLeftOnly) {
      parts.push(`<path d="${computeArrowheadPath(ex, ey, angle, t)}" fill="${color}" stroke="${color}" stroke-linejoin="round"/>`);
    }
    if (isDouble || isLeftOnly) {
      parts.push(`<path d="${computeArrowheadPath(sx, sy, angle + Math.PI, t)}" fill="${color}" stroke="${color}" stroke-linejoin="round"/>`);
    }

    if (options.arrow.label) {
      const midX = (sx + ex) / 2;
      const midY = (sy + ey) / 2;
      const labelOffset = 14 * scale;
      const perpX = -Math.sin(angle) * labelOffset;
      const perpY = Math.cos(angle) * labelOffset;
      const labelFontSize = (12 + options.arrow.thickness) * scale;
      parts.push(`<text x="${midX + perpX}" y="${midY + perpY}" font-size="${labelFontSize}" fill="${color}" font-family='${SANS_FONT_FAMILY}' text-anchor="middle" dominant-baseline="central">${escapeXml(options.arrow.label)}</text>`);
    }
  }

  if (options.callout?.position && options.callout.text) {
    const cx = options.callout.position.x * w;
    const cy = options.callout.position.y * h;
    const tipPx = options.callout.tipPosition
      ? { x: options.callout.tipPosition.x * w, y: options.callout.tipPosition.y * h }
      : null;
    const calloutPath = computeCalloutPath(cx, cy, scale, tipPx);
    const strokeW = 1 * scale;
    const fontSize = options.callout.fontSize * scale;
    parts.push(`<path d="${calloutPath}" fill="${options.callout.bgColor}" stroke="#94a3b8" stroke-width="${strokeW}" stroke-linejoin="round"/>`);
    parts.push(`<text x="${cx}" y="${cy}" font-size="${fontSize}" fill="${options.callout.color}" font-family='${SANS_FONT_FAMILY}' text-anchor="middle" dominant-baseline="central">${escapeXml(options.callout.text)}</text>`);
  }

  if (options.watermark?.text) {
    const escaped = escapeXml(options.watermark.text);
    const fontSize = options.watermark.fontSize * scale;
    const padding = 16 * scale;
    if (options.watermark.position === 'diagonal') {
      parts.push(`<text x="${w / 2}" y="${h / 2}" font-size="${fontSize}" fill="${options.watermark.color}" opacity="${options.watermark.opacity / 100}" font-family="${MONO_FONT_FAMILY}" font-weight="500" text-anchor="middle" dominant-baseline="central" transform="rotate(-45, ${w / 2}, ${h / 2})">${escaped}</text>`);
    } else {
      parts.push(`<text x="${w - padding}" y="${h - padding}" font-size="${fontSize}" fill="${options.watermark.color}" opacity="${options.watermark.opacity / 100}" font-family="${MONO_FONT_FAMILY}" font-weight="500" text-anchor="end">${escaped}</text>`);
    }
  }

  parts.push('</svg>');
  return parts.join('');
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

  const blob = await htmlToImage.toBlob(captureNode, {
    backgroundColor: effectiveBg ?? undefined,
    skipFonts: true,
  });
  if (!blob) {
    console.warn('[useExportEngine] html-to-image returned null');
    return { ok: false, reason: 'blob_null' };
  }

  const img = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;

  if (effectiveBg) {
    ctx.fillStyle = effectiveBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

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
