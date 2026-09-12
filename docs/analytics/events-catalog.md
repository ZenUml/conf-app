# Analytics Events Catalog

Complete reference for every Mixpanel event emitted by the conf-app frontend and backend. For storage locations, `clientDomain` format, and query patterns see [reference.md](reference.md).

---

## Common properties

All events are enriched automatically by `trackAnalyticsEvent.ts`. Call sites only need to pass the properties marked **required**.

| Property | Type | Source |
|---|---|---|
| `feature_area` | `"macro" \| "ai" \| "upgrade" \| "content" \| "confluence" \| "feedback" \| "system"` | **Required at call site** |
| `surface` | `"viewer" \| "editor" \| "modal" \| "page_banner" \| "dashboard" \| "route" \| "forge_trigger"` | **Required at call site** |
| `client_domain` | string | Auto: `getClientDomain()` (subdomain only, no `.atlassian.net`) |
| `user_account_id` | string | Auto: `window.globals.apWrapper.currentUser.atlassianAccountId` |
| `product_type` | `"lite" \| "full" \| "diagramly"` | Auto: build-time `PRODUCT_TYPE` env var |
| `environment_type` | string | Auto: `forgeGlobal.forgeContext.environmentType` |
| `confluence_space` | string | Auto: `getSpaceKey()` from Forge context URL params |
| `macro_uuid` | string | Auto: `forgeGlobal.forgeContext.localId` (Forge) or `apWrapper.getMacroData().uuid` (Connect legacy) |
| `page_id` | string | Auto: `forgeGlobal.forgeContext.extension.content.id` |
| `content_id` / `custom_content_id` | string | Auto: `extension.config.customContentId` or `extension.modal.customContentId` |
| `attachment_name` | string | Auto: derived as `zenuml-{customContentId}.png` |
| `app_version` | string | Auto: build-time `VITE_APP_VERSION` env var |
| `app_commit` | string | Auto: build-time `VITE_APP_COMMIT` env var |
| `is_demo_page` | boolean | Auto on `macro_*` events: Confluence page property `diagramly-demo-page` lookup (cached per page) |

---

## Macro lifecycle

### `macro_viewed`

**Trigger:** Every time a diagram macro finishes rendering — both viewer (display mode) and editor mode. Fired by `trackRenderTime()` in `src/utils/analytics/trackRenderTime.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` or `"editor"` |
| `macro_type` | `sequence \| mermaid \| graph \| openapi \| embed \| plantuml \| none` |
| `render_mode` | `"live_render"` (diagram rendered from DSL) or `"cached_svg"` (served from stored SVG) |
| `cache_source` | Where the cached SVG came from: `"none"` for live render, `"cc_body"` for custom-content body |
| `duration_ms` | Total wall-clock time from `window.__macroLoadStart` (injected in `index.html`) to render complete |
| `cache_state` | `"cold"` / `"warm"` / `"unknown"` — derived from Resource Timing `transferSize` of same-origin JS bundles |
| `transfer_bytes` | Summed wire bytes of same-origin JS bundles (only when `cache_state` is not `"unknown"`) |
| `bootstrap_ms` | Time from `__macroLoadStart` to first app code (head scripts + bundle eval) |
| `context_ms` | Duration of `Forge.getContext()` call |
| `fetch_ms` | Duration of custom-content REST round trip |
| `render_ms` | Duration of viewer library load + diagram render |
| `measured_sum_ms` | Sum of the above four phases; `duration_ms − measured_sum_ms` is the unattributed remainder |
| `tab_hidden` | `true` when the browser tab was backgrounded during load; exclude from percentile calculations |
| `space_admin_count` | Count of space admins resolved for the current space (only on `macro_viewed`) |

---

### `macro_create_started`

**Trigger:** Editor opens for a new macro (no `customContentId` in Forge context). Fired in `forgeIndex.ts`, `forge-graph-editor.ts`, `forge-embed-editor.ts`, `forge-swagger-editor.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type of the new macro |
| `entry_point` | `"page_editor"` (inserted via slash menu / macro browser) |
| creation attempt | The pairing properties below, with `creation_event_index` = 0 |

---

### Creation attempt pairing (`creation_attempt_id`)

Not an event. `src/utils/analytics/creationAttemptTelemetry.ts` stamps every create-mode lifecycle
event sent from one editor iframe with the same random attempt token, so a DSL type switch, a
blocked publish, a failed save and the terminal outcome can be joined without account, page,
content or replay identifiers (#520). The attempt starts at `macro_create_started` and ends at
`macro_create_succeeded` or `macro_create_cancelled`; `macro_publish_completed` and
`macro_save_failed` may still carry it after the end. Edit sessions (`operation_mode = "edit"`)
never carry these properties. The stamp is captured synchronously, before tracker initialisation,
so a fast switch-then-close cannot rewrite an earlier queued event.

| Property | Notes |
|---|---|
| `creation_attempt_id` | Random UUID per editor open; never persisted, never reused across opens |
| `initial_macro_type` | Type at `macro_create_started`; frozen for the attempt |
| `final_macro_type` | Type selected at the time of this event; final for the attempt only on success or cancellation |
| `creation_event_index` | 0 at start, +1 per stamped event; orders rapid switches even when ingestion reorders them |
| `creation_elapsed_ms` | Milliseconds since `macro_create_started` |

Stamped events: `macro_create_started`, `macro_type_changed`, `macro_publish_requested`,
`macro_publish_blocked`, `macro_save_failed`, `macro_create_succeeded`, `macro_create_cancelled`,
`macro_publish_completed`.

---

### `macro_type_changed`

**Trigger:** The DSL type selector in the shared text-editor header changes value. Fired in
`src/components/Header/Header.vue`; not fired when the selection is unchanged.

| Property | Notes |
|---|---|
| `feature_area` / `surface` | `"macro"` / `"editor"` |
| `macro_type` / `to_macro_type` | The newly selected type |
| `from_macro_type` | The previous type |
| `operation_mode` | `"create"` when the diagram has no id yet, else `"edit"` |
| `type_requested` / `is_new_macro` | Whether a deep link / byline chip pre-requested the type; whether the diagram is unsaved |
| creation attempt | On creates, the pairing properties above |

---

### `macro_publish_requested` / `macro_publish_blocked`

**Trigger:** `macro_publish_requested` fires on the observed Publish click or DrawIO save message,
before any local validation, via `src/utils/analytics/publishIntent.ts` (callers: `Header.vue` for
the text editors, `ForgeGraphEditor.vue` for Graph, `forge-swagger-editor.ts`,
`forge-asyncapi-editor.ts`, `forge-embed-editor.ts`). `macro_publish_blocked` fires when a local
gate refuses that request instead of reaching the persistence layer. Neither event says anything
about persistence; success is still `macro_create_succeeded` / `macro_save_succeeded`.

| Property | Notes |
|---|---|
| `feature_area` / `surface` | `"macro"` / `"editor"` |
| `macro_type` | Type at the click |
| `operation_mode` | `"create"` / `"edit"` |
| `title_present` | Boolean only; the title text is never sent |
| `publish_block_reason` | `macro_publish_blocked` only. `title_missing` (empty or whitespace title and no AI title available), `writeback_unavailable` (the host page cannot take the macro write-back), `legacy_load_blocked` (see `macro_save_failed` history). `validation_error` is reserved and not emitted yet |
| creation attempt | On creates, the pairing properties above |

---

### `macro_create_succeeded`

**Trigger:** First successful save of a new macro — `diagram.id` was falsy at save time in `Persistence.ts`. Embed instead freezes create/edit from `config.customContentId` at editor open and succeeds only after `view.submit()` confirms its selected reference. It creates no custom content of its own.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type saved |
| `operation_mode` | `"create"` |
| `content_id` / `custom_content_id` | The newly-created custom content ID returned by the server; for Embed, the selected existing custom content ID |
| `attachment_name` | `zenuml-{newId}.png` |

---

### `macro_edit_started`

**Trigger:** Editor opens for an existing macro (`customContentId` is present). Fired in `forgeIndex.ts`, `forge-graph-editor.ts`, `forge-embed-editor.ts`, `forge-swagger-editor.ts`.

**History:** Replaced `macro_edit_opened` on 2026-08-18. Include both names when querying a date range that spans this change.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type of the existing macro |
| `entry_point` | `"macro_toolbar"` (Edit button in viewer) or `"page_editor"` |

---

### `macro_create_cancelled` / `macro_edit_cancelled`

**Trigger:** The editor iframe closed without a successful save. Fired from
`src/utils/analytics/editorCloseOutcome.ts`, which every editor entry (sequence / mermaid /
plantuml / markdown, graph, openapi, asyncapi, embed) registers on mount. The trigger is
`view.onClose` — the Atlassian modal X, which is the only close control the Forge editors expose —
plus the explicit discard dialog where one still exists. `markEditorSaved()` is called by the
persistence layer at the moment a save is known to have succeeded, so a close that follows a save
never fires it. At most one event per iframe.

| Property | Notes |
|---|---|
| `macro_type` | Diagram type in the editor at close time |
| `operation_mode` | `"create"` / `"edit"` — picks the event name |
| `close_source` | `host_close` (modal X), `discard_dialog`, `exit_button` |
| `had_changes` | Content differed from what was loaded; omitted when unknown |
| `editor_open_duration_ms` | Mount → close |
| mutation summary | On text-editor edits, the same `had_global_replace` / delta buckets as `macro_save_succeeded` |
| creation attempt | On `macro_create_cancelled`, the pairing properties above |

**History:** Until 2026-09-11 `macro_edit_cancelled` fired only when a user confirmed **Discard** in
the text editors' close-without-saving dialog. That dialog is reached only from an exit button the
header no longer renders, so the event recorded 0 occurrences in the 12 weeks to 2026-09-11 while
the customer edit funnel (`macro_edit_started` → `macro_save_succeeded`, 1-hour window) lost ~17%
of sessions. `macro_create_cancelled` did not exist before this date. Sent with the `sendBeacon`
transport because the host destroys the iframe right after `view.onClose`.

---

### `macro_save_succeeded`

**Trigger:** Successful save of an existing macro (`diagram.id` was truthy at save time). Fired in `Persistence.ts`, `forge-embed-editor.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type saved |
| `operation_mode` | `"edit"` |
| `content_id` / `custom_content_id` | Custom content ID of the saved record (may differ from the pre-save value on cross-page copy / orphan repair) |
| `attachment_name` | `zenuml-{savedId}.png` |
| `journey_id` / `session_id` | Text-editor journey and same-tab session identifiers |
| `global_replace_count` | Number of accepted user transactions covering at least 95% of the editable old document |
| `post_replace_local_edit_count` | User-local transactions after the first global replacement |
| `net_delta_from_open_bucket` | Final content delta from editor open: `none \| tiny \| small \| medium \| large` |
| `delta_from_last_replace_bucket` | Final content delta from the last global replacement; absent when no replacement occurred |
| `last_copy_id` / `last_copy_source` / `last_copy_job` | Most recent successful-copy marker actually observed by a global replacement |

---

### `macro_save_failed`

**Trigger:** `saveToPlatform` (`src/model/ContentProvider/Persistence.ts`) could not persist the
custom content: the Confluence create/update call threw, or it returned without a usable id. Fired
for creates and edits from every editor that saves through `saveToPlatform` (text DSL editors,
Graph, OpenAPI, AsyncAPI). Failures after the custom content was stored (snapshot, D1 telemetry,
`view.submit`) are not labelled as save failures.

Embed stores only a reference through `view.submit`, so its failure boundary differs: an invalid
or inaccessible selection, or a rejected submit, emits this event without a success event.
Create/edit is frozen from the editor's initial `config.customContentId`, including copied macros.

| Property | Notes |
|---|---|
| `feature_area` / `surface` | `"macro"` / `"editor"` |
| `macro_type` | Type being saved |
| `operation_mode` | `"create"` (no `diagram.id` at save time; Embed: no initial configured reference) / `"edit"` |
| `failure_stage` | `"persistence"`; Embed uses `"validation"` or `"writeback"` |
| `failure_reason` | Persistence: `http_error` (Confluence answered 4xx/5xx), `request_failed` (no HTTP status: network, bridge, thrown error), `invalid_saved_content_id` (the save returned without a usable id). Embed validation: `invalid_selected_content_id`, `target_not_fetchable`; writeback: `view_submit_failed` |
| `http_status` | Present with `http_error` only; validated 400–599 |
| `error_code` | Present only for a known machine code: `NOT_FOUND`, `FORBIDDEN`, `UNAUTHORIZED`, `MISSING_CONTENT_PARENT`, `INVALID_ARGUMENT`. Server error text is never sent |
| mutation summary | On text-editor edits, the same `journey_id` / `had_global_replace` / delta buckets as `macro_save_succeeded` |
| creation attempt | On creates, the pairing properties above |

**History:** Until 2026-09-12 (PR #683) the event fired only from the text-editor save handler in
`forgeIndex.ts`, only for edits, with `failure_reason` drawn from `legacy_load_blocked`,
`invalid_saved_content_id`, `http_<status>`, the JavaScript error class, or `unknown_error`. A
query spanning that date must map `http_<status>` to `failure_reason = http_error` plus
`http_status`, and read the legacy-load refusal from `macro_publish_blocked`
(`publish_block_reason = legacy_load_blocked`), where it is reported now.

### `editor_global_replace_observed`

**Trigger:** Every accepted CodeMirror transaction that has `Transaction.userEvent` and whose
changed ranges cover at least 95% of the **old editable document**. Sequence and Mermaid use the
whole document; PlantUML excludes the protected `@startuml` / `@enduml` lines. Creates are excluded.
Programmatic store, AI Repair, and Agent Link document syncs have no user-event annotation and do
not fire this event.

| Property | Notes |
|---|---|
| `journey_id` / `session_id` | Joins the operation to the editor lifecycle |
| `replace_index` | 1-based sequence; every qualifying transaction fires, with no debounce or dedupe |
| `replace_scope` | `full` at 100% coverage; `near_full` at 95–<100% |
| `replaced_coverage_ratio` | Union of changed old-document ranges intersected with the editable range, divided by editable old length |
| `editable_chars_before` / `inserted_chars` | Size-only operation context |
| `input_method` | `paste \| typing \| delete \| drop \| undo \| redo \| unknown` |
| `content_delta_ratio` / `content_delta_bucket` | Text difference, separate from operation coverage; character diff up to 50k combined chars, line-level degradation above it |
| `copy_id` / `copy_source` / `copy_job` / `ms_since_copy` | Present only when a successful same-tab copy marker for the same custom content is ≤60 minutes old |

This event proves an accepted replacement operation, not that AI generated the text and not that it
was saved. The strict outcome is a later `macro_save_succeeded` with the same `journey_id`.
Telemetry contains only IDs, lengths, ratios, buckets, and enums—never DSL, snippets, or hashes.

---

### `macro_export_requested` / `macro_export_succeeded` / `macro_export_failed`

**Trigger:** Backend events fired by the attachment/export service when a PNG export is requested. The frontend references these event names in comments (`Attachment.ts:569`, `forge-upload-attachment.ts:13`) but the events are emitted server-side, not by the client tracker.

### `attachment_upload_async_succeeded` / `_failed` / `_skipped`

**Trigger:** Terminal outcome of the **save-time (async) PNG backup write**, emitted server-side by `functions/forge-upload-attachment.ts` from inside `waitUntil` — after the editor iframe (and with it the browser tracker) is gone. Registered for #392.

The frontend's `attachment_upload_queued` is the denominator: every queued upload should produce exactly one of these three. Before them, the async path — ~34% of all upload attempts as of Jul 2026 — reported no outcome at all, so `attachment_upload_failed` measured only the synchronous path.

**Which of the three fires** mirrors the sync path's split, and hinges on `content_status` (read from the page GET the upload already performs):

| Outcome | Condition |
|---|---|
| `_succeeded` | write landed |
| `_skipped` (`page_not_published`) | 404 on the upload leg **and** the page is not `current` — benign, the async twin of `attachment_upload_skipped`; v1 has no published content to attach to yet and the view-time backfill is the net |
| `_failed` (`app_no_access`) | 404 **and** the page IS `current` — the app cannot see the page at all (#211) |
| `_failed` (`http_<status>`) | everything else, including a 404 with unknown page status (never assume benign without evidence) and any 401/403, which stays a failure because the caller is the page editor at save time |

| Property | Notes |
|---|---|
| `failure_stage` | non-success only: `read_check` \| `upload` \| `properties_put` \| `handler_error` |
| `http_status` | non-success only: status from the stage that failed |
| `failure_reason` | non-success only: the Confluence `message`, extracted from the error envelope (the raw envelope is ~180 chars and would consume the whole 200-char cap) |
| `content_status` | non-success only: `current` \| `draft` \| … \| `unknown` — the skip-vs-failure discriminator |
| `attachment_name` | `zenuml-{customContentId}.{png,json}` |
| `page_id`, `cloud_id`, `client_domain` | tenant/page attribution (`client_domain` resolved from D1 when available) |
| `content_type` | `image/png` (backup) or `application/json` (diagram-source snapshot) |
| `surface` | always `backend` |

**Sampling:** unsampled. Volume tracks saves, not views.

## Get Started and Lite space templates

Get Started uses `feature_area: "confluence"`, `surface: "get_started"`.

| Event | Trigger and properties |
|---|---|
| `get_started_viewed` | Actual component mount |
| `get_started_action_clicked` | Explicit control click; `action`: `create_examples_page`, `open_examples_page`, `view_documentation`, `watch_videos`, `join_community`, or `report_issue` |
| `get_started_examples_result` | One observed resolver result or local timeout per request; `examples_result`: `created`, `already_exists`, `in_progress`, `enrolled`, `failed`, or `timeout`; `duration_ms`, and a closed `failure_reason` category on failure |

Only `created` and `already_exists` with a usable page ID show an examples-page link. `enrolled`,
`in_progress`, and `timeout` do not prove creation. A late response after timeout does not emit a
second outcome. Selected space keys, returned page IDs, raw resolver errors, and example content
are not added as event properties; standard tracker context still applies.

Lite templates use `feature_area: "confluence"`, `surface: "page_banner"`, `macro_type: "sequence"`,
`ui_component: "template_offer"`, and the cached `macro_count` that admitted the banner.

| Event | Trigger and properties |
|---|---|
| `template_offer_shown` | Actual banner mount |
| `template_offer_clicked` | Explicit Create template click |
| `template_created` | Confluence template API confirmed creation; `template_id` is the fixed kind `sequence-space-template`, not the returned Confluence ID |
| `template_create_failed` | Creation failed; `failure_reason`: `forbidden`, `bad_request`, `network`, `unexpected`, or `context_unavailable` |
| `template_offer_dismissed` | Explicit Not now click; suppresses the local offer for 30 days |

The offer uses an existing cached 50–84 count and space-admin verdict, below paywall and CSAT
priority. It performs no inventory query for eligibility or enrichment. Template creation is not
macro creation: a page made from the native template must later produce `macro_create_succeeded`
through its own editor save. The template contains no existing custom-content reference or UUID.

## Architecture Tokens (Phase 1)

These viewer events use `feature_area: "architecture_tokens"`, `surface: "viewer" | "fullscreen"`,
and the rendered diagram's `macro_type: "sequence" | "mermaid"`. Before the #582 fix, the footer
hardcoded `mermaid`, so historical events cannot establish the actual rendered type.

### `related_diagrams_lookup_succeeded`

**Trigger:** Route returned after render.

| Property | Notes |
|---|---|
| `lookup_outcome` | `indexed` when the current diagram has index rows; `index_miss` when the endpoint returns its intentional empty fail-open response. Historical events before deployment have this property unset. |
| `participant_count` | Participants declared in the rendered diagram |
| `participants_with_related` | Participants with at least one accessible related page |
| `related_pages_total` | Total accessible related pages across participants |
| `index_age_days` | Whole days since the index was built |
| `duration_ms` | Lookup duration in milliseconds |

### `related_diagrams_lookup_failed`

**Trigger:** Route error, timeout, or `error_kind` in the response body.

| Property | Notes |
|---|---|
| `error_kind` | Stable failure kind |
| `duration_ms` | Lookup duration in milliseconds |

### `related_token_indicators_shown`

**Trigger:** Once per rendered view when at least one cross-diagram token indicator is displayed.

| Property | Notes |
|---|---|
| `participant_count` | Participants declared in the rendered diagram |
| `participants_with_related` | Participants with at least one accessible related page |
| `related_pages_total` | Total accessible related pages across participants |
| `index_age_days` | Whole days since the index was built |

### `related_diagram_popover_opened`

**Trigger:** Click on a lifeline's count pill.

| Property | Notes |
|---|---|
| `related_count` | Accessible related pages for the selected participant |
| `label_variant_count` | Distinct raw labels among those related pages |

### `related_diagram_link_clicked`

**Trigger:** A related page link opened.

| Property | Notes |
|---|---|
| `related_count` | Accessible related pages for the selected participant |
| `same_space` | Whether the related page is in the same space as the viewer's page |
| `same_page` | Whether the related diagram is on the viewer's current page |

No label text, page id, or tenant vocabulary is included in these events. Lookup events are not
emitted when the feature flag is off, and `related_token_indicators_shown` is not emitted for zero results.

---

## AI title generation

Renamed 2026-09-08 from `ai_generation_*`; pre-release data carries the old names.

### `ai_title_generation_requested`

**Trigger:** AI title generation call dispatched (user clicked the spark icon, or auto-title triggered on init). Fired in `useAutoTitle.ts` for Sequence/Mermaid/PlantUML, Graph and OpenAPI editors.

| Property | Notes |
|---|---|
| `feature_area` | `"ai"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type (`sequence`, `mermaid`, `plantuml`, `graph`, or `openapi`) |
| `generation_source` | `"init"` (auto on editor open), `"user"` (manual click), `"regenerate"` (user clicked a second time after auto-generate) |
| `prompt_length` | Character count of the diagram DSL sent to the AI |

---

### `ai_title_generation_succeeded`

**Trigger:** AI title API returned a non-empty title. Fired in `useAutoTitle.ts` after successful response parse.

Same properties as `ai_title_generation_requested`.

---

### `ai_title_generation_failed`

**Trigger:** AI title API returned a non-OK response or threw. Fired in `useAutoTitle.ts`.

| Property | Notes |
|---|---|
| (all from `ai_title_generation_requested`) | |
| `failure_reason` | Raw error text from the API response or the caught exception message |

---

### `ai_title_dismissed`

**Trigger:** User clicked the dismiss (×) button on the animated AI title suggestion. Fired in `useAutoTitle.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"ai"` |
| `surface` | `"editor"` |

---

### `ai_title_accepted`

**Trigger:** User saved the diagram while the AI-generated title was still displayed (auto-name animation was done and the title was not manually edited). Fired by `useAutoTitle.ts::notifyAiTitleSaved` from the Sequence, Graph and OpenAPI save paths.

| Property | Notes |
|---|---|
| `feature_area` | `"ai"` |
| `surface` | `"editor"` |
| `accepted_title` | The AI-generated title string that was accepted |
| `content_id` | Custom content ID at the time of save |

---

### `ai_title_modified`

**Trigger:** User manually edited the title field after the AI-generated title was displayed (typewriter animation done). Fired on the first keystroke that changes the title. Fired in `useAutoTitle.ts::markManualEdit`.

| Property | Notes |
|---|---|
| `feature_area` | `"ai"` |
| `surface` | `"editor"` |

---

## Upgrade / paywall

All upgrade events are routed through `trackUpgradeEvent` in `src/utils/upgradeTracking.ts`, which sets `feature_area: "upgrade"` and `surface: "modal"` as defaults (individual call sites may override `surface`).

### `paywall_triggered`

**Trigger:** A paywall gate fires and the macro is mounted under `PaywallGate`. Fired in `mountPaywallGate.ts` for both fullscreen-viewer and page-editor surfaces.

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"modal"` (default) |
| `ui_component` | `"modal"` (fullscreen viewer) or `"viewer_notice"` (page editor) |
| `action_type` | `"fullscreen_viewer"`, `"page_editor"`, or `"page_editor_create"` |
| `macro_count` | Current macro count for the space (from `getUpgradeContext()`) |
| `space_key` | Space key |
| `client_domain` | Subdomain prefix |

---

### `paywall_blocked_create`

**Trigger:** Page-editor paywall fires specifically because the space has hit the create limit (`!customContentId && shouldBlockActions`). Fired alongside `paywall_triggered` in `mountPaywallGate.ts`.

Same properties as `paywall_triggered` with `action_type: "page_editor_create"`.

---

### `upgrade_modal_shown`

**Trigger:** The upgrade/paywall modal becomes visible (`v-if` transition). Fired in `useUpgradeTracking.ts` on the `visible` watcher.

| Property | Notes |
|---|---|
| `trigger_source` | `"header_badge"` (legacy compat field kept for saved Mixpanel queries) |
| `action_type` | `"page_editor"`, `"page_editor_create"`, or `"fullscreen_viewer"` |
| `macro_count` | Current space macro count |

---

### `upgrade_modal_dismissed`

**Trigger:** User closes the upgrade modal without taking any action. Fired in `useUpgradeTracking.ts::handleClose`.

| Property | Notes |
|---|---|
| `action_type` | Surface that triggered the modal |
| `time_spent` | Seconds the modal was open (integer) |
| `macro_count` | Current space macro count |

---

### `paywall_continue_used`

**Trigger:** User clicks "Continue editing" in the paywall modal, decrementing the grace-window counter. Fired in `UpgradePrompt.vue`.

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"modal"` |
| `remaining_attempts` | How many continue-editing clicks remain after this one |
| `macro_count` | Current space macro count |

---

### `paywall_attempts_exhausted`

**Trigger:** The grace-window counter reaches 0 — user has used all "Continue editing" attempts and is now locked out of the editor. Fired alongside `paywall_continue_used` in `UpgradePrompt.vue`.

Same properties as `paywall_continue_used` with `remaining_attempts: 0`.

---

### `paywall_banner_shown`

**Trigger:** The paywall warning banner (served from the `confluence:pageBanner` iframe) is committed to displaying. Fired in `PaywallWarningBanner.vue` on mount.

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"page_banner"` |
| `ui_component` | `"banner"` |
| `macro_count` | Current space macro count |
| `space_key` | Current space |

---

### `paywall_banner_dismissed`

**Trigger:** User clicks Dismiss on the paywall warning banner. Fired in `PaywallWarningBanner.vue`.

Same properties as `paywall_banner_shown`. The snooze window that starts on dismiss is kept in local storage by `src/utils/paywall/warningBanner.ts` and is not sent as an event property.

---

### `space_admin_active`

**Trigger:** The page-banner space-admin probe (`maybeProbeSpaceAdmin` in `spaceAdminProbe.ts`) determines the current user is a space admin. Fires at most once every 30 days per `domain:space`, only on Lite, only from the `confluence:pageBanner` module.

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"page_banner"` |
| `is_space_admin` | Always `true` (event is only emitted for admins) |
| `space_admin_count` | Total number of space admins in the space |

---

### `advocacy_message_copied`

**Trigger:** User clicks "Copy" on the pre-drafted advocacy message in the paywall modal or the warning banner. Fired in `useUpgradeTracking.ts` (modal) and `PaywallWarningBanner.vue` (banner).

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"modal"` or `"page_banner"` |
| `ui_component` | `"modal"` or `"banner"` |
| `action_type` | Which paywall surface opened the modal |
| `time_to_decision` | Seconds from modal shown to copy click |
| `macro_count` | Current space macro count |

---

### `advocacy_draft_preview_clicked`

**Trigger:** User expands or collapses the collapsible draft-message preview in the paywall modal. Fired in `useUpgradeTracking.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"modal"` |
| `ui_component` | `"modal"` |
| `expanded` | `true` when expanding, `false` when collapsing |
| `action_type` | Which paywall surface opened the modal |
| `time_to_decision` | Seconds from modal shown to toggle |

---

### `extension_request_clicked`

**Trigger:** User clicks the "Request extension" button in the paywall modal or warning banner. Fired in `useUpgradeTracking.ts` (modal) and `PaywallWarningBanner.vue` (banner).

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"modal"` or `"page_banner"` |
| `ui_component` | `"modal"` or `"banner"` |
| `copied_request_details` | Whether the user also copied the request details at the same time |
| `request_url` | The admin request URL that was opened |
| `action_type` | Which paywall surface opened the modal |
| `time_to_decision` | Seconds from modal shown to click |

---

## Tenant activity (D1 only)

### `page_updated`

Fired by `functions/forge-user-behavior.ts` from the `avi:confluence:updated:page` product-event trigger (mapped in `functions/service/forgeUserBehavior.ts`) and stored in D1 `AnalyticsEventFact`. **Not** forwarded to Mixpanel. This is a tenant-level activity signal, not a macro-view signal. See [reference.md](reference.md) for the distinction. The `avi:confluence:viewed:page` subscription (`page_viewed`) was removed from `manifest.yml` on 2026-06-06; rows with that name predate the removal.

---

## Feedback (CSAT)

### `csat_displayed`

**Trigger:** The CSAT banner is committed to displaying — after both the "fresh trigger" local gate and the "already suppressed" Confluence account check pass. This is the impression denominator for response rates. Fired in `CsatBanner.vue` on mount.

| Property | Notes |
|---|---|
| `feature_area` | `"feedback"` |
| `surface` | `"editor"` (the banner is hosted in the `confluence:pageBanner` iframe) |

---

### `csat_submitted`

**Trigger:** User clicks "Send" in the CSAT banner (either after selecting a score, or with a comment only). Fired in `CsatBanner.vue::submit`.

| Property | Notes |
|---|---|
| `feature_area` | `"feedback"` |
| `surface` | `"editor"` |
| `feedback_score` | 1–5 face rating (undefined if the user submitted a comment without selecting a face) |
| `feedback_text` | Optional free-text comment |

---

### `csat_dismissed`

**Trigger:** User clicks "Dismiss" in the CSAT banner. Fired in `CsatBanner.vue::dismiss`.

| Property | Notes |
|---|---|
| `feature_area` | `"feedback"` |
| `surface` | `"editor"` |
| `feedback_score` | Set if the user selected a face before dismissing; undefined if they dismissed outright |

---

### `feedback_link_clicked`

Backend-declared event. Not currently emitted by client code.

---

## Error / system

### `viewer_load_failed`

**Trigger:** The Vuex `error` store slot becomes truthy while the macro is in viewer/display mode (not editor mode — editor-context errors are excluded to avoid noise from syntax-validation failures). Fired by the `$store.state.error` watcher in `GenericViewer.vue`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` |
| `macro_type` | Diagram type that failed to render |
| `failure_reason` | Error message string |

---

### `load_failed_retry_clicked`

**Trigger:** User clicks "Try again" on the load-failed recovery panel. Fired in `GenericViewer.vue::retry`, before the reload it triggers.

**Transport:** `sendBeacon`, via `trackAnalyticsEventBeforeUnload`. The retry is a `location.reload()`, which aborts an in-flight XHR — production recorded 1 `load_failed_retry_resolved` and **0** of this event on 2026-08-23 with the default transport. The reload also waits for the send, because the enrichment step is itself async.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` |
| `macro_type` | Diagram type that failed to load |
| `content_id` | Custom content ID the viewer could not load |
| `retry_attempt` | 1 for the first retry of this macro in this browser tab, 2 for the next, … |

---

### `load_failed_retry_resolved`

**Trigger:** The viewer reaches a terminal state on the page load that a "Try again" click started. Fired in `GenericViewer.vue`'s `viewerLoadState` watcher, once per retry.

`retry()` is a bare `location.reload()`, so the click and its result sit in two different page lifetimes. A `sessionStorage` marker (`utils/loadFailedRetry.ts`, keyed on the macro's `localId`, 10-minute TTL) carries the attempt across the reload; the marker stops owing an outcome once reported, so an iframe remount without a retry emits nothing.

Without this pair, `load_failed_shown` counts impressions only. Measured 2026-08-18..22: 391 external impressions across 128 macros, with the transient-vs-permanent split unresolvable from telemetry.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` |
| `macro_type` | Diagram type |
| `content_id` | Custom content ID |
| `retry_attempt` | Attempt number the resolution belongs to |
| `retry_outcome` | `"recovered"` = the diagram rendered; `"failed_again"` = the terminal panel came back |

---

### `fullscreen_opened`

**Trigger:** User clicks the Fullscreen button in the viewer toolbar. Fired in `GenericViewer.vue::fullscreen`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` |
| `macro_type` | Diagram type |
| `entry_point` | `"page_view"` |

---

### `editor_load_empty_active_field`

**Trigger:** Wipe-precursor telemetry. The editor opened with a `customContentId` but the active code field for the diagram type was empty or absent in the loaded doc. Indicates a partially-corrupted or partially-migrated macro that a save could silently wipe. Fires only in editor mode to avoid viewer page-view volume. Fired in `forgeIndex.ts` and `forge-swagger-editor.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | The diagram type whose active field was empty |
| `content_id` | The `customContentId` of the suspect macro |

---

### `graph_editor_init_empty`

**Trigger:** The DrawIO graph editor opened but its XML content was empty (no `<mxCell>` nodes). Signals a diagram whose stored data may be blank. Fired in `ForgeGraphEditor.vue`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | `"graph"` |
| `content_id` | Custom content ID of the empty diagram |

---

### `swagger_editor_config_empty_with_modal`

**Trigger:** The OpenAPI editor opened in dashboard-Edit mode — `extension.config` carries no `customContentId` but `extension.modal.customContentId` supplies one (`isDashboardEdit`). Fired in `forge-swagger-editor.ts::initializeMacro`.

**Semantics changed 2026-07-05 (PR #298, dual-format dashboard):** originally added 2026-05-23 (ZEN-1170) as a safety-net regression detector when the `extension.modal.customContentId` fallback was removed — any firing meant a bug, and the Mixpanel board "OpenAPI Modal Fallback Regression Monitor" (11218509) watched for it staying at 0. The dual-format dashboard deliberately reintroduced that path (dashboard Edit opens this editor as a standalone modal carrying the id), so the event now measures the **intended** dashboard-Edit route. Non-zero volume is feature usage, not a regression.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | `"openapi"` |
| `content_id` | Custom content ID passed via `extension.modal.customContentId` |

---

### `close_guard_rejected`

**Trigger:** `view.onClose()` (the Forge bridge close hook registered in `setupCloseGuard`) threw or returned a rejected Promise — indicating the current Forge bridge version doesn't support `view.onClose` or that the registration itself failed. Fired in `closeGuard.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"system"` |
| `surface` | `"editor"` |
