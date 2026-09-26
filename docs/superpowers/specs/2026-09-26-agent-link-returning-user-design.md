# What a returning user sees — fewer consent screens, and more than one site

Date: 2026-09-26
Status: proposed
Related: [ADR 0008](../../adr/0008-agent-link-runs-its-own-authorization-server.md), [headless diagram MCP design](2026-09-19-headless-diagram-mcp-design.md), `functions/agent-link/oauth/`

## Why this exists

Two questions arrived from using the shipped flow, and they look separate but
are the same question:

1. *"I connected to whimet4 — how do I connect to another site?"*
2. *"Can the two consent screens be one?"*

Both are about the moment a user comes **back** — to add an agent, to add a
site, to reconnect after a token lapsed. The flow that shipped (#693, #697)
only really designed the first visit. Every return re-runs the whole thing,
because the server has no idea it has met this person before.

## What happens today

`/authorize` always sends the browser to Atlassian with `prompt=consent`. It
has no choice: the user's Atlassian account id is what the grant store is
keyed by, and the only trustworthy source for it is `GET /me` with a fresh
token — which arrives on the way back. So the server cannot answer "do I
already have a grant for whoever this is?" until after the trip it is trying
to avoid.

Screens per authorization, counting what the user actually clicks through:

| Case | Atlassian's screen | Our consent screen |
|---|---|---|
| First agent, no grant | yes | yes |
| Second agent, grant already exists | yes | yes |
| Same agent, re-authorizing | yes | no (consent recorded) |

Only the third row is short, and it is short by accident: `callback.ts` finds
a consent record and skips our screen. The Atlassian hop is never skipped.

### The two screens are not interchangeable

Worth stating plainly, because "just drop one" is the obvious idea and it is
wrong in one direction:

- **Atlassian's screen** names *ZenUML Agent Link*, lists Atlassian scopes,
  and picks the site. It cannot name the agent — one static client id fronts
  every dynamically registered MCP client, so from Atlassian's side every
  agent looks identical.
- **Our screen** names the *agent* ("Claude Desktop wants to read and update
  your diagrams"). It is the only place that information exists, which is why
  ADR 0008 Decision 3 and the MCP spec's proxy rule require it per
  (user, client). Without it the second agent a user installs inherits the
  first one's Atlassian grant silently.

So the reducible one is Atlassian's, and only when we already hold a live
grant for that user. Ours stays.

## Proposal

### 1. A returning-user cookie

Set at the end of a successful callback, read at the start of `/authorize`.

```
agent_link_user=<accountId>.<HMAC-SHA256(accountId, OAUTH_GRANT_SECRET)>
Path=/agent-link/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=90d
```

Signed, because an unsigned cookie would let a browser nominate whose grant
to use. Keyed on the same secret the grant store already needs, so no new
configuration. `SameSite=Lax` for the reason the consent cookie is Lax: the
request that carries it is a top-level navigation, sometimes started
cross-site.

`/authorize` then becomes:

```
client_id present?
  no  -> bare connect flow, unchanged (always via Atlassian)
  yes -> validate + park the request, then:
           cookie valid AND grant for that user is live?
             no  -> Atlassian (today's path)
             yes -> consent recorded for (user, client)?
                      no  -> our consent screen
                      yes -> issue the code now
```

"Grant is live" means `getAccessToken` succeeds — it refreshes if needed and
reports `reauthorize_required` when the grant is dead. A revoked or expired
grant therefore falls back to Atlassian on its own, with no extra bookkeeping.

Result:

| Case | Screens now | After |
|---|---|---|
| First agent, no grant | 2 | 2 |
| Second agent, grant exists | 2 | **1** (ours) |
| Same agent, re-authorizing | 1 | **0** |
| Grant revoked or expired | 1 | 1 (Atlassian, correctly) |

### 2. What this costs: the site picker disappears

Atlassian's screen is also where a user chooses which site to install on.
Skipping it skips that choice — which is exactly the mechanism question 1 was
asking about.

Today a grant is stored per user:

```
agent-link:oauth-grant:<accountId>
```

A second authorization for the same user **overwrites** it. So "add another
site" currently means "re-consent and pick the other site", and the first
site's access is replaced rather than added to. Neither behaviour is
documented, and I have not tested it — no second site with ZenUML installed
was available.

Two ways forward, and they should be decided before the cookie ships, because
the cookie makes the current mechanism unreachable:

**(a) One grant, many sites.** Rely on the 3LO grant already spanning every
site where the user has access and the app is installed — which is what
Atlassian's own consent text claims ("across all Atlassian sites where you
have access and this app is installed"). `list_sites` already returns whatever
`accessible-resources` reports, so if that claim holds, multi-site works today
and the site picker only decides where the app gets *installed*. **This needs
verifying against a second site before anything is built on it.**

**(b) A grant per (user, site).** Key the store
`agent-link:oauth-grant:<accountId>:<cloudId>`, keep a per-user index, and
merge `accessible-resources` across grants in `list_sites`. Strictly more
correct, and more moving parts: re-consent flows, partial revocation, a
migration for existing keys.

Add, in either case, an explicit way back to Atlassian for a user who wants
the picker:

```
GET /agent-link/oauth/authorize?...&prompt=login
```

forces the Atlassian hop even when the cookie says we know them. An agent can
surface it as "connect another site", and it is the escape hatch for "the
cookie is stale but the grant looks fine".

### 3. Security notes

- The cookie is an **identity hint, not an authorization**. It selects which
  grant to consider; it never substitutes for our consent check. A new client
  arriving with a valid cookie still gets the consent screen.
- It must be verified before use: bad signature, unknown account, or dead
  grant all fall through to the Atlassian path rather than failing the
  request.
- It is a tracking-adjacent cookie on our own origin, carrying an Atlassian
  account id. Worth naming in the §12.2 Privacy & Security questionnaire
  alongside the refresh tokens, rather than letting a reviewer find it.
- Revocation: when a grant is deleted, the cookie should be cleared on the
  next request that presents it, so a revoked user is not left in a loop of
  "we know you" followed by "but we cannot act for you".

## What I would build, in order

1. **Verify (a) first.** Install ZenUML on a second dev site, authorize once,
   and see whether `list_sites` returns both. One afternoon, and it decides
   whether §2(b) is work at all.
2. The returning-user cookie and the `/authorize` branch (§1), with
   `prompt=login` as the escape hatch.
3. Whichever multi-site shape step 1 proves necessary.

## What this does not change

- Our consent screen stays, per (user, client). This proposal removes a trip
  to Atlassian, never the screen that names the agent.
- The bare connect flow (`/authorize` with no `client_id`) keeps going
  straight to Atlassian — there is no client to consent to, and it is the
  path used to seed a grant deliberately.
- Token lifetimes, the audience check, and the grant store's encryption are
  untouched.
