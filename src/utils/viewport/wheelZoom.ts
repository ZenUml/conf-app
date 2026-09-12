/**
 * Wheel-to-zoom plumbing shared by every diagram viewport: svg-pan-zoom for
 * Mermaid and PlantUML, mxGraph for Graph, a CSS transform for Sequence. Each
 * engine applies its own zoom step; what lives here is the part that has to be
 * identical across all four — when a wheel event counts as a zoom at all, and
 * how much wheel makes one step.
 */

/**
 * Whether this wheel event is asking to zoom rather than to scroll the page.
 *
 * A plain wheel belongs to the page. A diagram that took it would trap the
 * reader's scroll the moment the pointer crossed a macro — and on the page
 * viewer the Forge iframe is sized to the diagram, so a tall one covers the
 * whole reading area with nowhere to put the pointer instead. Ctrl (Cmd on
 * macOS) is the browser-wide "zoom this, not the page" modifier, and it is what
 * DrawIO's own viewer has always required.
 *
 * Trackpad pinch arrives here for free: browsers report it as a wheel event
 * with `ctrlKey` set, with no key held.
 */
export function isZoomIntent(event: WheelEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

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

/**
 * Fires when a reader has been wheeling over a diagram without the zoom modifier
 * for long enough to mean it — the cue for the "use Ctrl/Cmd + scroll" hint.
 *
 * A threshold rather than the first tick: one notch is someone passing through,
 * a sustained push is someone working at a diagram that is not responding. And a
 * hard cap rather than a cooldown, because after two tellings the reader either
 * learned it or is doing something else, and an overlay that keeps reappearing
 * over a diagram is worse than one that never did.
 */
export function createZoomHintTrigger(
  onHint: () => void,
  { thresholdPx = 120, maxHints = 2 } = {},
): (event: WheelEvent, pageHeight: number) => void {
  let accumulated = 0;
  let hints = 0;
  return (event, pageHeight) => {
    if (hints >= maxHints) return;
    accumulated += Math.abs(wheelDeltaPixels(event, pageHeight));
    if (accumulated < thresholdPx) return;
    accumulated = 0;
    hints += 1;
    onHint();
  };
}
