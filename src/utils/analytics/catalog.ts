// src/utils/analytics/catalog.ts

export type FeatureArea =
  | "diagram"
  | "ai"
  | "upgrade"
  | "content"
  | "confluence"
  | "feedback"
  | "system";

export type DiagramTypeValue =
  | "sequence"
  | "mermaid"
  | "graph"
  | "openapi"
  | "embed"
  | "plantuml"
  | "none";

export type Surface =
  | "viewer"
  | "editor"
  | "modal"
  | "dashboard"
  | "route"
  | "forge_trigger";

export type EntryPoint =
  | "page_view"
  | "macro_toolbar"
  | "page_editor"
  | "get_started"
  | "viewer_notice"
  | "ai_prompt"
  | "dashboard"
  | "route"
  | "forge_trigger"
  | "unknown";

export type OperationMode = "create" | "edit" | "unknown";

export type FeedbackValue = "good" | "partial" | "bad";

export type AnalyticsEventName =
  | "diagram_viewed"
  | "diagram_create_started"
  | "diagram_create_succeeded"
  | "diagram_edit_opened"
  | "diagram_edit_cancelled"
  | "diagram_save_succeeded"
  | "diagram_save_failed"
  | "diagram_export_requested"
  | "diagram_export_succeeded"
  | "diagram_export_failed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_editor_opened"
  | "ai_feedback_submitted"
  | "upgrade_modal_shown"
  | "upgrade_cta_clicked"
  | "upgrade_action_blocked"
  | "upgrade_modal_dismissed"
  | "upgrade_prompt_hovered"
  | "upgrade_slider_changed"
  | "content_sync_requested"
  | "content_sync_succeeded"
  | "content_sync_failed"
  | "custom_content_loaded"
  | "confluence_page_viewed"
  | "confluence_page_updated"
  | "csat_submitted"
  | "feedback_link_clicked"
  | "feature_flags_fetch_failed"
  | "attachment_create_failed"
  | "custom_content_update_failed";
