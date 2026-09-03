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

import type { ContentSource } from './catalog';

export type RenderPhase = 'context' | 'fetch' | 'render' | 'cc_fetch' | 'adf_scan';

const durations: Partial<Record<RenderPhase, number>> = {};
let bootstrapMs: number | undefined;
let contentSource: ContentSource | undefined;

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
 * of app code (forgeIndex `initializeCriticalPath`). Captures the remaining
 * blocking head scripts + entry bundle eval that run before any app logic.
 * No-ops if `__macroLoadStart` isn't set (test/headless mounts).
 */
export function markAppEntry(): void {
  if (bootstrapMs !== undefined) return;
  const start = loadStart();
  if (start === undefined) return;
  bootstrapMs = Math.round(performance.now() - start);
}

/**
 * Record where the macro's CONTENT (the diagram doc) came from this render, so
 * `trackRenderTime` can tag `macro_viewed` with it (via getTimings). Unlike the
 * phase timers, this is last-wins: the content-SWR fast path marks 'swr_cache'
 * when it mounts the cached doc, and a background revalidate that re-renders the
 * fresh doc overrides it with 'fetch'. Left unmarked (undefined) when no content
 * fetch was involved — absent in the payload, never a default.
 */
export function markContentSource(src: ContentSource): void {
  contentSource = src;
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
  // Children of fetch_ms (custom-content GET vs page-ADF copy-scan). Not
  // added to measured_sum_ms — they'd double-count their parent.
  custom_content_fetch_ms?: number;
  page_adf_fetch_ms?: number;
  measured_sum_ms?: number;
  tab_hidden?: boolean;
  content_source?: ContentSource;
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
    custom_content_fetch_ms: durations.cc_fetch,
    page_adf_fetch_ms: durations.adf_scan,
    measured_sum_ms: measured.length ? measured.reduce((a, b) => a + b, 0) : undefined,
    tab_hidden: everHidden,
    content_source: contentSource,
  };
}

/** Test-only: clear recorded marks between cases. */
export function _resetForTesting(): void {
  delete durations.context;
  delete durations.fetch;
  delete durations.render;
  delete durations.cc_fetch;
  delete durations.adf_scan;
  bootstrapMs = undefined;
  contentSource = undefined;
  everHidden = typeof document !== 'undefined' ? document.hidden : false;
}
