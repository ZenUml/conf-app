# 0011 — Full's MCP server is the Lite backend

Date: 2026-10-24
Status: accepted
Related: [0008-agent-link-runs-its-own-authorization-server.md](0008-agent-link-runs-its-own-authorization-server.md), `src/composables/agentLink/connectInstructions.ts`, `functions/agent-link/macroIdentity.ts`, `functions/agent-link/oauth/`

## Context

The Connect MCP setup command (viewer button and Confluence Home card) told
each app's users to add `<this app's backend>/agent-link/mcp`. For Full that
was `conf-full.zenuml.com` (prod) and `conf-stg-full.zenuml.com` (staging),
and neither works. Measured 2026-10-24 with an MCP `initialize`:

| Backend | Answer |
|---|---|
| `conf-lite` / `conf-stg-lite` | 401, "Authorization required" (correct) |
| `conf-full` / `conf-stg-full` | 503, "Headless mode is not configured", missing `OAUTH_GRANT_SECRET` |

The Full projects were never fully provisioned for the headless path, but they
were already half-wired to the Lite one (Cloudflare Pages config, read
2026-10-24):

- `ATLASSIAN_OAUTH_REDIRECT_URI` on `conf-full` is
  `https://conf-lite.zenuml.com/agent-link/oauth/callback`, and on
  `conf-stg-full` the `conf-stg-lite` callback. A Full sign-in therefore
  finishes on the Lite backend, which encrypts the Atlassian grant with
  **Lite's** `OAUTH_GRANT_SECRET`.
- `OAUTH_GRANT_KV` and the `DB` D1 binding are the same namespace and
  database as Lite's, in both environments.

`OAUTH_GRANT_SECRET` is the AES key for that shared grant store and also signs
the D1 refresh ledger. Cloudflare does not return a secret's value once set,
and nobody had the 2026-09-25 value to hand.

The MCP server itself is not Lite-specific: it detects which of Lite, Full and
Diagramly are installed on a site and uses that app's content types
(`VARIANTS` in `macroIdentity.ts`), and the paywall gate passes every variant
but Lite (`headlessGate.ts`). Diagramly users already use the Lite backend,
because Diagramly's backend *is* `conf-lite`.

## Options considered

1. **Full uses the Lite backend's MCP URL.** A frontend change only.
2. **Copy Lite's `OAUTH_GRANT_SECRET` to `conf-full`.** Keeps a Full hostname,
   but needs a value no one could read back, and leaves two copies of one key
   that must be rotated together forever. Independence would be in name only:
   sign-in and storage still live on the Lite side.
3. **Separate Full completely**: its own registered callback, KV namespace and
   key. The only option that survives a `conf-lite` outage, at the cost of
   Console, infrastructure and code work, and a second sign-in for users of
   both apps.
4. **Generate a new `OAUTH_GRANT_SECRET` for `conf-full` only.** Rejected: the
   grant is written on `conf-lite` with Lite's key, so every Full MCP call
   would fail to decrypt it after a sign-in that appeared to succeed.
   (Rotating the key on both projects was also declined: it would sign out
   every existing Lite and Diagramly agent.)

## Decision

Option 1. `mcpBackendBaseUrl()` in `connectInstructions.ts` returns the Lite
backend for the current Forge environment when the app is Full
(`resolveZenumlRemoteBaseUrl(environmentType, { isLite: true })`), and the
app's own backend for everyone else. Full's setup command is now
`claude mcp add --transport http zenuml https://conf-lite.zenuml.com/agent-link/mcp`
in production and the `conf-stg-lite` equivalent on staging and dev. The MCP
server name stays `zenuml`, as before.

## Consequences

- Full's MCP needs no secrets on `conf-full`, and its sign-in, token storage
  and MCP endpoint all live on one backend, as Diagramly's already do.
- Full's MCP availability is tied to `conf-lite`. It already was: sign-in
  completed there. Revisit with option 3 if Full needs its MCP to survive a
  Lite backend outage, or its users' grants kept apart from Lite's.
- `conf-full`'s own `/agent-link/mcp` keeps answering 503. Nothing points
  users at it after this change.
- Relay sessions (off: `RELAY_SESSIONS_ENABLED = false`) still mint on the
  app's own backend via `mintAgentLinkSession()`. Turning them back on for
  Full needs the relay to mint on the backend this URL names, or the session
  token will not resolve.
- An `ATLASSIAN_OAUTH_CLIENT_SECRET` was set on `conf-full` on 2026-10-24
  while option 2 was considered. It is unused and harmless.
- The `agent-link-enabled` Forge flag still has to be created for the Full app
  (Developer Console) before Full users see the Connect MCP entry at all.
