# 0014 — Contracts of the frontend backend clients in `src/services`

Date: 2026-11-21
Status: accepted (records decisions already in the code)
Related: [0013-macro-metrics-counting.md](0013-macro-metrics-counting.md), `src/services/`, `functions/diagramly/context.ts`, `functions/activation-prepared.ts`, `functions/api/diagram-impact/`, `functions/architecture-tokens/`

## Context

`src/services` holds thin clients for our backend endpoints. The decisions
below were code comments in those files until the comment audit of 2026-11-21
moved them here. `MacroMetrics` has its own record, ADR-0013.

## Decisions

### Identity is never sent from the client

`GenerateService` (Diagramly chat, AI repair, AI chat) and `ActivationPrepared`
send no `accountId` or `cloudId`. The backend derives both from the verified
Forge invocation token (`functions/diagramly/context.ts`,
`functions/activation-prepared.ts`). A value from the client could only be
spoofed or drift from the authenticated caller. So the prepared-diagram request
carries only `pageId`.

### AI Chat polls for 135 seconds

Diagramly's provider layer lets one model request run for up to 120 seconds.
`AI_CHAT_SESSION_TIMEOUT_MS` is 135 seconds so the worker has time to persist the
finished version and report it through the job status.

### A prepared diagram is a new, unsaved diagram

`preparedToDiagram` sets no `id`. An `id` sends `createCustomContentV2` down the
update branch against a record that does not exist. The cached source goes into
the one field its diagram type renders from; the other content fields stay empty,
because later per-type queries read a stray value in another field as content
(see `.claude/skills/query-forensics/references/conf-app-schema-traps.md`). A
cache miss (404) returns `undefined` so the caller sends
`activation_cache_miss` instead of failing.

### Diagram impact reports `write_failed` with HTTP 200

The backend does not fail a page view because a derived table could not be
written, so `/api/diagram-impact/view` returns 200 with `result: 'write_failed'`.
The client must read `result`: counting that response as a success would put a
number in Mixpanel that no row backs.

### Related diagrams take the reader's page

`getRelatedDiagrams` sends `pageId`, the page the reader is on. The backend
returns only the nearest few positions (`related`, already ordered and capped),
and without `pageId` the reader's own page can fall outside that slice.
`relatedTotal` counts every page the index holds for the name. Optional arguments
are an options object, not positional: inserting a positional parameter before
`timeoutMs` once silently retargeted it. `stale_reason` and `index_source`
come only with `error_kind: 'stale_index'`; `live_version` comes only with
`stale_reason: 'version_mismatch'`.

### The debug bundle extracts code with the viewer's helper

`extractActiveField` reads saved versions through `getCodeFromDiagram`, the
helper the viewer's Source panel uses for Copy, so `saved.active` in the bundle
is byte-identical to what the viewer would show. `clientDomain` drops the
`.atlassian.net` suffix to match the Mixpanel and KV form
(`docs/analytics/reference.md`). The download revokes its object URL in a
`setTimeout`, because revoking it in the same task can race the click in some
browsers.
