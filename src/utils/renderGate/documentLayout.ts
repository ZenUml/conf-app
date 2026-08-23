// Layout readiness for renderers that measure text.
//
// `mermaid.render()` lays a temporary node into `document.body` and measures it
// with getBBox. When the rendering document has no layout box the measurement
// throws `svg element not in render tree`, mermaid's own wording, and the
// caller is left with no SVG at all.
//
// Reproduced 2026-08-11 against mermaid 11.12.2 in Chrome, four cases:
//   body { display: none }               -> throws
//   render inside a display:none iframe  -> throws
//   iframe 20000px below the viewport    -> renders (it still has a box)
//   laid-out document                    -> renders
// So the trigger is the absence of a layout box, NOT being scrolled offscreen.
// Consistent with production: all 30 events on 2026-08-10 carried
// `render_gate: undefined`, i.e. none of them came through the viewport gate.
//
// Fail-open throughout: when readiness cannot be determined, report ready and
// let the render proceed, so this can never withhold a diagram that would
// otherwise have appeared.

export interface LayoutDeps {
  doc?: Document;
  timeoutMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  ResizeObserverCtor?: typeof ResizeObserver;
}

// A laid-out document has at least one client rect on <body>. `display: none`
// on the body, or on any ancestor frame, collapses that list to empty.
export function hasLayout(doc: Document = document): boolean {
  const body = doc?.body;
  if (!body || typeof body.getClientRects !== 'function') return true;
  try {
    return body.getClientRects().length > 0;
  } catch {
    return true;
  }
}

// Resolves true once the document has a layout box, false if it still has none
// when the wait expires. Resolves immediately when layout is already present,
// so the common path adds no latency.
export function awaitLayout(deps: LayoutDeps = {}): Promise<boolean> {
  const {
    doc = typeof document !== 'undefined' ? document : undefined,
    timeoutMs = 10000,
    setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
  } = deps;

  const ResizeObserverCtor =
    'ResizeObserverCtor' in deps
      ? deps.ResizeObserverCtor
      : typeof ResizeObserver !== 'undefined'
        ? ResizeObserver
        : undefined;

  if (!doc || hasLayout(doc)) return Promise.resolve(true);
  // No ResizeObserver means no way to learn when the box appears. Fail open
  // rather than stall on a timer that cannot improve the outcome.
  if (!ResizeObserverCtor || !doc.body) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let observer: ResizeObserver | undefined;
    let settled = false;

    const finish = (laidOut: boolean) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearTimeoutFn(timer);
      resolve(laidOut);
    };

    const timer = setTimeoutFn(() => finish(hasLayout(doc)), timeoutMs);

    try {
      observer = new ResizeObserverCtor(() => {
        if (hasLayout(doc)) finish(true);
      });
      observer.observe(doc.body);
    } catch {
      finish(true);
    }
  });
}
