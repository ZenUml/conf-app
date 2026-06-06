// src/utils/analytics/renderPerf.ts
//
// Phase 0b instrumentation: per-render phase timers for `macro_viewed`, so we
// can attribute the ~2.5s mermaid p50 to bootstrap / context / fetch / render
// and pick the right optimization lever (see RENDERING_PERF_INSTRUMENTATION.md).
//
// Each Forge macro renders in its own sandboxed iframe → its own module
// instance, so this module-scoped singleton is naturally per-macro (no
// cross-macro contamination). Every export is read-only on render behavior:
// it reads clocks or wraps a promise without altering what runs.

export type RenderPhase = 'context' | 'fetch' | 'render';

const durations: Partial<Record<RenderPhase, number>> = {};
let bootstrapMs: number | undefined;

// Sticky "was the tab ever hidden during this load" flag. Tab-backgrounding
// throttles timers and inflates whichever phase was in flight — the cause of
// the 40s–425s p99 artifact. Emitting this lets analysts EXCLUDE backgrounded
// renders from percentiles instead of capping blindly.
let everHidden = typeof document !== 'undefined' ? document.hidden : false;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) everHidden = true;
  });
}

function loadStart(): number | undefined {
  return typeof window !== 'undefined' && typeof window.__macroLoadStart === 'number'
    ? window.__macroLoadStart
    : undefined;
}

/**
 * Record `bootstrap_ms = now − __macroLoadStart`, once. Call at the first line
 * of app code (forgeIndex `initializeCriticalPath`). Captures the head scripts
 * (dom-to-image, md5, DrawIO) + entry bundle eval that run before any app logic.
 * No-ops if `__macroLoadStart` isn't set (test/headless mounts).
 */
export function markAppEntry(): void {
  if (bootstrapMs !== undefined) return;
  const start = loadStart();
  if (start === undefined) return;
  bootstrapMs = Math.round(performance.now() - start);
}

/**
 * Time an async phase, recording its duration once — the first resolution wins.
 * Memoized callees (`getContext`, the custom-content fetch) may invoke this
 * repeatedly; only the first call (the real, uncached work) is kept, so cache
 * hits never dilute the measurement.
 */
export async function time<T>(phase: RenderPhase, fn: () => Promise<T>): Promise<T> {
  if (durations[phase] !== undefined) {
    return fn(); // already measured — run without re-timing
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (durations[phase] === undefined) {
      durations[phase] = Math.round(performance.now() - start);
    }
  }
}

export interface RenderTimings {
  bootstrap_ms?: number;
  context_ms?: number;
  fetch_ms?: number;
  render_ms?: number;
  measured_sum_ms?: number;
  tab_hidden?: boolean;
}

/**
 * Snapshot for `trackRenderTime` to merge into `macro_viewed`. Phases that did
 * not run (e.g. a legacy macro with no customContentId → no fetch) are left
 * `undefined` rather than 0, so absent phases don't dilute medians. The timers
 * are measured durations, not a partition: `duration_ms − measured_sum_ms` is
 * the (intentionally visible) unattributed remainder — Vue mount, getMacroData,
 * paywall predicates, gaps.
 */
export function getTimings(): RenderTimings {
  const parts = [bootstrapMs, durations.context, durations.fetch, durations.render];
  const measured = parts.filter((n): n is number => typeof n === 'number');
  return {
    bootstrap_ms: bootstrapMs,
    context_ms: durations.context,
    fetch_ms: durations.fetch,
    render_ms: durations.render,
    measured_sum_ms: measured.length ? measured.reduce((a, b) => a + b, 0) : undefined,
    tab_hidden: everHidden,
  };
}

/** Test-only: clear recorded marks between cases. */
export function _resetForTesting(): void {
  delete durations.context;
  delete durations.fetch;
  delete durations.render;
  bootstrapMs = undefined;
  everHidden = typeof document !== 'undefined' ? document.hidden : false;
}
