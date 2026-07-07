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

// Format slice selected on the dual-format ("My API Documents") dashboard's
// tab / Format filter. "all" shows both AsyncAPI and OpenAPI docs.
export type DashboardFormatFilter = "all" | "asyncapi" | "openapi";

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

// Where the macro count used by the Lite paywall gate came from, and — when the
// count is unusable — WHY. Rides on `paywall_gate_evaluated.macro_count_source`.
// This is the dispositive dimension for the #302 fail-open leak: the gate is
// `macrosCreated >= 100`, but `macrosCreated` defaults to 0, so a `undefined`
// (read failed) or `zero` (under-return) source means the gate silently does not
// fire on a genuinely over-limit space. `kv` = served from the KV cache (may be
// stale-low); `collect` = fresh space enumeration; `mock` = localStorage override.
export type MacroCountSource = "kv" | "collect" | "undefined" | "zero" | "mock";

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
  // Dual-format dashboard: user switched the format tab / Format filter
  // (All / AsyncAPI / OpenAPI). Tracks how the mixed AsyncAPI+OpenAPI document
  // list is being sliced; the chosen value rides on `format_filter`.
  | "dashboard_format_filtered"
  // Dual-format dashboard: user picked a format from the "Create New API"
  // split-button menu (AsyncAPI vs OpenAPI) — the funnel entry BEFORE the
  // editor's own macro_create_started fires. `macro_type` carries the choice.
  | "dashboard_create_selected"
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
  // Fires once per Lite paywall gate evaluation (editor + fullscreen-viewer
  // mount), whether or not the gate fired. Direct instrumentation for the #302
  // fail-open leak: `gate_fired` + `macro_count` + `macro_count_source` let us
  // measure how often an over-limit space slips through because the count read
  // failed / under-returned, and split the cause (KV stale-low vs collect fail).
  // See utils/paywall/mountPaywallGate.ts.
  | "paywall_gate_evaluated"
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
