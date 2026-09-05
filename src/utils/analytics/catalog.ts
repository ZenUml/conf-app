// src/utils/analytics/catalog.ts

export type FeatureArea =
  | "macro"
  | "macro_count"
  | "ai"
  | "upgrade"
  | "content"
  | "confluence"
  | "feedback"
  | "system"
  | "agent_link"
  // The confluence:contentBylineItem entry point under the page title. Its own
  // area because it is an activation surface, not part of a macro's lifecycle:
  // it renders on every page, including pages with no diagram at all.
  | "byline"
  // The confluence:homepageFeed card in the right panel of the Confluence
  // Home page. Its own area for the same reason as "byline" above: it is an
  // activation surface disconnected from any macro's lifecycle, rendered on
  // the Home page rather than on a page carrying a diagram.
  | "homepage_feed"
  | "diagram_impact"
  // Architecture Tokens: "also appears in other diagrams" context for Mermaid
  // sequence participants. Read-only in Phase 1; index built offline.
  | "architecture_tokens";

/** Whether an Architecture Tokens lookup found index rows for the current diagram. */
export type ArchitectureTokenLookupOutcome = "indexed" | "index_miss";

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
  // conf-app#368: on macro_viewed, `viewer`-vs-`editor` comes from
  // ApWrapper2.isDisplayMode(). Builds before 2026-07-19 stamped the native
  // macro-config surface (insert / edit-params dialog) as `viewer`, so
  // historical "viewer" render volumes include ~3% authoring-session renders
  // (no custom_content_id, inflated duration_ms from long-lived editor
  // iframes). Segment by app_version when comparing across the fix.
  | "viewer"
  | "editor"
  | "modal"
  | "page_banner"
  | "dashboard"
  | "route"
  // Byline activation nudge. MUST be passed explicitly on every activation_*/
  // byline_* event: the dialog runs in a contentBylineItem iframe where
  // ApWrapper2.isDisplayMode() returns true (no extension.modal/.macro), so an
  // inferred surface would mislabel byline activity as `viewer` — the exact
  // #368 misclassification (see MEMORY project_368_surface_misclassification).
  | "byline"
  | "forge_trigger"
  | "scheduled_job"
  // Vendor-operated actions launched from the ZenUML JSM agent view. This is
  // deliberately separate from `route`: it measures a support workflow, not
  // customer traffic to a Pages endpoint.
  | "support_automation"
  // The Fullscreen Connect rail (AgentLink/ConnectPanel.vue) — distinct from
  // the small-macro `viewer` surface that hosts the initial Connect button.
  | "fullscreen"
  // The contentBylineItem modal. Confluence boots this iframe only when the
  // item is CLICKED (measured 2026-08-01: 5 opens against 39,197 macro views on
  // the variants that ship it), so every event carrying this surface is a
  // deliberate user action — there are no byline impressions to filter out.
  | "byline";

export type EntryPoint =
  | "page_view"
  | "macro_toolbar"
  | "page_editor"
  | "get_started"
  | "viewer_notice"
  | "ai_prompt"
  | "ai_repair"
  | "dashboard"
  | "route"
  | "forge_trigger"
  | "byline"
  | "unknown";

export type OperationMode = "create" | "edit" | "unknown";

// Text-editor mutation telemetry. Replacement scope describes how much of the
// editable OLD document a user transaction covered; content delta describes
// how different the resulting text is. Keeping the two axes separate avoids
// treating a whole-document paste with a tiny textual change as a local edit.
export type EditorReplaceScope = "full" | "near_full";
export type EditorInputMethod =
  | "paste"
  | "typing"
  | "delete"
  | "drop"
  | "undo"
  | "redo"
  | "unknown";
export type ContentDeltaBucket = "none" | "tiny" | "small" | "medium" | "large";
export type CopySource = "copy_for_ai" | "view_source";

// Format slice selected on the dual-format ("My API Documents") dashboard's
// tab / Format filter. "all" shows both AsyncAPI and OpenAPI docs.
export type DashboardFormatFilter = "all" | "asyncapi" | "openapi";

export type RenderMode = "live_render" | "cached_svg";

// Viewport render gate (#382): how a gated viewer render was released.
// Property is ABSENT on ungated renders (flag off / editor / fullscreen /
// non-sequence-family) — see utils/renderGate/viewportGate.ts.
export type RenderGateOutcome =
  | "immediate"
  | "scrolled_in"
  | "background"
  | "failopen";

// Viewport gate depth (#382): what the gate held back for this render.
//   load   — the default: content fetch (and SWR revalidate) waited for the
//            viewport turn too, so an offscreen mount costs ~bundle boot +
//            context until released
//   render — paint-only gating (fetch ran immediately); reachable only via
//            the zenuml.gateMode localStorage diagnostic override
// Absent whenever render_gate is absent.
export type RenderGateMode = "render" | "load";

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

// Where the diagram CONTENT (the macro's doc) came from on this render — distinct
// from cache_source, which is about the rendered SVG.
//   fetch     — loaded over the network this view (first view / cache miss)
//   swr_cache — served from the id-keyed content cache BEFORE the fetch (a revisit
//               fast path), with a background revalidate that re-renders on change
// Absent when no content fetch was involved (legacy/new macros, or macro types not
// yet wired for the content cache). See utils/renderCache/contentCacheStore.ts.
export type ContentSource = "fetch" | "swr_cache";

// Where the macro count used by the Lite paywall gate came from, and — when the
// count is unusable — WHY. Rides on `paywall_gate_evaluated.macro_count_source`.
// This is the dispositive dimension for the #302 fail-open leak: the gate is
// `macrosCreated >= 100`, but `macrosCreated` defaults to 0, so a `undefined`
// (read failed) or `zero` (under-return) source means the gate silently does not
// fire on a genuinely over-limit space. `kv` = served from the KV cache (may be
// stale-low); `collect` = fresh space enumeration; `mock` = localStorage override.
export type MacroCountSource = "kv" | "collect" | "undefined" | "zero" | "mock";

// Which policy produced the Lite paywall's effective enabled/disabled state
// for this `paywall_gate_evaluated` decision (lite-paywall-default-on):
//   default_on — the backend explicitly returned `PAYWALL_EXEMPT: false`;
//                 Lite's paywall is on, per the fixed default policy.
//   exemption  — the backend explicitly returned `PAYWALL_EXEMPT: true`
//                 (a domain or the wildcard `"*"` entry in PAYWALL_EXEMPTIONS).
//   fail_open  — the `PAYWALL_EXEMPT` property was absent (missing/unreadable/
//                 malformed KV, or the lookup was never made) — an unavailable
//                 decision, not evidence the tenant is safe to restrict.
export type PaywallPolicySource = "default_on" | "exemption" | "fail_open";

// Onboarding funnel: how a starter surface (template gallery / starter-shown
// event) came to be visible. 'auto_first_open' = the editor opened it itself
// on a brand-new blank macro; 'manual' = the user asked for it (Templates
// button). Shared by editor_starter_shown's `trigger` and
// editor_template_gallery_opened's `template_gallery_trigger` so the two
// surfaces stay comparable on the same axis.
export type GalleryOpenTrigger = "auto_first_open" | "manual";

// Effective Session Replay policy stamped on analytics events. `authoring`
// means a macro create/edit start forced recording independently of the Forge
// flag cohort. See macro_create_started / macro_edit_started below.
export type SessionReplayEventSource =
  | "targeted"
  | "sampled"
  | "authoring"
  | "off";

// `start_session_recording()` is a void SDK call whose recorder work continues
// asynchronously. `returned` records only that the call did not synchronously
// throw; it is not proof that a replay was uploaded. `$mp_replay_id` on a later
// event is the outcome evidence.
export type SessionReplayStartCallOutcome = "returned" | "threw";

/**
 * Which 404 NOT_FOUND envelope a failed custom-content CREATE returned.
 * `bare_not_found`      — `"title":"Not Found"`, detail null: the permission-
 *                          masked refusal (verified 2026-08-30 on lite-stg).
 * `container_not_found` — `"title":"Unable to find container content…"`: the
 *                          page id does not resolve for this caller (bogus id,
 *                          or another user's unpublished draft).
 * `other`               — any other 404 NOT_FOUND title.
 */
export type CreateNotFoundShape = "bare_not_found" | "container_not_found" | "other";

/** Outcome of the operations probe behind save_failed_diagnosed. */
export type SaveFailureProbeStatus = "ok" | "page_unreachable" | "failed";

export type AnalyticsEventName =
  | "macro_viewed"
  // Both authoring-start events force Session Replay at 100% before the event
  // is sent. Editor entries must emit the event from the iframe that owns the
  // interaction; the replay policy itself stays centralized here.
  | "macro_create_started"
  | "macro_create_succeeded"
  | "macro_edit_started"
  | "macro_edit_cancelled"
  | "macro_save_succeeded"
  | "macro_save_failed"
  // Fired once per failed CREATE whose Confluence answer was a 404 NOT_FOUND
  // envelope, AFTER a read-only probe of the caller's own operations on the
  // host page (`GET /rest/api/content/{pageId}?expand=operations`). The bare
  // `"title":"Not Found"` shape is a permission-masked refusal: on 2026-08-30
  // (lite-stg, four permission sets) a user holding "Add pages" but not "Add
  // attachments" got exactly that shape on POST /api/v2/custom-content while
  // PUT still succeeded, and the `operations` list carried
  // `create/<our custom-content type>` only alongside `create/attachment`.
  // The legacy `save_failed` event keeps the raw error; this event records
  // WHY (`error_shape`, `can_create_cc_type`, `can_create_attachment`,
  // `can_create_page`, `page_reachable`) so the cause is read off the event
  // instead of inferred. One probe per failure; never fired on success.
  | "save_failed_diagnosed"
  // Fires when the shared DSL editor's selected type tab changes. `from` and
  // `to` capture the observed UI action; `macro_type` repeats the destination
  // for existing type breakdowns. This is an action signal, not proof of a
  // successful render or publish.
  | "macro_type_changed"
  // Fires the instant the editor begins its redirect after a Publish/Save —
  // i.e. immediately before view.submit() / view.close(). Carries
  // `publish_duration_ms`, the user-perceived click→redirect latency. This is a
  // WIDER window than macro_save_succeeded's `save_duration_ms` (which is only
  // the persistence round-trip inside saveToPlatform): it additionally covers
  // the ~500ms pre-submit delay, the save-time attachment race, and the
  // macro-config writeback. Emitted from all 5 save flows (sequence/mermaid/
  // plantuml via forgeIndex, graph, openapi, asyncapi, embed). See
  // utils/analytics/publishTiming.ts.
  | "macro_publish_completed"
  // Embed re-target attempted from a non-submittable surface (e.g. the
  // view-mode Edit modal). view.submit() throws "view is not submittable"
  // there, so the embed's document reference cannot be changed — the user
  // must re-target from the page editor. Tracks how often users hit this.
  | "embed_retarget_blocked"
  // A pasted confluence.zenuml.com deeplink autoconverted into an embed
  // macro. `detected` is the per-viewer-init denominator; exactly one of
  // `target_resolved`, `failed`, or `cross_tenant_rejected` follows. Because the
  // autoConvertLink persists in ADF, these measure render attempts rather
  // than unique paste actions.
  | "embed_autoconvert_detected"
  // The deeplink's cloudId doesn't match the pasting site's — rejected
  // fail-soft rather than fetching cross-tenant.
  | "embed_autoconvert_cross_tenant_rejected"
  // A same-tenant autoConvert link resolved to an existing custom-content
  // document. This is a data-resolution signal, not proof that the diagram
  // painted successfully; macro_viewed remains the rendered-view signal.
  | "embed_autoconvert_target_resolved"
  // An autoConvert link could not be resolved. `failure_reason` distinguishes
  // parser/matcher drift (`invalid_url`) from missing custom content
  // (`target_missing`). Cross-tenant rejection keeps its dedicated event.
  | "embed_autoconvert_failed"
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
  // conf-app#435: these three carry `macro_type` (reusing the property already
  // registered below, not a new one — see the field's doc comment in
  // src/utils/analytics/types.ts) so per-diagram-type export failure rates are
  // a direct query, not a join against `custom_content_id` history. Emitted
  // from the Forge backend (src/export.js, src/asyncapi-export.js), which
  // posts to Mixpanel /import directly rather than through
  // trackAnalyticsEvent/AnalyticsProperties — this union documents the shape,
  // it doesn't enforce it there.
  | "macro_export_requested"
  | "macro_export_succeeded"
  | "macro_export_failed"
  // Export PNG dialog (ExportModal.vue): richer overlay-annotated PNG export
  // (background + note/arrow/callout/watermark overlays), tracked separately
  // from the generic macro_export_* triple above (unused by any call site as
  // of this registration). opened = modal shown; succeeded = PNG delivered
  // via download or clipboard (`method`), with the `background` value and
  // has_note/has_arrow/has_callout/has_watermark overlay flags; failed = an
  // export attempt failed before delivery (`failure_reason`); dismissed =
  // modal closed with no successful export in that open session.
  | "export_png_opened"
  | "export_png_succeeded"
  | "export_png_failed"
  | "export_png_dismissed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_title_dismissed"
  | "ai_title_accepted"
  | "ai_title_modified"
  // AI entry-point impressions. Fire on each hidden -> visible transition of
  // the editor button (not on component re-renders), with macro_type so the
  // denominator can be compared directly with the existing click/request
  // events below.
  | "ai_chat_button_shown"
  | "ai_chat_opened"
  | "ai_chat_closed"
  | "ai_chat_suggestion_selected"
  | "ai_chat_prompt_submitted"
  | "ai_chat_change_applied"
  | "ai_chat_prompt_failed"
  | "ai_chat_prompt_cancelled"
  | "ai_chat_code_visibility_toggled"
  | "ai_chat_syntax_issue_shown"
  | "ai_chat_syntax_repair_requested"
  | "ai_chat_diff_toggled"
  | "ai_chat_history_opened"
  | "ai_chat_history_load_succeeded"
  | "ai_chat_history_load_failed"
  | "ai_chat_version_restore_requested"
  | "ai_chat_version_restored"
  | "ai_chat_change_undone"
  | "ai_chat_version_restore_failed"
  // AI Repair performance lifecycle. requested fires immediately before the
  // start request and carries poll_interval_ms + timeout_budget_ms plus the
  // requested ai_model / reasoning_disabled overrides when supplied. succeeded /
  // failed close the same user-perceived interval with duration_ms, poll_count,
  // and any backend timing/attempt/config metadata returned by job-status.
  // backend_duration_ms covers the whole Diagramly worker interval, while
  // backend_llm_duration_ms sums only its LLM calls across repair attempts.
  // failed additionally carries failure_phase; never attach diagram code,
  // error source text, or a job id to these events.
  | "ai_repair_button_shown"
  | "ai_repair_requested"
  | "ai_repair_succeeded"
  | "ai_repair_failed"
  | "ai_repair_applied"
  | "ai_repair_dismissed"
  | "upgrade_modal_shown"
  | "paywall_triggered"
  | "paywall_blocked_create"
  // Lite paywall on an EDIT (as opposed to paywall_blocked_create, the
  // create-time block). Emitted by mountPaywallGate.ts. paywall_continued_editing
  // is its counterpart: the user hit "Continue editing" instead of being
  // blocked. Both were live and documented in UpgradeEventName /
  // trackUpgradeEvent before being registered here.
  | "paywall_blocked_edit"
  | "upgrade_modal_dismissed"
  | "paywall_continue_used"
  | "paywall_continued_editing"
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
  // Phase 5b: the space-admin-only purchase CTA on the page banner. A space
  // admin can buy an Enterprise Bundle ($299/space/yr, Stripe) WITHOUT a
  // Confluence site admin — the Marketplace upgrade path needs a site admin,
  // which a space admin is not. This is the only event that measures whether
  // admin-targeted copy produces a purchase intent rather than another relay
  // hop. Distinct from `extension_request_clicked` (asks US for more free
  // time) and `advocacy_message_copied` (asks SOMEONE ELSE to act).
  | "paywall_bundle_cta_clicked"
  // The Marketplace (Full plan) rail. Separate event from the bundle rail
  // because they need different people: Marketplace requires a Confluence SITE
  // admin, the bundle requires nobody. Splitting them is how we find out which
  // wall a tenant is actually stuck behind.
  //
  // Restores measurement deleted in 05b5287f (2026-05-12), which removed the
  // pricing UI *and* its `upgrade_cta_clicked` emitter together. Any analysis
  // reading that event's 0 as "nobody wants to buy" is reading an absent
  // emitter — buy-intent has been unmeasurable since, not measured as zero.
  | "paywall_marketplace_cta_clicked"
  // Footer "Why do I need to upgrade?" link in the paywall modal. Until
  // 2026-08-10 this was a bare target="_blank" anchor, silently dropped by the
  // Forge iframe sandbox (no allow-popups) — zero effect on click AND zero
  // telemetry, so the four months of no clicks are an absent emitter, not
  // absent interest. Low-intent signal vs the two purchase rails: it measures
  // "wants to understand the pricing story", not "ready to pay".
  | "paywall_learn_more_clicked"
  | "space_admin_active"
  | "advocacy_message_copied"
  | "advocacy_draft_preview_clicked"
  | "extension_request_clicked"
  // JSM "Apply Extension" lifecycle. requested fires after the dedicated
  // automation secret is authenticated and the command shape is accepted;
  // succeeded fires only after the requester-scoped SPACE_LICENSE_KV record
  // is read back active; failed closes every authenticated attempt that did
  // not reach that state. Backend-emitted through Mixpanel /import. Never add
  // the Jira ticket key, raw JSM description, or customer reply to telemetry.
  | "extension_action_requested"
  | "extension_action_succeeded"
  | "extension_action_failed"
  | "csat_displayed"
  | "csat_submitted"
  | "csat_dismissed"
  | "feedback_link_clicked"
  | "graph_editor_init_empty"
  // Graph (DrawIO) Diagram/Board chrome switch. Same mxfile, two DrawIO
  // chromes: `diagram` is the existing Atlas/standard embed; `board` is
  // DrawIO Sketch (`ui=sketch&sketch=1`). requested fires on a click that
  // intends to change mode (same-mode clicks are a no-op and emit nothing);
  // succeeded fires only after the iframe has reloaded, the previous mxfile
  // has been re-loaded, and the switch control is operable; failed fires
  // instead of succeeded on capture/reload/restore/init errors.
  | "graph_editor_mode_switch_requested"
  | "graph_editor_mode_switch_succeeded"
  // A Board macro whose independent document is missing, empty or malformed.
  // GenericViewer's load_failed_shown cannot separate this from a 404.
  | "graph_board_document_invalid"
  | "editor_load_empty_active_field"
  | "swagger_editor_config_empty_with_modal"
  | "fullscreen_opened"
  // Viewer "View source" panel (#333): read-only DSL affordance for all viewers
  // (including users without edit permission). Opened from the hover toolbar on
  // text-DSL types only (sequence / mermaid / plantuml).
  | "viewer_source_opened"
  | "viewer_source_copied"
  // Copy-for-AI discovery funnel. Impression fires once per eligible viewer
  // instance; menu_opened fires on every closed -> open transition.
  | "copy_for_ai_impression"
  | "copy_for_ai_menu_opened"
  // "Copy for AI" demand-test button in the viewer top-actions row (alongside
  // View Source): a split button — a one-click primary segment (job:
  // 'generic') plus a chevron menu of five job-framed entry points (explain /
  // update / implement / audit / tests) that only vary the copied preamble
  // (buildCopyForAiPrompt.ts), never the DSL+page payload itself. Fires once
  // per click, primary or menu item, with `job` recording which one. `outcome`
  // distinguishes a full copy (diagram + surrounding page context) from the
  // diagram-only fallback (page context unavailable) and an outright
  // clipboard-write failure.
  | "copy_for_ai_clicked"
  // Every accepted, user-attributed CodeMirror transaction that replaces at
  // least 95% of the editable OLD document. This is an operation signal; a
  // saved outcome is established separately by macro_save_succeeded carrying
  // the same journey_id and the edit-session summary properties.
  | "editor_global_replace_observed"
  // Bottom-pill "Copy diagram link" action (task 6, docs/superpowers/sdd/
  // 2026-07-26-embed-deeplink-productization): mints and copies the bare
  // embed deeplink (https://<host>/d/<cloudId>/<contentId>) for the diagram
  // being viewed — the supply side of the autoConvert paste->embed flow.
  // `link_source` records which affordance minted it (today only the viewer
  // pill; a future share-preview surface would use a different value).
  // Fires once per click, in a finally block, after the terminal outcome is
  // known — same convention as `copy_for_ai_clicked`. `outcome` distinguishes
  // a successful clipboard write from a clipboard-write failure from the
  // three "couldn't even mint a link" paths (missing host/contentId, or an
  // unresolvable cloudId), which used to fire this event identically to
  // success.
  | "deeplink_copied"
  // Editor staleness hint (docs/superpowers/specs/
  // 2026-07-18-job-b-editor-staleness-hint-design.md). Shown on inline
  // page-editor renders when the host page drifted >=5 versions past the
  // diagram's last update. Job B shell / author-conversion core: the north
  // star is a non-author's first macro_save_succeeded after a hint click.
  | "staleness_hint_shown"
  | "staleness_hint_clicked"
  | "staleness_hint_dismissed"
  // User-cohort targeting pipeline (docs/superpowers/plans/
  // 2026-07-18-user-cohort-targeting-pipeline.md). The macro iframe refreshes
  // the current user's cohort membership from /api/user-cohorts (KV-backed,
  // offline-computed) and persists it as a localStorage marker for synchronous
  // reads by other iframes (page banner, upgrade modal). `refreshed` fires on
  // a successful fetch (including an empty cohort list); `refresh_failed` on
  // network/auth/malformed-response errors.
  | "cohorts_refreshed"
  | "cohorts_refresh_failed"
  // Lite byline activation, Phase 1 (docs/superpowers/specs/
  // 2026-07-25-lite-byline-activation-design.md). The whole point of Phase 1 is
  // to measure whether a contentBylineItem earns clicks in OUR app: the same
  // module has been opened 39 times in 3.5 months on Diagramly and never on
  // Full, so `byline_opened` IS the experiment's readout, not supporting
  // telemetry. Every event here is user-initiated — Confluence boots the byline
  // iframe on click only.
  // Fires exactly ONCE per modal open, even though the emit sits after the
  // listing resolves (it needs diagram_count to be the readout at all). The
  // retry button re-runs the same loader, so an unguarded emit counted a retry
  // as a second open — an inflation only users who hit a load failure could
  // produce, biasing the primary metric toward the failure population.
  | "byline_opened"
  // A retried listing, so the retry rate is measurable without it landing in
  // byline_opened. `result` = 'recovered' | 'failed'.
  | "byline_list_retried"
  // A listed diagram was acted on from the modal (jump / open fullscreen).
  | "byline_diagram_opened"
  // The diagram's DSL was copied to the clipboard from a card. Deliberately NOT
  // byline_diagram_opened: "the index helped me find and open a diagram" and "I
  // grabbed the source text" are different intents, and folding them together
  // makes index engagement read higher than the behaviour it describes.
  | "byline_diagram_source_copied"
  // "Add a diagram" clicked. Splits from byline_editor_deeplinked so an
  // intent-to-create that fails to route is still visible.
  | "byline_create_clicked"
  // The modal routed the user to the page editor (router.navigate). Phase 1's
  // create path ends here: the macro itself is inserted with the editor's own
  // insert menu. North star = a first-ever macro_create_succeeded by an
  // accountId within 30 minutes of this event.
  | "byline_editor_deeplinked"
  // Modal closed with no diagram opened and no create click — the "looked and
  // left" outcome. `dwell_ms` separates a misfire from a real evaluation.
  | "byline_dismissed"
  // Thumbnail resolution finished. Separate from byline_opened because
  // thumbnails load AFTER the list paints (they must never delay the Phase 1
  // readout), so the coverage number simply does not exist yet when
  // byline_opened fires. `thumbnail_count` vs `diagram_count` is the coverage
  // ratio that decides whether the visual index earns its requests.
  | "byline_thumbnails_loaded"
  // The page's published ADF was scanned to find which listed diagrams no macro
  // references. `unplaced_count` vs `diagram_count` measures the one failure
  // mode the whole create→paste handoff has: a diagram saved from the byline
  // that the user never pasted. It is already counted against the Lite
  // 100-macro limit at that point, so a rising ratio is both a UX failure and a
  // quota cost. Emitted once per open, after the list paints — the scan is a
  // full-page ADF GET and must never delay it.
  | "byline_unplaced_scanned"
  // The byline editor produced a saved diagram, and (when a cloudId is
  // available) a deeplink to place it. This is the conversion the picker exists
  // for: unlike byline_create_clicked it cannot fire on intent alone — a custom
  // content exists by the time it does.
  | "byline_diagram_created"
  // The byline editor closed without saving. Splits abandonment from failure,
  // which byline_create_clicked alone cannot distinguish.
  | "byline_create_cancelled"
  // "Done" was pressed on the post-create panel while the host page was in the
  // editor, and the app asked Confluence to close the byline view. Forge
  // documents view.close() as a *request* with no module restrictions stated,
  // but says nothing about contentBylineItem specifically — `result`
  // ('closed' | 'unsupported' | 'failed') is how we find out whether a byline
  // item can dismiss itself, rather than assuming it.
  | "byline_view_close_requested"
  // ---- Unplaced-diagram page banner (byline surface, page_banner surface) ----
  //
  // The byline already labels a diagram "not on this page" (BylineDiagrams.vue,
  // `isUnplaced`), but Confluence boots the byline iframe only on CLICK — 5
  // opens against 39,197 macro views — so the label reaches almost nobody. The
  // page banner mounts on every page load, which is where the fact has to be
  // said. Fired from UnplacedDiagramsBanner.vue.
  //
  // Two gates admit a load. The dedicated `zenuml-unplaced-banner` module is
  // gated by Confluence itself on a content property, so its iframe is never
  // created on a page with nothing to say; the shared page-banner host gates
  // its fallback synchronously off the localStorage marker. Either way the
  // ~99.9% of page loads with no record pay nothing.
  //
  // `unplaced_banner_evaluated` fires on every load past those gates, and it is
  // the denominator that makes their cost measurable. `result` covers every
  // path out, so that claim actually holds:
  //   'unplaced'          — the banner shows.
  //   'all_placed'        — the record was stale (the user pasted the link
  //                         since), so we paid one ADF read and showed nothing.
  //   'scan_failed'       — the page ADF could not be read; we show nothing
  //                         rather than claim what we cannot prove.
  //   'record_unreadable' — the gate fired but the record did not read back
  //                         (forbidden, malformed, already emptied).
  //   'expired'           — nobody has re-confirmed the record in 30 days, so
  //                         we stop buying an ADF read for it.
  //   'shows_exhausted'   — this browser has been told about this record the
  //                         maximum number of times.
  //   'page_mismatch'     — the fallback record names a different page than the
  //                         one it was read on, so it says nothing. Any hit
  //                         here is a bug: the record reached the wrong page.
  //   'dismissed_quiet'   — this user dismissed the notice within the quiet
  //                         window, so the load stood down before reading the
  //                         record at all.
  //   'dismissed_version' — this user dismissed the notice for exactly this
  //                         record version; a new diagram re-arms it.
  //   'yielded'           — a higher-priority banner has the page's one banner
  //                         slot; `suppressed_by` names it. Two Confluence
  //                         modules mean two iframes, so this notice stands
  //                         down rather than stack (utils/banners/priority.ts).
  //
  // The two 'dismissed_*' results are what separates "the gate never fires" from
  // "it fires and everyone has already said no" — the question that otherwise
  // needs a browser and the user's own localStorage to answer.
  //
  // A rising 'all_placed' share is the signal that the record's write/retire
  // cycle is leaking, not that users are ignoring the banner. A rising
  // 'record_unreadable' share means the gate and the reader disagree — most
  // likely a permission the writer holds and the reader does not. A high
  // 'yielded' share is how we tell "nobody sees this notice" apart from
  // "nobody has unplaced diagrams".
  | "unplaced_banner_evaluated"
  // The banner is committed to displaying. Split from _evaluated because only
  // this one is an impression: it is the denominator for the copy and dismiss
  // rates, and `unplaced_count` on it is the verified count (post-scan), not
  // the marker's possibly-stale one.
  | "unplaced_banner_shown"
  // The user dismissed the banner. Dismissal is scoped to the marker version it
  // was shown for, so a NEW unplaced diagram re-arms the banner rather than
  // being silenced by an old dismissal — which means this event counts
  // "not now, for these diagrams", never "never again".
  | "unplaced_banner_dismissed"
  // The byline recorded (or cleared) the page's unplaced set as a Confluence
  // CONTENT PROPERTY — the shared, cross-user store the banner's
  // `displayConditions` gate reads server-side.
  //
  // This event exists to measure the one assumption the property design rests
  // on: that the byline user can actually write a page property. The write runs
  // as the USER (requestConfluence), and a user who can create custom content
  // on a page cannot be assumed to hold edit permission on the page itself.
  // `result` = 'written' | 'deleted' | 'unchanged' | 'forbidden' | 'failed'.
  // Also emitted by the BANNER when it retires a record it proved stale, so a
  // reader who lacks delete permission is visible instead of leaving every
  // later reader to pay the same ADF read forever.
  // A material 'forbidden' share means the cross-user path is not reaching the
  // people who need it and the localStorage fallback is carrying the feature —
  // which is exactly what `unplaced_source` on the banner events reports from
  // the other end.
  | "unplaced_property_write"
  // One-click place: the app writes the macro into the page ADF itself, instead
  // of handing over a link for the user to paste. THE conversion event for this
  // whole feature — every other event here measures noticing, and this one
  // measures the thing actually getting fixed. Read against
  // `advocacy_message_copied` (ui_component 'byline_unplaced_link' /
  // 'page_banner_unplaced_link'), which is the same intent taking the four-step
  // route: copy, open the editor, paste, publish.
  //
  // `result`:
  //   'added'           — a new page version carries the macro.
  //   'already_present' — the page already referenced it (someone else placed
  //                       it, or a double click); nothing was written.
  //   'forbidden'       — the user cannot edit this page. Expected, not a bug:
  //                       the notice reaches every reader, and a reader is not
  //                       always an author. The UI falls back to the link.
  //   'conflict'        — the page changed under us twice; we do not force.
  //   'failed'          — anything else, including an unreadable page body.
  //
  // A material 'forbidden' share means the banner is reaching the wrong
  // audience and the button should be gated rather than offered-then-refused.
  | "diagram_added_to_page"
  // The macro that was just placed pulled the reloaded page to itself and
  // flashed a ring around the diagram. Fired by the MACRO, not by the surface
  // that placed it: the two are different iframes and only the macro knows it
  // rendered.
  //
  // It is the second half of `diagram_added_to_page` (result 'added') and only
  // means anything read against it. A gap between the two is the reveal being
  // requested and never claimed — the macro never booted, the reload never
  // happened, or the request went stale — which is invisible from the placing
  // side, because that iframe is gone by then. `reveal_age_ms` says how long
  // the round trip took; a value near the TTL is a page slow enough that the
  // next one would have missed it.
  | "diagram_revealed"
  // Two independent producers, disambiguated by `failure_stage` (reliability
  // audit 2026-08-06 §3/§4/§12 items 1-2, conf-app#149/#150):
  // - unset/'syntax': GenericViewer's `$store.state.error` watcher — client-
  //   side syntax validation (mermaid/plantuml/sequence) or, for PlantUML
  //   only, its own fetch failure (audit §2.1 — PlantUML's fetch-failure
  //   class is a separate, still-open investigation, audit §12 item 3).
  // - 'render_crash': trackViewerRenderCrash() — a genuine exception from the
  //   render pipeline itself (mermaid.js, zenuml.render, GraphViewer,
  //   SwaggerUIBundle) that previously produced a silent blank/broken macro
  //   with `console.error` as the only signal. Before this, Mermaid+Sequence
  //   (81% of view volume) had no way to distinguish "never rendered" from
  //   "rendered fine", and Graph/OpenAPI (12.4%) had no failure telemetry at
  //   all — a Graph crash fired neither this event nor `macro_viewed`.
  | "viewer_load_failed"
  // Load-failed recovery panel — the "Try again" button (GenericViewer.vue).
  // `retry()` is a bare location.reload(), so the click and its result sit in
  // two different page lifetimes: the click event is emitted before the reload,
  // and the resolution event after it, matched through a sessionStorage marker
  // (utils/loadFailedRetry.ts) keyed on the macro's localId. Without the pair
  // there is no way to tell a transient content-fetch failure (recovers on
  // reload) from a permanently unavailable diagram — both render the same
  // terminal panel, and 2026-08-18..22 telemetry could only count impressions
  // (391 external, 128 macros) with no recovery rate attached.
  | "load_failed_retry_clicked"
  | "load_failed_retry_resolved"
  // Diagram source snapshot attachments (resilience for cross-page copies /
  // deleted source pages — see docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md)
  | "snapshot_created"
  | "snapshot_create_failed"
  // Emitted when a snapshot write did NOT happen for an EXPECTED, by-design
  // reason rather than a genuine error — the write path is best-effort and must
  // "degrade silently" (see the plan). Splitting these out of
  // snapshot_create_failed keeps that event a real error signal: a plain viewer
  // with no attachment-write permission (`no_write_permission`, 401/403 from the
  // app-auth upload) and a save onto a not-yet-published draft page
  // (`page_not_published`, 404 — the same benign condition the PNG backup
  // recovers from) are the two normal outcomes, not failures. `snapshot_skip_reason`
  // carries which one. Genuine transport / 5xx errors still emit
  // snapshot_create_failed.
  | "snapshot_backfill_skipped"
  | "snapshot_fallback_rendered"
  // Diagram attribution and audience impact (Phase 1): the read-only footer
  // and its three-second continuous-visibility registration flow.
  | "diagram_attribution_shown"
  | "diagram_audience_registration_succeeded"
  | "diagram_audience_registration_failed"
  // Architecture Tokens Phase 1 (viewer footer + lifeline popover). No label
  // text, page id, or tenant vocabulary on any of these.
  | "related_diagrams_lookup_succeeded"
  | "related_diagrams_lookup_failed"
  | "related_token_indicators_shown"
  | "related_diagram_popover_opened"
  | "related_diagram_link_clicked"
  // Save-time PNG backup upload, async mode (#392). The frontend hands the PNG
  // to /forge-upload-attachment with `async: true`, gets an ack after
  // validation, emits `attachment_upload_queued` and returns — the real
  // Confluence write finishes server-side in `waitUntil`, after the editor
  // iframe is gone. These two are that write's terminal outcome, emitted by
  // the Cloudflare function (not the browser tracker), so the save path stops
  // being a blind channel: before this, ~34% of all upload attempts had no
  // success/failure signal at all. `attachment_upload_queued` remains the
  // denominator; every queued event should be followed by exactly one of
  // these. `failure_stage` splits WHERE the server-side write died
  // (read_check / upload / properties_put / handler_error).
  | "attachment_upload_async_succeeded"
  | "attachment_upload_async_failed"
  // The async counterpart of `attachment_upload_skipped`: the save-time write
  // 404'd because the host page is not published yet, which is the SAME benign
  // condition the sync path already records as a skip rather than an error.
  // Without this the identical situation was a `skipped` on one path and a
  // `_failed` on the other — recreating, on the path that carries ~34% of all
  // attempts, exactly the mislabeling #392 exists to remove (verified on
  // lite-stg: 14 async failures, all http 404, zero successes).
  //
  // A 404 is only benign when the page really is unpublished, so the two are
  // told apart by `content_status`, read from the page GET the upload already
  // performs: not-current -> this skip; `current` -> a real failure labelled
  // `app_no_access` (the app cannot see the page — #211), never a skip.
  | "attachment_upload_async_skipped"
  // Daily macro-count inventory snapshots. These are emitted by the
  // Cloudflare snapshot service, not by the browser tracker. Registering them
  // here keeps the shared analytics vocabulary explicit before the scheduled
  // job is wired (docs/superpowers/specs/
  // 2026-07-18-daily-macro-count-snapshots-design.md).
  | "macro_count_snapshot_completed"
  | "macro_count_space_changed"
  | "macro_count_snapshot_failed"
  // Lite->Full macro conversion (vendor-operated queue, phase 1). Emitted by
  // the Cloudflare conversion service, not the browser tracker — same
  // contract as the macro-count snapshot events above. Lifecycle: a job is
  // enqueued by the vendor admin script, claimed by the Full app's scheduled
  // function, then each page either converts or fails; `completed` closes the
  // job with totals. `macro_skipped` is per-macro (embed macros and unknown
  // keys are skipped by design in v1, and the skip is the signal that tells
  // us when phase-2 embed support becomes worth building).
  | "macro_convert_job_claimed"
  | "macro_convert_job_completed"
  | "close_guard_rejected"
  // Close-guard draft-restore banner (utils/restoreDraftBanner.ts). Shipped
  // 2026-05-10 without instrumentation, so 2.5 months of usage are dark —
  // these four decide whether the feature earns its keep. `shown` is the
  // denominator; `restored` / `discarded` / `dismissed` are the user's three
  // exits (✕ leaves the draft in localStorage, Discard deletes it).
  | "draft_banner_shown"
  | "draft_restored"
  | "draft_discarded"
  | "draft_banner_dismissed"
  // In-viewer Edit gate for same-page shared-id macros (view-fork silent
  // orphan: view-editing a macro whose customContentId is shared by N>1
  // macros on the page forks a new CC on save, but the in-viewer modal cannot
  // write the new id back into the macro config — writebackGate.ts / #170 —
  // so the edit lands in a CC nothing references). Evaluated on every viewer
  // Edit click that carries a customContentId; `edit_dup_gate_outcome`:
  // 'blocked' = duplicates found, modal NOT opened, user steered to the page
  // editor; 'passed' = unique reference, modal opened; 'scan_failed' = the
  // ADF count scan errored, fail-open (modal opened; the editor-side backstop
  // below still guards Publish).
  | "edit_dup_gate_evaluated"
  // The editor-side backstop caught what the click gate let through (its
  // fail-open path, the staleness-hint CTA on an inline page-editor render,
  // or any other non-submittable entry): the modal editor loaded a doc
  // flagged isCopy in a surface where view.submit({config}) cannot persist,
  // so Publish is disabled with an explanatory tooltip instead of silently
  // minting an unreferenced CC. `copy_reason` says which copy flavor.
  | "editor_publish_blocked_fork_unlinkable"
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
  // (the 10-min idle window, sliding — spec 2026-07-13 §3) lapses, from ANY still-live state (waiting/
  // timeout/connected/suspended). Distinct from agent_link_disconnected: no
  // explicit user action or wire disconnect envelope caused this — the token
  // simply died server-side and the client noticed on its own clock.
  // `had_agent_connected` distinguishes "an agent was actually paired and
  // lost its session" from "nobody ever paired before the token lapsed".
  | "agent_link_session_expired"
  // PR1 sliding TTL (spec 2026-07-13 §7): fired by the relay owner when a
  // status envelope moves the deadline forward — throttled client-side to at
  // most one per minute, NOT one per op.
  | "agent_link_session_extended"
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
  | "agent_link_list_performed"
  | "activation_nudge_clicked"
  | "activation_served"
  // Should be ~impossible by construction (the pipeline stamps the property only
  // after caching the result). Any volume here is a preparation-pipeline bug.
  | "activation_cache_miss"
  | "activation_diagram_edited"
  | "activation_completed"
  | "activation_nudge_dismissed"
  // Starter-template gallery (#334, JTBD: author job). The real "hire moment"
  // for diagram creation is at the macro editor, before the user has typed
  // anything — the gallery replaces the old external "Examples" link
  // (Header.vue templateClick, which sent the user away to zenuml.com/
  // mermaid.js.org/plantuml.com docs) with 6-10 curated, one-click,
  // in-product templates per text-DSL macro type (sequence/mermaid/plantuml).
  // `editor_template_gallery_opened` is the denominator; `editor_template_applied`
  // (keyed by `template_id`) is the per-template pull signal the JTBD's
  // success metric needs ("editor_template_applied share of new creates").
  // AI text->diagram entry from the same issue is explicitly OUT OF SCOPE
  // here (deferred 2026-08-03) — its ai_generation_* events already exist
  // above and are reused, not redefined, when that lands.
  | "editor_template_gallery_opened"
  | "editor_template_applied"
  // Onboarding funnel — starter-template surface visibility (companion to
  // the #334 gallery above, distinct denominator). Fires when the starter
  // surface becomes visible on an EMPTY new macro. `trigger` ('auto_first_open'
  // | 'manual') distinguishes an editor that opened the surface itself on a
  // brand-new blank macro from a user who asked for it via the Templates
  // button. Today only the `manual` path has a producer (Header.vue's
  // openTemplateGallery, alongside editor_template_gallery_opened) — no
  // auto-open-on-empty-macro surface exists yet, so `trigger: 'auto_first_open'`
  // is reserved for when one is built.
  | "editor_starter_shown"
  // Onboarding funnel — "second diagram" prompt (registered ahead of its
  // producer: this task only registers the event names + properties so the
  // catalog/types are ready; no call site exists yet in this codebase. A
  // later task wires the actual prompt UI and emits these). `shown` is the
  // denominator; `clicked` is the accept action.
  | "macro_second_diagram_prompt_shown"
  | "macro_second_diagram_prompt_clicked"
  // Foreign-dialect hint (#373: PlantUML pasted into a ZenUML sequence macro
  // renders as wrong-but-plausible nonsense — see detectForeignDialect.ts for
  // the detection rule). `shown` is the denominator, fired once per becoming-
  // visible transition (not on every keystroke while it stays visible);
  // `switch_clicked` = the user accepted the correction and the editor moved
  // their source into the PlantUML tab; `dismissed` = the user closed the
  // hint without switching. Editor-only: the hint's action (switch macro
  // type) only exists on the editor's type-switcher surface, so it is not
  // shown in the read-only viewer.
  | "foreign_dialect_hint_shown"
  | "foreign_dialect_hint_switch_clicked"
  | "foreign_dialect_hint_dismissed"
  // Confluence Home page "Create a diagram" card (confluence:homepageFeed —
  // see manifest.yml). The only onboarding surface a non-admin end user
  // encounters without first inserting a macro; the pre-existing
  // confluence:globalSettings "Get Started" page reaches only site admins.
  // `homepage_feed_viewed` fires once per mount (the card only exists while
  // its Home-page section is expanded); `homepage_feed_action_clicked` fires
  // on the quick-start button. `homepage_feed_diagram_opened` fires when a
  // recent-diagram row sends the user to the page that diagram lives on —
  // the one event that measures whether this card returns people to their
  // work, as opposed to merely being rendered. It carries `macro_type` (via
  // `toMacroType`, never the raw stored `diagramType`) so the row's type is
  // comparable with every other create/view surface.
  // `homepage_feed_example_expanded` fires when an example row is opened in
  // place. It is the funnel signal for the recognition half of the card: which
  // diagram type someone with none of their own wants to look at. Carries
  // `macro_type` so it lines up with the create events for the same type.
  | "homepage_feed_viewed"
  | "homepage_feed_action_clicked"
  | "homepage_feed_diagram_opened"
  | "homepage_feed_example_expanded";

// How an activation run completed. 'copy_link' = the primary path (mint a deeplink
// and paste it into any page, #360's missing producer); 'draft_page' = the
// stall-breaker secondary that creates a page carrying the diagram.
export type ActivationPath = "copy_link" | "draft_page";

// Why an agent_link session ended (agent_link_disconnected). 'user' = explicit
// Disconnect click; 'timeout' = token/session TTL; 'idle' = no activity for the
// idle window; 'tab_close' = macro connection dropped (tab close/navigation).
export type AgentLinkDisconnectReason = "user" | "timeout" | "idle" | "tab_close";

// Why a session finally expired under the sliding-TTL policy (spec
// 2026-07-13 §3): 'idle' = 10-min idle window lapsed; 'absolute_cap' = the
// 60-min hard cap bounded an otherwise-active session.
export type AgentLinkExpiryCause = "idle" | "absolute_cap";

// Terminal outcome of an agent_link render (agent_link_render_completed) —
// the signal the F-track "thinking state" UI clears on. 'rendered' = the new
// complete diagram painted (success); 'failed' = the op errored/persist
// failed; 'timeout' = the render-safety backstop fired (no terminal signal
// within RENDER_SAFETY_TIMEOUT_MS, e.g. a dropped WS) and the shimmer was
// force-cleared. WHY a 'failed' op failed is carried by agent_link_edit_failed
// for the same op; this field only says how the render surface ended up.
// (agent_link_guardrail_rejected was deleted 2026-09-02 — never emitted.)
export type AgentLinkRenderOutcome = "rendered" | "failed" | "timeout";

// Why Track C's update_diagram guardrail rejected an op BEFORE persisting.
// Its dedicated event (agent_link_guardrail_rejected) was deleted 2026-09-02 as
// never-emitted; the type survives because it still widens the shared `reason`
// union in types.ts. 'parse_error' = the DSL didn't parse in the
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

// Graph (DrawIO) editor chrome. `diagram` is Atlas/standard; `board` is
// Sketch. Unknown persisted values must normalize to `diagram`.
export type GraphEditorModeValue = "diagram" | "board";
