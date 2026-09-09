/**
 * Pan/zoom arithmetic for the Mermaid viewer (Mermaid.vue).
 *
 * Kept separate from the component because all of it is arithmetic on numbers
 * — no DOM, no Vue — and the interesting cases (clamping at the ends of the
 * ladder, keeping the point under the cursor still, refusing to let a diagram
 * be dragged off its own viewport) are exactly the ones that are painful to
 * assert through a mounted component.
 *
 * Two scales are in play and mixing them up is the bug this comment exists to
 * prevent:
 *
 *   naturalScale  the diagram's size relative to the size mermaid emitted.
 *                 1 = drawn at its natural width. This is what the reader is
 *                 shown as a percentage and what the analytics record.
 *   fitScale      the naturalScale the diagram draws at with no zoom applied,
 *                 i.e. rendered width / natural width. Below 1 for any diagram
 *                 wider than its column — the shrunk-to-fit case (ZEN-1207)
 *                 this feature exists for; exactly 1 for one that already fits.
 *
 * The CSS transform needs neither: it needs `naturalScale / fitScale`, because
 * the SVG already draws itself at fitScale (width:100% with max-width at the
 * natural width — see normalizeSvgSizing). At fit that ratio is 1, so the
 * transform is the identity and an unzoomed diagram renders exactly as it did
 * before this feature existed.
 */

/** One click of the +/- buttons, and one notch of a wheel gesture. */
export const ZOOM_STEP = 1.25;

/**
 * Ladder bounds, in naturalScale. The ceiling is 4x natural rather than
 * something larger because an SVG stays sharp at any magnification — past 4x
 * the reader is looking at three nodes and has lost the diagram. The floor is
 * a floor on the LADDER only: `clampScale` never clamps a diagram above its
 * own fit scale, so a diagram whose fit scale is 0.06 can still be shown at
 * 0.06 and zoomed out no further.
 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** Whether two scales are the same level, up to float noise from the ladder. */
export function sameScale(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

export function clampScale(scale: number, fitScale: number): number {
  const floor = Math.min(MIN_SCALE, fitScale);
  return Math.min(MAX_SCALE, Math.max(floor, scale));
}

/**
 * One step along the ladder.
 *
 * A step that would cross the fit scale lands ON it instead. Without that
 * snap the fit level is unreachable from the buttons — you can be at 94% and
 * 118% of a 100%-fit diagram but never at the level the diagram was first
 * shown at — and "back to how it looked" is the most common thing a reader
 * wants after a zoom.
 */
export function stepScale(scale: number, direction: 1 | -1, fitScale: number): number {
  const stepped = direction === 1 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
  const crossesFit =
    (scale < fitScale && stepped > fitScale) || (scale > fitScale && stepped < fitScale);
  return clampScale(crossesFit ? fitScale : stepped, fitScale);
}

/**
 * Keep the content honest against its viewport: an axis whose content is
 * smaller than the viewport is centred, an axis whose content overflows may be
 * dragged only as far as its own edges. Without the second half a reader can
 * fling a zoomed diagram off-screen and be left staring at blank space with no
 * way back except Reset.
 */
export function clampPan(pan: Point, viewport: Size, content: Size): Point {
  return {
    x: clampAxis(pan.x, viewport.width, content.width),
    y: clampAxis(pan.y, viewport.height, content.height),
  };
}

function clampAxis(offset: number, viewport: number, content: number): number {
  if (content <= viewport) return (viewport - content) / 2;
  return Math.min(0, Math.max(viewport - content, offset));
}

/**
 * The pan offset that holds `anchor` (a point in viewport coordinates) still
 * across a zoom from `from` to `to`. This is what makes ctrl+wheel zoom at the
 * cursor rather than at the top-left corner, and what makes the buttons zoom
 * about the middle of what the reader is looking at.
 *
 * Derivation: a content point c is drawn at `pan + c*k`. Holding the drawn
 * position of the content point currently under `anchor` fixed gives
 * `pan' = anchor - (anchor - pan) * (to / from)`.
 */
export function panAfterZoom(pan: Point, anchor: Point, from: number, to: number): Point {
  const ratio = to / from;
  return {
    x: anchor.x - (anchor.x - pan.x) * ratio,
    y: anchor.y - (anchor.y - pan.y) * ratio,
  };
}

/** The label the control shows: naturalScale as a whole-number percentage. */
export function formatZoomLabel(naturalScale: number): string {
  return `${Math.round(naturalScale * 100)}%`;
}

/** Rounded for analytics — two decimals is finer than any ladder step. */
export function roundScale(scale: number): number {
  return Math.round(scale * 100) / 100;
}
