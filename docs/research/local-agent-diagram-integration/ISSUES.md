# Backlog: Local AI agent ↔ ZenUML Confluence diagrams

Status: **DRAFT only** (research). Decomposes the recommended phased architecture into `ready-for-agent`-shaped GitHub issues. **No GitHub issues have been created** — creation is deferred to a human-approved morning run.

Grounded in (same directory): `ARCHITECTURE.md` §Recommendation (Phase 1 = Interpretation 2a paste-in DSL bridge, no auth; Phase 2 = Interpretation 1 local stdio MCP CRUD; Interpretation 3 sync deferred to v2+), `PRD.md`, `EVENTS.md`.

**Sequencing principle:** Phase 1 ships first and is independently valuable (no Atlassian auth, no egress, no admin consent, no credential custody). Issue #1 is the smallest possible walking skeleton (events + enum scaffolding, nothing user-facing). Phase 2 (direct writes under the user's own token) only starts after the store-contract spike (Issue #4) proves the body-shape can be reproduced outside Forge.

**Hard rule honored:** per conf-app `CLAUDE.md` *"Plan Mixpanel events before implementing any feature"*, Issue #1 lands the full event catalog + types scaffolding as the **first commit of the feature branch**, before any behavioral code.

Event names below are verbatim from `EVENTS.md` §Summary. All new events use `surface: "local_agent"` / `entry_point: "local_agent"`, are emitted **agent-side** (server-side `/track`, project `3373228`), and set `client_domain` explicitly (no Forge auto-enrichment).

---

## Issue 1 — Add the local-agent analytics catalog + types scaffolding (walking skeleton)

- **Phase:** 1
- **Suggested labels:** `ready-for-agent`, `area:analytics`, `phase-1`

**Context.** conf-app's hard rule requires analytics events to be defined *before* any feature code. This is the deliberately tiny walking-skeleton issue: it lands the event names, enum values, and property fields so every later issue can wire call sites against a stable catalog. No user-facing behavior; no auth; no network.

**What to build.**
- In `src/utils/analytics/catalog.ts`, add the nine new event names to the `AnalyticsEventName` union: `agent_dsl_generation_requested`, `agent_dsl_generated`, `agent_dsl_export_requested`, `agent_diagram_list_requested`, `agent_diagram_read`, `agent_diagram_write_requested`, `agent_diagram_write_succeeded`, `agent_diagram_write_failed`, `agent_render_preview_requested`.
- In `src/utils/analytics/types.ts`: add `Surface` += `local_agent`; `EntryPoint` += `local_agent`; and the new `AnalyticsProperties` fields under a `// --- local-agent diagram integration (proposed) ---` comment: `agent_client`, `agent_session_id`, `dsl_length`, `export_target`, `paste_token`, `render_preview_source`, `preview_rendered`, `match_count`, `content_version`, `body_shape_matched`.
- Add `paste_token` as an **optional** property usable on the existing `macro_create_succeeded` event (best-effort paste-in attribution; absence ≠ "not agent-originated").
- No call sites wired in this issue — catalog/types only.

**Analytics events it must emit.** None (this issue *defines* them; it emits nothing). It is the prerequisite that makes every later issue's events legal.

**Acceptance criteria** (spot-check format — behavior · observable signal · method):
1. New event names compile in the union · `pnpm test:unit` and `pnpm build:lite` both pass with the nine names present in `catalog.ts` · run the two commands; grep the built bundle / source for each name.
2. New enum + property fields type-check · `Surface`/`EntryPoint` accept `"local_agent"` and `AnalyticsProperties` accepts each new field with no `tsc` regression vs `main` · construct a fixture `AnalyticsProperties` object using every new field in a unit test; compare `tsc` error count to `main` baseline (baseline is red/ungated — only *new* errors fail).
3. `paste_token` is accepted on `macro_create_succeeded` · a unit test stamps `paste_token` onto a `macro_create_succeeded` payload and it type-checks · run that test.

**Dependencies.** None. This is the root of the chain.

---

## Issue 2 — Build the agent-side DSL generation + render-preview path (Phase 1 core)

- **Phase:** 1
- **Suggested labels:** `ready-for-agent`, `area:ai`, `area:mcp`, `phase-1`

**Context.** Interpretation 2a's value with no auth: the agent produces ZenUML/Mermaid/PlantUML DSL + `diagramType` and previews it via the existing render-only MCP (`diagramly-mcp-serverless` `zenuml-renderer-screenshot` / `mermaid-to-image`), proving the DSL renders before a human carries it across the Forge gate. DSL transforms need zero Forge context (recon §e). First cut is DSL-native types only (Sequence/Mermaid/PlantUml) per PRD §Non-goals.

**What to build.**
- An agent-side shim/tool that, on a "prep a diagram for Confluence" request, generates DSL + `diagramType`, then calls the reused render-only MCP for a preview image.
- Emit events server-side to Mixpanel `3373228` via `/track` with `client_domain` set explicitly and `entry_point: "local_agent"` (no Forge enrichment).
- Restrict `macro_type` to `sequence` / `mermaid` / `plantuml`.

**Analytics events it must emit** (from `EVENTS.md` §Phase 1 + shared):
- `agent_dsl_generation_requested` — on receiving the prep request (props: `feature_area:"ai"`, `surface:"local_agent"`, `entry_point:"local_agent"`, `macro_type`, `prompt_length`, `agent_client`, `agent_session_id`).
- `agent_dsl_generated` — when usable DSL + `diagramType` produced; `result:"failed"` + `failure_reason` on generation/preview failure (props add `dsl_length`, `preview_rendered`, `render_preview_source`).
- `agent_render_preview_requested` — when the render-only MCP is invoked (props: `feature_area:"ai"`, `macro_type`, `render_preview_source`, `result`, `failure_reason`, `duration_ms`). Shared with Phase 2.

**Acceptance criteria** (behavior · observable signal · method):
1. Agent generates DSL for a Sequence prompt · a syntactically-valid ZenUML DSL string + `diagramType:"Sequence"` is returned · drive the shim with a fixed prompt; assert the DSL parses (feed to `@zenuml/core` / the render-only MCP without error).
2. Render preview produced for generated DSL · a non-empty image is returned from `zenuml-renderer-screenshot` (or `mermaid-to-image` for Mermaid) · call the preview tool on the generated DSL; assert image bytes > 0.
3. `agent_dsl_generation_requested` fires on request · one event with `surface:"local_agent"`, `entry_point:"local_agent"`, the correct `macro_type` lands in Mixpanel `3373228` · run the shim against `/track`; query Mixpanel (or intercept the `/track` POST) for the event with those props.
4. `agent_dsl_generated` fires on success and carries `dsl_length` + `render_preview_source` · one matching event lands · same method as #3.
5. `agent_render_preview_requested` fires with `duration_ms` and `render_preview_source` · one matching event lands · same method as #3.
6. Generation failure path · `agent_dsl_generated` with `result:"failed"` + a `failure_reason` lands when DSL generation/preview fails · force a failing input; assert the failed event.

**Dependencies.** Issue 1 (events/enums/props must exist).

---

## Issue 3 — Build the DSL export + paste-in hand-off with paste_token correlation (Phase 1 hand-off)

- **Phase:** 1
- **Suggested labels:** `ready-for-agent`, `area:ai`, `area:editor`, `phase-1`

**Context.** This completes Journey B: the agent writes the DSL out (file and/or clipboard) for the human to carry into the existing Forge editor and Save — the human is the transport, no Confluence write surface. A `paste_token` (opaque short id, also embedded as a leading DSL comment) lets a later in-app `macro_create_succeeded` be best-effort attributed to a paste-in.

**What to build.**
- Agent-side export of generated DSL to a file (`docs/<name>.zenuml`) and/or clipboard, with a `paste_token` minted and embedded as a leading DSL comment.
- In-app (`Editor`/save path) read-through: if pasted DSL still carries the leading `paste_token` comment, stamp it onto the existing `macro_create_succeeded` event. Best-effort only — most users strip the comment; absence must not be treated as "not agent-originated".

**Analytics events it must emit** (from `EVENTS.md` §Phase 1):
- `agent_dsl_export_requested` — on export (props: `feature_area:"ai"`, `surface:"local_agent"`, `macro_type`, `export_target` (`file`/`clipboard`/`both`), `paste_token`, `agent_client`, `agent_session_id`).
- Reuse **`macro_create_succeeded`** for the in-app landing — add the optional `paste_token` property when present (no new event).

**Acceptance criteria** (behavior · observable signal · method):
1. Export writes DSL to file with an embedded `paste_token` comment · the file exists and its first line is a `paste_token` comment matching the event's token · run export to `file`; read the file; compare the leading-comment token to the emitted event's `paste_token`.
2. Export to clipboard works · clipboard payload equals the generated DSL (incl. the `paste_token` comment) · run export to `clipboard`; read clipboard; compare.
3. `agent_dsl_export_requested` fires with `export_target` + `paste_token` · one matching event lands in Mixpanel `3373228` · run export; query/intercept `/track`.
4. Paste-in correlation works end-to-end · pasting the exported DSL (token comment intact) into the Forge editor and Saving produces a `macro_create_succeeded` carrying that same `paste_token` · UI spot check: drive the editor via Playwright (Forge iframe → `frameLocator`), paste, Save, observe the network/Mixpanel event with the matching token. **UI assertion — must be confirmed by observing the UI/network, not a unit test.**
5. Token-stripped paste does not error · pasting DSL with the comment removed still Saves and fires `macro_create_succeeded` (without `paste_token`) · same Playwright flow, comment removed; assert save succeeds and the event has no `paste_token`.

**Dependencies.** Issue 1 (events/props), Issue 2 (produces the DSL being exported).

---

## Issue 4 — Spike: prove the v2 custom-content body.value can be reproduced byte-for-byte outside Forge (Phase 2 gate)

- **Phase:** 2
- **Suggested labels:** `ready-for-agent`, `area:spike`, `area:content`, `phase-2`

**Context.** This is `ARCHITECTURE.md` §Riskiest-assumption, the single load-bearing hypothesis under **every** write-capable option: a local tool can emit a custom-content `body.value` JSON whose shape exactly matches what conf-app writes via `ApWrapper2.createCustomContentV2` (`ApWrapper2.ts:237-278`), so the existing macro renders it unchanged. Pure local spike — **no prod/staging deploy, no live-tenant write.** It gates all Phase-2 write work (Issues 5–7).

**What to build.**
- A node/unit harness that (a) reads `src/model/ApWrapper2.ts:237-278` + `CustomContentStorageProvider.ts:34-42` and constructs the exact `body.value` JSON a `create_diagram` tool would emit for a known Sequence DSL; (b) invokes the app's own `createCustomContentV2` serialization path directly with the same fixture and diffs the two body strings byte-for-byte (modulo server-assigned ids/versions); (c) confirms the extracted DSL renders (via `@zenuml/core` headless if available — open-question #2 — else the `zenuml-renderer-screenshot` MCP).
- Output a pinned, version-stable `body.value` schema doc/fixture the write tools (Issues 5–7) must conform to, plus a regression test that re-checks it against the app code.

**Analytics events it must emit.** None — this is a local spike, no tracking. It *produces* the `body_shape_matched` self-check that Issue 6's `agent_diagram_write_succeeded` later reports.

**Acceptance criteria** (behavior · observable signal · method):
1. Hand-built body matches app-generated body · the two `body.value` strings are byte-identical (modulo ids/versions) · run the harness; assert string equality in the unit test.
2. Extracted DSL renders · the Sequence DSL from the body produces a non-empty render · feed it to `@zenuml/core` headless or the render-only MCP; assert success.
3. Pinned schema + regression test exist · a committed fixture/schema and a test that fails if the app's `createCustomContentV2` shape drifts · run the regression test against current app code; it passes; mutate the fixture to confirm it can fail.

**Dependencies.** None on the other issues (can run in parallel with Phase 1), but it is a **hard gate for Issues 5, 6, 7** — no Phase-2 write tool ships until this passes.

---

## Issue 5 — Build the local stdio MCP server skeleton + read tools (list/read) under the user's own token

- **Phase:** 2
- **Suggested labels:** `ready-for-agent`, `area:mcp`, `area:content`, `phase-2`

**Context.** Interpretation 1's read half. A **local stdio** MCP server (skeleton pattern `mcp-zenuml/src/stdio-mcp-server.ts:15-19`) holding the **user's own** Atlassian credential on-machine (never a hosted relay that pools many users' tokens — PRD §Risks highest). It calls Confluence v2 custom-content REST directly with `read:custom-content` scope. Read-only first so the auth/custody model is exercised before any write.

**What to build.**
- A local stdio MCP server reading the user's Atlassian token + site URL from local config (token never leaves the machine).
- `list_diagrams(pageId)` → `GET /wiki/api/v2/custom-content?...`; `read_diagram(id)` → returns the parsed `body.value` DSL (`store.state.diagram.code` shape).
- Server-side `/track` emission to Mixpanel `3373228` with `client_domain` set from the site host, `entry_point:"local_agent"`.

**Analytics events it must emit** (from `EVENTS.md` §Phase 2):
- `agent_diagram_list_requested` — on `list_diagrams` (props: `feature_area:"content"`, `surface:"local_agent"`, `entry_point:"local_agent"`, `page_id`, `result`, `match_count`, `failure_reason` (e.g. `auth_401`/`not_found`/`rate_limited`), `agent_client`, `agent_session_id`).
- `agent_diagram_read` — on `read_diagram` (props add `custom_content_id`, `macro_type`, `dsl_length`, `result`, `failure_reason`).

**Acceptance criteria** (behavior · observable signal · method):
1. stdio MCP server starts and registers `list_diagrams` + `read_diagram` · MCP `tools/list` returns both tools · start the server over stdio; send `tools/list`; assert both names present.
2. `list_diagrams` returns matching records · against a test page with known diagrams, returns the expected count · call with a fixture `pageId` (test site / user token); assert returned records match the seeded set.
3. `read_diagram` returns the DSL · the parsed `body.value` DSL for a known record equals the seeded DSL · call with that record's id; compare.
4. `agent_diagram_list_requested` fires with `match_count` + `result` · one matching event in Mixpanel `3373228` · run `list_diagrams`; query/intercept `/track`.
5. `agent_diagram_read` fires with `dsl_length` + `macro_type` · one matching event lands · same method.
6. Auth failure is observable · a 401 (bad/missing token) yields `agent_diagram_list_requested` with `result:"failed"` + `failure_reason:"auth_401"` · run with an invalid token; assert the failed event.
7. Token stays on-machine · the user token is never sent to any conf-app/Cloudflare/relay host — only to `*.atlassian.net` and the Mixpanel `/track` host (token not in the payload) · inspect outbound requests (network capture / code review of egress targets).

**Dependencies.** Issue 1 (events/props). Independent of the write gate (read-only), but lands the auth/custody foundation Issue 6 builds on.

---

## Issue 6 — Add the MCP write tools (create_diagram / update_diagram) with pinned body-shape

- **Phase:** 2
- **Suggested labels:** `ready-for-agent`, `area:mcp`, `area:content`, `phase-2`

**Context.** Interpretation 1's write half — the full-CRUD payoff. `create_diagram(pageId, diagramType, dsl, title)` and `update_diagram(id, dsl)` POST/PUT the v2 custom-content body reproduced per Issue 4's pinned schema, under the user's own token (`write:custom-content`). create-vs-update mirrors `CustomContentStorageProvider.save()` (`CustomContentStorageProvider.ts:34-42`). On reload the existing macro renders it unchanged (Journey A step 7).

**What to build.**
- `create_diagram` and `update_diagram` tools on the Issue-5 stdio server, building the body strictly to Issue 4's pinned `body.value` schema and self-checking shape conformance (`body_shape_matched`).
- Handle write outcomes: 2xx → success with returned `custom_content_id` + `version.number`; map failures to `auth_401`/`auth_403_scope`/`rate_limited`/`shape_rejected`/`network`/`conflict_409`.

**Analytics events it must emit** (from `EVENTS.md` §Phase 2):
- `agent_diagram_write_requested` — on invoke of create or update; `operation_mode` = `create`|`edit` (props: `feature_area:"content"`, `surface:"local_agent"`, `entry_point:"local_agent"`, `macro_type`, `page_id`(create)/`custom_content_id`(update), `dsl_length`, `preview_rendered`).
- `agent_diagram_write_succeeded` — on 2xx (props add `custom_content_id`, `page_id`, `content_version`, `body_shape_matched`). Not double-counted vs `macro_create_succeeded` (direct write bypasses the in-app save path — PRD §Risks D1-mirror divergence).
- `agent_diagram_write_failed` — on failure (props add `failure_reason`, `error_code`, optional `custom_content_id`/`page_id`).

**Acceptance criteria** (behavior · observable signal · method):
1. `create_diagram` creates a renderable record · a new custom-content id is returned and the macro renders the DSL unchanged on page reload · UI spot check: create against a test page, reload in Confluence via Playwright (Forge iframe), confirm the rendered diagram matches the DSL. **UI assertion — confirm by observing the rendered macro, not a unit test.**
2. `update_diagram` advances the version and re-renders · the returned `version.number` increments and the reloaded macro shows the new DSL · update a known record; assert version increment + UI re-render via Playwright.
3. Emitted body conforms to the pinned schema · `body_shape_matched` is `true` for a valid write · assert the self-check result in the write path; cross-check against Issue 4's regression test.
4. `agent_diagram_write_requested` fires with correct `operation_mode` · `create` for create, `edit` for update, lands in Mixpanel `3373228` · run each tool; query/intercept `/track`.
5. `agent_diagram_write_succeeded` fires with `content_version` + `body_shape_matched` · one matching event per successful write · same method.
6. `agent_diagram_write_failed` maps failures · a scope-less token yields `failure_reason:"auth_403_scope"`; a conflicting version yields `conflict_409` · force each condition; assert the failed event's `failure_reason`/`error_code`.
7. No double-count · a direct create produces `agent_diagram_write_succeeded` but **no** `macro_create_succeeded` · run a create; confirm only the agent-side success event appears (no in-app save event).

**Dependencies.** Issue 4 (pinned body-shape — hard gate), Issue 5 (stdio server + auth/custody foundation), Issue 1 (events/props).

---

## Issue 7 — Wire render-preview into the MCP write flow + ship example client config

- **Phase:** 2
- **Suggested labels:** `ready-for-agent`, `area:mcp`, `area:docs`, `phase-2`

**Context.** Completes Journey A's UX: before/after a write, the agent shows the user a rendered preview (reusing the render-only MCP — Journey A step 5), and ships a documented example stdio client config so a developer can register the server with their own token. This is the smallest issue that makes Phase 2 usable end-to-end without re-deriving setup each time.

**What to build.**
- Wire `agent_render_preview_requested` into the write flow (pre-write confirmation image), reusing the Issue-2 render-preview integration.
- Ship an example MCP client config (stdio) + setup doc: how to supply the user's Atlassian token + site URL locally, scopes required (`read:`/`write:custom-content`), and the on-machine-only custody note (no hosted relay).

**Analytics events it must emit** (from `EVENTS.md`, shared across phases):
- `agent_render_preview_requested` — on the pre/post-write preview (props: `feature_area:"ai"`, `surface:"local_agent"`, `macro_type`, `render_preview_source`, `result`, `failure_reason`, `duration_ms`). Same event as Issue 2; here fired from the write flow (Journey A step 5).

**Acceptance criteria** (behavior · observable signal · method):
1. Preview shown before a write · a render image is produced from the to-be-written DSL prior to the POST/PUT · run create/update with preview enabled; assert an image precedes the write call (ordering in logs / network).
2. `agent_render_preview_requested` fires from the write flow with `duration_ms` · one matching event in Mixpanel `3373228` · run a write-with-preview; query/intercept `/track`.
3. Example config registers the server · following the shipped doc, a fresh stdio client lists `list_diagrams`/`read_diagram`/`create_diagram`/`update_diagram` · register per the doc; send `tools/list`; assert all four tools.
4. Custody note is correct · the doc states the token stays on-machine and is never sent to a hosted relay/conf-app backend · review the doc against Issue 5's verified egress targets.

**Dependencies.** Issue 2 (render-preview integration), Issue 5 + Issue 6 (the MCP server + tools being configured).

---

## Dependency graph (summary)

```
Issue 1 (events scaffolding — walking skeleton)
 ├─ Issue 2 (agent DSL gen + preview)  ──┐
 │    └─ Issue 3 (export + paste-in)     │   [Phase 1 ships here — independently valuable, no auth]
 │                                        │
 ├─ Issue 4 (body-shape spike — Phase 2 GATE, can run parallel to Phase 1)
 │                                        │
 ├─ Issue 5 (stdio MCP + read tools) ─────┤
 │                                        │
 │  Issue 6 (write tools) ← needs Issue 4 (gate) + Issue 5
 │                                        │
 └─ Issue 7 (write-flow preview + client config) ← needs Issue 2 + Issue 5 + Issue 6
```

**Order to execute:** 1 → 2 → 3 (Phase 1 complete, shippable) ; 4 (gate) ‖ 5 → 6 → 7 (Phase 2).
