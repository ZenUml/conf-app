/**
 * How much detail the export should raster, expressed as a `pixelRatio` for
 * `captureBlob`.
 *
 * WHY THIS EXISTS. `captureBlob` sizes its canvas from the capture node's CSS
 * box times `devicePixelRatio`, so Export PNG has always rasterised whatever
 * is on screen. That is right for a diagram rendered at 1:1 and wrong for a
 * vector one the macro column has shrunk to fit: production page 2774138946's
 * second macro is a PlantUML SVG with a 4647x1469 viewBox laid out in a 562px
 * column, and its exported PNG came back 562x178 — an 8.3x loss of detail the
 * SVG in the DOM still carried. Rasterising at the source's own resolution
 * costs nothing but pixels; the vector redraws sharp at any scale.
 *
 * The ratio is the LARGER of the device ratio and the source-to-screen scale,
 * never their product: a Retina screen already doubles the raster, and the
 * source only holds 8.3x of real detail either way.
 */

/** @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size */
const CANVAS_DIMENSION_LIMIT = 16384;

/**
 * An SVG narrower than this fraction of the capture node is chrome, not the
 * diagram — the sequence viewer keeps a 24px status icon whose viewBox is
 * 214x214, and sizing an export off that would inflate a 1:1 diagram ~9x.
 */
const DIAGRAM_WIDTH_FRACTION = 0.5;

function viewBoxWidth(svg: SVGSVGElement): number {
  const raw = svg.getAttribute('viewBox');
  if (!raw) return 0;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[2] > 0 ? parts[2] : 0;
}

/**
 * The widest rendered SVG in the node that is plausibly the diagram itself.
 * Widest rather than first: PlantUml.vue's normalised diagram sits alongside
 * whatever inline icons the viewer chrome contributes.
 */
function findDiagramSvg(
  node: HTMLElement,
): { svg: SVGSVGElement; renderedWidth: number; renderedHeight: number } | null {
  const nodeWidth = node.clientWidth;
  if (!nodeWidth) return null;

  let best: { svg: SVGSVGElement; renderedWidth: number; renderedHeight: number } | null = null;
  for (const svg of Array.from(node.querySelectorAll('svg'))) {
    const { width: renderedWidth, height: renderedHeight } = svg.getBoundingClientRect();
    if (renderedWidth < nodeWidth * DIAGRAM_WIDTH_FRACTION) continue;
    if (!best || renderedWidth > best.renderedWidth) best = { svg, renderedWidth, renderedHeight };
  }
  return best;
}

/**
 * `pixelRatio` for `captureBlob` so the exported PNG carries the source
 * vector's own resolution. Falls back to `devicePixelRatio` — today's
 * behaviour — whenever the node holds no measurable diagram SVG, the SVG
 * carries no viewBox, or it already renders at/above 1:1.
 */
export function computeExportPixelRatio(node: HTMLElement | null | undefined): number {
  const deviceRatio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (!node) return deviceRatio;

  const found = findDiagramSvg(node);
  if (!found) return deviceRatio;

  const intrinsicWidth = viewBoxWidth(found.svg);
  if (!intrinsicWidth) return deviceRatio;

  const sourceRatio = intrinsicWidth / found.renderedWidth;
  const ratio = Math.max(deviceRatio, sourceRatio);

  // Past the browser's canvas cap html-to-image shrinks the canvas back down
  // proportionally, which would spend the memory and return the detail; stop
  // at the largest ratio that still fits. BOTH axes matter, and height is the
  // one that overflows first for the many-step flows this fix is aimed at.
  const limits = [CANVAS_DIMENSION_LIMIT / node.clientWidth];
  if (found.renderedHeight > 0) limits.push(CANVAS_DIMENSION_LIMIT / found.renderedHeight);
  return Math.min(ratio, ...limits);
}

export { CANVAS_DIMENSION_LIMIT, DIAGRAM_WIDTH_FRACTION };
