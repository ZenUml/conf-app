/**
 * Coalescing preview renderer: at most one render in flight; when it lands,
 * render only the newest request (if it differs from what is on screen).
 * Requests are thunks so the candidate is computed at render start, from the
 * newest text. With `delay`, a render starts only once no request has come
 * for that long (debounce); used when renders are slow.
 */
export interface RenderLoopStats {
  requests: number;
  renders: number;
  /** Requests that never got a render of their own (coalesced or unchanged). */
  skipped: number;
}

export interface RenderLoop {
  /** Ask for a render of whatever `next()` returns when the loop gets to it. */
  request(): void;
  /** Resolves when nothing is in flight or pending. */
  idle(): Promise<void>;
  /** Drop a pending request and any waiting timer (the render in flight, if any, still lands). */
  cancelPending(): void;
  stats(): RenderLoopStats;
  dispose(): void;
}

export interface Candidate {
  code: string;
  /** Opaque value handed back to `onRendered` (e.g. the input timestamp). */
  tag?: unknown;
}

export function createRenderLoop(options: {
  /** Newest candidate, or null when the current text is invalid (keep last picture). */
  next: () => Candidate | null;
  render: (code: string) => Promise<boolean>;
  onRendered: (candidate: Candidate, ok: boolean) => void;
  initialCode: string;
  /**
   * How a request starts the loop when it is idle. Default: at once. The
   * controller passes a macrotask: a Mermaid render is effectively one long
   * task, so keystrokes typed during it are queued as input tasks; letting
   * them run first means one render for all of them instead of one each.
   */
  schedule?: (run: () => void) => void;
  /**
   * Debounce, in ms, read on every request: 0 renders as soon as the loop is
   * free (default); more waits until no request has come for that long.
   */
  delay?: () => number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): RenderLoop {
  let inFlight: Promise<void> | null = null;
  let pending = false;
  let scheduled = false;
  const schedule = options.schedule ?? ((run: () => void) => run());
  const delay = options.delay ?? (() => 0);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  /** Bumped whenever a scheduled start is superseded or cancelled. */
  let token = 0;
  let lastRequestAt = 0;
  let disposed = false;
  let shown = options.initialCode;
  const stats: RenderLoopStats = { requests: 0, renders: 0, skipped: 0 };
  let idleWaiters: Array<() => void> = [];

  const settle = () => {
    if (inFlight || pending || scheduled) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  };

  const pump = () => {
    if (disposed || inFlight || !pending) return settle();
    pending = false;
    const candidate = options.next();
    if (!candidate || candidate.code === shown) return settle();
    stats.renders += 1;
    inFlight = (async () => {
      let ok = false;
      try {
        ok = await options.render(candidate.code);
      } catch {
        ok = false;
      }
      if (ok) shown = candidate.code;
      if (!disposed) options.onRendered(candidate, ok);
    })().finally(() => {
      inFlight = null;
      if (!pending || disposed) return settle();
      const rest = delay() - (now() - lastRequestAt);
      if (rest > 0) arm(rest);
      else kick();
    });
  };

  const drop = () => {
    token += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    scheduled = false;
  };

  const kick = () => {
    scheduled = true;
    const mine = token;
    schedule(() => {
      if (mine !== token) return;
      scheduled = false;
      pump();
    });
  };

  /** Start after `ms` unless another request moves it. */
  const arm = (ms: number) => {
    drop();
    scheduled = true;
    const mine = token;
    timer = setTimer(() => {
      if (mine !== token) return;
      timer = null;
      scheduled = false;
      pump();
    }, ms);
  };

  return {
    request() {
      if (disposed) return;
      stats.requests += 1;
      pending = true;
      lastRequestAt = now();
      if (inFlight) return;
      const wait = delay();
      if (wait > 0) return arm(wait);
      if (scheduled) return;
      kick();
    },
    idle() {
      if (!inFlight && !pending && !scheduled) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    cancelPending() {
      pending = false;
      drop();
      settle();
    },
    stats: () => ({ ...stats, skipped: stats.requests - stats.renders }),
    dispose() {
      disposed = true;
      pending = false;
      drop();
      settle();
    },
  };
}
