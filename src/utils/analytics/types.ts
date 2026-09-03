// src/utils/analytics/types.ts

import type { ProductType } from "./productType";
import type {
  FeatureArea,
  MacroTypeValue,
  Surface,
  EntryPoint,
  OperationMode,
  RenderMode,
  RenderGateMode,
  RenderGateOutcome,
  CacheState,
  CacheSource,
  ContentSource,
  MacroCountSource,
  PaywallPolicySource,
  DashboardFormatFilter,
  AgentLinkDisconnectReason,
  AgentLinkExpiryCause,
  AgentLinkRenderOutcome,
  AgentLinkGuardrailRejectReason,
  AgentLinkSessionSuspendReason,
  AgentLinkListScope,
  ActivationPath,
  GalleryOpenTrigger,
  SessionReplayEventSource,
  SessionReplayStartCallOutcome,
  GraphEditorModeValue,
  EditorReplaceScope,
  EditorInputMethod,
  ContentDeltaBucket,
  CopySource,
  CreateNotFoundShape,
  SaveFailureProbeStatus,
  ArchitectureTokenLookupOutcome,
} from "./catalog";

export type AnalyticsProperties = {
  // Required at call site
  feature_area: FeatureArea;
  surface: Surface;
  // Auto-enriched by tracker (optional for callers)
  client_domain?: string;
  user_account_id?: string;
  product_type?: ProductType;
  environment_type?: string;
  // Contextual — required when scope implies them
  // Also carried by macro_export_requested/_succeeded/_failed (#435), sent
  // from src/export.js / src/asyncapi-export.js (Forge backend, outside this
  // frontend catalog's enforcement — see the event names' doc comment above).
  // 'none' there means the type genuinely could not be resolved (no
  // customContentId, or the custom-content GET failed), recorded explicitly
  // rather than omitted.
  macro_type?: MacroTypeValue;
  entry_point?: EntryPoint;
  confluence_space?: string;
  macro_uuid?: string;
  // Lifecycle
  operation_mode?: OperationMode;
  // Shared DSL editor type-tab changes (#562). `from_macro_type` and
  // `to_macro_type` describe the observed UI transition; `macro_type` on the
  // same event is the destination for compatibility with existing breakdowns.
  // `type_requested` records whether the initial type came from an explicit
  // entry-point request (for example, a byline picker) rather than preference
  // restoration. `is_new_macro` reuses the existing create-vs-edit axis.
  from_macro_type?: MacroTypeValue;
  to_macro_type?: MacroTypeValue;
  type_requested?: boolean;
  // Session Replay policy. `macro_create_started` / `macro_edit_started` set
  // source=authoring and percent=100 after the SDK start call returns. The call
  // outcome is intentionally distinct from actual capture: only a later
  // `$mp_replay_id` proves that the recorder became active.
  session_replay_source?: SessionReplayEventSource;
  session_replay_percent?: number;
  session_replay_start_call_outcome?: SessionReplayStartCallOutcome;
  // Format slice chosen on the dual-format "My API Documents" dashboard
  // (dashboard_format_filtered). "all" = both AsyncAPI and OpenAPI shown.
  format_filter?: DashboardFormatFilter;
  result?: string;
  // AI entry-point impressions (ai_chat_button_shown /
  // ai_repair_button_shown) carry macro_type so their exposed users/volume
  // can be compared directly with the corresponding opened/requested event.
  // AI Chat failure events use only closed-vocabulary categories here. Never
  // attach the raw backend error, prompt, diagram code, or job id.
  failure_reason?: string;
  // AI Repair performance lifecycle (ai_repair_requested / _succeeded /
  // _failed). `duration_ms` below is click-to-visible-result wall time;
  // `backend_duration_ms` is job started-to-terminal time reported by the
  // Diagramly backend; `backend_llm_duration_ms` sums only the backend LLM
  // calls across repair attempts. Keep all three so UI/polling and non-LLM
  // backend overhead remain attributable.
  poll_interval_ms?: number;
  timeout_budget_ms?: number;
  poll_count?: number;
  backend_duration_ms?: number;
  backend_llm_duration_ms?: number;
  repair_attempts?: number;
  ai_model?: string;
  reasoning_disabled?: boolean;
  failure_phase?:
    | 'ensure'
    | 'start'
    | 'poll'
    | 'server'
    | 'timeout'
    | 'sync'
    | 'history_load'
    | 'version_restore';
  // Upgrade
  ui_component?: string;
  // Paywall gate evaluation (paywall_gate_evaluated). `gate_fired` = did the
  // Lite paywall block this mount; `macro_count` = the count the decision used;
  // `macro_count_source` = where that count came from / why it was unusable
  // (the #302 fail-open signal). `css_enabled` / `space_paid` / `is_lite` are
  // the other gate inputs, captured so a not-fired decision is fully explained.
  // `space_paid_scope` = which grant satisfied `space_paid` — 'user_license'
  // (per-requester extension), 'space_license' (whole-space extension or a
  // paid plan), or 'paid_rail' (D1 ForgeInstallation trial-window
  // suppression — a recent Full/Diagramly install on the same tenant, NOT a
  // real license; see functions/api/space-status.ts checkPaidRail). Lets
  // user-level, space-level, and paid-rail unlocks be measured separately.
  gate_fired?: boolean;
  macro_count?: number;
  macro_count_source?: MacroCountSource;
  css_enabled?: boolean;
  // Which policy produced the effective Lite paywall decision on this
  // evaluation (lite-paywall-default-on): `default_on` when the backend
  // explicitly returned `PAYWALL_EXEMPT: false`, `exemption` when it returned
  // `true`, `fail_open` when the property was absent or unusable. See
  // PaywallPolicySource in catalog.ts for the full contract.
  paywall_policy_source?: PaywallPolicySource;
  space_paid?: boolean;
  space_paid_scope?: 'user_license' | 'space_license' | 'paid_rail';
  is_lite?: boolean;
  source?: string;
  // Embed AutoConvert lifecycle. Absent when the Forge context has no cloudId
  // or the link cannot be parsed; false is reserved for the rejected
  // cross-tenant path. The raw deeplink/cloudId must never be tracked.
  is_same_site?: boolean;
  // Daily macro-count inventory snapshots. These events are emitted by the
  // Cloudflare backend, but their scalar property vocabulary lives here as the
  // cross-runtime analytics contract. Snapshot payloads must never include
  // content rows, page/content ids, titles, logical hashes, or raw errors.
  run_id?: string;
  captured_at?: string;
  space_key?: string;
  space_count?: number;
  content_count?: number;
  changed_space_count?: number;
  zeroed_space_count?: number;
  sequence_count?: number;
  graph_count?: number;
  openapi_count?: number;
  mermaid_count?: number;
  plantuml_count?: number;
  unknown_count?: number;
  type_request_count?: number;
  chunk_count?: number;
  change_reason?: "new" | "changed" | "zeroed";
  previous_total?: number;
  current_total?: number;
  delta_total?: number;
  previous_sequence_count?: number;
  current_sequence_count?: number;
  previous_graph_count?: number;
  current_graph_count?: number;
  previous_openapi_count?: number;
  current_openapi_count?: number;
  previous_mermaid_count?: number;
  current_mermaid_count?: number;
  previous_plantuml_count?: number;
  current_plantuml_count?: number;
  previous_unknown_count?: number;
  current_unknown_count?: number;
  failure_stage?: string;
  completed_type_count?: number;
  last_completed_type?: string;
  processed_contents?: number;
  processed_spaces?: number;
  // Lite->Full macro conversion (vendor-operated queue). Same backend-emitted
  // contract as the snapshot block above: never include page/content bodies,
  // titles, or raw errors. `convert_job_id` is our own D1 row id, not an
  // Atlassian identifier. `convert_skip_reason` is a closed vocabulary so the
  // phase-2 decision ("is embed demand real?") is a groupBy, not a text mine.
  convert_dry_run?: boolean;
  convert_request_source?: string;
  convert_failure_stage?:
    | "claim"
    | "page_read"
    | "bodies_fetch"
    | "content_create"
    | "adf_rewrite"
    | "page_update"
    | "report";
  // AI
  prompt_length?: number;
  generation_source?: string;
  accepted_title?: string;
  suggestion_id?: string;
  chat_message_count?: number;
  turn_index?: number;
  input_source?: "typed" | "suggestion" | "syntax_repair";
  retry_after_failure?: boolean;
  interaction_state?: "opened" | "closed" | "shown" | "hidden";
  change_kind?: "request" | "syntax_repair" | "undo" | "rollback";
  version_id?: string;
  version_number?: number;
  version_count?: number;
  is_retry?: boolean;
  error_category?: "syntax_error";
  lines_added?: number;
  lines_removed?: number;
  cancel_reason?: "panel_closed" | "component_unmounted";
  close_reason?: "user_closed";
  // Feedback
  feedback_score?: number;
  feedback_text?: string;
  // Content
  content_id?: string;
  content_type?: string;
  content_status?: string;
  page_id?: string;
  custom_content_id?: string;
  attachment_name?: string;
  // Load-failed recovery panel — "Try again" (load_failed_retry_clicked /
  // load_failed_retry_resolved). `retry_attempt` counts retries of the SAME
  // macro inside one browser session and starts at 1; it survives the reload
  // through the sessionStorage marker, so attempt 2+ marks a user who retried
  // a failure that had already failed a retry. `retry_outcome` is the state the
  // viewer reached after the reload: 'recovered' = the diagram rendered,
  // 'failed_again' = the terminal panel came back.
  retry_attempt?: number;
  retry_outcome?: 'recovered' | 'failed_again';
  // Snapshot attachments: which flow wrote it, and fallback freshness.
  snapshot_trigger?: 'save' | 'editor_backfill' | 'viewer_backfill';
  snapshot_age_days?: number;
  // Why a best-effort snapshot write was skipped rather than failed
  // (snapshot_backfill_skipped). `no_write_permission`: the app-auth upload was
  // denied (401/403) — typically a read-only viewer with no attachment-write
  // permission. `page_not_published`: the host page is an unpublished draft
  // (404) so there is nothing to attach to yet; the save-path/backfill
  // self-heals once the page is published.
  snapshot_skip_reason?: 'no_write_permission' | 'page_not_published';
  // Diagram attribution and impact (Phase 1). These values intentionally
  // exclude viewer keys, attribution names, and other users' account IDs.
  has_last_updated_by?: boolean;
  has_audience_count?: boolean;
  // Whether the diagram met the viewport rule when the 3s dwell timer fired.
  // `false` identifies the registrations produced by the ready-watcher path,
  // which armed the timer without any viewport check before 2026-09-02.
  was_intersecting?: boolean;
  // Which element the audience dwell gate watched. `footer` means the diagram
  // node was unavailable and the gate fell back to the 29px attribution strip,
  // which is the pre-2026-09-02 behaviour rather than the intended one.
  gate_target?: 'diagram' | 'footer';
  space_admin_count?: number;
  // Architecture Tokens Phase 1. Counts only.
  lookup_outcome?: ArchitectureTokenLookupOutcome; // required on new lookup-success events
  participant_count?: number;          // participants declared in this diagram
  participants_with_related?: number;  // of which have >=1 accessible related page
  related_pages_total?: number;        // sum of accessible related pages
  index_age_days?: number;             // now - indexedAt, whole days
  related_count?: number;              // for one participant (popover / click)
  label_variant_count?: number;        // distinct rawLabel values among related
  same_space?: boolean;                // clicked page in the same space as the viewer's page
  same_page?: boolean;                 // the opened participant also appears in another diagram on this page
  error_kind?: string;                 // 'timeout' | 'network' | 'http_<status>' | body error_kind
  // Join key on every `attachment_upload_*` event (model/Attachment.ts
  // UploadContext), mirroring the backend joinKeyProps() in src/export.js so
  // analysts can left-join uploads -> exports on (cloud_id, custom_content_id,
  // page_id).
  cloud_id?: string;
  // Restored 2026-09-03 after the `app_first_seen` Mixpanel emit was deleted:
  // the property is NOT dead. src/export.js `joinKeyProps()` (:203) stamps
  // `account_id` on every export event, and mixpanelService's /import call
  // reads it back as the event's `distinct_id` (:239). The declaration keeps
  // the typed frontend path able to carry the same key without a cast.
  account_id?: string;
  // True when the current user is resolved to be a space admin of the current
  // space. Set on `space_admin_active` (Phase 5a admin-activity probe) and, from
  // Phase 5b, on every page-banner event so the funnel can be split by audience.
  // See utils/paywall/spaceAdminProbe.ts.
  is_space_admin?: boolean;
  // Phase 5b: WHICH gate admitted the paywall page banner, and therefore which
  // copy/CTA set the user saw.
  //   'editor'      — legacy gate: this user created/edited a macro in the last
  //                   30 days. Sees "ask an admin" advocacy copy.
  //   'space_admin' — new gate: this user is a space admin of an over-limit
  //                   space, regardless of whether they author diagrams. Sees
  //                   the direct-purchase copy (Enterprise Bundle) instead.
  // A user who is BOTH is reported as 'space_admin' — the stronger audience.
  // This is the primary split for judging Phase 5b: 60d baseline was 358 unique
  // users reached on the 'editor' gate across 19 CSS tenants, against 5,021
  // unique space admins already loading the banner iframe unreached.
  banner_audience?: 'editor' | 'space_admin';
  // Advertised annual price on the bundle CTA at click time (USD, per space).
  // Recorded on the event so a later price change stays comparable.
  bundle_price_usd?: number;
  // JSM Apply Extension automation. `extension_action` is the fixed policy
  // command, never an arbitrary duration. Initial grants are requester-only
  // for 7 days; feedback grants renew the same requester for 60 days.
  // `extension_action_outcome` distinguishes a real write from an idempotent
  // replay, while `extension_failure_stage` is deliberately low-cardinality.
  extension_action?: 'initial' | 'feedback';
  extension_action_outcome?: 'applied' | 'already_applied';
  extension_scope?: 'user';
  extension_days?: 7 | 60;
  extension_failure_stage?:
    | 'request_validation'
    | 'tenant_resolution'
    | 'space_validation'
    | 'paid_status'
    | 'idempotency'
    | 'license_write'
    | 'license_verify'
    | 'unexpected';
  // Attribution token embedded in the Stripe Payment Link URL
  // (`<clientDomain>__<spaceKey>`, sanitised to Stripe's [A-Za-z0-9_-]).
  // Stripe returns it verbatim on the Checkout Session, so a $299 payment
  // joins back to the exact bundle CTA click without manual reconciliation.
  client_reference_id?: string;
  // Cohort targeting (cohorts_refreshed). `cohorts` = comma-joined cohort list
  // the refresh resolved; empty string = user in no cohort (still a successful
  // refresh). `cohort_count` = same list's length, for numeric filtering.
  cohorts?: string;
  cohort_count?: number;
  // Lite byline activation (byline_*). `page_has_diagram` / `diagram_count`
  // describe the page the modal opened on — the two populations behave
  // differently (index-a-diagram vs create-the-first-one) and the create
  // funnel must be measurable separately for each. `macro_types` is the
  // comma-joined set found on the page, in the same lowercase vocabulary as
  // `macro_type`, empty string when none.
  // `dwell_ms` = modal mount → close, carried on byline_dismissed so a
  // fat-finger open is distinguishable from a real look.
  page_has_diagram?: boolean;
  diagram_count?: number;
  macro_types?: string;
  dwell_ms?: number;
  // Byline listing health. Nothing on the listing path rejects — forgeRequest
  // resolves error bodies — so a 403 or rate-limit is otherwise reported as a
  // page with zero diagrams. `listing_failed` marks a `diagram_count: 0` that
  // means "unknown" rather than "none", which matters because byline_opened is
  // the Phase 1 readout; `failed_type_count` counts the probed custom-content
  // types that errored, so a partial failure is visible too.
  listing_failed?: boolean;
  failed_type_count?: number;
  // Which trigger put the byline's paste link on the clipboard
  // (advocacy_message_copied, ui_component: 'byline_created_link'). 'auto' is
  // the copy performed for the user at save; 'manual' is the button. They fail
  // for different reasons — the automatic write is not user-gesture-initiated
  // inside the Forge iframe — and a run of 'manual' copies against one created
  // link means the automatic one is not surviving to the paste.
  copy_trigger?: 'auto' | 'manual';
  // Was the host page already in the Confluence editor when the byline opened.
  // Carried on every byline event because it splits two genuinely different
  // journeys — reader-discovers-the-app vs author-mid-edit — and because the
  // detection degrading to false is otherwise indistinguishable from "nobody
  // opens the byline while editing".
  host_in_editor?: boolean;
  // `enrolled` means the installation renders the byline. Since the
  // 2026-08-22 general rollout that is every installation with a resolvable
  // cloudId, so `not_enrolled` is no longer emitted — it is retained here
  // because historical events in Mixpanel still carry it, and dropping it from
  // the union would make that data untypeable. `no_signal` is the distinct
  // live case where the runtime gave us no cloudId at all: it still suppresses,
  // and it must not collapse into the same value as a deliberate hide.
  byline_visibility_reason?:
    | "full_present"
    | "full_absent"
    | "full_stale"
    | "enrolled"
    | "not_enrolled"
    | "no_signal";
  // Byline thumbnails: how many of `diagram_count` resolved to a backup-PNG
  // attachment. Coverage is the whole question for this feature — diagrams
  // saved before the attachment backup existed, failed captures, and viewers
  // without attachment read permission all land here as a shortfall, and a
  // consistently low ratio means the visual index is not worth its requests.
  thumbnail_count?: number;
  // byline_unplaced_scanned. How many of the page's listed diagrams no macro on
  // the published page references — a diagram saved from the byline and never
  // pasted. Read against `diagram_count` from the same event. Deliberately
  // absent rather than 0 when the ADF could not be read: "scanned, found none"
  // and "could not scan" must not collapse into the same number.
  unplaced_count?: number;
  // Draft-restore banner (draft_banner_* / draft_restored / draft_discarded).
  // `draft_scope_kind` = which draft namespace the banner is for: 'edit' (a
  // specific custom-content id) or 'new' (an unsaved diagram of some type).
  // `draft_age_ms` = Date.now() − draft.savedAt at event time — how stale the
  // recovered work was when the user chose what to do with it.
  draft_scope_kind?: 'new' | 'edit';
  draft_age_ms?: number;
  // Staleness hint (staleness_hint_*). `drift_count` = page versions newer
  // than the diagram's last update at decision time; `is_diagram_author` =
  // current accountId equals the diagram custom content's last-version
  // authorId (picks the copy variant).
  drift_count?: number;
  is_diagram_author?: boolean;
  // Whether the current user can edit the page/macro. Set on
  // `viewer_source_opened` / `viewer_source_copied` so read-only vs editor
  // audience for the View Source panel (#333) can be split.
  has_edit_permission?: boolean;
  // "Copy for AI" viewer action (copy_for_ai_clicked — catalog.ts) AND the
  // "Copy diagram link" pill action (deeplink_copied — catalog.ts) share this
  // one `outcome` axis. For copy_for_ai_clicked: 'copied' = full page+diagram
  // copy, 'copied_diagram_only' = fell back to diagram-only content (page
  // context unavailable), 'clipboard_failed' = the clipboard write itself
  // threw. For deeplink_copied: 'copied' = clipboard write succeeded,
  // 'clipboard_failed' = the write returned false or threw, 'unavailable' =
  // the link couldn't be minted at all (no host/contentId, or cloudId
  // unresolved) — 'copied_diagram_only' does not apply to deeplink_copied.
  // `dsl_bytes` / `page_bytes` are the byte sizes of the diagram DSL and the
  // surrounding page context that were attempted, regardless of outcome
  // (copy_for_ai_clicked only).
  // `job` identifies which entry point fired the click: 'generic' = the
  // one-click primary segment (today's generic prompt, unchanged); the other
  // five are the split-button menu's job-framed entry points — explain /
  // update / implement / audit / tests — which only swap the preamble
  // buildCopyForAiPrompt.ts builds (same DSL + page payload, same fallback
  // rules). Absent on events emitted before this axis existed.
  outcome?: 'copied' | 'copied_diagram_only' | 'clipboard_failed' | 'unavailable';
  dsl_bytes?: number;
  page_bytes?: number;
  job?: 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests';
  // Copy -> editor attribution. A marker is written only after a successful
  // clipboard write and contains metadata only — never diagram text or hashes.
  copy_id?: string;
  copy_source?: CopySource;
  copy_job?: 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests';
  ms_since_copy?: number;
  // Per-transaction editor replacement signal. journey_id/session_id join the
  // operation to the editor lifecycle; replace_index preserves repeated whole
  // replacements rather than collapsing them into a session boolean.
  journey_id?: string | null;
  session_id?: string;
  replace_index?: number;
  ms_since_editor_open?: number;
  replace_scope?: EditorReplaceScope;
  replaced_coverage_ratio?: number;
  editable_chars_before?: number;
  inserted_chars?: number;
  input_method?: EditorInputMethod;
  content_delta_ratio?: number;
  content_delta_bucket?: ContentDeltaBucket;
  // Editor lifecycle summary, attached to save/cancel/failure events. These
  // fields describe the edit history; macro_save_succeeded remains the actual
  // persistence outcome.
  had_global_replace?: boolean;
  global_replace_count?: number;
  post_replace_local_edit_count?: number;
  net_delta_from_open_bucket?: ContentDeltaBucket;
  delta_from_last_replace_bucket?: ContentDeltaBucket;
  last_copy_id?: string;
  last_copy_source?: CopySource;
  last_copy_job?: 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests';
  // Bottom-pill "Copy diagram link" (deeplink_copied — catalog.ts). Which
  // affordance minted the deeplink; only the viewer pill exists today. Not
  // the same surface as the `/deeplink-ticket` share-preview endpoint, which
  // is owned by other PRs. See `outcome` above for this event's values.
  link_source?: 'viewer_pill';
  // In-viewer Edit dup gate (edit_dup_gate_evaluated): outcome of the
  // click-time same-page shared-id check. `same_page_macro_count` = how many
  // macros on the page reference the clicked macro's customContentId (absent
  // when the scan failed). `copy_reason` rides on
  // editor_publish_blocked_fork_unlinkable to say which copy flavor tripped
  // the editor-side backstop.
  edit_dup_gate_outcome?: 'blocked' | 'passed' | 'scan_failed';
  same_page_macro_count?: number;
  copy_reason?: 'same-page-duplicate' | 'cross-page';
  // AI-prepared byline activation nudge. `prepared_age_days` is how stale the
  // curated diagram was when served; `activation_path` describes how the user
  // completed the flow.
  // Diagram type reuses the existing `macro_type` above rather than the design's
  // `diagram_type` synonym — one name per concept.
  prepared_age_days?: number;
  activation_path?: ActivationPath;
  // Diagramly demo-page engagement: set automatically for macro_* events when
  // the macro lives on a page tagged with the `diagramly-demo-page` page
  // property. See utils/analytics/demoPageStatus.ts.
  is_demo_page?: boolean;
  // Export PNG dialog (export_png_succeeded / export_png_failed —
  // ExportModal.vue). `method` = delivery path the PNG went out through;
  // `background` mirrors the ExportState background option value
  // ('transparent' | 'white' | 'warm' | 'cool' | 'custom'). has_note/
  // has_arrow/has_callout/has_watermark record which overlay types were
  // present in the exported image (ExportState's computed flags of the same
  // names). `failure_reason` (declared above) carries export_png_failed's
  // reason, e.g. 'no_capture_node' | 'blob_null' | 'exception' |
  // 'clipboard_denied'.
  method?: 'download' | 'clipboard';
  background?: string;
  has_note?: boolean;
  has_arrow?: boolean;
  has_callout?: boolean;
  has_watermark?: boolean;
  // Performance
  render_mode?: RenderMode;
  // Where a cached_svg render sourced its SVG (Phase 2: 'cc_body'). Absent/'none' for live_render.
  cache_source?: CacheSource;
  // Where the macro's CONTENT (doc) came from this render — 'fetch' (network) or
  // 'swr_cache' (id-keyed content cache, the revisit fast path). Distinct from
  // cache_source (rendered-SVG cache). Absent when no content fetch was involved.
  content_source?: ContentSource;
  duration_ms?: number;
  // Graph Diagram/Board chrome switch (graph_editor_mode_switch_*).
  // `from_mode` / `to_mode` are the chrome values, never document types.
  from_mode?: GraphEditorModeValue;
  to_mode?: GraphEditorModeValue;
  has_unsaved_changes?: boolean;
  // True when the mxfile re-loaded after iframe reload matches the captured
  // pre-switch body (page/shape identity preserved).
  content_preserved?: boolean;
  // Wall time from switch click to operable chrome, in ms. Distinct from
  // render-time `duration_ms` so the two never share a property.
  reload_duration_ms?: number;
  // Browser cache state at render time, measured via Resource Timing transferSize
  // of same-origin JS bundles, plus the raw summed wire bytes. Lets cold/warm
  // render-time comparisons use a measured signal rather than inferring cache
  // state from duration magnitude. See utils/analytics/trackRenderTime.ts.
  cache_state?: CacheState;
  transfer_bytes?: number;
  // Phase 0b sub-timings (renderPerf). Attribute duration_ms to load phases so we
  // can pick the right optimization lever. Absent phases are omitted, not 0.
  bootstrap_ms?: number;   // __macroLoadStart → first app code (head scripts incl. DrawIO + bundle eval)
  context_ms?: number;     // Forge getContext() resolution
  fetch_ms?: number;       // custom-content REST round trip. Recorded by whoever owns the load: forgeIndex for the sequence family, viewerBootstrap for graph/openapi/embed (#413).
  render_ms?: number;      // viewer render (lib load + diagram render)
  measured_sum_ms?: number; // bootstrap+context+fetch+render; duration_ms − this = unattributed remainder
  tab_hidden?: boolean;    // tab was backgrounded during load → exclude from percentiles (artifact)
  // Publish/save round-trip latency, in ms. Rides on macro_create_succeeded /
  // macro_save_succeeded. Measures how long the persistence to Confluence took
  // — from the start of saveToPlatform's real work (custom-content save +
  // getMacroData) to the moment the success event is emitted. Deliberately
  // EXCLUDES the post-event syncCustomContent (D1 mirror), which is not on the
  // user-perceived publish path. Distinct from the render-time `duration_ms`
  // above so save-latency and render-latency never share a property. See
  // model/ContentProvider/Persistence.ts (saveToPlatform).
  save_duration_ms?: number;
  // User-perceived publish latency, in ms: the interval from the Publish/Save
  // click (save-handler entry, synchronous with the click) to the editor's
  // redirect (view.submit() / view.close()). Rides on macro_publish_completed.
  // Superset of save_duration_ms — additionally covers the ~500ms pre-submit
  // delay, the save-time attachment race, and the macro-config writeback. See
  // utils/analytics/publishTiming.ts.
  publish_duration_ms?: number;
  // P1.3 fetch split (children of fetch_ms — NOT part of measured_sum_ms):
  // custom-content GET vs full-page-ADF copy-scan. See renderPerf.ts.
  custom_content_fetch_ms?: number;
  page_adf_fetch_ms?: number;
  // Random per-iframe id + performance.timeOrigin. Makes concurrent
  // duplicate mounts of one macro (remount storms) directly countable
  // without burst reconstruction. See renderIdentity.ts.
  instance_nonce?: string;
  time_origin?: number;
  // Viewport render gate (#382): how this viewer render was released.
  // Absent on ungated renders (flag off / editor / fullscreen / non-sequence).
  // 'immediate'   — in or near (rootMargin) the top-level viewport at boot
  // 'scrolled_in' — released by scrolling into the prefetch margin
  // 'background'  — released by the jittered background-fill timer
  // 'failopen'    — gate errored or IntersectionObserver unavailable; rendered at once
  // See utils/renderGate/viewportGate.ts.
  render_gate?: RenderGateOutcome;
  // Wall time (ms) the mount ACTUALLY waited on the viewport gate, measured
  // at the mount-site await (renderGate/maybeGateViewerRender). NOT the
  // gate's age: the gate runs concurrently with the content fetch, so when
  // the fetch is the slower leg this is ~0 even for a 'background' release.
  // duration_ms includes exactly this much gate-induced delay — subtracting
  // it (or splitting by render_gate) is legitimate.
  render_deferred_ms?: number;
  // Strict (no-margin) top-level-viewport intersection at first observation.
  // The direct client-side measure of "was this macro on screen at boot".
  visible_at_boot?: boolean;
  // Gate depth for this render (#382 spike): 'render' = paint-only gating
  // (fetch ran immediately), 'load' = the content fetch also waited for the
  // viewport turn. Absent when render_gate is absent. With gate_mode='load',
  // fetch_ms starts at gate release, so render_deferred_ms still bounds the
  // total gate-induced delay inside duration_ms.
  gate_mode?: RenderGateMode;
  // Volume sampling: present (and < 1) only when this event was emitted under a
  // keep-probability < 1 (see utils/analytics/eventSampling.ts). Downstream
  // analysis extrapolates true volume as `count / sample_rate`. Absent ⇒ 1.0
  // (every occurrence emitted).
  sample_rate?: number;
  // Live Agent Link (see catalog.ts agent_link_* events). `time_to_connect_ms`
  // = waiting→connected latency (agent_link_agent_connected); `render_ok` /
  // `dsl_len_delta` characterize an applied edit (agent_link_edit_applied);
  // `session_duration_ms` / `edits_count` summarize the session at teardown
  // (agent_link_disconnected). `reason` is overloaded across edit_failed
  // (render/persist failure), disconnected (AgentLinkDisconnectReason),
  // guardrail_rejected (AgentLinkGuardrailRejectReason), and
  // session_suspended/session_resumed (AgentLinkSessionSuspendReason); kept as
  // a free-form string so edit_failed can carry its own failure text.
  time_to_connect_ms?: number;
  render_ok?: boolean;
  dsl_len_delta?: number;
  reason?:
    | string
    | AgentLinkDisconnectReason
    | AgentLinkGuardrailRejectReason
    | AgentLinkSessionSuspendReason;
  session_duration_ms?: number;
  edits_count?: number;
  // #314 (agent_link_session_expired only): true when the session had
  // actually reached 'connected'/'suspended' (an agent was paired) before the
  // token lapsed, false when the TTL expired while still 'waiting'/'timeout'
  // (nobody ever paired). Lets the funnel distinguish "lost a live agent" from
  // "the connect window itself timed out".
  had_agent_connected?: boolean;
  // PR1 sliding TTL (spec 2026-07-13 §7).
  // agent_link_session_extended: seconds until the NEW deadline at fire time.
  expires_in_sec?: number;
  // True once the effective deadline is bounded by the 60-min absolute cap
  // rather than the 10-min idle window (both _extended and _expired carry it).
  hit_cap?: boolean;
  // agent_link_session_expired only.
  expiry_cause?: AgentLinkExpiryCause;
  // Planned ahead of implementation (2026-07-09, catalog.ts's "Planned ahead
  // of implementation" block) — F/G/C fire these once built.
  //
  // F (agent_link_first_feedback / agent_link_render_completed): both key off
  // the same in-flight op. `ms_since_op_received` = op-received -> "AI
  // thinking" state shown (perceived-latency number); `total_ms` = op-received
  // -> render terminal outcome (superset of `render_ms`, which is view-layer
  // render time only, already declared above for macro load perf).
  // `render_outcome` carries agent_link_render_completed's success/failure.
  ms_since_op_received?: number;
  total_ms?: number;
  render_outcome?: AgentLinkRenderOutcome;
  // C: DSL string lengths in/out of the pre-persist guardrail (parse +
  // data-loss round-trip check), so a rejected op's size can be correlated with
  // the reject reason. Their dedicated event (agent_link_guardrail_rejected)
  // was deleted 2026-09-02 as never-emitted; these ride other agent_link events.
  input_len?: number;
  output_len?: number;
  // G (agent_link_session_resumed only): elapsed ms between the paired
  // agent_link_session_suspended and this resume. Absent when the session
  // never actually suspended (e.g. a duplicate/no-op resume signal).
  resume_latency_ms?: number;
  // U — discovery tool surface (agent_link_diagram_read / _search_performed /
  // _list_performed). `by_content_id` = read_diagram targeted a discovered
  // contentId rather than the bound diagram. `query_len` = search query length
  // ONLY (never the raw query — privacy). `hits` = candidate rows returned
  // (recall size for search/list). `list_scope` = page / space / site.
  by_content_id?: boolean;
  query_len?: number;
  hits?: number;
  list_scope?: AgentLinkListScope;
  // Starter-template gallery (#334). `template_id` identifies which curated
  // template was applied (editor_template_applied only) — flat across the
  // whole catalog (e.g. "mmd-auth-flow"), not scoped per macro_type, so it is
  // a stable Mixpanel dimension regardless of macro_type. `is_new_macro` is
  // the same create-vs-edit discriminator Header.vue already uses for its
  // macro_create_started/macro_edit_started split (`!diagram.id`) — reused
  // here so the gallery's funnel joins against that axis rather than
  // inventing a second one.
  template_id?: string;
  is_new_macro?: boolean;
  // Onboarding funnel. `trigger` (editor_starter_shown) and
  // `template_gallery_trigger` (editor_template_gallery_opened) both use
  // GalleryOpenTrigger — kept as two separate property names rather than one
  // shared key because the two events can, in principle, both be present on
  // the same underlying gallery-open session and need independent values.
  trigger?: GalleryOpenTrigger;
  template_gallery_trigger?: GalleryOpenTrigger;
  // Foreign-dialect hint (#373). `macro_type` on these events is always the
  // CURRENT macro's type (sequence — the only surface this ships on today);
  // `detected_dialect` is the OTHER dialect the pasted source looks like,
  // reusing MacroTypeValue rather than inventing a parallel enum since the
  // detectable dialects are already macro types users can switch to.
  detected_dialect?: MacroTypeValue;
  // Error
  error_code?: string;
  error_name?: string;
  // save_failed_diagnosed (create 404 diagnosis). `error_shape` classifies the
  // Confluence 404 envelope; the `can_*` booleans are read off the caller's own
  // `operations` list on the host page, so `can_create_cc_type=false` is
  // Confluence's statement, not our inference. `page_reachable=false` means the
  // probe itself 404'd (unpublished draft owned by someone else, or a page the
  // caller cannot view) and every `can_*` field is then absent.
  error_shape?: CreateNotFoundShape;
  probe_status?: SaveFailureProbeStatus;
  page_reachable?: boolean;
  page_status?: string;
  can_create_cc_type?: boolean;
  can_create_attachment?: boolean;
  can_create_page?: boolean;
  can_update_page?: boolean;
  // Attachment upload failures (#392). `via_app_fallback` is true when the
  // user-side write 401/403'd and the app-authenticated fallback
  // (/forge-upload-attachment) was attempted before this failure — so the
  // recorded status/message describe the APP's write, not the user's.
  // Without it, a post-fallback failure is indistinguishable from a plain
  // user-side one and the #211 population can only be recovered by
  // count-matching against attachment_upload_app_fallback_started at 10%
  // sampling. `fallback_from_status` carries the original user-side status
  // (401/403) that triggered the fallback.
  via_app_fallback?: boolean;
  fallback_from_status?: number;
  // Low-cardinality Confluence exception class parsed out of the error
  // envelope — PermissionException / NotFoundException / BadRequestException.
  // The raw `error_message` is capped at 200 chars and the envelope prefix
  // ({"statusCode":…,"data":{…},"message":"com.atlassian…) eats ~180 of them,
  // so before this the class name itself was truncated mid-word and could not
  // even be substring-matched in JQL.
  //
  // Every producer sets this unconditionally, using the explicit `'none'`
  // sentinel when the envelope carries no parseable class (see
  // NO_CONFLUENCE_ERROR_CLASS in SnapshotAttachment.ts). It stays optional here
  // only because most events never carry it at all — do NOT read that as
  // licence to omit it on an event that does. An omitted property cannot be
  // told apart from an unparseable class, nor from an event predating the
  // field, which is the ambiguity #398 was filed about and the reason #435
  // chose `macro_type: 'none'` over omission.
  confluence_error_class?: string;
  // Build info — auto-enriched from VITE_APP_VERSION / VITE_APP_COMMIT
  app_version?: string;
  app_commit?: string;
};
