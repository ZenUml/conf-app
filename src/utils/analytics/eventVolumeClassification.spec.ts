import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATED_SAMPLE_RATES,
  EVENT_SAMPLE_RATES,
  OCTOBER_REDUCED_EVENTS,
  OCTOBER_RETAINED_EVENTS,
  OCTOBER_STOP_EVENTS,
  PER_OCCURRENCE_SAMPLED_EVENTS,
} from "./eventSampling";

/**
 * Every Mixpanel event must have a deliberate volume decision.
 *
 * An event that no table names is sent on every occurrence. That is how
 * license_notice_evaluated and license_notice_shown shipped in November 2026:
 * ~37k each in their first week, 31% of billable volume, against a 1M/month
 * plan allowance. This test fails when a name is added to AnalyticsEventName
 * without a decision, so the decision is made, and reviewed, in the same PR.
 *
 * When it fails for your new event, pick one in eventSampling.ts:
 * - OCTOBER_RETAINED_EVENTS: send every occurrence. Say the expected volume
 *   in a comment; one event per page view or per macro view is rarely needed.
 * - EVENT_SAMPLE_RATES / DATED_SAMPLE_RATES: send a fraction, stamped with
 *   sample_rate so counts extrapolate.
 * - OCTOBER_REDUCED_EVENTS: a success/info event at one tenth of its rate.
 * - OCTOBER_STOP_EVENTS: never send.
 * - PER_OCCURRENCE_SAMPLED_EVENTS: sampled or deduplicated at the emit site.
 */

const CATALOG = path.resolve(__dirname, "catalog.ts");

function catalogEventNames(): string[] {
  const lines = fs.readFileSync(CATALOG, "utf8").split("\n");
  const start = lines.findIndex((l) => /export\s+type\s+AnalyticsEventName\s*=/.test(l));
  if (start < 0) throw new Error("AnalyticsEventName union not found in catalog.ts");
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*")) continue;
    const m = /^\|\s*"([^"]+)"\s*(;)?/.exec(t);
    if (m) {
      names.push(m[1]);
      if (m[2]) break;
    } else if (t.endsWith(";")) {
      break;
    }
  }
  return names;
}

function isClassified(name: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(EVENT_SAMPLE_RATES, name) ||
    Object.prototype.hasOwnProperty.call(DATED_SAMPLE_RATES, name) ||
    OCTOBER_RETAINED_EVENTS.has(name) ||
    OCTOBER_REDUCED_EVENTS.has(name) ||
    OCTOBER_STOP_EVENTS.has(name) ||
    PER_OCCURRENCE_SAMPLED_EVENTS.has(name)
  );
}

// Events that predate this test (2026-11-21) and have no volume decision yet.
// They are sent on every occurrence, as before. Nobody has reviewed them, so
// they are listed here rather than in OCTOBER_RETAINED_EVENTS. This list only
// shrinks: classify an event in eventSampling.ts and delete its line here.
// Never add a new event to it.
const UNCLASSIFIED_BEFORE_GUARD = new Set<string>([
  "agent_link_app_view_failed",
  "agent_link_app_view_fullscreen_requested",
  "agent_link_app_view_rendered",
  "agent_link_app_view_requested",
  "agent_link_app_view_zoomed",
  "agent_link_first_feedback",
  "agent_link_identity_unresolved",
  "agent_link_mcp_client_selected",
  "agent_link_mcp_install_clicked",
  "agent_link_mcp_tool_called",
  "agent_link_oauth_authorize_routed",
  "agent_link_oauth_refresh_failed",
  "agent_link_oauth_token_refresh_completed",
  "ai_title_label_used",
  "analytics_init_degraded",
  "app_installed",
  "attachment_upload_deferred",
  "attachment_upload_rate_limited",
  "bundle_checkout_continued",
  "bundle_checkout_redirected",
  "create_guide_open_failed",
  "csat_dismissed",
  "csat_displayed",
  "csat_submitted",
  "diagram_paste_handled",
  "diagram_paste_move_undone",
  "editor_publish_blocked_fork_unlinkable",
  "embed_autoconvert_cross_tenant_rejected",
  "embed_autoconvert_failed",
  "embed_retarget_blocked",
  "extension_action_failed",
  "feedback_report_capture_failed",
  "feedback_report_capture_removed",
  "feedback_report_capture_requested",
  "feedback_report_capture_succeeded",
  "feedback_report_handoff_blocked",
  "feedback_report_submit_failed",
  "fullscreen_recovery_action_selected",
  "fullscreen_recovery_activation_completed",
  "fullscreen_recovery_activation_failed",
  "fullscreen_recovery_gate_shown",
  "fullscreen_recovery_mail_status_changed",
  "fullscreen_recovery_manual_extension_completed",
  "fullscreen_recovery_manual_extension_failed",
  "fullscreen_recovery_request_completed",
  "fullscreen_recovery_request_failed",
  "fullscreen_recovery_request_submitted",
  "fullscreen_recovery_support_outcome_recorded",
  "fullscreen_view_ready",
  "graph_board_document_invalid",
  "graph_icon_proxy_failed",
  "graph_icon_proxy_requested",
  "graph_icon_proxy_succeeded",
  "license_notice_email_copied",
  "license_notice_plan_usage_clicked",
  "license_notice_ticket_clicked",
  "license_notice_upgrade_clicked",
  "macro_count_snapshot_failed",
  "macro_export_placeholder_shown",
  "magic_writeback_completed",
  "plan_usage_locations_filtered",
  "plan_usage_locations_load_failed",
  "plan_usage_locations_loaded",
  "plan_usage_locations_page_clicked",
  "plan_usage_locations_shown",
  "plantuml_local_render_failed",
  "plantuml_png_failed",
  "plantuml_png_produced",
  "png_export_state_persistence_failed",
  "saved_refusal_title_hidden",
  "targeted_survey_claim_failed",
  "targeted_survey_claim_requested",
  "targeted_survey_dismissed",
  "targeted_survey_opened",
  "targeted_survey_shown",
  "targeted_survey_submit_failed",
  "targeted_survey_submit_requested",
  "targeted_survey_submitted",
  "title_draft_add_clicked",
  "title_draft_preview_mounted",
  "title_draft_preview_reload_clicked",
  "title_draft_preview_render_delayed",
  "title_draft_preview_render_failed",
  "title_draft_preview_rendered",
  "viewer_rename_cancelled",
  "viewer_rename_failed",
  "viewer_rename_started",
  "viewer_rename_succeeded",
  "viewer_render_abandoned",
  "viewer_render_deferred",
]);

describe("Mixpanel event volume classification", () => {
  const names = catalogEventNames();

  it("reads the AnalyticsEventName union", () => {
    expect(names.length).toBeGreaterThan(300);
    expect(names).toContain("macro_viewed");
  });

  it("gives every new event a volume decision in eventSampling.ts", () => {
    const missing = names.filter((n) => !isClassified(n) && !UNCLASSIFIED_BEFORE_GUARD.has(n));
    expect(
      missing,
      "These events are sent on every occurrence by default. Classify each one in " +
        "eventSampling.ts (see the comment at the top of eventVolumeClassification.spec.ts).",
    ).toEqual([]);
  });

  it("keeps the grandfathered list to events that still exist and are still unclassified", () => {
    const stale = [...UNCLASSIFIED_BEFORE_GUARD].filter((n) => !names.includes(n) || isClassified(n));
    expect(
      stale,
      "Delete these from UNCLASSIFIED_BEFORE_GUARD: they were classified or removed from the catalog.",
    ).toEqual([]);
  });
});
