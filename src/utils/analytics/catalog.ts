// src/utils/analytics/catalog.ts

export type FeatureArea =
  | "macro"
  | "ai"
  | "upgrade"
  | "content"
  | "confluence"
  | "feedback"
  | "system";

export type MacroTypeValue =
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
  | "macro_viewed"
  | "macro_create_started"
  | "macro_create_succeeded"
  | "macro_edit_opened"
  | "macro_edit_cancelled"
  | "macro_save_succeeded"
  | "macro_save_failed"
  | "macro_export_requested"
  | "macro_export_succeeded"
  | "macro_export_failed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_editor_opened"
  | "ai_feedback_submitted"
  | "upgrade_modal_shown"
  | "upgrade_cta_clicked"
  | "paywall_triggered"
  | "upgrade_modal_dismissed"
  | "upgrade_slider_changed"
  | "upgrade_feature_enabled"
  | "advocacy_message_copied"
  | "advocacy_draft_preview_clicked"
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
