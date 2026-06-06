import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import type { CacheState, MacroTypeValue, RenderMode } from './catalog';

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
export function trackRenderTime(
  macroType: MacroTypeValue,
  isDisplayMode: boolean,
  renderMode: RenderMode = 'live_render',
): void {
  const t0 = window.__macroLoadStart;
  if (typeof t0 !== 'number') return;
  const { cacheState, transferBytes } = measureCacheState();
  trackAnalyticsEvent('macro_viewed', {
    feature_area: 'macro',
    surface: isDisplayMode ? 'viewer' : 'editor',
    macro_type: macroType,
    render_mode: renderMode,
    duration_ms: Math.round(performance.now() - t0),
    cache_state: cacheState,
    ...(transferBytes !== undefined ? { transfer_bytes: transferBytes } : {}),
  });
}
