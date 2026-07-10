// src/utils/analytics/catalog.ts

export type FeatureArea =
  | "macro"
  | "ai"
  | "upgrade"
  | "content"
  | "confluence"
  | "feedback"
  | "system"
  | "agent_link";

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
  | "forge_trigger"
  // The Fullscreen Connect rail (AgentLink/ConnectPanel.vue) — distinct from
  // the small-macro `viewer` surface that hosts the initial Connect button.
  | "fullscreen";

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
  // `space_paid_scope` additionally splits a paid gate by user-level vs
  // space-level extension grant. See utils/paywall/mountPaywallGate.ts.
  | "paywall_gate_evaluated"
  | "paywall_banner_shown"
  | "paywall_banner_dismissed"
  | "space_admin_active"
  | "advocacy_message_copied"
  | "advocacy_draft_preview_clicked"
  | "extension_request_clicked"
  | "extension_form_viewed"
  | "extension_form_submitted"
  | "extension_form_failed"
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
  | "renderer_prefetch_completed"
  // Live Agent Link (docs/superpowers/specs/2026-07-08-live-agent-link-design.md
  // §10). Funnel: connect_clicked → session_created → agent_connected →
  // edit_applied → disconnected; setup_shown measures first-time connector
  // friction; edit_failed is the real failure signal.
  | "agent_link_connect_clicked"
  | "agent_link_session_created"
  | "agent_link_setup_shown"
  | "agent_link_agent_connected"
  | "agent_link_page_read"
  | "agent_link_edit_applied"
  | "agent_link_edit_failed"
  | "agent_link_disconnected"
  // Planned ahead of implementation (2026-07-09 charter §6/§7/§4-C — project
  // rule: events before features). Not fired by any code yet; registered so
  // Tracks F (thinking-state UX), G (session lifecycle), and C (update_diagram
  // guardrails) can wire trackAnalyticsEvent calls directly against a
  // reviewed name/property contract instead of inventing one mid-feature.
  //
  // F — perceived-latency pair, both keyed to the same in-flight op:
  // first_feedback = the instant the render surface shows the "AI thinking"
  // state (an op was received); render_completed = that same op's terminal
  // outcome (rendered, or not). `ms_since_op_received` on first_feedback is
  // the perceived-latency number (op receipt -> visible feedback); render_completed's
  // `total_ms` is op receipt -> terminal outcome (superset of `render_ms`,
  // which is view-layer render time only — see `render_ms` below).
  | "agent_link_first_feedback"
  | "agent_link_render_completed"
  // C — update_diagram guardrail (parse-before-submit / data-loss check)
  // rejected an op BEFORE it reached bridge.writeDiagram(), i.e. nothing was
  // persisted. Distinct from agent_link_edit_failed, which fires for a
  // guardrail-passed op whose PERSIST then failed (bridge/version conflict).
  | "agent_link_guardrail_rejected"
  // G — session lifecycle beyond the terminal agent_link_disconnected:
  // suspended = the link survives an implicit drop (Fullscreen closed via X,
  // or an unexpected ws close) instead of tearing down, staying resumable by
  // token within TTL; resumed = a suspended session was reattached. A
  // suspended session that never resumes before TTL still ends in
  // agent_link_disconnected(reason: 'timeout') — these two are the states in
  // between, not a replacement for the terminal event.
  | "agent_link_session_suspended"
  | "agent_link_session_resumed"
  // #314 — the client-side TTL watchdog fires this the instant `expiresAt`
  // (TOKEN_TTL_MS = 10 min) lapses, from ANY still-live state (waiting/
  // timeout/connected/suspended). Distinct from agent_link_disconnected: no
  // explicit user action or wire disconnect envelope caused this — the token
  // simply died server-side and the client noticed on its own clock.
  // `had_agent_connected` distinguishes "an agent was actually paired and
  // lost its session" from "nobody ever paired before the token lapsed".
  | "agent_link_session_expired"
  // U — discovery tool surface (search_diagrams / list_diagrams, plus
  // read_diagram gaining a by-contentId mode). The trust boundary requires the
  // user to SEE everything the agent did, so every discovery op is both an
  // activity-feed row AND tracked here (design §3 "activity feed", scenarios
  // S3/S4/S5). `diagram_read` fires for the bound read AND a discovered-hit
  // read — `by_content_id` discriminates. `search_performed` / `list_performed`
  // carry the recall size (`hits`) so the read-side eval (charter §6 Track E:
  // "did the right diagram surface") has a volume signal; the raw query is
  // never sent — only `query_len` (privacy).
  | "agent_link_diagram_read"
  | "agent_link_search_performed"
  | "agent_link_list_performed";

// Where an idle renderer-bundle prefetch ran: an alive macro iframe after its
// own render settled, or the page-banner iframe on its no-banner fast-path.
// See utils/prefetch/rendererPrefetch.ts.
export type PrefetchHost = "macro" | "banner";

// Terminal outcome of a prefetch attempt: every asset settled ok, some assets
// failed/timed out, nothing was warmed at all, or the deadline fired before
// any per-asset result arrived (timed_out).
export type PrefetchOutcome = "completed" | "partial" | "failed" | "timed_out";

// Why an agent_link session ended (agent_link_disconnected). 'user' = explicit
// Disconnect click; 'timeout' = token/session TTL; 'idle' = no activity for the
// idle window; 'tab_close' = macro connection dropped (tab close/navigation).
export type AgentLinkDisconnectReason = "user" | "timeout" | "idle" | "tab_close";

// Terminal outcome of an agent_link render (agent_link_render_completed) —
// the signal the F-track "thinking state" UI clears on. 'rendered' = the new
// complete diagram painted (success); 'failed' = the op errored/persist
// failed; 'timeout' = the render-safety backstop fired (no terminal signal
// within RENDER_SAFETY_TIMEOUT_MS, e.g. a dropped WS) and the shimmer was
// force-cleared. WHY a 'failed' op failed is carried by whichever of
// agent_link_edit_failed / agent_link_guardrail_rejected fired for the same
// op; this field only says how the render surface ended up.
export type AgentLinkRenderOutcome = "rendered" | "failed" | "timeout";

// Why Track C's update_diagram guardrail rejected an op BEFORE persisting
// (agent_link_guardrail_rejected). 'parse_error' = the DSL didn't parse in the
// real parser (ZenUML/Mermaid/best-effort PlantUML — see charter §4-C);
// 'data_loss' = it parsed but the semantic round-trip diff showed the output
// dropping content present in the input (participant/message count collapse);
// 'other' = any other pre-persist guardrail rejection not covered above.
export type AgentLinkGuardrailRejectReason = "parse_error" | "data_loss" | "other";

// Why an agent_link session moved to/from 'suspended' (agent_link_session_suspended
// / agent_link_session_resumed — charter §7.2). 'fullscreen_closed' = the
// Fullscreen iframe closed via the browser/X control rather than the explicit
// Disconnect button; 'ws_drop' = the relay socket closed unexpectedly (not
// closedByCaller — see relayClient.ts) without an explicit disconnect;
// 'explicit' = the user re-opened Fullscreen deliberately after a suspend (or
// otherwise explicitly triggered the resume), as opposed to an automatic
// reconnect. A session suspended and never resumed within TTL still ends in
// agent_link_disconnected(reason: 'timeout') — that terminal event is separate.
export type AgentLinkSessionSuspendReason = "fullscreen_closed" | "ws_drop" | "explicit";

// How a discovery `list_diagrams` was scoped (agent_link_list_performed).
// 'page' = a single page's diagrams, 'space' = one space, 'site' = the whole
// estate (no space/page filter). Search (agent_link_search_performed) is always
// site-wide by design, so it has no scope field.
export type AgentLinkListScope = "page" | "space" | "site";
