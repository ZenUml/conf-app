# Architecture: Local AI agent ↔ ZenUML Confluence diagrams

Status: draft (research). Grounded in `recon.md` and `PRD.md` (same directory). No invented conf-app APIs.

This document scores the three PRD interpretations, describes how each works against the recon's hard facts, recommends one (phased) path, and names the single riskiest assumption to spike tonight.

## The one fact every option must obey

A local agent (Claude Code / Cursor) has **no Forge bridge, no Forge invocation token, and no way into the sandboxed cross-origin Forge iframe** (recon §e; `functions/utils/authenticate.ts:6-35`, `functions/forge-custom-content.ts:16-19`, `src/utils/requestUtil.ts:58-73`). Therefore conf-app's Cloudflare backend is unusable for any local-agent write. Every write/read of a Confluence diagram must go **direct to Confluence v2 custom-content REST using the user's own Atlassian credential**. The content it writes must be byte-compatible with conf-app's store contract — `body = {type, title, body:{value: JSON.stringify(diagram), representation:"raw"}, pageId|spaceId}` (`src/model/ApWrapper2.ts:237-278`) — so the existing macro renders it unchanged (`DiagramPortal.vue:32-34` → `Sequence.vue:83` `@zenuml/core .render(code)`).

## Comparison

Scoring legend: **Effort** and **Risk** — lower is better (Low good). **Forge-fit**, **Reuse**, **UX** — higher is better (High good). All five use Low/Med/High consistently.

| Interpretation | Effort | Forge-fit | Reuse | UX | Risk |
|---|---|---|---|---|---|
| **1 — MCP server CRUD** (list/read/create/update) | High | High | Med | High | Med |
| **2a — DSL push-bridge, paste-in** (human is the transport, no auth) | Low | High | High | Med | Low |
| **2b — DSL push-bridge, direct create-only write** (user token, create only) | Med | High | Med | High | Med |
| **3 — Bi-directional sync** (poll + conflict resolution) | High | Med | Low | High | High |

Notes on the scores (all grounded in recon/PRD):

- **Forge-fit** is High for 1/2 because they never touch conf-app's Forge-gated backend (the PRD's hard non-goal) — they sit entirely outside Forge and write to Confluence directly. Sync (3) is Med because its back-leg has *no clean Forge-native channel*: Forge product triggers fire inside Forge and don't reach a local process, and the D1 mirror is telemetry-only/may-be-stale (`forge-custom-content.ts:14-61`), forcing client-side `version.number` polling (PRD §Interpretation 3).
- **Reuse**: 2a reuses the most — the existing render-only MCPs (`diagramly-mcp-serverless` `zenuml-renderer-screenshot`/`mermaid-to-image`, `mcp-zenuml` `renderMermaid`) prove DSL transforms need zero Forge context (recon §c/§d/§e), and the human carries the DSL across the gate, so there is no new write surface at all. 1/2b reuse the store-contract shape but must build a new authenticated write path. 3 reuses least (net-new poller + conflict engine).
- **Risk**: 2a is Low — no auth, no egress, no admin consent, no credential custody (PRD §Interpretation 2). 1/2b are Med — they own the user-credential-custody problem (PRD §Risks "highest"). 3 is High — inherits 1's credential risk *plus* invents conflict resolution against last-write-wins custom-content versioning, with no existing primitive (PRD §Interpretation 3, §Risks).
- **UX**: 2a is Med because the human still pastes into the editor (one manual hop); 1/2b/3 are High because the agent writes/reads end-to-end without leaving the terminal.

## How each option works (grounded)

### Interpretation 1 — MCP server CRUD
- **Components:** a local **stdio** MCP server (skeleton pattern: `mcp-zenuml/src/stdio-mcp-server.ts:15-19`) exposing `list_diagrams(pageId)`, `read_diagram(id)`, `create_diagram(pageId, diagramType, dsl, title)`, `update_diagram(id, dsl)`. Optional render-preview tool reused from `diagramly-mcp-serverless` (recon §d).
- **Auth source:** the **user's own Atlassian credential** (API token / PAT, or OAuth 3LO), held on the user's machine by the stdio server. **Not** a Forge token — the recon proves a local caller cannot mint one (`authenticate.ts:6-35`).
- **Store path:** tools call Confluence `…/wiki/api/v2/custom-content` directly, reproducing `ApWrapper2.createCustomContentV2`/`saveCustomContentV2` body shape (`ApWrapper2.ts:237-278`); create-vs-update mirrors `CustomContentStorageProvider.save()` (`CustomContentStorageProvider.ts:34-42`).
- **Render path:** preview is the existing render-only MCP image tool; the *authoritative* render still happens client-side in the Forge macro when the user reloads the page (`Sequence.vue:83`). No new renderer.

### Interpretation 2 — DSL push-bridge
- **2a (paste-in, recommended MVP):** the agent generates DSL + `diagramType`, previews via the render-only MCP (no Forge, no Atlassian auth — recon §e "Enables (indirect)"), writes it to a file / clipboard. The **human** opens the Forge editor, pastes into `store.state.diagram.code` (`Sequence.vue:46`), and Saves — conf-app's normal `CustomContentStorageProvider.save()` create path runs (`CustomContentStorageProvider.ts:34-42`). **Auth source: none** (the human is the transport). **Store path: the existing in-app save**, unchanged.
- **2b (direct create-only write):** same as Interpretation 1 but create-only — one `create_diagram` tool POSTing the v2 custom-content body with the user's token. Narrower scope (`write:custom-content` only, no read). Auth/store path = Interpretation 1's create leg.

### Interpretation 3 — Bi-directional sync
- **Components:** a local file (`.zenuml`) ↔ Confluence custom-content id mapping (`.zenuml-sync.json` with last-seen `version.number`), an `update_diagram` push leg (= Interpretation 1), a **polling** pull leg, and a **net-new conflict-resolution engine**.
- **Auth source:** user credential, both legs (no Forge backend, no Forge token).
- **Store path (push):** `saveCustomContentV2` shape, user token. **Change-detection (pull):** client-side polling of `GET …custom-content/<id>?…version` — the recon gives no clean push channel (Forge triggers don't reach local; D1 mirror is telemetry-only/stale, `forge-custom-content.ts:14-61`).
- **Render path:** same as 1. Conflict resolution (version-vector / 3-way DSL merge / policy) **does not exist today** and is the crux risk.

## Recommendation

**Phase 1 = Interpretation 2a (paste-in DSL push-bridge); Phase 2 = Interpretation 1 (full stdio MCP CRUD).** Ship 2a first because it is Low-effort, Low-risk, High-reuse, and High-Forge-fit: it requires no Atlassian auth, no egress allowlist change, no admin consent, and no credential custody — the agent only produces/previews DSL (which the render-only MCPs already prove needs zero Forge context) and the human carries it across the gate into the existing, unchanged save path. Then extend to Interpretation 1's full CRUD as a **local stdio** server holding the user's own token on-machine (never a hosted relay that pools many users' write tokens — the PRD's highest risk), reusing the store-contract shape and render-preview tools; defer Interpretation 3 to v2+ because its back-leg has no Forge-native change feed and forces an invented conflict-resolution engine on last-write-wins versioning.

## Riskiest assumption

**Hypothesis (single, load-bearing, locally testable):** A local MCP `create_diagram` tool can emit a custom-content `body.value` JSON whose shape **exactly** matches what conf-app writes via `ApWrapper2.createCustomContentV2` (`ApWrapper2.ts:237-278`) — same `type`, `title`, `diagramType`, sanitization, and inner JSON structure — such that the existing Forge macro viewer/editor would accept and render it unchanged. If the agent-written shape drifts from conf-app's expected schema, the macro renders wrong or the in-app editor chokes (PRD §Risks "Content-shape drift", §Open-questions #5). This assumption underpins **every** write-capable option (1, 2b, 3); 2a is the only option that *doesn't* depend on it, which is exactly why it is the safe Phase-1 floor.

**Tonight's local spike (no prod/staging deploy, no live-tenant write):**
1. In a node script, read conf-app's `src/model/ApWrapper2.ts:237-278` + `CustomContentStorageProvider.ts:34-42` and construct the exact `body.value` JSON a `create_diagram` tool would emit for a known Sequence DSL.
2. Diff it byte-for-byte against a body produced by the app's own `createCustomContentV2` code path — invoke that function (or its serialization helper) directly in a unit harness with a fixture diagram, rather than POSTing anywhere. The two strings must be identical (modulo server-assigned ids/versions).
3. Feed the same `body.value` into `@zenuml/core` render in a headless node check (open-question #2: confirm whether `@zenuml/core` exposes a usable headless DSL→SVG/render entry; if not, fall back to the existing `diagramly-mcp-serverless` `zenuml-renderer-screenshot` tool to confirm the extracted DSL renders).

Pass condition: the hand-built body string is byte-identical to the app-generated one, and the extracted DSL renders. That proves the store contract can be reproduced outside Forge before any auth/egress/deploy work is committed.
