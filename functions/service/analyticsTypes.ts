// functions/service/analyticsTypes.ts
// Canonical analytics types for backend use.
// Keep in sync with src/utils/analytics/catalog.ts and src/utils/analytics/types.ts.
// TODO: unify into a shared/ module when build config supports it.

// Keep one runtime list and derive the TypeScript union from it. The previous
// hand-maintained union + Set duplicated every name and could drift within this
// file before frontend/backend drift was even considered.
export const CANONICAL_EVENT_NAME_LIST = [
  "macro_viewed",
  "macro_create_started",
  "macro_create_succeeded",
  "macro_edit_started",
  "macro_edit_cancelled",
  "macro_save_succeeded",
  "macro_save_failed",
  "copy_for_ai_impression",
  "copy_for_ai_menu_opened",
  "editor_global_replace_observed",
  "macro_export_requested",
  "macro_export_succeeded",
  "macro_export_failed",
  "ai_generation_requested",
  "ai_generation_succeeded",
  "ai_generation_failed",
  "upgrade_modal_shown",
  "upgrade_action_blocked",
  "upgrade_modal_dismissed",
  "upgrade_prompt_hovered",
  "csat_submitted",
  "feedback_link_clicked",
  // Terminal outcome of the async (save-time) PNG backup write, emitted by
  // functions/forge-upload-attachment.ts from inside waitUntil. See the
  // matching block in src/utils/analytics/catalog.ts (#392).
  "attachment_upload_async_succeeded",
  "attachment_upload_async_failed",
  "attachment_upload_async_skipped",
  "macro_count_snapshot_completed",
  "macro_count_space_changed",
  "macro_count_snapshot_failed",
  // Lite->Full conversion lifecycle. Emitted by functions/conversion/service.ts
  // — the Forge executor that does the work carries no Mixpanel token, so the
  // two moments the backend observes (claim, terminal report) are the events.
  // The per-page/per-macro names in src/utils/analytics/catalog.ts stay
  // unemitted until phase 2 puts conversion in front of a user.
  "macro_convert_job_claimed",
  "macro_convert_job_completed",
  // JSM support-agent manual action lifecycle. The target is intentionally
  // absent from this runtime list's comments/properties: ticket keys and raw
  // request descriptions must never enter Mixpanel.
  "extension_action_requested",
  "extension_action_succeeded",
  "extension_action_failed",
] as const;

export type AnalyticsEventName = typeof CANONICAL_EVENT_NAME_LIST[number];

// The transport_version: 2 "canonical" shape (TrackCanonicalRequest) and its
// isCanonicalRequest() discriminator were deleted 2026-09-02: nothing ever
// sent transport_version: 2 to /track (the frontend's canonical emit path is
// trackAnalyticsEvent -> Mixpanel directly, not this legacy endpoint). This
// is now just the one shape /track has ever actually received.
export type TrackRequest = {
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
