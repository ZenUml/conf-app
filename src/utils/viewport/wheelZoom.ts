/**
 * Wheel-to-zoom plumbing shared by the diagram viewports that drive their own
 * zoom (Graph through mxGraph, Sequence through a CSS transform). Mermaid and
 * PlantUML do not use it — svg-pan-zoom handles their wheel internally.
 */

/** Wheel deltas are pixels by default, lines in Firefox, and occasionally pages. */
export function wheelDeltaPixels(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * pageHeight;
  return event.deltaY;
}

/** +1 to zoom in (wheel up), -1 to zoom out. */
export type WheelZoomDirection = 1 | -1;

/**
 * One zoom step per notch-worth of wheel, rather than one per event: a trackpad
 * emits a stream of small deltas and stepping on each would rocket through the
 * zoom range. The remainder carries over instead of being dropped, so slow
 * scrolling still zooms eventually.
 */
export function createWheelStepper(
  onStep: (direction: WheelZoomDirection) => void,
  stepPx = 100,
): (event: WheelEvent, pageHeight: number) => void {
  let accumulated = 0;
  return (event, pageHeight) => {
    accumulated += wheelDeltaPixels(event, pageHeight);
    while (Math.abs(accumulated) >= stepPx) {
      const out = accumulated > 0;
      accumulated += out ? -stepPx : stepPx;
      onStep(out ? -1 : 1);
    }
  };
}
