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
  | "asyncapi"
  | "embed"
  | "plantuml"
  | "none";

export type Surface =
  | "viewer"
  | "editor"
  | "modal"
  | "page_banner"
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

export type RenderMode = "live_render" | "cached_svg";

// Browser cache state at macro render time, derived from Resource Timing
// transferSize of the macro's same-origin JS bundle:
//   warm    — bundle served from HTTP/disk cache (transferSize ~ 0)
//   cold    — bundle downloaded over the wire (transferSize = wire bytes)
//   unknown — Resource Timing unavailable (e.g. test env) or no same-origin script seen
// Lets cold-vs-warm render-time comparisons use a measured signal instead of
// inferring cache state from duration magnitude. See trackRenderTime.ts.
export type CacheState = "cold" | "warm" | "unknown";

// Where a `cached_svg` render sourced its SVG. `none` for `live_render`.
// `cc_body` = SVG co-stored in the custom-content body (Phase 2);
// `attachment` / `localstorage` reserved for a future static fast-path viewer.
export type CacheSource = "none" | "cc_body" | "attachment" | "localstorage";

export type FeedbackValue = "good" | "partial" | "bad";

export type AnalyticsEventName =
  | "macro_viewed"
  | "macro_create_started"
  | "macro_create_succeeded"
  | "macro_edit_opened"
  | "macro_edit_cancelled"
  | "macro_save_succeeded"
  | "macro_save_failed"
  // Embed re-target attempted from a non-submittable surface (e.g. the
  // view-mode Edit modal). view.submit() throws "view is not submittable"
  // there, so the embed's document reference cannot be changed — the user
  // must re-target from the page editor. Tracks how often users hit this.
  | "embed_retarget_blocked"
  // AsyncAPI dashboard: user clicked a document card's "Page:" reference to
  // open the Confluence page hosting the doc. Tracks dashboard → page nav.
  | "asyncapi_dashboard_page_opened"
  | "macro_export_requested"
  | "macro_export_succeeded"
  | "macro_export_failed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_title_dismissed"
  | "ai_title_accepted"
  | "ai_title_modified"
  | "ai_editor_opened"
  | "ai_feedback_submitted"
  | "ai_repair_requested"
  | "ai_repair_succeeded"
  | "ai_repair_failed"
  | "ai_repair_applied"
  | "ai_repair_dismissed"
  | "upgrade_modal_shown"
  | "paywall_triggered"
  | "paywall_blocked_create"
  | "upgrade_modal_dismissed"
  | "upgrade_feature_enabled"
  | "paywall_continue_used"
  | "paywall_attempts_exhausted"
  | "paywall_banner_shown"
  | "paywall_banner_dismissed"
  | "space_admin_active"
  | "advocacy_message_copied"
  | "advocacy_draft_preview_clicked"
  | "extension_request_clicked"
  | "content_sync_requested"
  | "content_sync_succeeded"
  | "content_sync_failed"
  | "custom_content_loaded"
  | "confluence_page_viewed"
  | "confluence_page_updated"
  | "csat_displayed"
  | "csat_submitted"
  | "csat_dismissed"
  | "feedback_link_clicked"
  | "feature_flags_fetch_failed"
  | "attachment_create_failed"
  | "custom_content_update_failed"
  | "graph_editor_init_empty"
  | "editor_load_empty_active_field"
  | "swagger_editor_config_empty_with_modal"
  | "fullscreen_opened"
  | "viewer_load_failed"
  | "close_guard_rejected"
  | "renderer_prefetch_started"
  | "renderer_prefetch_completed";

// Where an idle renderer-bundle prefetch ran: an alive macro iframe after its
// own render settled, or the page-banner iframe on its no-banner fast-path.
// See utils/prefetch/rendererPrefetch.ts.
export type PrefetchHost = "macro" | "banner";

// Terminal outcome of a prefetch attempt: every asset settled ok, some assets
// failed/timed out, nothing was warmed at all, or the deadline fired before
// any per-asset result arrived (timed_out).
export type PrefetchOutcome = "completed" | "partial" | "failed" | "timed_out";
