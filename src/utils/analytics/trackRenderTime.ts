import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import type { MacroTypeValue, RenderMode } from './catalog';

export function trackRenderTime(
  macroType: MacroTypeValue,
  isDisplayMode: boolean,
  renderMode: RenderMode = 'live_render',
): void {
  const t0 = window.__macroLoadStart;
  if (typeof t0 !== 'number') return;
  trackAnalyticsEvent('diagram_rendered', {
    feature_area: 'macro',
    surface: isDisplayMode ? 'viewer' : 'editor',
    macro_type: macroType,
    render_mode: renderMode,
    duration_ms: Math.round(performance.now() - t0),
  });
}
