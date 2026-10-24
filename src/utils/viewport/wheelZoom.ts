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
 * a sustained push is someone working at a diagram that is not responding. That
 * only holds if the total decays — otherwise three unrelated notches minutes
 * apart add up to the same number as one push and the hint fires at someone who
 * was only passing through, three times over. So the count resets once the wheel
 * has been quiet, exactly like `createGestureGate`, and `thresholdPx` means
 * "within one continuous push" rather than "ever".
 *
 * A hard cap rather than a cooldown for the repeat: after two tellings the reader
 * either learned it or is doing something else, and an overlay that keeps
 * reappearing over a diagram is worse than one that never did. The cap counts
 * tellings, not triggers — `onHint` returns false when it merely extended a hint
 * already on screen, which the reader experiences as one telling, so it does not
 * spend one of the two.
 *
 * `now` is injectable because the thing worth testing here is the clock.
 */
export function createZoomHintTrigger(
  onHint: () => boolean | void,
  { thresholdPx = 120, maxHints = 2, quietMs = 500, now = () => Date.now() } = {},
): (event: WheelEvent, pageHeight: number) => void {
  let accumulated = 0;
  let lastWheel = -Infinity;
  let hints = 0;
  return (event, pageHeight) => {
    if (hints >= maxHints) return;
    const at = now();
    if (at - lastWheel > quietMs) accumulated = 0;
    lastWheel = at;
    accumulated += Math.abs(wheelDeltaPixels(event, pageHeight));
    if (accumulated < thresholdPx) return;
    accumulated = 0;
    if (onHint() === false) return;
    hints += 1;
  };
}

/**
 * Collapses a wheel gesture to its first step, so it can be reported like a
 * button click instead of a stream.
 *
 * A Ctrl/Cmd + scroll is one act of intent that arrives as a dozen callbacks.
 * Reporting each would flood the event and make a wheel zoom look a dozen times
 * more common than a click; reporting the first and staying shut until the wheel
 * goes quiet makes the two comparable. The quiet window restarts on every step,
 * so one long push is one gesture however far it travels.
 *
 * `now` is injectable because the thing worth testing here is the clock.
 */
export function createGestureGate(
  { quietMs = 500, now = () => Date.now() } = {},
): () => boolean {
  let lastStep = -Infinity;
  return () => {
    const at = now();
    const isNewGesture = at - lastStep > quietMs;
    lastStep = at;
    return isNewGesture;
  };
}
