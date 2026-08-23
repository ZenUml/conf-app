# 0003 — Agent Link mints its own short-lived session token

Date: 2026-08-16
Status: accepted
Related: [docs/superpowers/specs/2026-07-08-live-agent-link-design.md](../superpowers/specs/2026-07-08-live-agent-link-design.md), [docs/features/copy-for-ai.md](../features/copy-for-ai.md), `functions/agent-link/sessionToken.ts`

> **Why this ADR exists.** The reasoning below was decided verbally and never
> written down. It has therefore been re-litigated at least three times, most
> recently on 2026-08-16, when an architecture review proposed replacing the
> whole minted-token design with "the user supplies their own Atlassian API
> token" on the strength of a REST probe. The probe result was correct and the
> proposal was still wrong, for the reason in Decision 1. Anyone who rediscovers
> that probe result must read this file before acting on it.

## Context

Agent Link connects a user's local AI agent (over MCP) to the diagram open in
their browser. The agent must authenticate to something.

A REST probe on 2026-08-16 established a true technical fact: a plain Atlassian
user API token (Basic auth) can read **and** write the app-scoped diagram custom
content directly through Confluence REST v2, with no Forge runtime and no ZenUML
backend involved.

- `GET /wiki/api/v2/custom-content/{id}?body-format=raw` → 200, full DSL.
- `PUT` with a deliberately stale `version` → **400 "Version must be
  incremented"**, i.e. the optimistic-lock check, which is reached only *after*
  authorization passes. Never 401/403. Nothing mutated.
- `GET /wiki/api/v2/pages/{pageId}/custom-content` → lists the diagram, so
  discovery works too.
- Corroborated in our own code: the app's save path (`src/model/ApWrapper2.ts:447`
  → `requestConfluence`) already runs as the **end user**, the same permission
  surface a user API token operates under.

So a standalone MCP server carrying the user's own API token is technically
sufficient to deliver the core job, and would make the ~9,984 prod LOC of
Durable Object + WSS relay + session token + TTL + lock + presence unnecessary.

We are not doing that. The reason is not technical.

## Decisions

1. **We mint a short-lived session token in the product. We do not ask the user
   for their own Atlassian API token.** This is the load-bearing decision and it
   is a *distribution* decision, not an architecture one.

   Most users will never obtain their own API token. They do not know it exists,
   do not know it lives at id.atlassian.com under Security → API tokens, and are
   not going to go looking. Of the minority who do find it, most then do not know
   what to do with it — which file to put it in, what an MCP server config looks
   like, which field the token goes in, what the site URL field wants.

   The minted token removes that entire step. The user clicks one button in the
   macro and gets a ready-to-paste command with the credential already embedded.
   That is the feature. The relay is the machinery that makes a
   product-controlled credential possible; it is not the point of the product.

   Treating "the user creates an API token, about one minute" as a small cost is
   the specific error this ADR exists to prevent. It is not one minute. For most
   of the addressable population it is the step at which they stop.

2. **The token is short-lived and scoped to one diagram session.** Because we
   mint it, we own its lifetime: `min(lastActivity + 10min, issuedAt + 60min)`
   (`functions/agent-link/sessionToken.ts`, `IDLE_TTL_MS` / `MAX_SESSION_MS`).
   A user-supplied API token would be long-lived, site-wide, and would sit in a
   config file on the user's disk indefinitely. Handing an agent a narrow,
   expiring, one-diagram credential is the better security posture, and it is
   only available to us because we are the issuer.

3. **No OAuth.** Rejected earlier for the same distribution reason plus cost: a
   3LO flow needs its own Marketplace app identity, consent screens, and token
   refresh infrastructure, and still puts a browser-based consent step in front
   of a CLI-based agent. It removes less friction than the minted token and adds
   more of our own infrastructure.

## Consequences

- **Accepted:** the browser tab must stay open, because the relay proxies every
  agent operation through the macro's WebSocket. This is the direct cost of the
  credential decision, and it is why the session has a TTL, a lock, and a
  reconnect path at all.
- **Accepted:** ~10k lines of relay code exist to support a credential model,
  not a rendering feature. That ratio is uncomfortable and is the reason the
  standalone-MCP proposal keeps resurfacing. It stays justified only as long as
  Decision 1 holds.
- **Watch item, unverified:** some enterprise organisations disable API-token
  creation for managed accounts. If true at the tenants we most want, the
  user-supplied-token path is not merely high-friction there but unavailable —
  which strengthens Decision 1. Nobody has checked this.
- **What would reopen this ADR:** evidence that the target users *do* already
  hold and configure API tokens (for example, telemetry showing most Agent Link
  users arrive with an MCP client already configured against other Atlassian
  tooling). Absent that evidence, a technical demonstration that user tokens
  *can* write is not a reason to revisit — Decision 1 already assumes it can.
