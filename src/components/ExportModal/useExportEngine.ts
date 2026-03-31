import * as htmlToImage from 'html-to-image';
import { saveAs } from 'file-saver';

export interface ExportOptions {
  theme: string;
  background: string; // preset key ('transparent'|'white'|'warm'|'cool') OR hex color string
  note: {
    text: string;
    position: string;
    fontSize: number;
    color: string;
  };
  arrow: {
    enabled: boolean;
    type: string; // '→' | '←→' | '⤷'
    label: string;
    color: string;
    thickness: number;
  };
  watermark: {
    enabled: boolean;
    text: string;
    opacity: number;
    fontSize: number;
    color: string;
    position: 'diagonal' | 'bottom-right';
  };
  arrowPoints?: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
  notePoint?: { x: number; y: number } | null;
}

function resolveBgColor(background: string): string | undefined {
  if (background === 'transparent') return undefined;
  if (background === 'white') return '#ffffff';
  if (background === 'warm') return '#fffbf0';
  if (background === 'cool') return '#f0f4ff';
  // custom hex or any other string passed directly
  return background;
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  color: string,
  thickness: number,
): void {
  // markerjs3-inspired proportional arrow sizing
  const arrowHeight = 10 + thickness * 2;
  const arrowWidth = Math.min(Math.max(5, thickness * 2), thickness + 5);
  const dipFactor = 0.7;

  const baseX = tipX - arrowHeight * dipFactor * Math.cos(angle);
  const baseY = tipY - arrowHeight * dipFactor * Math.sin(angle);
  const tipBaseX = tipX - arrowHeight * Math.cos(angle);
  const tipBaseY = tipY - arrowHeight * Math.sin(angle);
  const side1X = tipBaseX + arrowWidth * Math.sin(angle);
  const side1Y = tipBaseY - arrowWidth * Math.cos(angle);
  const side2X = tipBaseX - arrowWidth * Math.sin(angle);
  const side2Y = tipBaseY + arrowWidth * Math.cos(angle);

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(side1X, side1Y);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(side2X, side2Y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function useExportEngine() {
  async function exportDiagram(options: ExportOptions): Promise<void> {
    // ── Step 1: Capture the diagram node ──────────────────────────────────
    const node = document.querySelector('.screen-capture-content') as HTMLElement | null;
    if (!node) {
      console.warn('[useExportEngine] .screen-capture-content not found in DOM');
      return;
    }

    const bgColor = resolveBgColor(options.background);

    // Theme color is the canvas background; explicit non-white background overrides it
    const themeColors: Record<string, string> = {
      auto: '#ffffff',
      light: '#ffffff',
      dark: '#1e293b',
      blueprint: '#0f172a',
    };
    const themeBg = themeColors[options.theme] ?? '#ffffff';
    // White on a light/auto theme is the default (use theme); white on dark/blueprint is explicit override
    const isDefaultBg = options.background === 'white' && (options.theme === 'light' || options.theme === 'auto');
    const effectiveBg = isDefaultBg ? themeBg : bgColor;

    let blob: Blob | null = null;
    blob = await htmlToImage.toBlob(node, {
      backgroundColor: effectiveBg ?? undefined,
      skipFonts: true,
    });

    if (!blob) {
      console.warn('[useExportEngine] html-to-image returned null blob');
      return;
    }

    // ── Step 2: Draw onto canvas ───────────────────────────────────────────
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

    // ── Step 3: Draw note overlay ──────────────────────────────────────────
    if (options.note.text) {
      ctx.save();
      ctx.font = `${options.note.fontSize}px sans-serif`;
      ctx.fillStyle = options.note.color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;

      if (options.notePoint) {
        // Custom click-to-place position (normalized 0–1 coords)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(options.note.text, options.notePoint.x * canvas.width, options.notePoint.y * canvas.height);
        ctx.textBaseline = 'alphabetic';
      } else {
        const padding = 16;
        const positions: Record<string, [number, number]> = {
          'top-left': [padding, padding + options.note.fontSize],
          'top-center': [canvas.width / 2, padding + options.note.fontSize],
          'top-right': [canvas.width - padding, padding + options.note.fontSize],
          'bottom-left': [padding, canvas.height - padding],
          'bottom-center': [canvas.width / 2, canvas.height - padding],
          'bottom-right': [canvas.width - padding, canvas.height - padding],
        };
        const align: Record<string, CanvasTextAlign> = {
          'top-left': 'left', 'top-center': 'center', 'top-right': 'right',
          'bottom-left': 'left', 'bottom-center': 'center', 'bottom-right': 'right',
        };
        const [x, y] = positions[options.note.position] ?? [padding, canvas.height - padding];
        ctx.textAlign = align[options.note.position] ?? 'left';
        ctx.fillText(options.note.text, x, y);
      }
      ctx.restore();
    }

    // ── Step 4: Draw arrow overlay ─────────────────────────────────────────
    if (options.arrow.enabled) {
      const pts = options.arrowPoints;
      const startX = pts ? pts.start.x * canvas.width : canvas.width * 0.2;
      const startY = pts ? pts.start.y * canvas.height : canvas.height * 0.5;
      const endX = pts ? pts.end.x * canvas.width : canvas.width * 0.8;
      const endY = pts ? pts.end.y * canvas.height : canvas.height * 0.5;
      ctx.save();
      ctx.strokeStyle = options.arrow.color;
      ctx.lineWidth = options.arrow.thickness;
      ctx.beginPath();

      const isCurved = options.arrow.type === '⤷';
      const isDouble = options.arrow.type === '←→';
      const isLeftOnly = options.arrow.type === '←';

      const angle = Math.atan2(endY - startY, endX - startX);

      if (isCurved) {
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(startX + 60, startY - 40, endX - 60, endY - 40, endX, endY);
      } else {
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
      }
      ctx.stroke();

      // Arrowheads
      if (!isLeftOnly) {
        drawArrowhead(ctx, endX, endY, angle, options.arrow.color, options.arrow.thickness);
      }
      if (isDouble || isLeftOnly) {
        drawArrowhead(ctx, startX, startY, angle + Math.PI, options.arrow.color, options.arrow.thickness);
      }

      // Arrow label — offset perpendicular to the line direction
      if (options.arrow.label) {
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const perpX = -Math.sin(angle) * 14;
        const perpY = Math.cos(angle) * 14;
        ctx.font = `${12 + options.arrow.thickness}px sans-serif`;
        ctx.fillStyle = options.arrow.color;
        ctx.textAlign = 'center';
        ctx.fillText(options.arrow.label, midX + perpX, midY + perpY);
      }
      ctx.restore();
    }

    // ── Step 5: Draw watermark ─────────────────────────────────────────────
    if (options.watermark.enabled && options.watermark.text) {
      ctx.save();
      ctx.globalAlpha = options.watermark.opacity / 100;
      ctx.font = `bold ${options.watermark.fontSize}px sans-serif`;
      ctx.fillStyle = options.watermark.color;

      if (options.watermark.position === 'diagonal') {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(options.watermark.text, 0, 0);
      } else {
        // bottom-right
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(options.watermark.text, canvas.width - 16, canvas.height - 16);
      }
      ctx.restore();
    }

    // ── Step 6: Export ─────────────────────────────────────────────────────
    await new Promise<void>((resolve) => {
      canvas.toBlob(async (pngBlob) => {
        if (pngBlob) {
          saveAs(pngBlob, 'zenuml-diagram-export.png');
        }
        resolve();
      }, 'image/png');
    });
  }

  return { exportDiagram };
}
