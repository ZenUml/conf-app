# Analytics events: Local AI agent ↔ ZenUML Confluence diagrams

Status: draft (research). Plans Mixpanel events for the **recommended path** only:
**Phase 1 = Interpretation 2a (paste-in DSL push-bridge)**, then **Phase 2 = Interpretation 1 (local stdio MCP CRUD)**. See `ARCHITECTURE.md` §Recommendation. Bi-directional sync (Interpretation 3) is deferred to v2+, so its events are listed as **deferred** (not added to the catalog).

This satisfies the conf-app hard rule *"Plan Mixpanel events before implementing any feature"* (`CLAUDE.md`): for each event below — **name · trigger · key properties · journey** — and the catalog/types draft is in the matching `git diff` (no call sites wired).

## House-style conventions reused

- snake_case names, grouped by feature area, lifecycle suffix `requested` / `succeeded` / `failed` / `dismissed` (mirrors `ai_generation_*`, `content_sync_*`, `ai_repair_*` in `catalog.ts`).
- Every event carries the required `feature_area` + `surface` (`AnalyticsProperties`, `types.ts`). New events use **`feature_area: "ai"`** (agent/DSL generation) or **`feature_area: "content"`** (Confluence custom-content writes), reusing the existing enums — no new `FeatureArea` value.
- A new `local_agent` surface is added (the agent/MCP runs outside the Forge iframe, so none of the existing `Surface` values — all in-iframe UI — fit). New `EntryPoint` value `local_agent` for the same reason.
- Generation/write outcomes reuse existing props (`macro_type`, `operation_mode`, `result`, `failure_reason`, `prompt_length`, `custom_content_id`, `page_id`, `content_id`). New, agent-specific props are added in `types.ts` and grouped under a `// --- local-agent diagram integration (proposed) ---` comment.

### Important measurement caveat (from PRD §Risks "D1 mirror divergence")

Phase-2 direct writes (2b/Interpretation 1) **bypass conf-app's Forge save path entirely** — they go straight to Confluence v2 custom-content with the user's own Atlassian credential. So:

- These events are emitted by the **local MCP server / agent shim**, NOT by the in-iframe Vue app. They must be sent to the **same Mixpanel project `3373228`** via the server-side `/track` HTTP path (not the in-iframe `trackAnalyticsEvent`), so they land in one funnel with `macro_create_succeeded` etc.
- `client_domain` / `user_account_id` / `product_type` auto-enrichment does **not** happen for these (no Forge context). The MCP must set `client_domain` (site host minus `.atlassian.net`) and `entry_point: "local_agent"` explicitly. `product_type` is unknown from a local process → leave unset.
- Phase-1 (2a paste-in) has **no agent-side write**: the only in-app event is the existing `macro_create_succeeded` that already fires when the human pastes + saves. The new Phase-1 events (`agent_dsl_generated`, `agent_dsl_exported`) fire **agent-side** and tell us a paste-in was *prepared*; the join to the in-app save is best-effort (see `paste_token` below).

---

## Phase 1 — Interpretation 2a (paste-in DSL push-bridge) — Journey B

No Atlassian auth, no Confluence write surface; the human is the transport. We can only instrument the **agent side** (generation + export) and rely on the **existing** `macro_create_succeeded` for the in-app landing.

### `agent_dsl_generation_requested`
- **Trigger:** the local agent is asked to produce a diagram for Confluence and begins generating DSL (Journey B step 1 — "Generate a sequence diagram of the checkout flow and prep it for Confluence").
- **Key properties:** `feature_area: "ai"`, `surface: "local_agent"`, `entry_point: "local_agent"`, `macro_type` (sequence/mermaid/plantuml — the DSL-native types, PRD §Non-goals), `prompt_length`, `agent_client` (claude_code / cursor / other), `agent_session_id`.
- **Journey:** B, step 1.

### `agent_dsl_generated`
- **Trigger:** the agent has produced a syntactically-usable DSL + `diagramType` and (optionally) a render preview succeeded (Journey B step 2 — DSL written, preview rendered via the render-only MCP).
- **Key properties:** `feature_area: "ai"`, `surface: "local_agent"`, `macro_type`, `dsl_length`, `preview_rendered` (bool — was the render-only MCP preview shown), `render_preview_source` (`zenuml_screenshot_mcp` / `mermaid_to_image_mcp` / `none`), `agent_client`, `agent_session_id`. Failure of generation/preview → `result: "failed"` + `failure_reason`.
- **Journey:** B, step 2.

### `agent_dsl_export_requested`
- **Trigger:** the agent writes the DSL out for the human to carry — to a file (`docs/checkout.zenuml`) and/or clipboard (Journey B step 2 tail).
- **Key properties:** `feature_area: "ai"`, `surface: "local_agent"`, `macro_type`, `export_target` (`file` / `clipboard` / `both`), `paste_token` (an opaque short id also embedded as a leading DSL comment so a later in-app save can be correlated), `agent_client`, `agent_session_id`.
- **Journey:** B, step 2→3 hand-off (this is the last agent-side signal before the human pastes).

### Existing event reused for the landing (no new event)
- **`macro_create_succeeded`** already fires when the human pastes the DSL into the Forge editor and Saves (Journey B step 4 — `CustomContentStorageProvider.save()` create path). To attribute it to a paste-in we add an **optional** `paste_token` property: if the pasted DSL still carries the leading `paste_token` comment, the editor reads it and stamps it on `macro_create_succeeded`. Best-effort join only — most users will strip the comment; absence ≠ "not agent-originated".

*(No `*_failed` agent event for the in-app save: the save failure path is already covered by the existing `macro_save_failed`.)*

---

## Phase 2 — Interpretation 1 (local stdio MCP CRUD) — Journey A

The agent does full CRUD against Confluence v2 custom-content with the **user's own** token (emitted agent-side; see caveat above). One lifecycle per MCP tool. `operation_mode` distinguishes create vs edit where the same event covers both write paths.

### `agent_diagram_list_requested`
- **Trigger:** agent calls the MCP `list_diagrams(pageId)` tool (Journey A step 3 — `GET /wiki/api/v2/custom-content`).
- **Key properties:** `feature_area: "content"`, `surface: "local_agent"`, `entry_point: "local_agent"`, `page_id`, `result` (`succeeded`/`failed`), `match_count` (how many diagram records returned), `failure_reason` (e.g. `auth_401`, `not_found`, `rate_limited`), `agent_client`, `agent_session_id`.
- **Journey:** A, step 3.

### `agent_diagram_read`
- **Trigger:** agent calls `read_diagram(id)` and the parsed `body.value` DSL is returned into agent context (Journey A step 4).
- **Key properties:** `feature_area: "content"`, `surface: "local_agent"`, `custom_content_id`, `macro_type`, `dsl_length`, `result`, `failure_reason`, `agent_client`, `agent_session_id`.
- **Journey:** A, step 4.

### `agent_diagram_write_requested`
- **Trigger:** agent invokes `create_diagram(...)` (Journey A — create leg / Journey B-2b) **or** `update_diagram(id, dsl)` (Journey A step 6) — i.e. a write to Confluence is about to be attempted. `operation_mode` = `create` | `edit`.
- **Key properties:** `feature_area: "content"`, `surface: "local_agent"`, `entry_point: "local_agent"`, `operation_mode`, `macro_type`, `page_id` (create) / `custom_content_id` (update), `dsl_length`, `preview_rendered`, `agent_client`, `agent_session_id`.
- **Journey:** A, step 6 (and 2b direct create).

### `agent_diagram_write_succeeded`
- **Trigger:** the v2 custom-content `POST`/`PUT` returns 2xx and the new `custom_content_id` + `version.number` are known (Journey A step 6 success; the macro will render unchanged on reload, step 7).
- **Key properties:** `feature_area: "content"`, `surface: "local_agent"`, `operation_mode`, `macro_type`, `custom_content_id`, `page_id`, `content_version` (the returned `version.number`), `body_shape_matched` (bool — did the emitted `body.value` pass the pinned-schema self-check from `ARCHITECTURE.md` §Riskiest-assumption spike), `agent_client`, `agent_session_id`.
- **Journey:** A, steps 6→7. *(This is the agent-side analogue of `macro_create_succeeded`/`macro_save_succeeded`; it will NOT be double-counted because those fire only on the in-app save path, which a direct write bypasses — PRD §Risks "D1 mirror divergence".)*

### `agent_diagram_write_failed`
- **Trigger:** the write attempt fails — auth rejected (no `write:custom-content`), rate-limited, content-shape rejected by Confluence, or network error (Journey A step 6 failure).
- **Key properties:** `feature_area: "content"`, `surface: "local_agent"`, `operation_mode`, `macro_type`, `custom_content_id?`, `page_id?`, `failure_reason` (`auth_401` / `auth_403_scope` / `rate_limited` / `shape_rejected` / `network` / `conflict_409`), `error_code`, `agent_client`, `agent_session_id`.
- **Journey:** A, step 6 (failure). Maps the PRD §Risks credential-custody, rate-limit, and content-shape-drift risks to observable failures.

### `agent_render_preview_requested`
- **Trigger:** agent calls the reused render-only MCP (`zenuml-renderer-screenshot` / `mermaid-to-image`) to show the rendered image before/after a write (Journey A step 5; also Journey B step 2). Shared between both phases.
- **Key properties:** `feature_area: "ai"`, `surface: "local_agent"`, `macro_type`, `render_preview_source` (`zenuml_screenshot_mcp` / `mermaid_to_image_mcp`), `result`, `failure_reason`, `duration_ms`, `agent_client`, `agent_session_id`.
- **Journey:** A step 5 / B step 2.

---

## Deferred — Interpretation 3 (bi-directional sync), Journey C — NOT added to catalog

Listed for completeness; **not** added to `catalog.ts`/`types.ts` because Interpretation 3 is v2+ (no Forge-native change feed, invented conflict engine — `ARCHITECTURE.md`). Plan when sync is greenlit:

- `agent_sync_link_created` — a repo file is linked to a custom-content id in `.zenuml-sync.json` (Journey C step 1).
- `agent_sync_pull_detected` — poller sees a remote `version.number` newer than last-seen and pulls (Journey C step 4). Props: `custom_content_id`, `local_version`, `remote_version`.
- `agent_sync_conflict_detected` — both sides changed since last-seen version; resolution required (Journey C step 5). Props: `conflict_policy` (`confluence_wins`/`local_wins`/`three_way_merge`/`prompt`), `resolved` (bool). This is the crux-risk signal.
- `agent_sync_push_succeeded` / `agent_sync_push_failed` — the local→Confluence leg (= `agent_diagram_write_*`; may simply reuse those with a `sync_initiated: true` flag rather than new names).

---

## Summary — events added to the catalog this iteration

| Event | Phase | feature_area | Lifecycle role |
|---|---|---|---|
| `agent_dsl_generation_requested` | 1 (2a) | ai | requested |
| `agent_dsl_generated` | 1 (2a) | ai | succeeded |
| `agent_dsl_export_requested` | 1 (2a) | ai | requested (hand-off) |
| `agent_diagram_list_requested` | 2 (1) | content | requested |
| `agent_diagram_read` | 2 (1) | content | succeeded |
| `agent_diagram_write_requested` | 2 (1/2b) | content | requested |
| `agent_diagram_write_succeeded` | 2 (1/2b) | content | succeeded |
| `agent_diagram_write_failed` | 2 (1/2b) | content | failed |
| `agent_render_preview_requested` | 1 & 2 | ai | requested |

Reused unchanged: `macro_create_succeeded` (+ optional `paste_token`), `macro_save_failed`.
New enum values: `Surface` += `local_agent`; `EntryPoint` += `local_agent`.
New `AnalyticsProperties` fields: `agent_client`, `agent_session_id`, `dsl_length`, `export_target`, `paste_token`, `render_preview_source`, `preview_rendered`, `match_count`, `content_version`, `body_shape_matched`.
