import * as htmlToImage from 'html-to-image';
import { saveAs } from 'file-saver';
import { trackEvent } from '../../utils/window';

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

function computeArrowheadPath(
  tipX: number, tipY: number,
  angle: number, thickness: number,
): string {
  const arrowHeight = 10 + thickness * 2;
  const arrowWidth = Math.min(Math.max(5, thickness * 2), thickness + 5);
  const dipFactor = 0.7;
  const bx = tipX - arrowHeight * dipFactor * Math.cos(angle);
  const by = tipY - arrowHeight * dipFactor * Math.sin(angle);
  const tbx = tipX - arrowHeight * Math.cos(angle);
  const tby = tipY - arrowHeight * Math.sin(angle);
  const s1x = tbx + arrowWidth * Math.sin(angle);
  const s1y = tby - arrowWidth * Math.cos(angle);
  const s2x = tbx - arrowWidth * Math.sin(angle);
  const s2y = tby + arrowWidth * Math.cos(angle);
  return `M ${bx} ${by} L ${s1x} ${s1y} L ${tipX} ${tipY} L ${s2x} ${s2y} Z`;
}

const VIEWBOX_REF_W = 600;

function buildOverlaySvg(w: number, h: number, options: ExportOptions): string {
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
      const pos = options.note.position;
      const padding = 16 * scale;
      nx = pos.endsWith('left') ? padding : pos.endsWith('right') ? w - padding : w / 2;
      ny = pos.startsWith('top') ? padding + fontSize : h - padding;
      anchor = pos.endsWith('left') ? 'start' : pos.endsWith('right') ? 'end' : 'middle';
    }
    const escaped = escapeXml(options.note.text);
    parts.push(`<text x="${nx}" y="${ny}" font-size="${fontSize}" fill="${options.note.color}" font-family="sans-serif" font-weight="500" text-anchor="${anchor}" dominant-baseline="central" filter="url(#ds)">${escaped}</text>`);
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
      parts.push(`<text x="${midX + perpX}" y="${midY + perpY}" font-size="${labelFontSize}" fill="${color}" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">${escapeXml(options.arrow.label)}</text>`);
    }
  }

  if (options.callout?.position && options.callout.text) {
    const cx = options.callout.position.x * w;
    const cy = options.callout.position.y * h;
    const bw = 120 * scale, bh = 40 * scale, r = 5 * scale;
    const left = cx - bw / 2, top = cy - bh / 2, right = cx + bw / 2, bottom = cy + bh / 2;
    let calloutPath = `M ${left + r} ${top} L ${right - r} ${top} Q ${right} ${top} ${right} ${top + r} L ${right} ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom}`;
    if (options.callout.tipPosition) {
      const tipX = options.callout.tipPosition.x * w;
      const tipY = options.callout.tipPosition.y * h;
      const tipGap = 8 * scale;
      calloutPath += ` L ${cx + tipGap} ${bottom} L ${tipX} ${tipY} L ${cx - tipGap} ${bottom}`;
    }
    calloutPath += ` L ${left + r} ${bottom} Q ${left} ${bottom} ${left} ${bottom - r} L ${left} ${top + r} Q ${left} ${top} ${left + r} ${top} Z`;
    const strokeW = 1 * scale;
    const fontSize = options.callout.fontSize * scale;
    parts.push(`<path d="${calloutPath}" fill="${options.callout.bgColor}" stroke="#94a3b8" stroke-width="${strokeW}" stroke-linejoin="round"/>`);
    parts.push(`<text x="${cx}" y="${cy}" font-size="${fontSize}" fill="${options.callout.color}" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">${escapeXml(options.callout.text)}</text>`);
  }

  if (options.watermark?.text) {
    const escaped = escapeXml(options.watermark.text);
    const fontSize = options.watermark.fontSize * scale;
    const padding = 16 * scale;
    if (options.watermark.position === 'diagonal') {
      parts.push(`<text x="${w / 2}" y="${h / 2}" font-size="${fontSize}" fill="${options.watermark.color}" opacity="${options.watermark.opacity / 100}" font-family="monospace" font-weight="500" text-anchor="middle" dominant-baseline="central" transform="rotate(-45, ${w / 2}, ${h / 2})">${escaped}</text>`);
    } else {
      parts.push(`<text x="${w - padding}" y="${h - padding}" font-size="${fontSize}" fill="${options.watermark.color}" opacity="${options.watermark.opacity / 100}" font-family="monospace" font-weight="500" text-anchor="end">${escaped}</text>`);
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

export function useExportEngine() {
  async function exportDiagram(options: ExportOptions): Promise<void> {
    const node = document.querySelector('.screen-capture-content') as HTMLElement | null;
    if (!node) {
      console.warn('[useExportEngine] .screen-capture-content not found');
      return;
    }

    const effectiveBg = resolveBgColor(options.background);

    const blob = await htmlToImage.toBlob(node, {
      backgroundColor: effectiveBg ?? undefined,
      skipFonts: true,
    });
    if (!blob) {
      console.warn('[useExportEngine] html-to-image returned null');
      return;
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

    await new Promise<void>((resolve) => {
      canvas.toBlob(async (pngBlob) => {
        if (pngBlob) {
          trackEvent('download_png', 'click', 'export');
          saveAs(pngBlob, 'zenuml-diagram-export.png');
        }
        resolve();
      }, 'image/png');
    });
  }

  return { exportDiagram };
}
