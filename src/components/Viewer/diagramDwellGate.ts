/**
 * How much of the diagram has to be on screen before the 3s audience dwell
 * timer starts.
 *
 * Until 2026-09-02 the gate observed the attribution footer — `padding: 8px
 * 12px; font-size: 12px`, about 29px tall — with `threshold: 0.5`. A tall
 * diagram could be read in full while that strip stayed below the fold, so the
 * reader was never counted. Measured over 2026-08-15..09-02 across four
 * tenants: 4,429 of 41,844 rendered footers reached the dwell (10.6%), split
 * 4.2% for sequence against 26.0% for graph, which tracks how tall each macro
 * type tends to be.
 *
 * A ratio alone cannot serve both ends of the size range. A 3000px diagram in
 * a 700px viewport caps at ratio 0.23, so `threshold: 0.5` would never fire
 * for it; meanwhile 200px of a 300px diagram is most of the diagram. Short
 * diagrams therefore qualify on half of themselves, tall ones on a fixed band.
 *
 * This reads only `intersectionRect` and `boundingClientRect`. An implicit
 * root inside a cross-origin iframe reports `rootBounds: null` per spec, and
 * every viewer in this app runs inside one, so no viewport-relative rule is
 * available here.
 */
export const MIN_VISIBLE_PX = 200;

export type DwellGateEntry = Pick<
  IntersectionObserverEntry,
  'isIntersecting' | 'intersectionRect' | 'boundingClientRect'
>;

export function qualifiesForDwell(entry: DwellGateEntry): boolean {
  if (!entry.isIntersecting) return false;
  const needed = Math.min(MIN_VISIBLE_PX, entry.boundingClientRect.height * 0.5);
  return entry.intersectionRect.height >= needed;
}

/**
 * Dense at the bottom on purpose: a tall diagram sits pinned at its ceiling
 * ratio, so a list clustered near 1 would stop delivering callbacks while the
 * reader is still scrolling through it.
 */
export const DWELL_GATE_THRESHOLDS = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1];
