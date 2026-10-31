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
| `content_state` | Body classification at render time (#113), by `classifyContentState()` in `src/utils/analytics/contentState.ts`: `"default"` (body equals the bundled starter for the type), `"authored"` (anything else), `"empty"` (type-specific body field null, undefined or whitespace-only). A `custom_content_id` that was once `authored` and is now `empty` is a high-confidence wipe. **Where `empty` is observable:** every body-carrying type reports it, because the viewers' empty-body branches still send `macro_viewed` (with the verdict, once per mount, and without attempting a render): `sequence`, `openapi`, `asyncapi` on their normal path; `mermaid`, `graph` and `markdown` (empty string) from the empty branch; `plantuml` from its loaded body, including direct fetch, SWR cache and revalidation: the existing example fallback still renders, but runtime-only metadata preserves the original empty verdict. Whitespace-only bodies also report `empty`: Mermaid keeps its existing empty branch; PlantUML and Graph report before their existing validation/parsing, even when that path rejects the body; Markdown renders normally and reads `empty` on that path. The empty-branch event fires only for a document that loaded with an empty body of the viewer's own type (`isLoadedEmptyBody`); a never-loaded shell emits nothing. Absent when the load failed or the diagram never loaded (no verdict, never `empty`). `graph` `default` = a byte match of the empty-canvas seed (lzutf8 bodies are decompressed first); it is best-effort and rarely reached, because the editor saves DrawIO's own re-serialised `payload.xml`, not the seed string, so a blank canvas saved through the editor reads `authored`. `embed` has no body of its own: the referenced document's own type component classifies the referenced body |
| `layout_wait_ms` | Mermaid only. Wall time the viewer waited for a measurable SVG text layout after `mermaid.render()` threw `svg element not in render tree` (collapsed or hidden macro). Absent when no wait happened. Included in `duration_ms`; exclude present values from render-time percentiles (#706) |

---

### `macro_create_started`

**Trigger:** Editor opens for a new macro (no `customContentId` in Forge context). Fired in `forgeIndex.ts`, `forge-graph-editor.ts`, `forge-embed-editor.ts`, `forge-swagger-editor.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type of the new macro |
| `entry_point` | `"page_editor"` (inserted via slash menu / macro browser) |
| `creation_origin` | Surface that started the create: `page_editor` (default), `byline_view`, `byline_editor`, `dashboard`, `homepage` (reserved, no create path today), `unknown` (a carried value was not recognised). Separate from `entry_point`, which stays `page_editor` for every editor-hosted create |
| `creation_flow_id` | UUID generated once per editor iframe and shared by this iframe's start, success and cancel events — the join key for one creation |

---

### `macro_create_succeeded`

**Trigger:** First successful save of a new macro — `diagram.id` was falsy at save time. Fired in `Persistence.ts`, `forge-embed-editor.ts`.

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"editor"` |
| `macro_type` | Diagram type saved |
| `operation_mode` | `"create"` |
| `content_id` / `custom_content_id` | The newly-created custom content ID returned by the server |
| `attachment_name` | `zenuml-{newId}.png` |
| `creation_origin` / `creation_flow_id` | Same values as on `macro_create_started` for this iframe |

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
| `creation_origin` / `creation_flow_id` | `macro_create_cancelled` only: same values as on `macro_create_started` for this iframe |
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

| Property | Notes |
|---|---|
| `feature_area` / `surface` | `"macro"` / `"editor"` |
| `macro_type` | Type being saved |
| `operation_mode` | `"create"` (no `diagram.id` at save time) / `"edit"` |
| `failure_stage` | Always `"persistence"` |
| `failure_reason` | `http_error` (Confluence answered 4xx/5xx), `request_failed` (no HTTP status: network, bridge, thrown error), `invalid_saved_content_id` (the save returned without a usable id) |
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

## Architecture Tokens (Phase 1)

These viewer events use `feature_area: "architecture_tokens"`, `surface: "viewer" | "fullscreen"`,
and `macro_type: "mermaid"`.

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

**Trigger:** The paywall warning banner (served from the `confluence:pageBanner` iframe) is committed to displaying. Fired in `PaywallWarningBanner.vue` on every eligible mount. There is no dismissal or impression-frequency suppression. `show_count` and optional `hours_since_last_shown` remain descriptive analytics properties.

| Property | Notes |
|---|---|
| `feature_area` | `"upgrade"` |
| `surface` | `"page_banner"` |
| `ui_component` | `"banner"` |
| `macro_count` | Current space macro count |
| `space_key` | Current space |

---

### `paywall_banner_dismissed`

**Historical event:** Previously fired when a user dismissed the paywall warning banner, with the same properties as `paywall_banner_shown`. The persistent banner has no dismissal control and no longer emits this event. Legacy `dismissedAt` values do not suppress it.

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

## What's new (page banner)

The release-notes strip in the shared `confluence:pageBanner` host (`src/components/WhatsNew/WhatsNewBanner.vue`). Lowest priority in the host; shown only to browsers that rendered one of our macros on the site in the last 90 days, at most 3 times per release, inside the release's 30-day window (`src/utils/whatsNew/`). Every event carries `feature_area: "whats_new"`, `surface: "page_banner"` and `whats_new_release_id`.

### `whats_new_banner_evaluated`

**Trigger:** The banner component mounts — only on loads the host's synchronous gate admitted, never on ordinary page loads.

| Property | Notes |
|---|---|
| `result` | `"shown"`, `"yielded_unplaced"` (the page carries the unplaced-diagram property, or the read could not rule it out) or `"failed"` |

### `whats_new_banner_shown`

**Trigger:** The strip is committed to displaying. The impression; denominator for expand and dismiss rates.

| Property | Notes |
|---|---|
| `whats_new_show_count` | Which impression of this release this browser is on (1–3) |

### `whats_new_banner_expanded`

**Trigger:** The user clicks "See what's new" and the item list opens inline.

### `whats_new_banner_dismissed`

**Trigger:** The user dismisses the strip. Retires the release for this browser; the next release re-arms it.

| Property | Notes |
|---|---|
| `whats_new_expanded` | Whether the list was opened before dismissing |

### `whats_new_link_clicked`

**Trigger:** The user opens an item's "Learn more" link.

| Property | Notes |
|---|---|
| `whats_new_item_id` | The item's stable id within its release |

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

### `customcontent_orphan_observed`

**Trigger:** A viewer/editor loaded a macro whose `customContentId` did not yield a document. Fired once per macro load by the owning entry (`forgeIndex.ts`, `forge-graph-*`, `forge-embed-viewer.ts`, `openDocument.ts`) via `reportOrphanObserved`.

| Property | Notes |
|---|---|
| `diagram_kind` | `sequence \| graph \| openapi \| embed` |
| `recoverable` | Probe verdict, or `probe_skipped_no_page_id` / `probe_skipped_no_probe_result` when no probe ran |
| `recovery_used` | Whether a recovered sibling was used |
| `direct_fetch_status` | Outcome of the by-id fetch that preceded any probe: `ok \| not_found \| other_error` |
| `direct_fetch_http_status` | HTTP status from the first structured Confluence error (absent for thrown / malformed) |
| `direct_fetch_error_code` | API error code, e.g. `NOT_FOUND`, `FORBIDDEN` (absent for thrown / malformed) |
| `direct_fetch_error_class` | `thrown \| structured \| malformed`; absent when the fetch succeeded or not_found came from an invalid id |

With `recoverable = probe_skipped_no_probe_result` the direct fetch failed for a reason other than a strict 404, so these fields say which one (403 vs 5xx vs thrown vs malformed). Added for #148.

---

### `viewer_render_deferred`

**Trigger:** A Mermaid macro has been waiting more than 10 s for a measurable SVG text layout (`mermaid.render()` threw `svg element not in render tree`: collapsed expand, background tab, `display:none` ancestor). Fired once per wait, by `Mermaid.vue`. The wait itself is unchanged (no forced retry, no blank diagram); this event only makes a hidden macro distinguishable from a silently broken one (#706).

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` or `"editor"` |
| `macro_type` | `"mermaid"` |
| `reason` | `"no_layout"` |
| `waited_ms` | Time waited when the event was emitted (about 10 000) |
| `render_gate`, `visible_at_boot` | Viewport-gate outcome and "on screen at boot" flag, when the gate recorded them; absent otherwise |

The terminal outcome is one of: `macro_viewed` with `layout_wait_ms` (the layout appeared and the render succeeded), `viewer_render_abandoned`, or `viewer_load_failed` with `failure_stage = render_crash` (the post-wait retry failed).

---

### `viewer_render_abandoned`

**Trigger:** The layout wait described above was cancelled before it resolved: the component unmounted, or the diagram was cleared or replaced (#706). Sent with `sendBeacon` (`trackAnalyticsEventBeforeUnload`), since the cancel usually coincides with iframe teardown. Emitted for any cancelled wait, so it can occur without a preceding `viewer_render_deferred` (wait shorter than 10 s).

| Property | Notes |
|---|---|
| `feature_area` | `"macro"` |
| `surface` | `"viewer"` or `"editor"` |
| `macro_type` | `"mermaid"` |
| `reason` | `"no_layout"` |
| `waited_ms` | Total time waited before the cancel |
| `render_gate`, `visible_at_boot` | As on `viewer_render_deferred` |

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

---

Every frontend event carries the `analytics_init_ms` super-property (#707): milliseconds from the iframe’s first retained track call to Mixpanel init completion, including the replay-config wait. It is measured once per iframe with a monotonic clock and reused by later events. It excludes event enrichment and network delivery.

### `analytics_init_degraded`

**Trigger:** The iframe's Mixpanel bootstrap (`_initMixpanel` in `trackAnalyticsEvent.ts`) stopped waiting for the Forge feature-flag download after `SESSION_REPLAY_CONFIG_TIMEOUT_MS` (3000 ms) and initialised Mixpanel with replay off. Fired once per iframe, after `mixpanel.init`, so it actually leaves. Before #707 a hung bridge call kept the init promise pending forever and every event for that iframe was dropped without a log line.

| Property | Notes |
|---|---|
| `feature_area` | `"system"` |
| `surface` | `"iframe_bootstrap"` |
| `module_key` | Forge `moduleKey` of the degraded iframe |
| `reason` | `"session_replay_config_timeout"` |
| `timeout_ms` | The wait that elapsed (3000) |

Replay for that iframe stays off even if the flag answer arrives later; there is no re-init. Every event from that iframe carries `session_replay_source = "timeout"` (distinct from `"off"`, which means the flag or policy said off).
