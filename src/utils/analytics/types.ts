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
  duration_ms?: number;
  // Browser cache state at render time, measured via Resource Timing transferSize
  // of same-origin JS bundles, plus the raw summed wire bytes. Lets cold/warm
  // render-time comparisons use a measured signal rather than inferring cache
  // state from duration magnitude. See utils/analytics/trackRenderTime.ts.
  cache_state?: CacheState;
  transfer_bytes?: number;
  // Error
  error_code?: string;
  error_name?: string;
  error_source?: string;
  // Build info — auto-enriched from VITE_APP_VERSION / VITE_APP_COMMIT
  app_version?: string;
  app_commit?: string;
};
