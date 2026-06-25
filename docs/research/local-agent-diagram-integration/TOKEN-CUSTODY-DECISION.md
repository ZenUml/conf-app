# Decision: Atlassian token-custody model for the local-agent diagram bridge

Status: decision (research). Resolves **PRD Open-question #1** (the "biggest" — `PRD.md:113`). Grounded in `recon.md`, `PRD.md`, `ARCHITECTURE.md` (same directory) and the conf-app `manifest.yml`. No invented conf-app APIs.

This doc resolves the single open question that gates every write-capable interpretation. It does **not** re-litigate the phasing (`ARCHITECTURE.md` already commits Phase-1 = Interpretation 2a paste-in, Phase-2 = Interpretation 1 stdio MCP CRUD); it decides **where the user's Atlassian credential lives** for the Phase-2 write path.

---

## The question, precisely

When a local AI coding agent (Claude Code / Cursor) reads or writes a Confluence diagram, **conf-app's own backend cannot help**: the Cloudflare backend is gated to Forge invocation tokens (RS256 vs Atlassian JWKS, `app.id ∈ ALLOWED_FORGE_APP_IDS`, `functions/utils/authenticate.ts:6-35`) and `/forge-custom-content` additionally requires the `x-forge-oauth-user` header set by the Forge remote proxy (`functions/forge-custom-content.ts:16-19`). A local process can mint **neither** credential. So the read/write must go **direct to the Confluence v2 custom-content REST API using the user's own Atlassian credential** (`ARCHITECTURE.md:7-9`).

That forces five sub-questions, which are the actual decision:

1. **Whose credential?** — The end-user's own Atlassian identity (so writes are attributed to them and obey *their* Confluence space/page permissions). Never the conf-app Forge app's grant: the app already holds `read:custom-content:confluence` + `write:custom-content:confluence` (`manifest.yml:78-79`), but that is the app's grant *inside Forge*, irrelevant and unusable by a local caller (`PRD.md:37`).
2. **What scopes?** — `read:custom-content` (list/read tools, EAG-100) and `write:custom-content` (create/update tools, EAG-101). For an API token / PAT these are implicit (the token inherits the user's full permissions); for OAuth 3LO they are explicit requested scopes (`read:custom-content:confluence`, `write:custom-content:confluence`, matching `manifest.yml:78-79`). A read-only deployment requests only the read scope.
3. **What credential type?** — Atlassian API token / PAT (user-managed, coarse-grained, no registered OAuth app) vs OAuth 3LO access+refresh tokens (requires a registered Atlassian OAuth app + redirect handling, but scope-limited and revocable per-grant).
4. **Where does it live at rest?** — On the user's own machine (local config / OS keychain), or in a hosted relay's datastore.
5. **Who can revoke, and what's the blast radius if it leaks?** — A self-managed token the user revokes in their Atlassian account settings vs a pooled store an operator must rotate; one identity's exposure vs many.

Sub-questions 3/4/5 are where the options diverge. 1 and 2 are fixed by the constraint above.

---

## Options

### Option A — Local stdio MCP, user's own token on-machine *(recommended)*

A local **stdio** MCP server (skeleton: `mcp-zenuml/src/stdio-mcp-server.ts:15-19`) runs on the user's machine and holds **their own** Atlassian credential — API token / PAT, or OAuth 3LO tokens — in local config or the OS keychain. The token is read from disk by the server process and used to call `…/wiki/api/v2/custom-content` directly. **The credential never leaves the user's machine.** No shared server ever sees it.

- Custody: the **user's device**. conf-app/ZenUML holds nothing (`PRD.md:95` non-goal: "conf-app storing or holding the user's Atlassian credential").
- This is exactly the Phase-2 shape `ARCHITECTURE.md:49` already names ("a **local stdio** server holding the user's own token on-machine (never a hosted relay that pools many users' write tokens)").

### Option B — Hosted relay (Cloudflare Worker) with OAuth 3LO, pooling many users' write tokens

Extend the existing HTTP MCP pattern (`diagramly-mcp-serverless`, `recon.md` §d) into a write bridge: users do OAuth 3LO against a registered Atlassian app; the relay stores each user's access+refresh tokens server-side and writes to Confluence on their behalf. Lower client-side friction (no per-machine token setup), single config endpoint, works identically from any client.

- Custody: a **central datastore holding many users' Confluence write tokens** — a high-value breach target. The PRD calls this out as the highest risk twice: `PRD.md:34` ("a custody/security downgrade"), `PRD.md:102` ("a relay that holds many users' Confluence write tokens is a high-value breach target").
- Compounding hazard: the relay skeleton (`diagramly-mcp-serverless`) is **today unauthenticated** — CORS `*`, no token check (`recon.md` §d; `PRD.md:103`). Reusing it as-is would expose Confluence writes to anyone who can reach `/mcp`. A write relay would need a real auth layer built from zero, *and* secure token-at-rest storage, *and* rotation/breach response.

### Option C — Hybrid: local OAuth 3LO, on-machine token storage, no pooling

OAuth 3LO (proper scope-limited, revocable grant; registered Atlassian app) but the resulting access+refresh tokens are stored **on the user's machine** (keychain), and the local stdio server refreshes them locally. No central token store. This is Option A's custody posture with OAuth's scoping/revocation niceties instead of a coarse API token.

- Custody: the **user's device** (same as A). The registered OAuth app + redirect-handling cost is real but one-time engineering; no pooled-token liability.
- This is the natural **maturity step inside Option A**, not a different custody model. The redirect/refresh plumbing is the only added effort over an API token.

---

## Comparison

Legend: lower is better for risk/effort/consent/blast-radius; higher is better for multi-client/UX.

| Dimension | A — stdio, on-machine token | B — hosted relay, pooled OAuth | C — hybrid (local OAuth, on-machine) |
|---|---|---|---|
| **Custody / security risk** | Low — token on user's device only; ZenUML holds nothing | **High** — central store of many users' write tokens; single breach = mass exposure | Low — tokens on user's device; no central store |
| **Admin-consent burden** | None for API token (user self-issues). 3LO variant = standard per-user 3LO consent, no site-admin app install | Registered OAuth app + per-user 3LO consent; some orgs require admin approval of the OAuth app | Registered OAuth app + per-user 3LO consent (same as B's consent, without the pooled store) |
| **Revocation** | User revokes own API token in Atlassian account settings; instant, self-service | Operator must revoke/rotate; user can revoke the grant but must trust the relay actually purges stored tokens | User revokes the 3LO grant in Atlassian; local token becomes useless; self-service |
| **Multi-client (Claude Code / Cursor)** | High — stdio MCP is the native local-agent transport; both support stdio servers; one config block per client | High — single HTTP endpoint, any client; but a network hop + hosted dependency | High — same stdio transport as A |
| **Effort** | **Low** — extend `mcp-zenuml` stdio skeleton; read token from config/keychain; no server infra | High — auth layer (relay is currently open), token-at-rest store, OAuth app, rotation, breach plan, hosting/ops | Med — A's effort + registered OAuth app + redirect/refresh plumbing (no server token store) |
| **UX** | Med — user pastes an API token into local config once (one-time setup) | High — click "Connect", OAuth redirect, done; no token handling by user | Med-High — OAuth click-through, but local; smoother than pasting a token, no relay dependency |
| **Blast radius if compromised** | **One user's** Confluence access (their own machine); attacker needs that machine | **All enrolled users'** Confluence write access at once (the pooled store) | **One user's** Confluence access (their machine); 3LO scope-limited to custom-content |

The decisive row is **blast radius**. Option B concentrates many users' Confluence **write** tokens in one place we'd operate — that is a custody liability we would own indefinitely, on top of building auth + token-storage + rotation that don't exist today (the relay skeleton is unauthenticated, `recon.md` §d). Options A and C keep custody on the user's device: a compromise is one machine, one identity, and revocation is the user's own self-service action. On-machine storage genuinely shifts custody risk **to the user's device** — that is a real tradeoff, not a free lunch — but it is a per-user, user-controllable, user-revocable risk, not a single mass-breach target we hold.

---

## Recommendation

**Adopt Option A (local stdio MCP, user's own token on-machine) as the token-custody model, starting with a user-issued Atlassian API token, and treat Option C (local OAuth 3LO, on-machine storage) as the in-place maturity upgrade. Explicitly reject Option B (hosted relay pooling write tokens).**

Rationale:

1. **Custody stays off our infrastructure.** This honors the PRD non-goal verbatim — "conf-app storing or holding the user's Atlassian credential" (`PRD.md:95`) — and the architecture's stated Phase-2 shape, "a **local stdio** server holding the user's own token on-machine (never a hosted relay that pools many users' write tokens — the PRD's highest risk)" (`ARCHITECTURE.md:49`). We never become the breach target.
2. **Blast radius is one user, revocation is self-service.** A leaked on-machine token exposes exactly that user's Confluence access; they revoke it themselves in Atlassian account settings. No operator rotation, no "did the relay really purge my token" trust gap.
3. **Lowest effort, native transport.** stdio is the native local-agent transport (both Claude Code and Cursor consume stdio MCP servers), and we extend an existing skeleton (`mcp-zenuml`) rather than building an auth layer + secure token store + OAuth app + rotation/breach plan for a relay that is currently wide open (`recon.md` §d).
4. **Start API-token, graduate to 3LO (Option C) when scoping/UX justify it.** API token = zero new infra, fastest to a working write tool; the move to local 3LO is additive (registered OAuth app + redirect/refresh) and does **not** change the custody model — tokens still live on the user's machine. So we are never trapped: Option C is reachable without re-architecting.

**What it unblocks** (Multica EAG issues — these are gated on this decision):
- **EAG-100 — read tools** (`list_diagrams`, `read_diagram`): unblocked. Read tools need only `read:custom-content` under the user's on-machine token; Option A is sufficient and lowest-risk for the read-only first slice.
- **EAG-101 — write tools** (`create_diagram`, `update_diagram`): unblocked. Write tools need `write:custom-content` under the user's on-machine token — Option A's custody model is the prerequisite the PRD said must be decided "before any write tool ships" (`PRD.md:102`).
- **EAG-102 — config** (how the user supplies/stores the credential, per-client MCP config): unblocked and scoped. Config = local config file / OS keychain for the token + site base URL, plus the stdio MCP server block for each client (Claude Code / Cursor). No relay endpoint, no hosted OAuth callback to design for Phase-2.

**What the human must confirm before Phase-2 build starts:**
1. **Accept on-machine custody** — agree the token lives on the user's device (their custody, their revocation) and ZenUML stores nothing. This is the load-bearing acceptance.
2. **API-token-first is acceptable for the first write slice** — i.e. it's OK to ship `create_diagram`/`update_diagram` gated on a user-pasted Atlassian API token (coarse-grained, user's full permissions) before investing in local 3LO scoping. If not, EAG-102 must front-load the OAuth-app registration (Option C) before EAG-101.
3. **Paywall stance for the direct-write path** (PRD Open-question #7, `PRD.md:119`) — a token-authenticated `create_diagram` bypasses the Lite editor-mount paywall gate entirely. Confirm whether that is acceptable (power-user feature) or whether EAG-101 must add an enforcement check. This is independent of custody but is triggered the moment a write tool exists, so it must be answered alongside it.
4. **Content-shape spike is green first** — `ARCHITECTURE.md:51-60`'s byte-compatible `body.value` spike (the riskiest assumption, PRD Open-question #5) should pass before EAG-101 write code is committed; custody is moot if the written content doesn't render.

Item 4 is a precondition the architecture already owns; items 1-3 are the decisions only the human can make.

---

## Decision needed

**Adopt Option A — local stdio MCP, user's Atlassian credential on-machine (API-token-first, with local OAuth 3LO / Option C as the additive upgrade), and do NOT build a hosted relay that pools user write tokens — yes or no?**

Default (if no objection): **yes** — proceed with Option A; this unblocks EAG-100, EAG-101, EAG-102. Reconsider only if the human wants the one-click "Connect" UX of a hosted relay (Option B) badly enough to accept owning a pooled-write-token store and building its auth/storage/rotation from scratch.
