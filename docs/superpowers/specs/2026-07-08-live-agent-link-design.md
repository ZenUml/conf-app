# Live Agent Link — local AI agent ↔ ZenUML Confluence macro

Status: **draft (design / brainstorming output)** · Date: 2026-07-08 · Owner: pengxiao

Supersedes the transport decision in `research/local-agent-diagram-integration` (which chose a local-stdio MCP writing to Confluence with the *user's own Atlassian token*). This design keeps that research's store-contract findings but inverts the actor model: **the macro does the Confluence I/O; the local agent holds no Atlassian credential.**

---

## 1. Summary

Let a user edit a ZenUML diagram (Sequence / Mermaid / PlantUML for MVP) from their **local AI coding agent** (Claude Code / Cursor), live, without leaving their agent — and let that agent read the surrounding Confluence page for context.

The user clicks **Connect to Agent** on the macro. Confluence goes straight to **Fullscreen**, which hosts the handshake: it shows a short prompt carrying a **session token**, the user pastes it into their agent, the agent (via a hosted **conf-agent MCP**) connects to a **relay**, and the two are paired. From then on the agent's edits flow through the relay to the macro, which **renders them live and persists them via its own Forge bridge**, and the agent can read the page. The macro shows a live indicator; closing Fullscreen keeps the link alive (badge on the small macro) until Disconnect / timeout / tab close.

The load-bearing inversion vs the earlier research: **the macro is the privileged actor.** It already has a Forge bridge with the logged-in user's session, so it can read the page and read/write the bound custom content. The agent never touches Atlassian credentials.

---

## 2. Problem & goal

- Diagrams of record live in Confluence as conf-app macro custom-content; developers increasingly drive work from local coding agents but have no live path to those diagrams.
- A local process has **no Forge bridge, no Forge token, and cannot reach into the sandboxed cross-origin Forge iframe** (established in the prior recon). Direct local→Confluence needs the user's own Atlassian credential (the old model's cost) and gives no live link / no page context "through the macro."
- **Goal:** a live, bidirectional link where the macro is the privileged executor, so the agent needs zero Atlassian credentials, page context comes for free, and edits render live.

---

## 3. Locked decisions

1. **Actor = macro.** All Confluence reads/writes + page-context reads happen in the macro via its Forge bridge. Local agent holds no Atlassian credential.
2. **Interaction surface = agent chat (edits) + macro Fullscreen (live canvas).** No local editor/preview UI is built.
3. **Editing source = agent-only during a session.** Fullscreen is a live view, not hand-editable while linked → no conflict-merge / CRDT.
4. **Capability = read whole page + write the bound diagram only.** No page-body ADF authoring, no creating/editing other macros in MVP.
5. **Bootstrap = hosted remote MCP; the session token is the auth.** Main path: add the connector once + paste a token each Connect. Fallback: a zero-connector native-HTTP bridge for locked-down orgs.
6. **First-time detection = none.** The macro can't see the local machine; it shows the token and waits. Setup UI auto-reveals only after ~20s with no connection ("presence + timeout").
7. **Connect → Fullscreen directly.** The handshake happens in Fullscreen; on connect the rail becomes a live **activity feed** of the agent's edits.
8. **Close Fullscreen ≠ disconnect.** Same iframe stays alive; return to the small macro with a `● live` badge; session ends only on Disconnect / token TTL / idle timeout / tab close.

---

## 4. Architecture & data flow

### 4.1 Topology
```
 Confluence page (Forge iframe = macro)                 User machine
 ┌──────────────────────────────────┐          ┌──────────────────────────┐
 │ ZenUML macro / Fullscreen         │          │ Claude Code / Cursor      │
 │  • Forge bridge (privileged)      │          │   └─ conf-agent MCP (HTTP)│
 │  • .render(dsl) live in iframe    │          └────────────┬──────────────┘
 └───────────────┬───────────────────┘                       │ public internet
     allowlisted egress │ (SSE / long-poll; WSS TBD)          │ (remote MCP + long conn)
                        ▼                                      ▼
     ┌──────────────────── Relay (Cloudflare Worker + Durable Object) ─────────────────┐
     │  AgentLinkSession DO: pairs {token} ↔ {macro conn, agent conn}; forwards msgs   │
     │  Binds {cloudId, pageId, contentId, scope}; ephemeral; not logged               │
     └─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Privileged actor
The macro executes every Confluence operation through `@forge/bridge` in the logged-in user's context: `read_page` (page body/ADF), `read_diagram` / `update_diagram` (custom-content v2). Reproduces conf-app's own store contract (`ApWrapper2` body shape); because the **bound macro already exists on the page, `update` always renders** — we avoid the "create doesn't render / needs ADF macro insertion" trap the prior live-verification hit.

### 4.3 Connect handshake
1. User clicks **Connect to Agent** → Fullscreen opens in `waiting`.
2. Macro → relay (egress): `POST /agent-link/session` → relay creates an `AgentLinkSession` DO, returns a short-lived **token** (≤10 min TTL, single-use). Macro opens its live channel to the relay and waits.
3. Fullscreen shows the paste prompt (token embedded) + a collapsed "set up connector (once)".
4. User pastes into the agent → agent's conf-agent MCP (`https://<relay-host>/agent-link/mcp`) presents the token → relay **pairs** the agent connection with the waiting macro connection, binds `{cloudId, pageId, contentId, scope: read-page + write-this-diagram}`.
5. Macro flips to `connected`; activity feed starts.

### 4.4 Edit round-trip & read
- `update_diagram(dsl)`: agent → relay → macro. Macro (a) `.render(dsl)` in Fullscreen immediately, (b) persists via Forge bridge (v2 `PUT`, `status:"current"` + `version.number`), (c) returns `{ok, version, rendered:true}`; activity feed appends an entry.
- `read_page()`: macro reads page body/ADF via bridge → returns title + text/ADF to the agent.
- `read_diagram()`: returns the bound diagram's DSL + `diagramType`.

### 4.5 Session lifetime
Alive while the iframe is alive. Close Fullscreen → return to the small macro, iframe alive, `● live` badge, session persists. Ends on: Disconnect (either side), token/session TTL, idle timeout (no activity N min), tab close / navigation (macro connection drops → relay tears down the DO).

### 4.6 Alternatives rejected
- **iframe → localhost direct:** impossible (Forge CSP + egress allowlist + mixed content).
- **Local agent with user's Atlassian token (old model):** no live link, no page-context-through-macro, re-introduces credential custody. Kept only as the degraded zero-connector fallback's spiritual cousin — but even the fallback routes through the macro, not a user token.

### 4.7 Transport fallback ladder (macro ↔ relay)
The live link is **not at feasibility risk — only its tier is.** In order of preference:
1. **Streaming from the Custom UI iframe** (SSE `EventSource`, or WSS) direct to the relay on an allowlisted host — true push. *Unverified; this is the §13.1 spike.*
2. **Long-poll via `@forge/bridge` fetch** to the allowlisted relay host — repeated request/response, each held open server-side until a message or ~timeout. Near-live; Custom UI supports plain fetch, so this **always works**.
3. **Through the existing Forge remote** (`invokeRemote` → Forge remote proxy → conf-app's Cloudflare backend, where the relay lives) — reuses conf-app's already-blessed transport; runs on Cloudflare (**no Forge Function GB-seconds**); request/response, so also long-poll-style, bounded by the proxy's request timeout.

**Re-consent avoidance:** tiers 2–3 that reuse conf-app's **existing** backend remote/host add no new `external.fetch` host and no new `remotes` entry → **minor** Forge version, no admin re-consent. Only tier 1 with a *new* egress host trips a major version. The fallback is therefore also the cheaper-to-ship path.

---

## 5. Components

### 5.1 Macro side (Forge Custom UI, Vue)
- `AgentLink/ConnectButton.vue` — the "Connect to Agent" affordance on the macro; opens Fullscreen and starts a session.
- `AgentLink/ConnectPanel.vue` — the Fullscreen rail: `waiting` / `connected` (activity feed) / `timeout` (setup). (Mock: the published `connect-fullscreen-v2` artifact.)
- `AgentLink/LiveBadge.vue` — the `● live` indicator + border treatment on the small macro when linked-but-not-fullscreen.
- `AgentLink/useAgentLinkSession.ts` — composable owning the client state machine (§7), the relay channel, and dispatch of incoming ops to `bridgeOps`.
- `AgentLink/bridgeOps.ts` — the privileged ops (`readPage`, `readDiagram`, `writeDiagram(dsl)`), wrapping the existing `ApWrapper2` / `requestConfluence` / custom-content v2 paths. **Write scope enforced here**: only the bound `contentId`.

### 5.2 Relay (Cloudflare Worker + Durable Object)
- `functions/agent-link/session.ts` — `POST` to mint a session + token; returns token + relay channel URL.
- `functions/agent-link/mcp.ts` — the hosted MCP endpoint the agent connects to (token-authenticated); exposes the tool surface (§6) bound to one session.
- `functions/agent-link/AgentLinkSession.ts` — the Durable Object: holds `{token, macroConn, agentConn, boundContext, expiry, lastActivity}`; forwards messages between the two conns; enforces scope + TTL; tears down on drop.
- `public/_routes.json` — **add `/agent-link/*` to the `include` allowlist** (else Pages serves it as SPA HTML).

### 5.3 conf-agent MCP (evolve `ZenUml/conf-agent-mcp`)
Today it's a local-stdio server holding the user's Atlassian token. This design adds a **remote-HTTP MCP mode** that holds **no** Atlassian token — it authenticates to the relay with the session token and proxies tool calls to the bound macro. The stdio/user-token mode can remain for the headless "no live macro" use cases, but the live-link feature uses the hosted remote MCP.

---

## 6. MCP tool surface (bound to one session)

- `read_page()` → `{ pageId, title, text, adf? }` — the bound page's content for context.
- `read_diagram()` → `{ contentId, diagramType, dsl }` — the bound diagram.
- `update_diagram(dsl: string, summary?: string)` → `{ ok, version, rendered }` — replace the bound diagram's DSL; macro renders + persists. The optional `summary` is the agent's own one-line description of the change (e.g. "added refresh-token step") and drives the activity-feed entry; absent → generic "diagram updated".
- `get_status()` → `{ connected, diagramType, page, expiresInSec }`.

No `create_diagram`, no `list_diagrams`, no writing other content — write scope = the bound diagram only (decision #4).

---

## 7. Relay session state machine

`created` → (macro connected, waiting) → `paired` (agent joined) → `active` (edits flowing) → `closed`.
Also: `created` → `expired` (token TTL, agent never joined); `paired`/`active` → `closed` on Disconnect / idle timeout / either conn drop.
The **macro-side** client mirrors this as the Connect panel states: `waiting` → `connected`; and `waiting` → `timeout` after ~20s with no pairing (UI only — the session may still pair later; timeout just reveals setup).

---

## 8. Security & privacy model

- **Token = auth.** Short-lived (≤10 min), single-use, scoped to `{cloudId, pageId, contentId, read-page + write-this-diagram}`. Minted by the relay; embedded in the client-generated prompt text (nothing is fetched/executed from a remote script → no phone-home / injection surface).
- **Credential custody — the big win, intact.** No Atlassian credential ever leaves the user's Confluence session. The macro's Forge bridge does the privileged calls; the agent and relay never receive Atlassian tokens.
- **Honest privacy caveat — the relay is NOT zero-knowledge.** In the hosted-remote-MCP model the relay is an *endpoint*, so DSL and page content pass through our own backend in cleartext (TLS in transit). Posture: ephemeral (held only for the live session), **not logged**, same trust boundary as the rest of conf-app's backend. True end-to-end encryption (relay sees only ciphertext) would require a local key-holding shim on the agent side — that reintroduces a local component, so it is **deferred to v2** and offered only if a customer requires it. **Accepted 2026-07-08.**
- **Egress / Forge version.** The macro's live channel to the relay needs the relay host in `permissions.external.fetch` (and CSP `connect-src`). Adding a *new* egress host is a **major Forge version (admin re-consent)** — so host the relay on an **already-allowlisted domain** (e.g. `zenapi.zenuml.com`) to keep it a minor upgrade. Verify before building (§10).
- **Paywall.** A live-edit path could bypass the Lite editor-mount gate. Stance for MVP: **the write still goes through the macro's own persistence**, so reuse the existing gate/telemetry there; do not create an ungated side-channel. (Confirm during build.)

---

## 9. Connect UX

Reference mock (published artifact `connect-fullscreen-v2`): Fullscreen = big live diagram canvas (left) + Connect rail (right). Three states — `waiting` (paste prompt + copy + collapsed setup), `connected` (live activity feed of agent edits + "read page for context" + Disconnect), `timeout / first-time` (setup auto-expanded: Add-to-Cursor deeplink, `claude mcp add` command, no-install fallback). Visual system: ZenUML violet `#6C4CF0`, live-green `#16A66B`, amber `#C4761F`; both themes. Small-macro `● live` badge when linked outside Fullscreen.

---

## 10. Analytics events (plan before code — per CLAUDE.md)

Register in `src/utils/analytics/catalog.ts` (`AnalyticsEventName`) + `types.ts` as the first implementation commit.

| Event | Trigger | Key properties |
|---|---|---|
| `agent_link_connect_clicked` | User clicks Connect to Agent | `macro_type`, `surface` |
| `agent_link_session_created` | Macro minted token + opened channel | `macro_type` |
| `agent_link_setup_shown` | ~20s, no pairing → setup revealed (first-time friction) | `macro_type` |
| `agent_link_agent_connected` | Relay paired the two ends | `macro_type`, `time_to_connect_ms` |
| `agent_link_page_read` | `read_page` served | `macro_type` |
| `agent_link_edit_applied` | `update_diagram` rendered + persisted | `macro_type`, `render_ok`, `dsl_len_delta` |
| `agent_link_edit_failed` | render or persist failed | `macro_type`, `reason` |
| `agent_link_disconnected` | Session ended | `macro_type`, `reason` (`user`/`timeout`/`idle`/`tab_close`), `session_duration_ms`, `edits_count` |

Funnel: `connect_clicked → session_created → agent_connected → edit_applied → disconnected`; `setup_shown` measures first-time friction; `edit_failed` is the real failure signal.

---

## 11. Error handling & edge cases

- **Agent never connects** → `waiting` → `timeout` (setup shown); token still valid until TTL; `session_created` without `agent_connected` = drop-off.
- **Persist fails but render succeeded** (bridge/version conflict) → activity feed shows the edit as "shown, not saved"; `update_diagram` returns `{ok:false, reason}`; agent is told; do not silently claim success.
- **Version conflict** (someone edited in-app) → last-write-wins on custom-content version; surface a "diagram changed underneath" notice; agent re-reads before next write.
- **Fullscreen closed mid-edit** → link persists (decision #8); edits keep applying to the small macro; badge stays `live`.
- **Tab close / navigation** → macro conn drops → relay closes session; agent's next tool call returns `session_closed`.
- **Token replay / leak** → single-use + short TTL + scope binding; a leaked token only grants "edit this one diagram for ≤10 min".
- **Wrong diagram type for MVP** (Graph/OpenAPI) → Connect to Agent not offered on those macros in MVP.

---

## 12. MVP scope

**In:** Sequence / Mermaid / PlantUML (DSL-native); single bound diagram per session; read-page + update-bound-diagram; Fullscreen Connect + activity feed + live badge; hosted remote MCP with token auth + "add connector once" main path.

**Out (v2+):** DrawIO / OpenAPI (non-DSL sources); creating/editing other macros or page body; true E2E-encrypted relay (local shim); multi-diagram / multi-agent sessions; the zero-connector native-HTTP fallback may ship as a follow-up if the connector-add friction proves blocking.

---

## 13. Riskiest assumptions — spike before building

1. **(Load-bearing) Forge Custom UI live egress.** Which transport tier (§4.7) do we get — streaming (SSE/WSS) or long-poll? And is the relay reachable via conf-app's existing backend remote (→ no re-consent)? Feasibility is assured by tiers 2–3; the spike only decides latency/tier. Spike a minimal Forge Custom UI page opening SSE/WSS (then long-poll) to a test endpoint on the existing backend host.
2. **Bridge write from Fullscreen renders live** — confirm `update_diagram` via bridge on an existing bound macro re-renders in the same iframe without reload (expected true; the macro already renders `store.state.diagram.code`).
3. **Remote-HTTP MCP add friction** across Claude Code + Cursor (the #69246 failure mode) — validate the "add connector once + paste token" path end to end on both.

---

## 14. Open questions

1. Idle-timeout duration and whether the `live` badge should also count down.
2. ~~Activity feed: semantic diff vs raw DSL delta?~~ **Resolved (2026-07-08):** feed entries come from an optional `summary` the agent supplies on `update_diagram` — accurate, cheap, no DSL differ in the macro; generic "diagram updated" when absent. Macro-computed semantic diff is a v2 nicety.
3. Relay host: reuse `zenapi.zenuml.com` (avoids re-consent) vs a dedicated subdomain — depends on §13.1.
4. Do we ship the zero-connector fallback in MVP or defer? (Depends on §13.3 friction results.)
5. Multi-tenant relay abuse controls (rate limits, per-tenant caps) — needed before GA.
