// functions/service/analyticsTypes.ts
// Canonical analytics types for backend use.
// Keep in sync with src/utils/analytics/catalog.ts and src/utils/analytics/types.ts.
// TODO: unify into a shared/ module when build config supports it.

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

export const CANONICAL_EVENT_NAMES = new Set<string>([
  "macro_viewed",
  "macro_create_started",
  "macro_create_succeeded",
  "macro_edit_opened",
  "macro_edit_cancelled",
  "macro_save_succeeded",
  "macro_save_failed",
  "macro_export_requested",
  "macro_export_succeeded",
  "macro_export_failed",
  "ai_generation_requested",
  "ai_generation_succeeded",
  "ai_generation_failed",
  "ai_editor_opened",
  "ai_feedback_submitted",
  "upgrade_modal_shown",
  "upgrade_cta_clicked",
  "upgrade_action_blocked",
  "upgrade_modal_dismissed",
  "upgrade_prompt_hovered",
  "upgrade_slider_changed",
  "content_sync_requested",
  "content_sync_succeeded",
  "content_sync_failed",
  "custom_content_loaded",
  "confluence_page_viewed",
  "confluence_page_updated",
  "csat_submitted",
  "feedback_link_clicked",
  "feature_flags_fetch_failed",
  "attachment_create_failed",
  "custom_content_update_failed",
]);

export type TrackCanonicalRequest = {
  transport_version: 2;
  event: AnalyticsEventName;
  properties: Record<string, string | number | boolean | null | undefined>;
  addon_key: string;
  version: string;
};

export type TrackLegacyRequest = {
  transport_version?: 1;
  action: string;
  event_category?: string;
  event_label?: string;
  client_domain?: string;
  user_account_id?: string;
  addon_key: string;
  version: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type TrackRequest = TrackCanonicalRequest | TrackLegacyRequest;

export function isCanonicalRequest(body: TrackRequest): body is TrackCanonicalRequest {
  return (body as TrackCanonicalRequest).transport_version === 2;
}
