# Lite → Full macro conversion — phase 1 (vendor-operated queue)

**Date:** 2026-08-11 · **Branch:** `feat/lite-to-full-conversion`

## Problem

Lite and Full are separate Forge apps with distinct macro keys (`zenuml-*-macro-lite` vs
`zenuml-*-macro`) and app-namespaced custom-content types. Installing Full next to Lite migrates
nothing: every existing page keeps rendering through Lite, so a Full evaluation on a Lite-heavy
site runs to expiry without the customer ever seeing Full render their content. First observed
live on a 152-seat tenant whose Full evaluation had zero renders 20h after install while their
191 Lite macros stayed Lite (2026-08-11 investigation; see the per-tenant Usage Mixpanel board 11447488).

Eleven active tenants hold Full + Lite on the same site today; every future Lite→Full conversion
walks through this same gap.

## Decision

Build the conversion as a **vendor-operated queue** first (phase 1, this branch). A per-macro
"Convert to Full" button (phase 2) and a space-level self-serve batch page (phase 3) reuse the
same conversion core; phase 1 ships no customer-visible UI.

**Boundary: a job is only enqueued for a migration the customer explicitly requested** (email
reply, JSM ticket). The enqueue script requires `--request-source`. Vendor-initiated page edits
without a customer request are out, both on Partner-Agreement grounds (§8.4(b) "necessary for
providing the functionality") and on trust grounds (app-attributed bulk edits in a tenant's page
history must never be a surprise).

## Architecture

```
tools/lite2full/enqueue.py            vendor admin, local. wrangler d1 insert -> ConversionJob
        │
        ▼
ConversionJob (D1, migration 0016)    queued → claimed → done | failed
        ▲ claim/report                          ▲ bodies
        │                                       │
functions/conversion/{claim,bodies,report}.ts   FIT-authed (middleware), Full-app-only allowlist
        ▲ invokeRemote (FIT carries install identity)
        │
src/lite-full-conversion.ts           Full app scheduledTrigger (hourly)
        │ api.asApp().requestConfluence()
        ▼
Confluence: read page ADF → create Full custom content → rewrite extension nodes → PUT page
```

Token model: same as `macro-count-snapshot.ts` — the scheduled function holds `api.asApp()` for
Confluence and `invokeRemote` for our backend; the backend never mints tokens and identifies the
tenant from the FIT, never from the request body.

Bodies come from the D1 `CustomContent`/`CustomContentVersion` mirror (37,807 Lite rows, live),
not from cross-app Confluence reads — custom-content types are app-namespaced and cross-app
readability is unverified; the mirror sidesteps the question.

## ADF rewrite (verified against a live capture)

Captured 2026-08-11 from lite-stg page 99876891 (`scratchpad/lite-page-adf.json` of the session;
reproduced in the unit-test fixture). A Forge macro is:

```json
{ "type": "extension",
  "attrs": {
    "extensionType": "com.atlassian.ecosystem",
    "extensionKey": "<appId>/<envId>/static/<macroKey>",
    "text": "<macro title>",
    "parameters": {
      "guestParams": { "customContentId": "99745817", "updatedAt": "…" },
      "forgeEnvironment": "STAGING",
      "localId": "<uuid>",
      "extensionId": "ari:cloud:ecosystem::extension/<appId>/<envId>/static/<macroKey>",
      "extensionTitle": "<macro title>" },
    "localId": "<uuid>" } }
```

Rewrite per node, everything else byte-preserved:

| Field | New value |
|---|---|
| `extensionKey` / `parameters.extensionId` | own `getAppContext()` appId + environmentId, macro key with `-lite` stripped |
| `parameters.guestParams.customContentId` | the freshly created Full custom content id |
| `text` / `parameters.extensionTitle` | Full macro title |
| `parameters.forgeEnvironment` | own environment |
| `localId` (both) | **preserved** (survives page copy; treat as identity) |
| `embeddedMacroContext` | preserved as-is |

Macro-key mapping is suffix-strip only (`zenuml-sequence-macro-lite` → `zenuml-sequence-macro`,
same for openapi/graph/embed). Custom-content types:
`ac:com.zenuml.confluence-addon-lite:zenuml-content-{sequence,graph}` →
`ac:com.zenuml.confluence-addon:…`.

**v1 scope:** sequence, mermaid, plantuml (all under `zenuml-content-sequence`), openapi, graph.
**Skipped in v1:** embed macros (they reference other diagrams' ids and need an old→new mapping
table built AFTER all referenced content is converted) and unknown keys. Skips are counted and
emitted (`macro_convert_macro_skipped` with `convert_skip_reason`) — that count is the phase-2
demand signal. Graph DrawIO preview attachments are page-scoped and survive the key swap
(assert in staging spot-check, not re-verified in code).

## Safety properties

- Page update goes through the normal version mechanism: one version bump per page, rollback =
  restore previous version.
- `dryRun` jobs walk everything and report the per-page plan without creating content or
  updating pages.
- Idempotence: a page whose ZenUML extension nodes are already Full-keyed contributes zero
  rewrites; re-running a job is safe.
- The claim endpoint only hands a job to the Full app (`appId` allowlist from the verified FIT)
  and only for the FIT's own `cloudId`.
- Lite custom content is left untouched (no deletes in v1) — orphaned Lite rows are cleanup for
  a later phase, after conversions are proven stable.

## Verification plan

Unit: ADF walk/rewrite pure functions against the captured fixture (`src/lite-full-conversion.spec.ts`).
Staging: enqueue a dry-run for a lite-stg-authored page copied to a dual-app test site, then a
real run; spot-check renders + page history + graph attachment. The `asApp` page-PUT and the
custom-content POST shape are the two remaining live-unverified steps and gate any production job.

## Events

Registered first (commit 1): `macro_convert_job_enqueued / job_claimed / page_succeeded /
page_failed / macro_skipped / job_completed`, properties `convert_*` in
`src/utils/analytics/types.ts`. Emitted by the backend report/claim handlers, not the browser.
