// src/utils/analytics/types.ts

import type {
  FeatureArea,
  MacroTypeValue,
  Surface,
  EntryPoint,
  OperationMode,
  FeedbackValue,
  RenderMode,
  CacheState,
  CacheSource,
  PrefetchHost,
  PrefetchOutcome,
} from "./catalog";

export type AnalyticsProperties = {
  // Required at call site
  feature_area: FeatureArea;
  surface: Surface;
  // Auto-enriched by tracker (optional for callers)
  client_domain?: string;
  user_account_id?: string;
  product_type?: "lite" | "full" | "diagramly";
  environment_type?: string;
  // Contextual — required when scope implies them
  macro_type?: MacroTypeValue;
  // For macro_type='embed': the inner diagram type the embed actually rendered.
  wrapped_type?: MacroTypeValue;
  entry_point?: EntryPoint;
  confluence_space?: string;
  macro_uuid?: string;
  // Lifecycle
  operation_mode?: OperationMode;
  result?: string;
  failure_reason?: string;
  // Upgrade
  product_option?: string;
  ui_component?: string;
  cta_position?: "primary" | "secondary";
  feature_name?: string;
  source?: string;
  // AI
  prompt_length?: number;
  generation_source?: string;
  accepted_title?: string;
  // Feedback
  feedback_value?: FeedbackValue;
  feedback_score?: number;
  feedback_text?: string;
  // Content
  content_id?: string;
  content_type?: string;
  content_status?: string;
  page_id?: string;
  custom_content_id?: string;
  attachment_name?: string;
  space_admin_count?: number;
  // True when the current user is resolved to be a space admin of the current
  // space. Set on `space_admin_active` (Phase 5a admin-activity probe). Only
  // emitted as `true` today; kept optional for a future "always, with flag"
  // rate variant. See utils/paywall/spaceAdminProbe.ts.
  is_space_admin?: boolean;
  // Diagramly demo-page engagement: set automatically for macro_* events when
  // the macro lives on a page tagged with the `diagramly-demo-page` page
  // property. See utils/analytics/demoPageStatus.ts.
  is_demo_page?: boolean;
  // Performance
  render_mode?: RenderMode;
  // Where a cached_svg render sourced its SVG (Phase 2: 'cc_body'). Absent/'none' for live_render.
  cache_source?: CacheSource;
  duration_ms?: number;
  // Browser cache state at render time, measured via Resource Timing transferSize
  // of same-origin JS bundles, plus the raw summed wire bytes. Lets cold/warm
  // render-time comparisons use a measured signal rather than inferring cache
  // state from duration magnitude. See utils/analytics/trackRenderTime.ts.
  cache_state?: CacheState;
  transfer_bytes?: number;
  // Phase 0b sub-timings (renderPerf). Attribute duration_ms to load phases so we
  // can pick the right optimization lever. Absent phases are omitted, not 0.
  bootstrap_ms?: number;   // __macroLoadStart → first app code (head scripts incl. DrawIO + bundle eval)
  context_ms?: number;     // Forge getContext() resolution
  fetch_ms?: number;       // custom-content REST round trip
  render_ms?: number;      // viewer diagram render (mermaid still folds loadMermaid here; disjoint goal = render-only)
  // "Load our resources" half of the user-defined metric: loadZenUml()/loadMermaid()/
  // ensureDrawioViewerLoaded()/swagger-ui. our-controllable-client-time = resource_load_ms + render_ms
  // (disjoint). Excludes Forge macro-shell bootstrap and platform fetch_ms. Absent ⇒ omitted, never 0.
  resource_load_ms?: number;
  measured_sum_ms?: number; // bootstrap+context+fetch+render; duration_ms − this = unattributed remainder
  tab_hidden?: boolean;    // tab was backgrounded during load → exclude from percentiles (artifact)
  // Renderer-bundle prefetch (renderer_prefetch_started / _completed). Fired
  // only on an actual attempt (throttled to ≤1 per deploy per browser), never
  // on the skip path — volume stays far below page-view scale. See
  // utils/prefetch/rendererPrefetch.ts.
  prefetch_host?: PrefetchHost;
  prefetch_renderers?: string; // comma list, e.g. "graph,mermaid,sequence,openapi"
  prefetch_outcome?: PrefetchOutcome;
  prefetch_assets_count?: number;
  prefetch_failed_count?: number;
  prefetch_duration_ms?: number;
  effective_type?: string; // navigator.connection.effectiveType at attempt time
  save_data?: boolean;
  // Volume sampling: present (and < 1) only when this event was emitted under a
  // keep-probability < 1 (see utils/analytics/eventSampling.ts). Downstream
  // analysis extrapolates true volume as `count / sample_rate`. Absent ⇒ 1.0
  // (every occurrence emitted).
  sample_rate?: number;
  // Error
  error_code?: string;
  error_name?: string;
  error_source?: string;
  // Build info — auto-enriched from VITE_APP_VERSION / VITE_APP_COMMIT
  app_version?: string;
  app_commit?: string;
};
