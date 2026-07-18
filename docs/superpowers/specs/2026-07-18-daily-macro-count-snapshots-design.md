# Daily Macro Count Snapshots — Design

**Status:** Approved in-session on 2026-07-18; awaiting written-spec review

## Context

The current macro-count path is driven by whichever editor happens to open or
save in a space:

- `MacroMetrics.getMacroMetrics()` reads
  `metrics:${domain}:${productType}` from Cloudflare KV and falls back to a
  live current-space enumeration on a cache miss.
- The latency-critical fallback stops once it reaches the Lite paywall
  threshold, so it is intentionally not an exact inventory above the threshold.
- `MacroMetrics.reportMacroMetrics()` performs a full current-space enumeration
  after a save, then `/metrics-cache/update` reads the tenant-wide KV object,
  replaces one space, and writes the object back.
- The browser therefore decides when a count is refreshed, while concurrent
  browser read-modify-writes can overwrite one another. KV contains only the
  latest value and provides no evidence explaining a large jump.

This is the wrong ownership model for an entitlement input. A user can observe
a count jump even when the immediately preceding product action did not create
that many macros. A `macro_create_*` analytics event is a signal about an editor
flow, not the source of truth for current inventory. The inventory source of
truth is the set of current ZenUML custom-content records visible to the app in
Confluence.

The replacement is one complete daily inventory per enrolled Lite
installation. It produces immutable diagnostic snapshots in R2, publishes one
latest compatible object to KV, and emits compact backend analytics.

## Goals

- Produce an exact daily count for every space containing a registered ZenUML
  custom-content record.
- Keep the existing KV key and per-space field contract readable by current
  consumers.
- Make count changes diagnosable for 90 days without storing diagram bodies.
- Remove editor activity as a writer of the authoritative count for managed
  installations.
- Count by registered custom-content type, matching the existing frontend
  semantics, without scanning every Confluence page or page ADF.
- Fail atomically: never publish a partially scanned tenant to KV.
- Authenticate every Forge-to-Cloudflare write with a verified Forge
  Invocation Token (FIT).

## Non-goals

- Do not reconstruct inventory from Mixpanel macro-create events.
- Do not count macro placements by scanning page ADF.
- Do not deduplicate custom-content records that share a logical diagram ID;
  duplicate identity is diagnostic metadata, not a reason to change the count.
- Do not store diagram DSL, raw custom-content bodies, authors, or raw titles in
  R2 or Mixpanel.
- Do not change the Lite paywall threshold or grace-window behavior.
- Do not roll this job out to Full, Diagramly, or AsyncAPI in the first release.
- Do not make D1 the system of record for the snapshot or count.

## Approaches considered

### 1. Tenant-wide enumeration by custom-content type — selected

For each custom-content type registered by the Lite variant, enumerate
`GET /wiki/api/v2/custom-content?type=...&body-format=raw&limit=250`, follow the
cursor to completion, group results by `spaceId`, and then resolve only the
discovered space IDs to space keys. Confluence documents this endpoint as
returning all visible custom content for a type with cursor pagination.

This uses one scan per registered type rather than one scan per page or one scan
per space. It also discovers spaces that have content but are absent from the
current KV object.

### 2. Enumerate spaces, then enumerate custom content in every space

This preserves the current space endpoint but costs at least one request per
space per type, including empty spaces. A tenant with thousands of spaces would
pay for thousands of queries to discover that most contain no ZenUML content.

### 3. Enumerate pages and inspect page ADF

This would count placements rather than the custom-content records used by the
current entitlement model. It is also prohibitively expensive for large spaces
and introduces page-body privacy and parsing concerns. It is explicitly
rejected.

## Scope and enrollment

The scheduled module ships only in the Lite variant. Forge invokes it once per
installation per day, but the first remote call is a lightweight eligibility
and claim check. A tenant performs the heavy Confluence scan only when:

1. the validated FIT identifies the Lite app;
2. the validated tenant identity resolves to a client domain; and
3. that domain is enabled in the existing `CUSTOMER_SUCCESS_SERVICE` feature
   flag.

An unenrolled installation exits after the claim response. This still incurs
one small daily Forge invocation and Remote request per Lite installation; the
rollout is not zero-cost for unenrolled installations.

Managed mode becomes active only after a run has completed its R2 snapshot
uploads and begun the first KV commit. The R2 `latest.json` pointer is the mode
marker. Read and legacy-write endpoints require both current enrollment and the
pointer, so removing a domain from `CUSTOMER_SUCCESS_SERVICE` returns it to the
legacy behavior without a separate KV key.

## Architecture

### Forge scheduled orchestrator

A Lite-only `scheduledTrigger` calls a Forge function with `interval: day`. The
function declares `timeoutSeconds: 900`, the maximum supported for scheduled
functions. Enumeration stays in the Forge function because a scheduled trigger
that directly targets a Remote has a five-second Remote timeout and cannot own
the full scan.

The function has four responsibilities:

1. acquire an enrolled daily run claim from Cloudflare;
2. enumerate Confluence custom content and map space IDs to keys;
3. transform raw results into counts and privacy-safe diagnostic metadata;
4. upload bounded snapshot chunks and request one final commit.

Confluence calls use `api.asApp().requestConfluence()`. Cloudflare calls use
`invokeRemote('connect', ...)` from `@forge/api`; raw `api.fetch()` and a shared
secret are not used.

### Cloudflare snapshot service

The snapshot service lives below `/metrics-cache/snapshot/*`, so it is covered
by the existing `/metrics-cache` authentication prefix. The route family is
added to `public/_routes.json` and exposes four POST operations:

- `/metrics-cache/snapshot/claim`
- `/metrics-cache/snapshot/chunk`
- `/metrics-cache/snapshot/commit`
- `/metrics-cache/snapshot/fail`

The service validates the active run for every operation. It writes immutable
run objects to R2, writes one complete compatible KV value at commit, and emits
backend Mixpanel events after the KV write succeeds.

### Existing read and legacy-write service

The existing KV key remains authoritative for product reads. New clients use a
versioned response contract on `/metrics-cache/query?contract=2`:

```json
{
  "mode": "snapshot",
  "metrics": {
    "space": "EXAMPLE",
    "total": 120,
    "sequence": 70,
    "graph": 20,
    "openapi": 10,
    "mermaid": 10,
    "plantuml": 5,
    "unknown": 5,
    "isLite": true,
    "lastUpdated": "2026-07-18T00:00:00.000Z"
  }
}
```

`mode` is `snapshot` only when the installation is currently enrolled and has
an R2 latest pointer. In snapshot mode:

- `getMacroMetrics()` returns the cached result and never performs the
  current-space fallback, including on a KV miss;
- `reportMacroMetrics()` performs only the lightweight mode check and never
  enumerates or writes;
- `/metrics-cache/update` returns success with `ignored: "snapshot-managed"`
  and does not mutate KV.

Unmanaged installations retain the existing collect-and-write behavior. Old
frontends remain wire-compatible: the unversioned query returns the existing
bare per-space object, while their updates are harmlessly ignored once snapshot
mode is active. They may still perform a redundant browser scan during the
upgrade window, but cannot overwrite the snapshot-managed KV value.

Both versioned and unversioned handlers derive domain and product type from the
verified FIT. Legacy `domain` and `addonKey` parameters are compatibility hints
only: when present, they must agree with the authenticated identity and never
select a different tenant's key.

## Identity and FIT authentication

FIT is the only Forge-to-Cloudflare authentication mechanism for this feature.
Cloudflare must not trust `domain`, `cloudId`, `productType`, app ID, or
installation ID supplied in a request body or query parameter.

Before the snapshot endpoints are enabled, the shared FIT validator is
hardened to:

- verify the JWT signature with Atlassian's published JWKS;
- require issuer `forge/invocation-token`;
- require `aud` to match one of the configured full Forge app ARIs;
- require `app.id` to agree with the accepted audience and app allowlist;
- enforce expiry and not-before claims through `jose.jwtVerify()`;
- stop logging decoded tokens or complete verified payloads.

The normalized authenticated context exposes `appId`, `installationId`,
`apiBaseUrl`, environment, and `cloudId`. Backend-function `invokeRemote` calls
do not provide trustworthy identity through ordinary body context, so
`cloudId` is derived from the verified FIT installation context or the verified
`apiBaseUrl`. Cloudflare resolves the compatible client domain through the
existing `AtlassianInstance` / `ForgeInstallation` mapping. If identity or
domain resolution is incomplete, the request fails closed before R2, KV, or
Mixpanel is touched.

Any body identity field that is retained for debugging must match the verified
FIT identity or the request is rejected. OAuth headers are treated as opaque
and are never logged.

Atlassian's FIT verification contract is documented in
[Forge Remote essentials](https://developer.atlassian.com/platform/forge/remote/essentials/),
and backend function invocation is documented in
[Calling a Remote from a Forge function](https://developer.atlassian.com/platform/forge/remote/calling-from-function/).

## Scan and count semantics

### Content types

The function derives the fully qualified custom-content types from the Lite
variant configuration rather than duplicating string constants. The initial
Lite scan covers the sequence-family and graph custom-content types registered
by that variant. A future variant rollout must use that variant's own registered
types; unsupported types must never be queried.

### Pagination

Each type is paginated independently with `limit=250`. A page is transformed
and its raw bodies discarded before the next page is retained. Rate-limit and
transient-server responses use bounded exponential backoff, honor
`Retry-After`, and remain within the 900-second invocation budget.

The run is complete only when every type reaches the end of its cursor chain.
An absent or malformed next cursor, an API error, or a timeout makes the whole
run fail. No ceiling is used: the scheduled count is exact even when it is far
above the paywall threshold.

### Grouping and type counts

Every returned custom-content record contributes exactly one to `total`.
Parsing its raw body maps it to `sequence`, `graph`, `openapi`, `mermaid`, or
`plantuml`. A missing, invalid, or unmappable body contributes to `unknown` but
still contributes to `total`.

The invariant for each space is:

```text
total = sequence + graph + openapi + mermaid + plantuml + unknown
```

Records are not deduplicated by body ID, title, page, or logical hash. Their
status and logical hash are retained only to diagnose why the inventory
changed.

Every result must contain a usable `spaceId`. The function resolves only the
set of discovered IDs through batched `GET /wiki/api/v2/spaces?ids=...`
requests. If a discovered ID cannot be mapped to a key, the run fails rather
than silently dropping or misassigning content.

The Confluence V2 custom-content and space pagination contracts are documented
in the official
[Custom content API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-custom-content/)
and [Space API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/).

## R2 snapshot model

### Object layout

All objects use UTC dates and a versioned prefix:

```text
macro-count/v1/{productType}/{cloudId}/{YYYY}/{MM}/{DD}/claim.json
macro-count/v1/{productType}/{cloudId}/{YYYY}/{MM}/{DD}/{runId}/manifest.json
macro-count/v1/{productType}/{cloudId}/{YYYY}/{MM}/{DD}/{runId}/spaces-000001.json
macro-count/v1/{productType}/{cloudId}/{YYYY}/{MM}/{DD}/{runId}/{spaceId}.json
macro-count/v1/{productType}/{cloudId}/{YYYY}/{MM}/{DD}/{runId}/{spaceId}/contents-000001.json
macro-count/v1/{productType}/{cloudId}/latest.json
```

The top-level `{spaceId}.json` is the logical per-space snapshot. It holds the
summary and an ordered list of content-chunk keys. Content rows are uploaded in
chunks capped below 400 KiB so the Forge Remote request remains below the
platform's 500 KiB request-payload boundary. Small and large spaces therefore
use the same storage model. Compact per-space count rows are also uploaded as
bounded `spaces-*.json` chunks. `/commit` carries only the run ID, expected
counts, and hashes; it never risks exceeding the same boundary on a tenant with
thousands of spaces.

The snapshot service uses a dedicated `MACRO_COUNT_SNAPSHOT_BUCKET` binding.
The existing shared `EVENT_BUCKET` cannot satisfy this requirement because its
bucket-wide lifecycle rule expires objects after seven days. Separate staging
and production snapshot buckets receive a lifecycle rule that deletes only
`macro-count/v1/` objects after 90 days, without changing retention for
unrelated analytics objects.

### Run manifest

The run manifest records:

```text
schemaVersion, runId, capturedAt, state
appId, installationId, cloudId, productType
expectedTypes, completedTypes
spaceCount, contentCount, chunkCount
aggregateMetrics
spaceAggregateChunks[]
failureStage, failureReason
```

`state` is `running`, `snapshots_complete`, `committing`, `completed`, or
`failed`. Failure reasons are bounded enums; raw response bodies and exception
messages are not archived.

### Space manifest

Each `{spaceId}.json` contains:

```text
schemaVersion, runId, capturedAt
cloudId, productType
spaceId, spaceKey
metrics:
  total, sequence, graph, openapi, mermaid, plantuml, unknown
contentChunks[]:
  key, rowCount, sha256
```

Each content chunk contains only:

```text
contentId
pageId (nullable)
type
status
versionNumber (nullable)
versionCreatedAt (nullable)
diagramType
logicalIdHash
parseStatus
```

`type` is the fully qualified custom-content type. `parseStatus` is a bounded
value such as `parsed`, `missing_body`, `invalid_json`, or
`unknown_diagram_type`.

`logicalIdHash` is computed inside Forge as a tenant-scoped SHA-256 value over
`cloudId` and the best available logical identifier extracted from the body.
The raw identifier and title are discarded before upload. The hash is stable
within one tenant so repeated logical IDs can be diagnosed without enabling
cross-tenant correlation.

The snapshot never contains diagram DSL, the raw body, raw title, author ID,
user ID, or user email.

## Claiming, concurrency, and commit protocol

R2 provides strongly consistent reads/writes and conditional writes, so it is
used for daily claim coordination without adding a D1 lock table.

### Claim

1. `/claim` validates FIT, resolves identity, and checks enrollment.
2. For an enrolled installation, Cloudflare conditionally creates the day's
   `claim.json` and returns the server-generated `runId`.
3. A duplicate invocation observing `running` exits without scanning.
4. A duplicate observing `completed` also exits.
5. `failed` can be replaced by a same-day retry using an ETag compare-and-swap.
6. `running` can be replaced only after 30 minutes, safely beyond the
   function's 15-minute maximum.

Every subsequent chunk, fail, or commit request checks that its `runId` still
owns the claim. A late worker that was superseded cannot upload into or commit
the replacement run.

### Upload and commit

1. Forge uploads all content chunks and finalizes every space manifest.
2. Forge uploads bounded `spaces-*.json` aggregate chunks, then calls `/commit`
   with only their hashes and the expected space/content/chunk counts.
3. Cloudflare verifies the active claim, aggregate chunks, and finalized
   manifests, then moves the run manifest to `snapshots_complete`.
4. Cloudflare writes `latest.json` with state `committing`. From this point,
   legacy browser writes are ignored.
5. Cloudflare reads the previous KV object, builds the current full compatible
   object, and performs exactly one KV `put`.
6. Cloudflare marks `latest.json` and the run manifest `completed`.
7. Mixpanel delivery is attempted after KV success and does not roll back R2 or
   KV.

If KV succeeds but the response is lost, retrying the same commit rewrites the
same complete value. Mixpanel uses deterministic insert IDs derived from
`runId` and optional `spaceId`, so a retry is idempotent at the analytics layer.

The relevant R2 guarantees are documented in
[R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
and the
[R2 Worker API conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## KV compatibility and zeroing

The key remains exactly:

```text
metrics:${domain}:${productType}
```

The Lite value remains:

```json
{
  "domain": "example.atlassian.net",
  "spaces": {
    "EXAMPLE": {
      "space": "EXAMPLE",
      "total": 120,
      "sequence": 70,
      "graph": 20,
      "openapi": 10,
      "mermaid": 10,
      "plantuml": 5,
      "unknown": 5,
      "isLite": true,
      "lastUpdated": "2026-07-18T00:00:00.000Z"
    }
  }
}
```

No run metadata is added to the compatibility object. R2 holds run metadata.
The existing 365-day KV TTL is retained and refreshed on each successful
commit.

The new `spaces` map is the union of spaces found by the complete scan and
spaces in the previous KV object. A previously known space absent from the
complete scan is explicitly written with all counts set to zero and
`lastUpdated = capturedAt`. This prevents a removed final macro from leaving a
permanent stale positive count.

An empty but complete tenant scan is valid and publishes either an empty spaces
map or zeroed previous spaces. A partial or failed scan never reaches this
step.

## Analytics contract

The analytics vocabulary is the first implementation commit. Event names and
properties are registered in `src/utils/analytics/catalog.ts`,
`src/utils/analytics/types.ts`, and the backend analytics type registry before
the scheduled behavior is wired.

### `macro_count_snapshot_completed`

Fires once after a successful KV commit.

Key scalar properties:

- `feature_area: "macro_count"`
- `surface: "scheduled_job"`
- `run_id`, `captured_at`, `duration_ms`
- `product_type`, `environment`
- `space_count`, `content_count`, `changed_space_count`, `zeroed_space_count`
- `sequence_count`, `graph_count`, `openapi_count`, `mermaid_count`,
  `plantuml_count`, `unknown_count`
- `type_request_count`, `chunk_count`

### `macro_count_space_changed`

Fires only when a space first appears or one of its counts differs from the
previous KV value. It is not emitted for unchanged spaces.

Key scalar properties:

- `run_id`, `space_key`
- `change_reason: "new" | "changed" | "zeroed"`
- `previous_total`, `current_total`, `delta_total`
- previous/current scalar counts for every diagram-type bucket

### `macro_count_snapshot_failed`

Fires best-effort after a claimed run fails before KV publication.

Key scalar properties:

- `run_id`, `duration_ms`
- `failure_stage`, `failure_reason`
- `completed_type_count`, `last_completed_type`, `processed_contents`,
  `processed_spaces`, `chunk_count`

No event contains `contents[]`, page IDs, content IDs, logical hashes, raw
errors, or tenant page titles. Tenant-level events use the FIT installation ID
as the stable Mixpanel distinct ID rather than pretending that the job ran as a
user. `$insert_id` is deterministic per run/event/space.

If Cloudflare is unreachable, Forge records a bounded log entry but cannot
guarantee a Mixpanel failure event. Analytics is observability, not the commit
authority.

## Error handling

- **Not enrolled:** exit successfully after the claim check; no scan, R2
  snapshot, KV write, or Mixpanel event.
- **Identity unresolved:** reject before claim and log a bounded reason.
- **FIT invalid:** return 401; no side effects.
- **429/5xx from Confluence:** retry with bounded backoff and `Retry-After`.
- **Pagination, parse-container, or space-map failure:** mark the run failed;
  preserve the previous KV value.
- **Individual body parse failure:** count the record as `unknown`; this does
  not fail the run because the inventory record itself is valid.
- **Chunk or R2 failure:** stop uploads, mark the run failed, and do not commit.
- **KV failure:** leave the previous complete KV value in place and keep the
  run retryable/idempotent.
- **Mixpanel failure:** retain the completed R2/KV state and record a bounded
  backend warning.
- **Invocation timeout:** the 30-minute stale-claim rule allows a later retry;
  the timed-out run can never commit after it loses the claim.

Logs contain counts, stages, run IDs, and status codes only. They do not contain
FITs, OAuth tokens, raw Confluence response bodies, diagram bodies, titles, or
customer domains.

## Data residency and release versioning

The R2 rows contain customer-derived custom-content and page identifiers, so
this design treats the Remote as storing in-scope End-User Data. The `connect`
remote must accurately declare the `storage` operation and
`storage.inScopeEUD: true`; `compute` remains because backend
`invokeRemote()` requires it.

The existing Remote uses a global Cloudflare base URL rather than realm-specific
URLs. Atlassian documents that storing in-scope data on such a Remote affects
PINNED eligibility, and expanding an existing Remote's storage declaration may
produce a major Forge version requiring admin re-consent. This is a release
gate, not something to infer from the diff:

1. update the manifest declaration accurately;
2. deploy to staging and record Forge CLI's actual version classification;
3. if it is major, coordinate re-consent for the enrolled Lite tenants before
   expecting the scheduled module to reach them;
4. document the 90-day snapshot category and retention in the app's privacy and
   data-residency documentation.

The manifest contract is documented in Atlassian's
[Remotes reference](https://developer.atlassian.com/platform/forge/manifest-reference/remotes/)
and [Data residency guide](https://developer.atlassian.com/platform/forge/data-residency/).

## Verification

### Unit tests

- FIT validator accepts a correctly signed accepted audience and rejects
  missing, expired, wrong-issuer, wrong-audience, and wrong-app tokens.
- Authenticated identity ignores or rejects spoofed body `cloudId`, domain,
  product type, and installation ID.
- Eligibility permits only Lite plus `CUSTOMER_SUCCESS_SERVICE` enrollment.
- The scanner follows more than one 250-row page for every registered type.
- Multiple types and spaces group correctly and satisfy the count invariant.
- Missing/invalid bodies increment `unknown`; duplicate logical hashes do not
  reduce `total`.
- Only discovered space IDs are resolved, and unresolved IDs fail the run.
- Chunk serialization stays below its byte cap and contains no forbidden raw
  fields.
- R2 paths, manifests, hashes, and the 90-day-prefix lifecycle configuration
  are correct.
- Conditional claim creation rejects duplicates; failed and stale claims are
  taken over only through ETag compare-and-swap.
- A superseded run cannot upload or commit.
- A complete run performs one whole-object KV put with the existing key/value
  shape.
- Previous missing spaces are zeroed; a failed run leaves KV byte-for-byte
  unchanged.
- Snapshot-managed legacy updates return success without a KV write; unmanaged
  updates retain existing behavior.
- Contract-v2 reads never collect in snapshot mode, including a KV miss.
- Mixpanel events contain only approved scalar properties and deterministic
  insert IDs.

### Integration tests

Use mocked Confluence cursor responses plus local R2/KV/D1 bindings to cover:

- more than 250 records;
- multiple custom-content types;
- several spaces, including one absent from the prior KV;
- a previously cached space that now has zero records;
- a large space requiring multiple Remote chunks;
- a mid-run R2 failure and a retry after a lost commit response.

### Staging validation

1. Deploy the FIT validator and snapshot endpoints to staging.
2. Prove `@forge/api.invokeRemote()` from the scheduled function reaches the
   endpoint with a valid FIT; the existing page-capture shared-secret path is
   not evidence for this flow.
3. Enroll one internal Lite staging tenant and invoke one run.
4. Compare the snapshot totals with a direct fully paginated custom-content
   query for the same installation.
5. Inspect the R2 run/space manifests and verify no body, title, author, or
   token was stored.
6. Inspect the one compatible KV object, including a zeroed previous space.
7. Query Mixpanel for the completed and changed events and validate deterministic
   deduplication.
8. Exercise a forced chunk failure and prove the existing KV object is
   unchanged.
9. Open the Lite editor and capture UI/network evidence that contract-v2 reads
   the snapshot count without a browser enumeration or update call. If the
   Forge iframe cannot be driven, mark that UI assertion skipped with the
   blocker rather than passing it from unit evidence.

## Rollout

1. Land analytics vocabulary first on the feature branch.
2. Land FIT hardening and Cloudflare snapshot endpoints with snapshot-managed
   mode inactive until a valid first run reaches `committing`.
3. Land the Lite-only scheduled function and variant manifest changes.
4. Verify the staging Forge version classification and complete any required
   admin re-consent.
5. Run the staging validation above.
6. Enable one internal production domain already in
   `CUSTOMER_SUCCESS_SERVICE`; observe cost, duration, failures, R2, KV, and
   Mixpanel for at least two daily runs.
7. Expand only to the remaining Lite `CUSTOMER_SUCCESS_SERVICE` domains.
8. Keep Full, Diagramly, AsyncAPI, and non-enrolled Lite installations on the
   legacy path.

Stop expansion if any run publishes a partial count, a previous KV value is
lost after failure, FIT rejection rates rise unexpectedly, the 15-minute budget
is approached, or Forge/Cloudflare cost is materially higher than measured in
the internal canary.
