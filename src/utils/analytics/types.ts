// src/utils/analytics/types.ts

import type {
  FeatureArea,
  MacroTypeValue,
  Surface,
  EntryPoint,
  OperationMode,
  FeedbackValue,
  RenderMode,
  CacheState,
  CacheSource,
  MacroCountSource,
  PrefetchHost,
  PrefetchOutcome,
  DashboardFormatFilter,
  AgentLinkDisconnectReason,
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
  space_admin_count?: number;
  // True when the current user is resolved to be a space admin of the current
  // space. Set on `space_admin_active` (Phase 5a admin-activity probe). Only
  // emitted as `true` today; kept optional for a future "always, with flag"
  // rate variant. See utils/paywall/spaceAdminProbe.ts.
  is_space_admin?: boolean;
  // Diagramly demo-page engagement: set automatically for macro_* events when
  // the macro lives on a page tagged with the `diagramly-demo-page` page
  // property. See utils/analytics/demoPageStatus.ts.
  is_demo_page?: boolean;
  // Performance
  render_mode?: RenderMode;
  // Where a cached_svg render sourced its SVG (Phase 2: 'cc_body'). Absent/'none' for live_render.
  cache_source?: CacheSource;
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
  fetch_ms?: number;       // custom-content REST round trip
  render_ms?: number;      // viewer render (lib load + diagram render)
  measured_sum_ms?: number; // bootstrap+context+fetch+render; duration_ms − this = unattributed remainder
  tab_hidden?: boolean;    // tab was backgrounded during load → exclude from percentiles (artifact)
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
  // Build info — auto-enriched from VITE_APP_VERSION / VITE_APP_COMMIT
  app_version?: string;
  app_commit?: string;
};
