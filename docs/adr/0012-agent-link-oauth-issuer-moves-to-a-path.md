# 0012 — Agent Link's OAuth issuer moves to `<origin>/agent-link`

Date: 2026-11-06
Status: proposed. Implemented behind `OAUTH_ROOT_AS_METADATA=off` in [#1042](https://github.com/ZenUml/conf-app/pull/1042), which turns it on for staging only. Production stays on the bare-origin issuer until the staging sign-in checks below pass.
Related: [#1038](https://github.com/ZenUml/conf-app/issues/1038), [0008-agent-link-runs-its-own-authorization-server.md](0008-agent-link-runs-its-own-authorization-server.md), `functions/agent-link/oauth/asMetadata.ts`, `functions/agent-link/oauth/discovery.ts`, `functions/agent-link/oauth/authServer.ts`
Amends: ADR 0008 Decision 2, which placed the RFC 8414 document at the root

> **Why this ADR exists.** Moving an OAuth issuer looks like a URL change. It
> is really a change of the authorization server's identity, and every
> connected client has a copy of that identity. This file records why we
> moved it anyway, what stays stable so existing connections keep working,
> and the one case that can break.

## Context

One origin, for example `conf-lite.zenuml.com`, serves two MCP servers:

| Endpoint | Sign-in |
|---|---|
| `/agent-link/mcp` (Confluence tools) | required: our own authorization server (ADR 0008), with Atlassian upstream |
| `/mcp` and `/mcp/render` (render server) | none |

Before connecting, an MCP client looks for OAuth metadata. It tries, in order:

1. the protected-resource document for the endpoint's own path (RFC 9728 §3.1), for example `/.well-known/oauth-protected-resource/mcp/render`;
2. the bare `/.well-known/oauth-protected-resource`;
3. for clients following the MCP 2025-03-26 behaviour, the authorization server's document at `/.well-known/oauth-authorization-server`.

The last two are origin-wide, and both described agent-link. A client adding `/mcp/render` was therefore told that sign-in is required. It registered, then asked for a token for `/mcp/render`. Our server correctly answered `invalid_target`, and the client fell back to connecting without a token. What users saw:
- a first try that failed;
- Codex leaving the server "Not logged in";
- Codex printing "OAuth provider rejected discovered scopes".

#1039 and #1040 fixed the first two steps:
- the path-specific lookup answers a JSON 404;
- the bare protected-resource document can be turned off with `OAUTH_ROOT_RESOURCE_METADATA=off`.

Codex then still found step 3. That document sat at the root only because the issuer was the bare origin: RFC 8414 §3 puts the document at the well-known prefix followed by the issuer's path, and a bare origin has no path.

## Options

1. **Move the issuer to a path, `<origin>/agent-link`.** Its document then lives at `/.well-known/oauth-authorization-server/agent-link` (RFC 8414 §3.1). Only a client that agent-link's protected-resource document points there will read it. Nothing at the root advertises OAuth.
2. **Serve the render server from its own origin.** This is cleaner in principle. But the Claude directory listing `zenuml-diagrams`, which is in review, and the published plugin configs name `conf-lite.zenuml.com/mcp/render`, and a submitted connector's URL can only be changed through Anthropic.
3. **Keep the root document and live with the extra sign-in attempt.** Every client that runs OAuth discovery keeps the "first try fails" behaviour.

## Decision

**Option 1, behind one flag.** `OAUTH_ROOT_AS_METADATA=off` makes `<origin>/agent-link` the issuer. Option 2 stays as the fallback if a client turns out to need the root document.

### What the flag changes

With `OAUTH_ROOT_AS_METADATA=off` (and `OAUTH_ROOT_RESOURCE_METADATA=off`, which retires the bare protected-resource document):

| URL | Flag unset (production today) | Flag `off` |
|---|---|---|
| `/.well-known/oauth-authorization-server` | 200, `issuer` = origin | **404 JSON** |
| `/.well-known/oauth-authorization-server/agent-link` | 200, `issuer` = `<origin>/agent-link` (served, nothing points at it) | 200, `issuer` = `<origin>/agent-link` |
| `/.well-known/oauth-protected-resource/agent-link/mcp` | 200, `authorization_servers` = [origin] | 200, `authorization_servers` = [`<origin>/agent-link`] |
| `/.well-known/oauth-protected-resource` | 200 (404 with `OAUTH_ROOT_RESOURCE_METADATA=off`) | same |
| any other path under either prefix, including `/mcp` and `/mcp/render` | 404 JSON | 404 JSON |
| `iss` on a new authorization response (RFC 9207) | origin | `<origin>/agent-link` |

**One flag moves the documents and `iss` together.** A client compares the `iss` on the authorization response with the `issuer` of the metadata it read. If the two could be switched separately, there would be a moment when every new sign-in failed.

### What does not change

| Thing | Why it is stable |
|---|---|
| Endpoint URLs: `/agent-link/oauth/authorize`, `/token`, `/register` | They are absolute URLs on the origin, read from the metadata, never derived from the issuer. |
| Resource URI and token audience: `<origin>/agent-link/mcp` | `resourceFor()` and `audienceMatches()` use the origin, so issued access tokens stay valid. |
| Refresh tokens | The D1 refresh ledger uses its namespace as a row key and in the AES-GCM AAD (`refreshLedger.ts`). It stays keyed on the **origin**: `token.ts` and `headlessMcp.ts` pass `originFor()`, not the issuer. So no migration is needed, and every existing refresh token is still found and decrypted. |
| Registered (DCR) clients | They are stored in KV by `client_id`, with no issuer. |
| A sign-in in progress when the flag flips | `validateAuthorize` records the issuer on the parked authorization, and the response carries that one. A record parked before #1042 has no issuer and counts as the bare origin. |

## Consequences for clients that were already connected

- **Day-to-day use and refresh keep working.** Access tokens, refresh and the token endpoint are unchanged, and no issuer check takes part in a refresh.
- **The risk is a new sign-in.** A full sign-in happens when the 30-day refresh token expires, the user reconnects, or access is revoked.
  - A client that re-reads the protected-resource document first, as the MCP spec expects after a 401, finds the path issuer. The sign-in then succeeds with a matching `iss`.
  - A client that reuses the metadata it cached before the switch expects `iss` = origin. It receives `<origin>/agent-link` and rejects the sign-in. The user would see a failed reconnect, typically reported as an issuer mismatch, for example "Issuer mismatch in authorization response (RFC 9207)".
- **Workaround:** remove and re-add the connector. That forces fresh discovery.
- **Fallbacks if a common client behaves that way:**
  - leave the flag unset in production, accepting the extra sign-in attempt on the render server;
  - or take option 2.

It isn't known yet how Claude.ai, Codex, VS Code Copilot and ChatGPT behave here. That is why the rollout tests both an existing and a new connection in each.

## Rollout

1. **Merge #1042.**
   - **Production:** neither flag is set in `wrangler-prod.toml`, so behaviour is unchanged. The only visible additions are the unreferenced path-issuer document and the missing-asset 404.
   - **Staging:** `wrangler-stg.toml` sets both flags.
2. **Staging checks.** For Codex, Claude.ai, VS Code Copilot and, where available, ChatGPT, check both:
   - an **existing** connection, made before the switch, still works and refreshes;
   - a **new** sign-in completes, with no issuer mismatch.

   Also check that `codex mcp add …/mcp/render` and `…/mcp` start no OAuth flow. That one passed on 2026-11-03 with Codex CLI 0.166.0.
3. **If all pass,** set both flags in `wrangler-prod.toml` and release Diagramly, then Lite, then Full. Note that Full's MCP server is the Lite backend (ADR 0011).
4. **Rollback:** unset `OAUTH_ROOT_AS_METADATA`, which takes a deploy. The issuer returns to the origin, and refresh tokens are unaffected either way. Clients that signed in under the path issuer and later need a new sign-in face the same mismatch case in reverse, so roll back only for a real failure.

## How to check which issuer is live

```bash
ORIGIN=https://conf-stg-lite.zenuml.com
curl -s -o /dev/null -w '%{http_code}\n' $ORIGIN/.well-known/oauth-authorization-server   # 404 = path issuer on
curl -s $ORIGIN/.well-known/oauth-protected-resource/agent-link/mcp | grep -o '"authorization_servers":\[[^]]*\]'
```

Staging is redeployed by every `main` merge and every PR push. Until #1042 is merged, a deploy from `main` takes staging back to the bare-origin issuer, so check before testing.
