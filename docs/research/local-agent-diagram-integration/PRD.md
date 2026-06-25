# PRD: Local AI coding agents ↔ ZenUML Confluence diagrams

Status: draft (research). Grounded entirely in `recon.md` (same directory). No invented conf-app APIs. Path roots and file:line citations below come from the recon.

## Problem

Users who author code with local AI coding agents (Claude Code, Cursor) keep architecture/sequence/flow knowledge in their codebase, but their team's diagrams of record live in Confluence as conf-app macro custom-content. There is no path today for a local agent to **read, create, or update** those Confluence-stored diagrams. Two hard walls block the obvious route (recon §e):

- All conf-app Confluence I/O happens **inside a sandboxed cross-origin Forge Custom-UI iframe** via `@forge/bridge` (`requestConfluence` / `invokeRemote`), `src/utils/requestUtil.ts:58-73`. A local process has no bridge, no Forge invocation context, and cannot reach into the OOPIF (only Playwright crosses that boundary).
- conf-app's Cloudflare backend is gated to **Forge invocation tokens** (RS256 vs Atlassian JWKS, `app.id ∈ ALLOWED_FORGE_APP_IDS`), `functions/utils/authenticate.ts:6-35`; `/forge-custom-content` additionally requires `x-forge-oauth-user` set by the Forge remote proxy, `functions/forge-custom-content.ts:16-19`. A local agent cannot mint either credential.

Consequence: a local agent that wants to write a Confluence diagram **cannot go through conf-app at all**. It must talk to Confluence directly with the **user's own Atlassian auth** (OAuth 3LO / API token / PAT) against the v2 custom-content REST API, producing content shaped exactly like what conf-app's viewers already read.

The enabling facts (recon §a, §b, §summary): the DSL string + `diagramType` is the single source of truth; render is fully client-side (`@zenuml/core .render(code)`, `src/components/Sequence.vue:83`); the store contract is a known v2 custom-content body shape (`src/model/ApWrapper2.ts:237-278`). If a local agent produces a byte-correct custom-content record, the existing macro renders it unchanged.

## Users

1. **Developer using Claude Code / Cursor** on a codebase, who wants to push a generated diagram into a Confluence page or pull an existing one in to edit it — without leaving the terminal/IDE.
2. **Tech writer / architect** who maintains the canonical Confluence diagrams and wants agent-generated DSL to land in the right macro without copy-paste-through-the-editor.
3. **Team admin** (gatekeeper) who must approve any new Atlassian auth grant and any new egress host; cares about credential custody and audit.
4. **Non-user we must not break:** the existing in-product Forge editor flow — any agent-written content must be indistinguishable from app-written content so the macro keeps rendering/editing normally.

## Interpretations

Three distinct readings of "let users interact with diagrams from local AI coding agents." All three share one unavoidable constraint: **the Confluence write/read step uses the user's own Atlassian credentials, never conf-app's Forge-gated backend.**

### Interpretation 1 — MCP server (agent reads/creates/edits the user's Confluence diagrams)

**What it enables:** The local agent gets MCP tools like `list_diagrams(pageId)`, `read_diagram(customContentId)`, `create_diagram(pageId, diagramType, dsl, title)`, `update_diagram(customContentId, dsl)`. The agent can pull a diagram's DSL into context, modify it, and push it back — full CRUD on diagrams of record.

**How it'd plausibly work (grounded):**
- Tools map to **Confluence v2 custom-content REST** directly, reproducing conf-app's store contract: body = `{type, title, body:{value: JSON.stringify(diagram), representation:"raw"}, pageId|spaceId}` (`src/model/ApWrapper2.ts:237-278`); create-vs-update mirrors `CustomContentStorageProvider.save()` (`CustomContentStorageProvider.ts:34-42`) — has-id-and-not-copy ⇒ update (`saveCustomContentV2`), else create (`createCustomContentV2`).
- Auth is the **user's own Atlassian OAuth/API token**, NOT a Forge token. The MCP server holds (or proxies) that credential and calls `.../wiki/api/v2/custom-content`.
- Transport choice: **local stdio MCP** (pattern: `mcp-zenuml`, `stdio-mcp-server.ts:15-19`) keeps the user credential on the user's machine — preferred for custody. **Hosted HTTP MCP** (pattern: `diagramly-mcp-serverless`, `src/index.ts` JSON-RPC `/mcp`) is lower-friction but would have to receive the user credential, which is a custody/security downgrade.
- Render preview is free: reuse `diagramly-mcp-serverless` `zenuml-renderer-screenshot` / `mermaid-to-image` (recon §d) to show the agent (and user) the rendered image before/after a write.

**Dependency on gating constraints:** Cannot use conf-app's backend (Forge-token-gated, `authenticate.ts:6-35`). **Entirely dependent on obtaining the user's Atlassian credential** with `read:custom-content` / `write:custom-content` scope. The app already *has* these scopes (`manifest.yml permissions.scopes`), but that's the app's grant inside Forge — irrelevant to a local caller, which needs its own user-level grant. This is the heaviest interpretation: it owns the full auth + credential-custody problem.

### Interpretation 2 — DSL push-bridge (agent generates DSL → into a macro/page)

**What it enables:** One-directional, write-only, lighter. The agent generates ZenUML/Mermaid DSL and "drops" it into Confluence — either by creating a new macro custom-content record on a target page, or by emitting an artifact the user pastes/imports once. No read-back, no edit-in-place of existing diagrams.

**How it'd plausibly work (grounded):**
- Minimal version, **no new auth at all**: the agent produces DSL + `diagramType` (it already can — render-only MCPs prove DSL transforms need no Forge context, recon §e "Enables (indirect)"), writes it to a local `.md`/`.mermaid` file or a clipboard payload, and the user pastes it into the existing Forge editor (`store.state.diagram.code`, `Sequence.vue:46`). Zero Confluence-write surface; the human is the bridge.
- Heavier version, **agent writes the macro**: same v2 custom-content POST as Interpretation 1's `create_diagram`, but create-only (no list/read/update). Still needs the user's Atlassian credential, but a narrower scope (`write:custom-content` only) and no read.
- Either way the written DSL is what every downstream surface keys off (`DiagramPortal.vue` switches renderer by `diagramType`, `:32-34`; render is `@zenuml/core .render(code)`), so a correct push renders with no app changes.

**Dependency on gating constraints:** The **paste-in variant has essentially no dependency** — it never touches Confluence APIs or conf-app's backend; it sidesteps every gate by making the human the transport. The **direct-write variant** inherits Interpretation 1's user-credential dependency but at reduced scope. Neither can use conf-app's backend. This is the recommended MVP because the paste-in flavor ships with no auth, no egress, no admin consent.

### Interpretation 3 — Bi-directional sync (agent edits ↔ Confluence diagram stay in sync)

**What it enables:** A diagram's DSL lives in the repo (e.g. a `.zenuml` file) AND in Confluence custom-content, and edits on either side propagate. The agent edits locally; the Confluence macro updates; a Confluence-side edit flows back to the repo file.

**How it'd plausibly work (grounded):**
- Local→Confluence leg = Interpretation 1's `update_diagram` (v2 custom-content update, `saveCustomContentV2`, user credential).
- Confluence→local leg requires **change detection**, which the recon does not give a clean primitive for. Options, all unverified: (a) **poll** the v2 custom-content `version.number` per tracked record and pull when it advances; (b) hook the existing D1 mirror, but the recon says it is **telemetry-only and may be stale / returns 2xx on re-fetch failure** (`forge-custom-content.ts:14-61`) — NOT a reliable change feed; (c) Confluence webhooks/Forge product triggers, but those fire **inside Forge**, not to a local process. So practically the back-leg is **client-side polling of version numbers** by the local agent using the user credential.
- Conflict resolution has **no existing mechanism** — custom-content is last-write-wins on version. Sync must add its own (version-vector / 3-way DSL merge / "Confluence wins" / "local wins"), none of which exists today.

**Dependency on gating constraints:** Most dependent and most speculative. Inherits the user-credential dependency of Interpretation 1 for both legs (no Forge backend, no Forge token). The back-leg has **no clean push channel** (D1 mirror is telemetry-only and unreliable; Forge triggers don't reach local), forcing polling and inventing conflict resolution. This is a v2+ research line, not an MVP.

## Journeys

### Journey A — Interpretation 1 (MCP CRUD)

1. Dev runs `claude` in a repo. They've configured a ZenUML diagrams MCP server (stdio, local) with their Atlassian API token + site URL in local config (the token never leaves the machine).
2. Dev: "Update the auth-flow sequence diagram on our 'Auth' Confluence page to add the refresh-token step."
3. Agent calls `list_diagrams(pageId=<Auth page>)` → MCP does `GET /wiki/api/v2/custom-content?... ` with the user token, returns records; agent picks the one whose title/diagramType matches.
4. Agent calls `read_diagram(id)` → MCP returns the parsed `body.value` JSON; agent extracts the ZenUML DSL (`store.state.diagram.code` shape).
5. Agent edits the DSL, optionally calls the render-preview tool (`zenuml-renderer-screenshot`, recon §d) to confirm it renders, shows the user the image.
6. Agent calls `update_diagram(id, newDsl)` → MCP rebuilds the body `{type,title,body:{value:JSON.stringify(diagram),representation:"raw"},pageId}` (matching `ApWrapper2.ts:237-278`) and `PUT`s the new version with the user token.
7. User reloads the Confluence page; the existing macro (`DiagramPortal.vue` → `Sequence.vue` `.render(code)`) renders the updated DSL unchanged — because the record is byte-compatible with app-written content.

### Journey B — Interpretation 2 (DSL push-bridge, paste-in MVP — no auth)

1. Dev: "Generate a sequence diagram of the checkout flow and prep it for Confluence."
2. Agent generates ZenUML DSL, renders a preview via the render-only MCP (no Forge, no Atlassian auth — recon §e indirect-enable), writes the DSL to `docs/checkout.zenuml` and copies it to clipboard.
3. Dev opens the target Confluence page, inserts a ZenUML macro, opens the editor, pastes the DSL into the code editor (`store.state.diagram.code`).
4. Dev clicks Save/Publish in the existing Forge editor; conf-app's normal `CustomContentStorageProvider.save()` create path runs (`CustomContentStorageProvider.ts:34-42`) — no new code, no new auth, the human carried the DSL across the gate.

   (Heavier variant: steps 3-4 replaced by the agent calling a create-only tool that POSTs custom-content with the user's token — same as Journey A step 6 but create-only.)

### Journey C — Interpretation 3 (bi-directional sync)

1. Repo has `docs/architecture.zenuml` linked to a Confluence custom-content id in a local `.zenuml-sync.json` (stores id + last-seen `version.number`).
2. Dev edits `architecture.zenuml`; on save the agent/MCP pushes via `update_diagram` (Journey A step 6) and records the new returned version number.
3. Meanwhile a teammate edits the same diagram in the Confluence Forge editor → custom-content version advances.
4. The local sync poller (`GET ...custom-content/<id>?... version`) sees a version newer than `.zenuml-sync.json` → pulls the remote DSL.
5. **Conflict:** if the local file also changed since last-seen version, sync must resolve (3-way DSL merge / prompt the user / policy). No existing primitive — this logic is net-new and is the crux risk of this interpretation.

## Non-goals

- **Routing any local-agent traffic through conf-app's Cloudflare backend.** It is Forge-token + `x-forge-oauth-user` gated (`authenticate.ts:6-35`, `forge-custom-content.ts:16-19`); we will not weaken those guards to admit local callers.
- **Reaching into the running Forge iframe** from a local process (impossible across the OOPIF except via Playwright; out of scope for a product feature).
- **Server-side / headless render of ZenUML DSL → SVG** as a shipped dependency. The recon marks "whether `@zenuml/core` exposes a headless DSL→SVG API" UNKNOWN; preview reuses existing render-only MCPs (image), not a new headless renderer.
- **conf-app storing or holding the user's Atlassian credential.** Credential custody is the local MCP's / user's concern; conf-app's backend stays out of the local-write path entirely.
- **Real-time/CRDT collaborative editing** between local and Confluence. Sync (Interpretation 3), if built, is poll-based and eventually-consistent, not live co-editing.
- **Diagram types beyond DSL-native ones for write-back in v1.** Graph (DrawIO) and OpenAPI use their own viewers and non-DSL sources (recon §b); first cut targets Sequence/Mermaid/PlantUml where DSL *is* the content.
- **Bypassing the Lite paywall.** A direct-write path that creates macros outside the editor must not become a paywall-evasion vector; enforcement scope is an open question, not a feature.

## Risks

- **Auth model / credential custody (highest).** A local-write path needs the user's Atlassian credential with `write:custom-content`. Stdio-local keeps it on-machine (good); a hosted HTTP MCP would receive it (bad — a relay that holds many users' Confluence write tokens is a high-value breach target). OAuth 3LO needs a registered app + redirect handling; API-token/PAT is simpler but coarse-grained and user-managed. **Decision required before any write tool ships.**
- **Security of a local relay / hosted bridge.** `diagramly-mcp-serverless` today is **unauthenticated** (CORS `*`, no token check — recon §d). Reusing it as a write bridge would expose Confluence writes to anyone who can reach `/mcp`. Any write surface needs real auth; do not inherit the render-only server's open posture.
- **Confluence API rate limits.** Direct v2 REST under the user's token is subject to Atlassian per-user rate limits (not quantified in recon — open question). Sync polling (Interpretation 3) multiplies request volume per tracked diagram and can trip limits / get the user throttled.
- **Conflict resolution for sync.** No existing primitive (custom-content is version-last-write-wins). Concurrent local + Confluence edits can silently clobber. Interpretation 3 must invent merge/conflict policy or it will lose work.
- **Content-shape drift.** If the agent-written `body.value` JSON diverges from what conf-app expects (`ApWrapper2.ts:237-278` shape, `diagramType`, sanitization), the macro may render wrong or the in-app editor may choke. The store contract must be pinned and version-tested against the live app, not assumed stable.
- **D1 mirror divergence.** Agent-written content bypasses conf-app's save path, so the D1 telemetry mirror (`forge-custom-content.ts:14-61`) won't see those writes unless/until the page is re-opened in-app. Telemetry/analytics (`macro_create_succeeded`, etc.) will undercount agent-originated diagrams — acceptable but must be known.
- **Egress allowlist (minor but real).** If any in-app feature must call a new relay host, it must be added to `manifest.yml permissions.external.fetch` (minor version, no admin re-consent per the manifest comment) — but localhost is unreachable from the iframe at all, so an in-app↔local channel is not viable regardless.
- **Paywall evasion.** A create path outside the Forge editor sidesteps the editor-mount paywall gate (Lite). Could be read as a feature (power users) or a leak; needs an explicit stance.

## Open-questions

1. **(Biggest)** What is the **user-auth model and who holds the credential** — stdio-local MCP with the user's API token on-machine, vs OAuth 3LO via a hosted relay that holds Confluence write tokens? This single choice determines security posture, custody risk, admin-consent burden, and which interpretations are even shippable.
2. Does **`@zenuml/core` expose a headless DSL→SVG API** usable outside the browser (recon UNKNOWN)? Affects whether the agent can render/validate locally or must call a hosted render service.
3. What are the **exact Atlassian per-user rate limits** for v2 custom-content reads/writes, and do they make Interpretation 3's polling viable at team scale?
4. Are any conf-app Cloudflare routes in `_routes.json` (`/track`, `/ai-generate-title`, `/diagramly/*`, `/diagram-likes/*`, `/api/*`) **intentionally unauthenticated** (recon did not audit per-route auth)? If one is, it could be an unintended local-agent entry point — needs an explicit audit before we assume the backend is fully closed.
5. What is the **canonical, version-stable `body.value` JSON schema** a write tool must emit so existing viewers/editors accept it unchanged, and how do we regression-test it against the live app as conf-app evolves?
6. For sync: what **conflict-resolution policy** (Confluence-wins / local-wins / 3-way DSL merge / prompt) is acceptable, and is poll-on-`version.number` the only viable change-detection channel (Forge triggers don't reach local; D1 mirror is telemetry-only)?
7. **Paywall stance:** should a direct-write/create path enforce the Lite limit, and if so, how — given it bypasses the editor-mount gate entirely?
8. Is `mcp-zenuml` (local stdio, Mermaid-only) wired into any shipped client config today (recon UNKNOWN), and is it the right skeleton to extend vs. starting from `diagramly-mcp-serverless`?
