/**
 * Wheel-to-zoom plumbing shared by every diagram viewport: svg-pan-zoom for
 * Mermaid and PlantUML, mxGraph for Graph, a CSS transform for Sequence. Each
 * engine applies the zoom itself; what lives here is the part that has to be
 * identical across all four — what a wheel event means on each surface, how
 * much one event zooms, and how far a diagram may be zoomed and panned.
 */

/**
 * Whether this wheel event holds the zoom modifier.
 *
 * On the page viewer a plain wheel belongs to the page. A diagram that took it
 * would trap the reader's scroll the moment the pointer crossed a macro — the
 * Forge iframe is sized to the diagram, so a tall one covers the whole reading
 * area with nowhere to put the pointer instead. Ctrl (Cmd on macOS) is the
 * browser-wide "zoom this, not the page" modifier, and it is what DrawIO's own
 * viewer has always required.
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

/** Per-event zoom cap: a fast fling or a long pinch frame cannot jump the view. */
const MAX_STEP_IN = 1.25;
const MAX_STEP_OUT = 0.75;
/** A mouse notch is ~100px; clamp so one notch and one big trackpad frame match. */
const WHEEL_DELTA_CAP_PX = 50;
/** exp(-delta * k): one 100px notch (capped to 50) gives ~1.105x. */
const WHEEL_ZOOM_PER_PX = 0.002;
/** Pinch frames are a few pixels each, so they need a steeper curve. */
const PINCH_ZOOM_PER_PX = 0.01;
/** Ctrl with a delta this small is a trackpad pinch, not Ctrl + mouse wheel. */
const PINCH_MAX_DELTA_PX = 40;

export type WheelAction =
  | { kind: 'zoom'; factor: number; modifier: 'none' | 'ctrl_meta' }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'pass' };

function horizontalPixels(event: WheelEvent, pageWidth: number): number {
  if (event.deltaMode === 1) return event.deltaX * 16;
  if (event.deltaMode === 2) return event.deltaX * pageWidth;
  return event.deltaX;
}

function clampFactor(factor: number): number {
  return Math.min(MAX_STEP_IN, Math.max(MAX_STEP_OUT, factor));
}

/**
 * What one wheel event means on this surface.
 *
 * | Surface                     | Plain vertical | Shift / horizontal | Ctrl/Cmd, pinch |
 * |-----------------------------|----------------|--------------------|-----------------|
 * | Fullscreen, editor preview  | zoom           | pan                | zoom            |
 * | Page viewer                 | pass (page)    | pass (page)        | zoom            |
 *
 * Fullscreen and the editor preview are fixed-height hosts with no page behind
 * the diagram, so a plain wheel there used to do nothing; it now zooms at the
 * pointer, the way a map or an image viewer does. On the page viewer it still
 * scrolls the Confluence page (see `isZoomIntent`).
 *
 * Zoom is continuous, not stepped: a trackpad emits many small deltas and each
 * one zooms a little, so the view follows the fingers instead of jumping.
 */
export function classifyWheel(
  event: WheelEvent,
  { plainWheelZooms, pageHeight, pageWidth = pageHeight }: {
    plainWheelZooms: boolean;
    pageHeight: number;
    pageWidth?: number;
  },
): WheelAction {
  const dy = wheelDeltaPixels(event, pageHeight);
  if (isZoomIntent(event)) {
    const pinch = event.ctrlKey && !event.metaKey && Math.abs(dy) < PINCH_MAX_DELTA_PX;
    const delta = pinch ? dy : Math.max(-WHEEL_DELTA_CAP_PX, Math.min(WHEEL_DELTA_CAP_PX, dy));
    const factor = clampFactor(Math.exp(-delta * (pinch ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX)));
    return { kind: 'zoom', factor, modifier: 'ctrl_meta' };
  }
  if (!plainWheelZooms) return { kind: 'pass' };
  const dx = horizontalPixels(event, pageWidth);
  // Shift + wheel is the desktop convention for horizontal scroll. Some
  // browsers already swap it into deltaX; the rest leave it in deltaY.
  if (event.shiftKey) return { kind: 'pan', dx: -(dx || dy) || 0, dy: 0 };
  if (Math.abs(dx) > Math.abs(dy)) return { kind: 'pan', dx: -dx || 0, dy: -dy || 0 };
  const delta = Math.max(-WHEEL_DELTA_CAP_PX, Math.min(WHEEL_DELTA_CAP_PX, dy));
  return { kind: 'zoom', factor: clampFactor(Math.exp(-delta * WHEEL_ZOOM_PER_PX)), modifier: 'none' };
}

/**
 * How far a diagram may be zoomed, in natural-size units (1 = the size the
 * renderer draws it on an unlimited canvas).
 *
 * Floor: the opening size. Every viewport opens at "fit, never above 1:1", so
 * smaller than that only shrinks a diagram that already fits. Ceiling: natural
 * size. Past it the renderer has no more detail to show, only bigger pixels.
 * The `Math.min`/`Math.max` keep the range valid if a diagram ever opens above
 * natural size.
 */
export function zoomLimits(openScale: number): { min: number; max: number } {
  return { min: Math.min(openScale, 1), max: Math.max(openScale, 1) };
}

export function clampScale(scale: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/**
 * Where a diagram's leading edge (left or top, in box pixels) may sit on one
 * axis.
 *
 * Larger than the box: an edge never comes inside the box edge, so the reader
 * cannot drag the diagram away into empty space. Smaller than the box: it stays
 * where it opened (`align`, 0 = start, 0.5 = centre, 1 = end), scaled with its
 * size, so a drag or a zoom-out cannot leave it stranded off to one side.
 */
export function axisOffset(offset: number, content: number, box: number, align: number): number {
  if (content <= box) return align * (box - content);
  return Math.min(0, Math.max(box - content, offset));
}

/** Read `align` for `axisOffset` from a diagram's position at opening. */
export function alignOf(offset: number, content: number, box: number): number {
  if (!(box - content > 0.5)) return 0.5;
  return Math.min(1, Math.max(0, offset / (box - content)));
}

/**
 * Safari reports a trackpad pinch as its own `gesture*` events, not as Ctrl +
 * wheel, and zooms the whole page unless they are cancelled. Bind on every
 * surface, the page viewer included: a pinch over a diagram is always a zoom.
 * Returns the unbind function.
 */
export function bindSafariPinch(
  element: HTMLElement,
  onZoom: (factor: number, clientX: number, clientY: number) => void,
): () => void {
  let last = 1;
  type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number };
  const start = (event: Event) => {
    event.preventDefault();
    last = 1;
  };
  const change = (event: Event) => {
    event.preventDefault();
    const gesture = event as GestureLike;
    const scale = gesture.scale ?? 1;
    if (!(scale > 0)) return;
    const factor = clampFactor(scale / last);
    last = scale;
    const rect = element.getBoundingClientRect();
    onZoom(factor, gesture.clientX ?? rect.left + rect.width / 2, gesture.clientY ?? rect.top + rect.height / 2);
  };
  element.addEventListener('gesturestart', start);
  element.addEventListener('gesturechange', change);
  element.addEventListener('gestureend', start);
  return () => {
    element.removeEventListener('gesturestart', start);
    element.removeEventListener('gesturechange', change);
    element.removeEventListener('gestureend', start);
  };
}
