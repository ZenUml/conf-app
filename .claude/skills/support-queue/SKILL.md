---
name: support-queue
description: >
  Read and triage the ZEN service-desk queue on zenuml.atlassian.net — what tickets
  are open, who is waiting on a reply, which granted extensions are about to expire.
  Use for any QUEUE-shaped question: "any new tickets", "who is waiting on me",
  "did <tenant> ever file a ticket", "what came in since <date>", "工单", "谁在等回复",
  "有没有新工单", or when a paywall/churn analysis needs the support-ticket signal.
  Read-only. To FULFIL a specific request (write the KV licence, draft the reply)
  use `extend-space-license` instead.
  Discriminator, one rule: the question names a specific ticket or hands over a
  request to fulfil -> `extend-space-license`; the question is about the queue, a
  time window, "anything new", or who is waiting -> this skill.
---

# Support queue (ZEN service desk)

## Access — Playwright MCP only. Do not try the local Atlassian token.

**The only working path is a same-origin `fetch` inside a `zenuml.atlassian.net`
page driven by Playwright MCP**, using the browser's live `support@zenuml.com`
session. Start there. Do not open with a credential probe.

Two paths that look plausible and are both dead ends — do not spend rounds on them:

| Attempt | Result | Why |
|---|---|---|
| `.env.forge.local` `FORGE_EMAIL` / `FORGE_API_TOKEN` | **403**, HTML login page | Valid credentials (`/rest/api/3/myself` returns 200) but the owner is not an *agent* on the ZEN desk. A per-desk permission gap, not an expired token. |
| `JSM_API_TOKEN` (the `support@zenuml.com` agent token) | not obtainable | Exists only as a GitHub Actions secret, synced to Cloudflare Pages at deploy time. GitHub secrets cannot be read back. No local copy. |

Cost of ignoring this: on 2026-08-11 the 403 path plus a hung navigation consumed
several rounds before the browser path was used. The rule is an ACTION — open the
page first.

### Connecting

```zsh
~/.agents/skills/connect-playwright-profile/scripts/preflight.zsh --runtime claude
```

Then navigate to any `zenuml.atlassian.net` page (`/jira/servicedesk/projects` is
enough) and run the queries from the page context.

**If preflight prints `stale extension MCPs: reaped N`, expect the next navigation
to hang with no error** — the Chrome extension is still paired to a dead relay.
Fix: ask the user to run `/mcp` -> `playwright` -> Reconnect, then re-run preflight
(a new MCP pid must appear) and navigate again. The agent cannot invoke `/mcp`
itself. Ask on the FIRST hang; do not retry navigation against a dead transport.

## Writing a comment — visibility is NOT the default you expect

This skill is read-only, but a triage run often ends in a close, and the close is
where a comment gets written. Two endpoints, and only one of them controls
visibility:

| Endpoint | Visibility |
|---|---|
| `POST /rest/api/3/issue/<key>/comment` | **Public.** Omitting a visibility field does **not** make it internal. |
| `POST /rest/servicedeskapi/request/<key>/comment` with `{"public": false}` | Internal. Read back `jsdPublic: false` to confirm. |

**Always read the comment back and assert `jsdPublic` before moving on.** On
2026-08-11 three notes intended as internal — text that named a customer's
reseller — posted publicly on three live customer tickets via the first endpoint.
They were deleted (`DELETE /rest/api/3/issue/<key>/comment/<id>`, 204) and
re-posted through the second, but the text was customer-visible in the interval.
The response body of the servicedeskapi call also echoes `public`; that echo is
not proof — assert the read-back.

## Two API traps

1. **`/rest/api/2/search?jql=` returns an empty `issues: []` silently on this
   site.** Only `/rest/api/3/search/jql` works. No error is raised, so a wrong
   endpoint reads as "no tickets".
2. **The comment endpoint ignores `orderBy=-created`** and always returns ascending
   order. A small `maxResults` therefore yields the FIRST comments, not the last.
   Fetch the whole list and take the tail. (This produced a wrong "last comment"
   reading on 2026-08-11 before it was caught.)

Also: query with `statusCategory != Done`, **not** `resolution = Unresolved`. The
ZEN workflow's "Resolve this issue" transition (id `761`) moves the ticket to
`Resolved` **without setting a resolution field** — verified 2026-08-11 by closing
three tickets and reading `status` + `resolution` back (`Resolved` / `null` on all
three). So `resolution = Unresolved` counts every closed ticket as open.
Transitions available on an open ZEN ticket: `781` Respond to support, `761`
Resolve this issue, `901` Cancel request, `911` Escalate this issue.

## Step 1 — read the queue

Read `.claude/skills/support-queue/scripts/queue.js` and pass its body to
`browser_evaluate`. It returns `{ generatedAt, counts, tickets }` with per-ticket
`kind`, parsed `ctx`, `lastComment`, `signalA`, `signalB`.

### How a ticket maps to a tenant

Deterministic, not inferred. `src/components/UpgradePrompt/buildExtensionRequest.ts`
builds a prefilled service-desk deep link: `summary` = the instance URL,
`description` = a structured block, `customfield_10070` = the plan option.

```
Client domain: example-tenant     Space key: ENG          Macro count: 1822
Limit: 100                        Product: ZenUML lite    App version: v2026.08.040331-lite
User account ID: 712020:…         Page ID: 1714749490     Macro type: sequence
```

**Classify on field presence, never on summary wording.** A paywall lockout filed
as a plain bug report ("we have not changed our configuration and should still be
under the free plan") carries none of these fields. Both such tickets in the
archive matter — one of them is the only confirmed Bundle conversion in the
product's history — and a summary-pattern classifier drops both.

`kind: 'other'` therefore holds three different things: genuine product/bug
requests, customer-worded paywall lockouts, and **our own outbound tickets** (the
"ZenUML Lite limit reached in the X space" ones we raise proactively), which have
no structured description either.

> **Production note:** the server-side ticket-creation endpoint
> (`functions/api/extension-request.ts`) is **not on `main`** — it lives only on
> `feat/in-app-extension-request` and `design/paywall-redesign`. In production the
> modal opens the prefilled portal form and the customer submits it. Verify with
> `git merge-base --is-ancestor c7b85838 origin/main` before assuming otherwise.

## Step 2 — signal C: granted extensions vs open tickets

`queue.js` cannot compute this — it needs Cloudflare KV, which the browser cannot
read. Run this and join on the ticket key:

```zsh
NS=8969e8528105403bb2d9adca9fc16567   # SPACE_LICENSE_KV (prod)
for k in $(npx wrangler kv key list --namespace-id=$NS --remote \
    | python3 -c "import json,sys;[print(x['name']) for x in json.load(sys.stdin) if x['name'].startswith('license:')]"); do
  npx wrangler kv key get "$k" --namespace-id=$NS --remote \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('spaceKey'),d.get('status'),d.get('activatedBy'),d.get('expiresAt'))"
done
```

`activatedBy` carries the ticket key by convention
(`support:temp-7d-extension:ZEN-NNNN`), **but the convention is not enforced** —
several records carry only `support:temp-14d-extension` with no ticket. An
unmatched record is not proof that no ticket exists; match by
`cloudId`+`spaceKey` as a fallback via the ticket's parsed `ctx`.

Why this signal is load-bearing: the only confirmed Bundle conversion happened
when a granted extension expired and the customer was blocked a second time. An
expiry that passes unnoticed is a lost conversation, not a quiet success.

## Step 3 — the attention rule

Ticket status carries almost no information: most open tickets sit in
`Waiting for customer` because the ZEN workflow offers no transition out of it
(see `extend-space-license`). Some have been parked there for over a year. Triage
on these three signals instead:

| Signal | Meaning | Source |
|---|---|---|
| **A** | The last comment author is the customer — we owe a reply. | `queue.js` |
| **B** | The last comment is our own internal note (`jsdPublic: false`) — something was recorded and the customer was never answered. | `queue.js` |
| **C** | A granted extension **has already expired** and the ticket is still open. | Step 2 |

> **An extension that has not expired yet is NOT an action item.** Expiry is the
> designed mechanism, not a failure to prevent — the only confirmed Bundle
> conversion happened *because* a grant expired and the customer was blocked a
> second time. Renewing before expiry cancels that mechanism. Report a live grant
> with its date under "parked" and nothing more; the decision point arrives after
> the date, if and only if someone asks again.
>
> This exact error was made on the skill's first run (2026-08-11): ZEN-1198 was
> listed as needing action three days before its grant expired, and the proposed
> action was a renewal.

Everything else is **parked**: list it aggregated by tenant (repeat askers are the
conversion signal) but keep it out of the action list.

### Do not contact an inactive PAYING tenant (owner rule, 2026-08-11)

Before proposing any outbound message, check the tenant's paid status
(`marketplace/scripts/mp_report.py whois <domain> --local --app all`) and recent
activity. **If the tenant is paying and inactive, propose no contact — not a
reply, not a courtesy close, not a status update.** An unsolicited message to a
dormant subscriber is a prompt to reconsider the subscription, and the ticket
being old is not a reason to accept that risk.

This overrides signal A and signal B: "we owe a reply" is a triage fact, not an
instruction to send one. Report the ticket as **parked — inactive payer**, name
the renewal date, and stop.

**A resolve transition is NOT silent.** JSM notifies the customer when a request
is resolved, so closing counts as contact under this rule. Leave the ticket open
unless the desk's notification scheme has been checked and shown to be off.
(Worked example: ZEN-1157 — a paying Full tenant, 14 seats, $254.52 monthly,
renewal 15 days out, 0 saves and 0 creates in 90 days, question unanswered for 16
months. Correct handling is to leave it open and untouched.)

## Step 4 — enrichment is delegated

This skill owns the ticket side only: key, tenant, space, macro count, requested
plan, signals, grant expiry. For anything beyond that, call the owning skill
rather than duplicating its logic:

| Question | Skill |
|---|---|
| Is this tenant paying / how much would they pay | `tenant` |
| Is this tenant currently blocked, how badly | `paywall` |
| Event-level evidence | `mixpanel` |
| Grant the extension and reply | `extend-space-license` |

The KV expiry read in Step 2 is the one exception — it *is* signal C, not
enrichment.

## Output

One table, action rows first:

| Ticket | Tenant | Space | Macros | Signal | Age | Note |
|---|---|---|---|---|---|---|

Then a parked section aggregated by tenant. Real tenant names must **not** be
written into any public-repo file; this SKILL.md and its scripts use placeholders
only. Durable queue snapshots belong in the private handbook, alongside
`paywall/extension-request-replies.md`.

## Scheduled runs

Under `/loop` or cron, read and write `private/support/queue-state.json`:

```json
{ "lastRun": "<ISO8601>", "tickets": { "ZEN-NNNN": { "updated": "…", "signals": "AB" } } }
```

Report only what **changed** since `lastRun` (new ticket, new signal, grant now
inside 7 days of expiry). A full re-list every run puts a 16-month-old parked
ticket next to one expiring in 3 days at equal weight, and the report stops being
read. On the first run there is no baseline: report everything once and say so.

## Related

- `extend-space-license` — the write side: grant the licence, draft and post the reply.
- `connect-playwright-profile` — the preflight and reconnect procedure.
- `tenant`, `paywall`, `marketplace`, `mixpanel` — enrichment owners.
