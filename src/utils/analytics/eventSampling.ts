// src/utils/analytics/eventSampling.ts
//
// Central, build-time event sampling to keep Mixpanel volume under quota.
//
// Both emit paths consult this before calling `mixpanel.track`:
//   - trackAnalyticsEvent (modern) keyed on the AnalyticsEventName
//   - trackEvent          (legacy, utils/window.ts) keyed on the `action` arg
//
// An event maps to a keep-probability in [0, 1]:
//   1 (or absent) — always emit (the default; product, paywall, funnel, error events)
//   0             — never emit (telemetry whose purpose is served; e.g. validated rollouts)
//   0 < r < 1     — emit a random fraction r; the emitted event is stamped with
//                   `sample_rate: r` so downstream extrapolates `count / r`.
//
// Single source of truth: change a rate here, and it takes effect on the next
// deploy across every call site of that event — no per-site edits.
import { isOctoberBillingBudgetActive } from "@/lib/octoberBudgetWindow.js";

export const EVENT_SAMPLE_RATES: Record<string, number> = {
  // --- Sampled to 10% -------------------------------------------------------
  // High-volume success / info diagnostics. 10% plus `sample_rate` extrapolation
  // is ample for rate/health trends; we do not need every occurrence.
  convert_to_png: 0.1, // model/Attachment.ts — PNG render side-effect
  upload_attachment: 0.1, // model/Attachment.ts — attachment upload (success path)
  attachment_upload_succeeded: 0.1,
  attachment_upload_app_fallback_started: 0.1,
  attachment_upload_app_fallback_succeeded: 0.1,
  attachment_upload_skipped: 0.1,
  sync_custom_content: 0.1, // services/CustomContent.ts (success path)
  update_custom_content: 0.1, // model/ApWrapper2.ts (info path)
  report_macro_metrics: 0.1, // KV metrics reporting
  duplication_detect: 0.1, // model/ApWrapper2.ts — cross/same-page warning probe
  click: 0.1, // generic UI-click telemetry (edit/fullscreen/copy_link/…)
  close_guard_rejected: 0.1, // editor close-guard diagnostic

  // Phase-5a admin-activity probe (spaceAdminProbe.ts). The measurement question
  // — "do admins load Confluence pages on Lite installs?" — is answered (~38k
  // distinct domain×space×admin contexts in 17 days; the 30-day localStorage
  // throttle works, ~86% of triples fire exactly once). The volume is genuine
  // cardinality, not a leak, so sample the signal rather than chase the throttle.
  space_admin_active: 0.1,

  // --- Quota reduction 2026-08-26 -------------------------------------------
  // Fired once per macro view by DiagramAttributionFooter.vue, so it scales
  // with `macro_viewed` and was the joint-largest product event at 62,338 in
  // the 2026-08-19..25 week (9.8% of all volume). Its question — how often the
  // attribution byline is seen, and with which of its two optional fields — is
  // a rate, not a census, so 5% plus `sample_rate` extrapolation answers it.
  diagram_attribution_shown: 0.05,

  // --- Quota reduction 2026-09-07 -------------------------------------------
  // Fires once per eligible viewer INSTANCE, so a page of macros produces one
  // per macro: 80,912 occurrences from 4,414 unique users in the 30 days to
  // 2026-09-07 — 18.3 each, and 19.4% of all billable event volume, which is
  // most of the month's projected overage on its own.
  //
  // Its only consumer is the Copy for AI discovery rate (clicks ÷ impressions),
  // a rate rather than a census, and the click side stays at full fidelity.
  // The rate this event was built to produce is 3.76% (166 ÷ 4,414), first
  // computed on 2026-09-07 — after the demand test it was meant to inform had
  // already concluded on its own denominator.
  //
  // Caveat for whoever reads it next: `sample_rate` extrapolates EVENT counts,
  // not UNIQUE-USER counts. At 10% a user averaging 18.3 impressions still has
  // an ~86% chance of keeping at least one, so the unique-user denominator
  // shrinks by roughly a seventh rather than by nine tenths — but the loss
  // falls hardest on users with a single impression, which biases the
  // denominator toward heavier viewers and makes the measured discovery rate a
  // slight UNDER-estimate. Take the pre-sampling 3.76% as the reference point.
  copy_for_ai_impression: 0.1,
};

// Prefix rules apply when no exact match is found. `create_attachment` is
// emitted as `create_attachment<diagramType>` (e.g. create_attachmentmermaid)
// at forgeIndex.ts, so an exact key cannot cover every variant.
const PREFIX_RULES: ReadonlyArray<readonly [string, number]> = [
  ["create_attachment", 0.1],
];

// October 2026 cost control: only these conf-app browser event names are
// stopped. Other products in the shared Mixpanel project are unaffected.
export const OCTOBER_STOP_EVENTS = new Set<string>([
  "cohorts_refreshed",
  "copy_for_ai_impression",
  "editor_global_replace_observed",
  "report_macro_metrics",
  "snapshot_backfill_skipped",
  "viewport_control_used",
  "whats_new_banner_evaluated",
]);

// The reviewed core/error list is explicit so an expanded success/info
// allowlist cannot silently reduce a protected event during this budget.
export const OCTOBER_RETAINED_EVENTS = new Set<string>([
  "agent_link_edit_failed",
  "ai_repair_failed",
  "ai_title_generation_failed",
  "attachment_upload_async_failed",
  "attachment_upload_failed",
  "cohorts_refresh_failed",
  "diagram_audience_registration_failed",
  "export_png_failed",
  "feedback_link_clicked",
  "feedback_report_dismissed",
  "feedback_report_handoff_opened",
  "feedback_report_handoff_requested",
  "feedback_report_opened",
  "feedback_report_submit_requested",
  "feedback_report_submit_succeeded",
  "load_failed_retry_clicked",
  "load_failed_retry_resolved",
  "macro_authoring_ended",
  "macro_create_cancelled",
  "macro_create_started",
  "macro_create_succeeded",
  "macro_edit_cancelled",
  "macro_edit_started",
  "macro_export_failed",
  "macro_publish_completed",
  "macro_save_failed",
  "macro_save_succeeded",
  "macro_viewed",
  "magic_layout_feedback_prompt_shown",
  "magic_layout_feedback_submitted",
  "magic_layout_feedback_updated",
  "magic_view_failed",
  "markdown_render_failed",
  "mermaid_highlight_feedback_answered",
  "mermaid_highlight_feedback_dismissed",
  "mermaid_highlight_feedback_reason_selected",
  "mermaid_highlight_feedback_shown",
  "paywall_banner_dismissed",
  "paywall_banner_shown",
  "paywall_bundle_cta_clicked",
  "paywall_gate_evaluated",
  "paywall_triggered",
  "plan_usage_request_full_clicked",
  "publish_failed",
  "related_diagrams_lookup_failed",
  "render_failed",
  "request_full_atlassian_clicked",
  "request_full_guide_shown",
  "save_existence_check_failed",
  "save_failed",
  "save_failed_diagnosed",
  "snapshot_create_failed",
  "snapshot_created",
  "update_custom_content_error",
  "view_submit_failed",
  "viewer_load_failed",
  // Low-volume action signal with an existing E2E wire assertion.
  "copy_for_ai_clicked",
]);

// Explicit conf-app browser success/info allowlist. Core lifecycle, paywall,
// error/failure, feedback, survey, and CSAT names stay at current rates.
// Unknown names remain unchanged. The full reviewed list follows below.
export const OCTOBER_REDUCED_EVENTS = new Set<string>([
  "markdown_render_requested",
  "markdown_render_succeeded",
  "markdown_seeded_from_mermaid",
  "macro_type_changed",
  "plantuml_paste_normalized",
  "embed_autoconvert_detected",
  "embed_autoconvert_target_resolved",
  "asyncapi_dashboard_page_opened",
  "dashboard_format_filtered",
  "dashboard_create_selected",
  "macro_export_requested",
  "macro_export_succeeded",
  "export_annotation_tool_clicked",
  "export_annotation_created",
  "export_annotation_changed",
  "export_annotation_deleted",
  "export_annotations_restored",
  "export_png_opened",
  "export_png_succeeded",
  "export_png_dismissed",
  "ai_title_generation_requested",
  "ai_title_generation_succeeded",
  "ai_title_dismissed",
  "ai_title_accepted",
  "ai_title_modified",
  "ai_chat_button_shown",
  "ai_chat_opened",
  "ai_chat_closed",
  "ai_chat_suggestion_selected",
  "ai_chat_prompt_submitted",
  "ai_chat_no_change",
  "ai_chat_change_applied",
  "ai_chat_prompt_cancelled",
  "ai_chat_code_visibility_toggled",
  "ai_chat_syntax_issue_shown",
  "ai_chat_syntax_repair_requested",
  "ai_chat_diff_toggled",
  "ai_chat_history_opened",
  "ai_chat_history_load_succeeded",
  "ai_chat_version_restore_requested",
  "ai_chat_version_restored",
  "ai_chat_change_undone",
  "ai_repair_button_shown",
  "ai_repair_requested",
  "ai_repair_succeeded",
  "ai_repair_applied",
  "ai_repair_dismissed",
  "magic_writeback_requested",
  "magic_writeback_skipped",
  "magic_availability_checked",
  "magic_default_resolved",
  "magic_view_requested",
  "magic_view_succeeded",
  "magic_view_restored",
  "magic_preference_changed",
  "upgrade_modal_shown",
  "upgrade_modal_dismissed",
  "paywall_continue_used",
  "paywall_continued_editing",
  "paywall_attempts_exhausted",
  "paywall_marketplace_cta_clicked",
  "paywall_learn_more_clicked",
  "space_admin_active",
  "advocacy_message_copied",
  "advocacy_draft_preview_clicked",
  "extension_request_clicked",
  "extension_action_requested",
  "extension_action_succeeded",
  "graph_editor_init_empty",
  "graph_editor_mode_switch_requested",
  "graph_editor_mode_switch_succeeded",
  "editor_load_empty_active_field",
  "swagger_editor_config_empty_with_modal",
  "fullscreen_opened",
  "viewport_zoom_hint_shown",
  "viewer_source_opened",
  "viewer_source_copied",
  "mermaid_highlight_used",
  "mermaid_highlight_preference_changed",
  "mermaid_highlight_hint_shown",
  "mermaid_highlight_hint_dismissed",
  "copy_for_ai_menu_opened",
  "viewer_more_menu_opened",
  "create_guide_impression",
  "create_guide_opened",
  "create_guide_closed",
  "deeplink_copied",
  "staleness_hint_shown",
  "staleness_hint_clicked",
  "staleness_hint_dismissed",
  "byline_opened",
  "byline_list_retried",
  "byline_diagram_opened",
  "byline_diagram_source_copied",
  "byline_create_clicked",
  "byline_editor_deeplinked",
  "byline_dismissed",
  "byline_thumbnails_loaded",
  "byline_unplaced_scanned",
  "byline_diagram_created",
  "byline_create_cancelled",
  "byline_view_close_requested",
  "unplaced_banner_evaluated",
  "unplaced_banner_shown",
  "unplaced_banner_dismissed",
  "unplaced_property_write",
  "whats_new_banner_shown",
  "whats_new_banner_expanded",
  "whats_new_banner_dismissed",
  "whats_new_link_clicked",
  "diagram_added_to_page",
  "diagram_revealed",
  "snapshot_fallback_rendered",
  "diagram_attribution_shown",
  "diagram_audience_registration_succeeded",
  "related_diagrams_lookup_succeeded",
  "related_token_indicators_shown",
  "related_diagram_popover_opened",
  "related_diagram_link_clicked",
  "attachment_upload_async_succeeded",
  "attachment_upload_async_skipped",
  "macro_count_snapshot_completed",
  "macro_count_space_changed",
  "macro_convert_job_claimed",
  "macro_convert_job_completed",
  "draft_banner_shown",
  "draft_restored",
  "draft_discarded",
  "draft_banner_dismissed",
  "edit_dup_gate_evaluated",
  "agent_link_connect_clicked",
  "agent_link_session_created",
  "agent_link_setup_shown",
  "agent_link_agent_connected",
  "agent_link_page_read",
  "agent_link_edit_applied",
  "agent_link_disconnected",
  "agent_link_render_completed",
  "agent_link_session_suspended",
  "agent_link_session_resumed",
  "agent_link_session_expired",
  "agent_link_session_extended",
  "agent_link_diagram_read",
  "agent_link_search_performed",
  "agent_link_list_performed",
  "agent_link_identity_resolved",
  "agent_link_oauth_authorized",
  "agent_link_oauth_revoked",
  "agent_link_oauth_chain_revoked",
  "agent_link_diagram_created",
  "agent_link_diagram_updated",
  "agent_link_page_created",
  "agent_link_page_updated",
  "agent_link_mcp_dialog_opened",
  "agent_link_mcp_dialog_copied",
  "agent_link_mcp_dialog_closed",
  "agent_link_mcp_initialized",
  "activation_nudge_clicked",
  "activation_served",
  "activation_cache_miss",
  "activation_diagram_edited",
  "activation_completed",
  "activation_nudge_dismissed",
  "editor_template_gallery_opened",
  "editor_template_applied",
  "editor_starter_shown",
  "editor_code_panel_toggled",
  "macro_second_diagram_prompt_shown",
  "macro_second_diagram_prompt_clicked",
  "foreign_dialect_hint_shown",
  "foreign_dialect_hint_switch_clicked",
  "foreign_dialect_hint_dismissed",
  "homepage_feed_viewed",
  "homepage_feed_action_clicked",
  "homepage_feed_diagram_opened",
  "homepage_feed_example_expanded",
  "plan_usage_viewed",
  "plan_usage_purchase_clicked",
  "request_full_reason_copied",
  "ai_aide_route_accessed",
  "analytics_dashboard_deleted_saved_view",
  "analytics_dashboard_export",
  "analytics_dashboard_inspect_row",
  "analytics_dashboard_loaded_saved_view",
  "analytics_dashboard_page_view",
  "analytics_dashboard_saved_view",
  "attachment_upload_app_fallback_started",
  "attachment_upload_app_fallback_succeeded",
  "attachment_upload_queued",
  "attachment_upload_skipped",
  "attachment_upload_succeeded",
  "click",
  "convert_to_png",
  "customcontent_orphan_macro_repaired",
  "customcontent_orphan_observed",
  "duplication_detect",
  "document_list",
  "get_feature_flags",
  "get_started_create_embed",
  "get_started_create_first_diagram",
  "get_started_create_graph",
  "get_started_create_mermaid",
  "get_started_create_openapi",
  "get_started_create_sequence",
  "get_started_page_view",
  "get_started_route_accessed",
  "get_started_view_docs",
  "legacy_content_property_macro_repaired",
  "legacy_content_property_restored",
  "legacy_custom_content_by_uuid_restored",
  "load",
  "new_diagram_link_seeded",
  "sync_custom_content",
  "update_custom_content",
  "update_recreate_fallback",
  "upload_attachment",
  "writeback_unbound_first_save",
]);

/** Keep-probability for an event name/action. Defaults to 1 (always emit). */
export function sampleRateFor(name: string, now = Date.now()): number {
  let currentRate = 1;
  if (Object.prototype.hasOwnProperty.call(EVENT_SAMPLE_RATES, name)) {
    currentRate = EVENT_SAMPLE_RATES[name];
  } else {
    for (const [prefix, rate] of PREFIX_RULES) {
      if (name.startsWith(prefix)) {
        currentRate = rate;
        break;
      }
    }
  }
  if (!isOctoberBillingBudgetActive(now)) return currentRate;
  if (OCTOBER_STOP_EVENTS.has(name)) return 0;
  if (OCTOBER_RETAINED_EVENTS.has(name)) return currentRate;
  // The legacy `create_attachment<diagramType>` family has a dynamic suffix.
  // Its error-category emit still bypasses sampling in window.ts.
  if (OCTOBER_REDUCED_EVENTS.has(name) || name.startsWith("create_attachment")) {
    return currentRate / 10;
  }
  return currentRate;
}

export interface SampleDecision {
  /** Whether to emit this occurrence. */
  keep: boolean;
  /** The applied rate — stamp as `sample_rate` when < 1 so volume extrapolates. */
  rate: number;
}

/**
 * Decide whether to emit one occurrence of `name`. `rng` is injectable so tests
 * are deterministic; production uses Math.random.
 */
export function decideSample(
  name: string,
  rng: () => number = Math.random,
  now = Date.now(),
): SampleDecision {
  const rate = sampleRateFor(name, now);
  if (rate >= 1) return { keep: true, rate: 1 };
  if (rate <= 0) return { keep: false, rate: 0 };
  return { keep: rng() < rate, rate };
}
