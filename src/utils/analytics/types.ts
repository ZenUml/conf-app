// src/utils/analytics/types.ts

import type {
  FeatureArea,
  MacroTypeValue,
  Surface,
  EntryPoint,
  OperationMode,
  FeedbackValue,
  RenderMode,
  RenderGateMode,
  RenderGateOutcome,
  CacheState,
  CacheSource,
  ContentSource,
  MacroCountSource,
  PrefetchHost,
  PrefetchOutcome,
  DashboardFormatFilter,
  AgentLinkDisconnectReason,
  AgentLinkExpiryCause,
  AgentLinkRenderOutcome,
  AgentLinkGuardrailRejectReason,
  AgentLinkSessionSuspendReason,
  AgentLinkListScope,
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
  // Lifecycle
  operation_mode?: OperationMode;
  // Format slice chosen on the dual-format "My API Documents" dashboard
  // (dashboard_format_filtered). "all" = both AsyncAPI and OpenAPI shown.
  format_filter?: DashboardFormatFilter;
  result?: string;
  failure_reason?: string;
  // Upgrade
  product_option?: string;
  ui_component?: string;
  // Paywall gate evaluation (paywall_gate_evaluated). `gate_fired` = did the
  // Lite paywall block this mount; `macro_count` = the count the decision used;
  // `macro_count_source` = where that count came from / why it was unusable
  // (the #302 fail-open signal). `css_enabled` / `space_paid` / `is_lite` are
  // the other gate inputs, captured so a not-fired decision is fully explained.
  // `space_paid_scope` = which grant satisfied `space_paid` — 'user_license'
  // (per-requester extension) vs 'space_license' (whole-space extension or a
  // paid plan). Lets user-level vs space-level unlocks be measured separately.
  gate_fired?: boolean;
  macro_count?: number;
  macro_count_source?: MacroCountSource;
  css_enabled?: boolean;
  space_paid?: boolean;
  space_paid_scope?: 'user_license' | 'space_license';
  is_lite?: boolean;
  cta_position?: "primary" | "secondary";
  feature_name?: string;
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
  // AI
  prompt_length?: number;
  generation_source?: string;
  accepted_title?: string;
  // Feedback
  feedback_value?: FeedbackValue;
  feedback_score?: number;
  feedback_text?: string;
  // Content
  content_id?: string;
  content_type?: string;
  content_status?: string;
  page_id?: string;
  custom_content_id?: string;
  attachment_name?: string;
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
  space_admin_count?: number;
  // True when the current user is resolved to be a space admin of the current
  // space. Set on `space_admin_active` (Phase 5a admin-activity probe). Only
  // emitted as `true` today; kept optional for a future "always, with flag"
  // rate variant. See utils/paywall/spaceAdminProbe.ts.
  is_space_admin?: boolean;
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
  // Diagramly demo-page engagement: set automatically for macro_* events when
  // the macro lives on a page tagged with the `diagramly-demo-page` page
  // property. See utils/analytics/demoPageStatus.ts.
  is_demo_page?: boolean;
  // Performance
  render_mode?: RenderMode;
  // Where a cached_svg render sourced its SVG (Phase 2: 'cc_body'). Absent/'none' for live_render.
  cache_source?: CacheSource;
  // Where the macro's CONTENT (doc) came from this render — 'fetch' (network) or
  // 'swr_cache' (id-keyed content cache, the revisit fast path). Distinct from
  // cache_source (rendered-SVG cache). Absent when no content fetch was involved.
  content_source?: ContentSource;
  duration_ms?: number;
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
  // Renderer-bundle prefetch (renderer_prefetch_started / _completed). Fired
  // only on an actual attempt (throttled to ≤1 per deploy per browser), never
  // on the skip path — volume stays far below page-view scale. See
  // utils/prefetch/rendererPrefetch.ts.
  prefetch_host?: PrefetchHost;
  prefetch_renderers?: string; // comma list, e.g. "graph,mermaid,sequence,openapi"
  prefetch_outcome?: PrefetchOutcome;
  prefetch_assets_count?: number;
  prefetch_failed_count?: number;
  prefetch_duration_ms?: number;
  effective_type?: string; // navigator.connection.effectiveType at attempt time
  save_data?: boolean;
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
  // C (agent_link_guardrail_rejected): DSL string lengths in/out of the
  // pre-persist guardrail (parse + data-loss round-trip check), so a rejected
  // op's size can be correlated with the reject reason.
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
  // Error
  error_code?: string;
  error_name?: string;
  error_source?: string;
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
  confluence_error_class?: string;
  // Build info — auto-enriched from VITE_APP_VERSION / VITE_APP_COMMIT
  app_version?: string;
  app_commit?: string;
};
