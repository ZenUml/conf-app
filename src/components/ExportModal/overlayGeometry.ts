// Geometry and font-family constants shared between the live preview overlay
// (OverlayLayer.vue, rendered in a fixed VIEWBOX_REF_W-wide SVG) and the
// exported-PNG SVG builder (useExportEngine.ts, rendered at the capture
// node's actual pixel size). Keeping this logic in one place is what
// guarantees the preview and the exported image agree pixel-for-pixel.

export const VIEWBOX_REF_W = 600;
export const EDGE_PADDING = 12;

// Neither font is bundled/loaded by the app, so both surfaces fall back to
// the platform's default sans/mono stacks anyway; naming that explicitly
// here (instead of a webfont that never loads) keeps preview and export
// typography identical without a network font request either could miss.
export const SANS_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const MONO_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export function computeArrowheadPath(
  tipX: number, tipY: number,
  angle: number, thickness: number,
): string {
  const arrowHeight = 10 + thickness * 2;
  const arrowWidth = Math.min(Math.max(5, thickness * 2), thickness + 5);
  const dipFactor = 0.7;
  const baseX = tipX - arrowHeight * dipFactor * Math.cos(angle);
  const baseY = tipY - arrowHeight * dipFactor * Math.sin(angle);
  const tipBaseX = tipX - arrowHeight * Math.cos(angle);
  const tipBaseY = tipY - arrowHeight * Math.sin(angle);
  const s1X = tipBaseX + arrowWidth * Math.sin(angle);
  const s1Y = tipBaseY - arrowWidth * Math.cos(angle);
  const s2X = tipBaseX - arrowWidth * Math.sin(angle);
  const s2Y = tipBaseY + arrowWidth * Math.cos(angle);
  return `M ${baseX} ${baseY} L ${s1X} ${s1Y} L ${tipX} ${tipY} L ${s2X} ${s2Y} Z`;
}

export interface NotePositionResult {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

// Resolves the note's preset position (top/bottom-left/center/right) into
// pixel coordinates. Only used when the note has no explicit drag point
// (state.notePoint / options.notePoint); callers handle that branch.
export function computeNotePosition(
  position: string,
  width: number,
  height: number,
  fontSize: number,
  padding: number = EDGE_PADDING,
): NotePositionResult {
  const x = position.endsWith('left') ? padding : position.endsWith('right') ? width - padding : width / 2;
  const y = position.startsWith('top') ? padding + fontSize : height - padding;
  const anchor = position.endsWith('left') ? 'start' : position.endsWith('right') ? 'end' : 'middle';
  return { x, y, anchor };
}

export interface CalloutTipPoint {
  x: number;
  y: number;
}

// Builds the callout's rounded-rect-with-tail path. `scale` is 1 in the
// preview (its viewBox width is always VIEWBOX_REF_W) and w/VIEWBOX_REF_W in
// the export builder, so the box/tail sizing matches on both surfaces.
export function computeCalloutPath(
  cx: number,
  cy: number,
  scale: number,
  tipPosition: CalloutTipPoint | null,
): string {
  const w = 120 * scale;
  const h = 40 * scale;
  const r = 5 * scale;
  const left = cx - w / 2;
  const top = cy - h / 2;
  const right = cx + w / 2;
  const bottom = cy + h / 2;

  let path = `M ${left + r} ${top} L ${right - r} ${top} Q ${right} ${top} ${right} ${top + r} L ${right} ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom}`;

  if (tipPosition) {
    const tipGap = 8 * scale;
    path += ` L ${cx + tipGap} ${bottom} L ${tipPosition.x} ${tipPosition.y} L ${cx - tipGap} ${bottom}`;
  }

  path += ` L ${left + r} ${bottom} Q ${left} ${bottom} ${left} ${bottom - r} L ${left} ${top + r} Q ${left} ${top} ${left + r} ${top} Z`;
  return path;
}
