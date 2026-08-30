# Local CRM — Today as a work queue

Decisions from the 2026-08-30 design interview. Every count below is a query result
against the running loopback console, as-of 2026-08-30.

## What Today is

A work queue across three lifecycles: **welcome**, **extension**, **expiry and
cancellation**. It lists only what is waiting on the operator. A settled fact stays
off it, except for a short confirmation tail.

Extension is the only lifecycle with data today. Welcome and expiry/cancellation
appear as one `(todo)` row each, stating what has no source yet:

- **welcome** — migration 0025 (`welcome_state`, `block_reason`, `retry_count`,
  `lifecycle_setting`, `lifecycle_run`) is applied nowhere; the Resend sending domain
  is unverified; all 1,407 contacts sit under `bootstrap_backlog`, which the design
  in `src/utils/analytics/catalog.ts:844-895` explicitly does not count as an
  operator exception. Welcome sends are unattended by design — the operator's job is
  the exception queue, template/rule publishing, and the kill switch.
- **expiry and cancellation** — `lifecycle_touchpoint` holds 0 rows; the 448 lapse
  marks carry the ingest run's timestamp, not a cancellation date. Trial ends
  (`evalEndsAt`, 158 contacts) belong here and stay out of the queue until this row
  has a source.

## What enters the queue

Ball in our court only:

| Item | Rule | Today |
|---|---|---|
| Request waiting on support | JSM status `Waiting for support` | 2 |
| Request in progress | status `In Progress` / `Work in progress` | 5 |
| Extension expiring | `expiresAt` within 7 days | 2 |
| Nudge | status `Waiting for customer`, idle ≥ 30 days on `updatedAt` | 16 |
| Close | same, idle ≥ 90 days | 2 |

`Waiting for customer` inside 30 days stays out: 29 of 36 open requests are parked on
the customer, and a queue that lists them is not a day's work.

## Ordering

One numeric score per row, ascending. The score is days until the item stops being
actionable, computed from stored fields only:

- waiting on support / in progress → `0`
- expiry → days until `expiresAt`
- nudge → `-(idle days - 30)`
- close → `-(idle days - 90)`

The row displays its own real date (created, updated, or expires); the score is never
shown. No invented deadlines: the two thresholds (7 days, 30/90 days) are the only
judgement, and they are stated on the row.

## Layout

No page title. No tier headings. No filter pills. No right rail. One column:

```
30 Aug   extension   ZEN-1216  zeptonow / Engineerin   waiting for support     → open · command
01 Sep   extension   the8games / ServerDev             access stops in 2 days  → open · command
22 Jun   extension   ZEN-1175  no reply in 69 days     nudge or close          → open
  —      welcome     (todo) …
  —      expiry      (todo) …
```

Under the queue, a muted **settled tail**: grants written and expiries reached in the
last 14 days, one line each, no action. It exists as the readback that a queue action
landed — 13 rows today. An empty queue renders one line plus the freshness stamp.

## What a row carries

The five facts the grant-or-refuse decision needs, all already parsed server-side:

- resolved `cloudId` (join `typedDomain` → sites)
- requester email
- `macroCount` against `macrosLimit`
- prior grants for that cloudId + space: count, latest expiry, whether one is active
- who spoke last on the ticket (`comments.lastCommentAuthorship`)

Requester emails are customer data: loopback only, never a public-repo file
(`docs/policies/client-privacy.md`).

## What a row does

Read, route, and hand over the command. Two links (JSM ticket, tenant on Sites) plus a
copy-ready `extend-space-license` invocation with cloudId, space key and duration
filled in. **The console still writes nothing.** A write path waits on three things
that do not exist: a POST route, an `ExtensionAction` audit row (production holds 0),
and a readback proving the KV write landed.

Row click opens the existing drawer, slimmed for queue rows: evidence, the command,
and the ticket's comment history. No lifecycle rail (every grant case renders the same
four `never entered` stages) and no Audit tab (its table is empty).

## Work

1. **Server** — widen the open-request projection in `server/extensionsData.ts:528`
   from 7 fields to the decision set; it already holds the parsed issue. Bump
   `EXTENSIONS_CONTRACT_VERSION`.
2. **Queue builder** — one pure module: rules, score, settled tail. Tests first.
3. **TodayScreen** — replace the stream, pills and rail with the queue.
4. **Drawer** — queue-row variant.
5. **Verify** — unit tests, then the running console with live data.
