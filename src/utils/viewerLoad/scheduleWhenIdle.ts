/**
 * Run work once the main thread is idle, so it stops competing with the
 * viewer's first render.
 *
 * WHY THIS EXISTS: P1.1 deferred the ADF copy-scan off the fetch phase, but
 * dispatched it fire-and-forget immediately before `mountRoot` — so the scan's
 * page-ADF GET started at the same instant the diagram began rendering and
 * raced it for the connection pool and the main thread. Measured on Lite
 * v2026.07.171106 (mermaid, same version, same macro type): `fetch_ms` fell
 * 1509 → 1194 (-315ms) while `render_ms` rose 127 → 425 (+298ms), leaving
 * `duration_ms` flat at 2452 → 2417. The work had moved, not left the critical
 * path. Scheduling it for an idle period is what actually frees the render.
 *
 * `timeout` is a correctness bound, not a nicety: the scan decides whether the
 * "copied macro" banner appears, so it must not wait indefinitely behind a
 * busy page. requestIdleCallback runs the callback once the deadline expires
 * even if the thread never goes idle.
 */

/** Upper bound on how long the copy verdict may be delayed. */
export const IDLE_TIMEOUT_MS = 2000;

export interface IdleScheduler {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
  requestAnimationFrame?: (cb: () => void) => unknown;
  setTimeout?: (cb: () => void, ms: number) => unknown;
}

function resolve(deps: IdleScheduler): Required<Pick<IdleScheduler, 'setTimeout'>> & IdleScheduler {
  const g = globalThis as unknown as IdleScheduler;
  return {
    requestIdleCallback:
      deps.requestIdleCallback ??
      (typeof g.requestIdleCallback === 'function' ? g.requestIdleCallback.bind(globalThis) : undefined),
    requestAnimationFrame:
      deps.requestAnimationFrame ??
      (typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame.bind(globalThis) : undefined),
    setTimeout: deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms)),
  };
}

/**
 * Schedule `run` for the next idle period. Falls back to "after the next
 * paint" (rAF → macrotask) where requestIdleCallback is unavailable, and to a
 * plain macrotask where neither exists (jsdom, SSR). Never throws: a scheduler
 * that rejects the callback degrades to running it as a macrotask.
 */
export function scheduleWhenIdle(run: () => void, deps: IdleScheduler = {}): void {
  const { requestIdleCallback: ric, requestAnimationFrame: raf, setTimeout: later } = resolve(deps);

  const safely = () => {
    try {
      run();
    } catch (e) {
      console.warn('[viewer-load] idle-scheduled work threw', e);
    }
  };

  try {
    if (ric) {
      ric(safely, { timeout: IDLE_TIMEOUT_MS });
      return;
    }
    if (raf) {
      // rAF fires BEFORE the frame is painted, so hop one macrotask further
      // to land after it — otherwise we would still be racing the render we
      // are trying to get out of the way of.
      raf(() => later(safely, 0));
      return;
    }
    later(safely, 0);
  } catch (e) {
    console.warn('[viewer-load] idle scheduling failed; running as macrotask', e);
    later(safely, 0);
  }
}
