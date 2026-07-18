import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import type { CacheState, MacroTypeValue, RenderMode, CacheSource } from './catalog';
import { getTimings } from './renderPerf';
import { getRenderIdentity } from './renderIdentity';
import { isPrefetchDue } from '@/utils/prefetch/throttle';
import type { PrefetchRenderer } from '@/utils/prefetch/rendererPrefetch';

// Below this many summed wire bytes across same-origin scripts we treat the boot
// as warm: a disk-cache hit reports transferSize 0 and a 304 revalidation only a
// few hundred header bytes, while a real cold download of the app bundle is
// hundreds of KB. 10 KB cleanly separates the two.
const COLD_TRANSFER_THRESHOLD_BYTES = 10240;

// Derive browser cache state from Resource Timing. Only same-origin scripts are
// counted: a cross-origin resource without Timing-Allow-Origin reports
// transferSize 0 even when downloaded, which would misread a cold boot as warm.
// Inside the Forge hosted-resources iframe the app's own chunks are same-origin,
// so their transferSize is accurate. Returns 'unknown' when Resource Timing is
// unavailable (e.g. test env) or no same-origin script was observed.
export function measureCacheState(): {
  cacheState: CacheState;
  transferBytes?: number;
} {
  try {
    const origin = location.origin;
    const entries = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    if (!entries || entries.length === 0) return { cacheState: 'unknown' };
    let bytes = 0;
    let sawScript = false;
    for (const e of entries) {
      const isScript =
        e.initiatorType === 'script' || /\.js(\?|$)/.test(e.name);
      if (!isScript || !e.name.startsWith(origin)) continue;
      sawScript = true;
      bytes += e.transferSize || 0;
    }
    if (!sawScript) return { cacheState: 'unknown' };
    return {
      cacheState: bytes > COLD_TRANSFER_THRESHOLD_BYTES ? 'cold' : 'warm',
      transferBytes: bytes,
    };
  } catch {
    return { cacheState: 'unknown' };
  }
}

// Guards on window.__macroLoadStart (set in index.html head) — silently
// no-ops in test environments that mount components without the HTML wrapper.
//
// `cacheSource` records where a `cached_svg` render got its SVG so we can tell
// the cache-hit path apart from live render in Mixpanel. Defaults to 'none',
// which is the correct value for `live_render` (the existing 2-arg callers).
export function trackRenderTime(
  macroType: MacroTypeValue,
  isDisplayMode: boolean,
  renderMode: RenderMode = 'live_render',
  cacheSource: CacheSource = 'none',
): void {
  const t0 = window.__macroLoadStart;
  if (typeof t0 !== 'number') return;
  const duration_ms = Math.round(performance.now() - t0);
  const timings = getTimings();
  const { cacheState, transferBytes } = measureCacheState();
  // Dev-only: surface the phase breakdown locally (mirrors the POC harness).
  // Stripped from prod by the bundler's `import.meta.env.DEV` constant fold.
  if (import.meta.env.DEV) {
    console.debug('[macro_viewed]', { macro_type: macroType, duration_ms, ...timings });
  }
  trackAnalyticsEvent('macro_viewed', {
    feature_area: 'macro',
    surface: isDisplayMode ? 'viewer' : 'editor',
    macro_type: macroType,
    render_mode: renderMode,
    cache_source: cacheSource,
    duration_ms,
    cache_state: cacheState,
    ...(transferBytes !== undefined ? { transfer_bytes: transferBytes } : {}),
    ...timings,
    ...getRenderIdentity(),
  });

  scheduleRendererPrefetch(macroType);
}

const PREFETCHABLE: readonly PrefetchRenderer[] = ['graph', 'mermaid', 'sequence', 'openapi'];

// Macro-host half of the idle renderer prefetch (EAG-64): this iframe just
// finished rendering and will stay alive, so at idle it warms the OTHER
// renderer families' bundles (utils/prefetch/rendererPrefetch.ts). The render
// path is untouched — the orchestrator chunk is only imported at idle, and
// only when the cheap due-check says an attempt is possible (≤1 per deploy
// per browser). `macro_viewed` for THIS render has already been measured and
// sent above, so the extra resource fetches cannot skew its cache_state.
function scheduleRendererPrefetch(macroType: MacroTypeValue): void {
  try {
    if (!isPrefetchDue()) return;
    const idle = window.requestIdleCallback
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 10_000 })
      : (cb: () => void) => window.setTimeout(cb, 3_000);
    idle(() => {
      import('@/utils/prefetch/rendererPrefetch')
        .then(({ runRendererPrefetchIfDue }) =>
          runRendererPrefetchIfDue({
            host: 'macro',
            // This iframe's own family is already loaded; embed/plantuml hosts
            // exclude nothing (embed can wrap any type, plantuml has no bundle).
            excludeRenderers: PREFETCHABLE.filter((r) => r === macroType),
          }),
        )
        .catch(() => undefined);
    });
  } catch {
    // Prefetch is an optimization — never let it surface to the render path.
  }
}
