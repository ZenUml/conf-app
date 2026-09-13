import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { viewportSurface } from '@/utils/viewport/surface';

/** Which control the reader used. One gesture counts as one `wheel`. */
export type ViewportInput = 'toolbar' | 'wheel';

/**
 * Report a deliberate zoom.
 *
 * One call site for all four renderers and both controls, because the event is
 * about the reader's intent rather than the engine underneath: Mermaid and
 * PlantUML zoom through svg-pan-zoom, Graph through mxGraph and Sequence through
 * a CSS transform, and none of that belongs in the analytics. Keeping it here
 * also keeps `surface` derived one way — the property #368 has been misread on
 * before.
 */
export function trackViewportControl(options: {
  macroType: string;
  viewportAction: 'zoom_in' | 'zoom_out';
  viewportInput: ViewportInput;
  isDisplayMode: boolean;
}): void {
  trackAnalyticsEvent('viewport_control_used', {
    feature_area: 'macro',
    surface: viewportSurface(options.isDisplayMode),
    macro_type: options.macroType,
    viewport_action: options.viewportAction,
    viewport_input: options.viewportInput,
  });
}
