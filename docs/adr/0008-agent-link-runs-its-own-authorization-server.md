# 0008 — Agent Link runs its own OAuth authorization server for the headless path

Date: 2026-09-19
Status: proposed
Related: [docs/superpowers/specs/2026-09-19-headless-diagram-mcp-design.md](../superpowers/specs/2026-09-19-headless-diagram-mcp-design.md) §5.1 and §12.6, [0003-agent-link-mints-its-own-short-lived-token.md](0003-agent-link-mints-its-own-short-lived-token.md), `functions/agent-link/oauth/`
Supersedes in part: ADR 0003 Decision 3 ("No OAuth")

> **Why this ADR exists.** The headless design's §12.6 lists three ways to
> satisfy the MCP authorization spec and declines to pick one, and every
> phase after Phase 3 is blocked on the pick. This file makes it, and — more
> importantly — records *why the answer is not the obvious one*, because the
> obvious one ("just use Atlassian as the authorization server") is wrong in a
> way that will not be visible to whoever next reads the spec in a hurry.

## Context

The headless path needs two credentials that must never be the same object:

| | Issued by | Issued to | Audience |
|---|---|---|---|
| MCP token | an authorization server *we* control | the MCP client (Claude Code, Codex, Cursor) | our MCP endpoint |
| Atlassian token | Atlassian | us, as a registered 3LO client | Confluence |

The MCP authorization spec (2025-06-18) forbids collapsing them: an MCP server
"MUST only accept tokens specifically intended for themselves" and "MUST NOT
pass through the token it received from the MCP client." Pointing the
resource-metadata document at `auth.atlassian.com` and letting clients bring
Atlassian tokens would be exactly that passthrough — a foreign-audience token
accepted at our endpoint, the confused-deputy shape the spec names. So
*something* has to mint MCP tokens with our endpoint as audience, hold the
Atlassian grant behind them, and run OAuth 2.1 with PKCE, RFC 8414 metadata,
Dynamic Client Registration, and its own consent step (the spec's rule for
proxies with one static upstream client id, which is precisely our shape).

The spec's §12.6 offered three candidates for that something:

1. **Build it ourselves**, on Cloudflare, next to the MCP endpoint.
2. **Rent it** — Auth0, WorkOS or Stytch as the AS, with Atlassian upstream.
3. **Defer it** — ship headless reads over the existing relay only, and decide
   later.

What already exists, and bears on the choice:

- The MCP endpoint already mints and validates its own credential
  (`functions/agent-link/sessionToken.ts`, `mcpAuth.ts`): an opaque
  `CL-XXXX-XXXX` token looked up in a server-side registry with a
  server-authoritative TTL. That is ADR 0003's "we are the issuer" decision,
  implemented. It is not a signing infrastructure — the tokens are random
  handles, not JWTs — but the *shape* (issue, store, look up, expire) is the
  whole of what an AS's token endpoint does.
- Phase 3 has already landed the resource-server half: RFC 9728 metadata, the
  401 `WWW-Authenticate` challenge, the audience check, the Atlassian 3LO
  client and the AES-GCM grant store (`functions/agent-link/oauth/`, 80
  tests). Those pieces are identical under all three options.
- The Atlassian app is registered (2026-09-19) and its client id is in config.
- §12.2 of the spec already commits us to a Privacy & Security questionnaire
  update for all four Marketplace variants, because storing refresh tokens is
  a new class of end-user credential.

## Decisions

1. **We run the authorization server ourselves, as Pages Functions beside the
   MCP endpoint.** Not a hosted provider, and not deferred.

   The decisive argument is the P&S declaration, not the code. A hosted AS
   places a third party in the path of every end-user Atlassian consent: the
   vendor sees the authorization, brokers the upstream grant, and in the
   common integration pattern *holds* the upstream refresh token. That is a
   second custodian of the exact credential §12.2 already makes us declare.
   Declaring "ZenUML stores encrypted Atlassian refresh tokens in Cloudflare
   KV" is one sentence. Declaring that plus a sub-processor is a different
   conversation with every enterprise reviewer, and it is permanent. The
   vendor's bill is a rounding error next to that.

   Deferral (option 3) is a false economy: the relay path already serves read
   tools, so "headless reads over the relay" delivers nothing the product does
   not have today. It would postpone the decision without buying information.

2. **The AS is the minimum the spec forces, and no more.** Concretely:

   - `GET /.well-known/oauth-authorization-server` — RFC 8414, a static
     document.
   - `POST /agent-link/oauth/register` — DCR. Accepts `redirect_uris` and a
     client name; stores them in KV under a generated `client_id`. No client
     secrets (public clients + PKCE), no client management UI, no token
     endpoint auth methods beyond `none`.
   - `GET /agent-link/oauth/authorize` — PKCE required (`S256` only). Renders
     our consent screen naming the *registered MCP client* ("Claude Code wants
     to edit your Confluence diagrams as you"), then hands off to Atlassian's
     3LO authorize if no usable grant exists for this user.
   - `GET /agent-link/oauth/callback` — the Atlassian leg's return; exchanges
     the code, seals the grant into `OAUTH_GRANT_KV`, then completes *our*
     authorization by redirecting to the MCP client's `redirect_uri` with our
     own code.
   - `POST /agent-link/oauth/token` — exchanges our code (checking the PKCE
     verifier) for an MCP access token; supports `refresh_token`.

   **MCP tokens are opaque handles, like session tokens today**, stored in KV
   with `{ userId, clientId, scope, expiresAt }` and looked up on every
   request. No JWTs, no signing keys, no key rotation story. This is the same
   pattern `mcpAuth.ts` uses and it is sufficient: the token's only consumer
   is us. Revocation is a KV delete. The one property this costs is stateless
   validation, which we do not need at this scale.

   Refresh-token rotation on our side mirrors Atlassian's: a new refresh token
   on every use, the old one dead.

3. **Our consent screen is the security boundary, not a formality.** The
   spec's rule exists because one static upstream client id (ours at
   Atlassian) fronts many dynamically registered MCP clients. Without a
   per-client consent step, the second client a user registers inherits the
   Atlassian grant the first one obtained — an agent the user never approved
   would write to Confluence as them. The consent page therefore records
   `{ userId, clientId, grantedAt }` and `/authorize` refuses to issue for an
   unconsented `(user, client)` pair even when a live Atlassian grant exists.
   Re-consent at Atlassian is *not* required for a new client; our consent is.

4. **ADR 0003 Decision 3 is superseded for the headless actor only.** 0003
   rejected OAuth because a browser consent step in front of a CLI agent
   "removes less friction than the minted token." That reasoning still holds
   for the relay: when the page is open, the one-click minted token remains
   the credential and nothing here changes it. It does not hold for the
   headless case, where there is no page and no macro to click — the only
   alternatives to a browser consent are the user-supplied API token 0003
   already rejected on distribution grounds, or an app-level credential the
   headless spec §8 rejects on major-version and confused-deputy grounds.
   Both actors coexist; `get_status` reports which is live.

## Consequences

- **Accepted:** we are now the operator of an authorization server, with the
  obligations that implies — its availability gates every headless call, its
  KV holds credentials whose loss is a customer-visible incident, and a bug in
  `/token` is a security bug rather than a rendering bug. Mitigation is the
  narrowness in Decision 2: fewer than ten routes, all opaque-token, all
  KV-backed, no cryptography beyond what `tokenStore.ts` already does.
- **Accepted:** DCR is unauthenticated by design (the spec's clients expect
  it), so `/register` is a public write endpoint. It must be rate-limited and
  its rows must expire (a registration never followed by a consent is
  garbage after a day).
- **Accepted:** the P&S questionnaires for all four variants must be updated
  before this ships to any customer site, per §12.2. That work is on the
  critical path now and should start when `OAUTH_GRANT_KV` is provisioned,
  because Marketplace review lag is measured in weeks.
- **Sequencing this unblocks.** The Atlassian leg (`/authorize` → 3LO →
  `/callback` → `saveGrant`) is buildable and live-verifiable on
  `conf-stg-lite` *before* the MCP-facing routes exist, using a hand-built
  authorize URL. Do that first: it exercises the registered app, the callback
  URIs and the grant store with the least new code. Then wire the 401
  challenge on `mcp.ts` (the resource-server half is already written), then
  DCR + PKCE + consent, then `update_diagram` headless as the first tool —
  it needs no `extensionKey` and no paywall gate, so it proves the whole
  OAuth chain with the safest write.
- **Watch item:** the MCP clients we target (Claude Code, Codex, Cursor)
  differ in which parts of the spec they actually implement — DCR support,
  PKCE method, whether they honour `WWW-Authenticate` resource metadata. The
  2026-08-23 analysis §9 has the experiment matrix. Run it against a staging
  AS before assuming DCR is enough; if a major client needs pre-registered
  client ids, add a static allowlist alongside DCR rather than dropping DCR.
- **What would reopen this ADR:** an enterprise reviewer accepting a named
  sub-processor more readily than first-party credential storage (the
  opposite of the assumption in Decision 1), or the AS's operational cost
  turning out to dominate — for example, if refresh-token rotation bugs
  become a recurring support load. Either is measurable within a quarter of
  pilot use; neither is a reason to re-litigate before then.
