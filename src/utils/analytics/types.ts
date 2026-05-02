// src/utils/analytics/types.ts

import type {
  FeatureArea,
  MacroTypeValue,
  Surface,
  EntryPoint,
  OperationMode,
  FeedbackValue,
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
  is_forge?: boolean;
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
  // Feedback
  feedback_value?: FeedbackValue;
  feedback_score?: number;
  // Content
  content_id?: string;
  content_type?: string;
  content_status?: string;
  // Error
  error_code?: string;
  error_name?: string;
  error_source?: string;
};
