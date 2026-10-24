# Prepared Diagram Curation Portal — Implementation Plan

> **Execution rule:** implement this plan task by task with TDD. Use the repository's `validate-branch` pipeline before submitting, then `submit-branch`/`babysit-pr`/`land-pr`; use `release-app`, `pvt`, and `spot-check` only after merge. Do not combine this feature with an unrelated fix branch.

**Specs:**

- `docs/superpowers/specs/2026-08-12-prepared-diagram-curation-portal-design.md`
- `docs/superpowers/specs/2026-08-12-prepared-diagram-byline-copy-design.md`

**Goal:** let an allowlisted internal reviewer select a Diagramly page by client domain and page ID, generate one useful Mermaid diagram from the relevant part of that page, review/edit it, and publish a version-consistent prepared-diagram byline. Any later page update hides the byline immediately and produces a new candidate that still requires human approval.

**Architecture:** a dedicated `ops.zenuml.com` Cloudflare Worker serves a Vue SPA, validates Cloudflare Access JWTs, owns the review API, consumes generation jobs from Cloudflare Queues, and binds to the shared product D1 plus a dedicated curation R2 bucket. Existing Pages backends produce invalidation jobs. Existing Forge remotes provide installation-scoped app-system token leases through a new hourly scheduled trigger. Confluence remains the source of truth for page bodies; D1 stores candidates, immutable revisions, publication state, and the existing compatibility read model.

**Pilot boundary:** the UI and publish API accept Diagramly targets only. The schema, services, and token leases remain product-neutral for later Lite/Full enablement. AsyncAPI is explicitly excluded from the heartbeat, curation queue, and byline.

**Validated platform facts:**

- [Cloudflare Pages Functions support Queue producer bindings but not Queue consumers](https://developers.cloudflare.com/pages/functions/bindings/#queue-producers); the standalone ops Worker must implement the consumer.
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/) can serve the SPA from the same Worker while running the Worker first for every request, allowing origin auth and no-store/security headers on the SPA as well as the API.
- [Cloudflare Access origins should validate `Cf-Access-Jwt-Assertion`](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) against the team JWKS, issuer, and application audience.
- [Forge remote scheduled triggers](https://developer.atlassian.com/platform/forge/remote/scheduled-triggers/) can reuse an existing endpoint and receive `x-forge-oauth-system`; an hourly interval is within the token's guaranteed remaining lifetime.
- [Forge `contentBylineItem.contentPropertyKey`](https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-content-byline-item/#content-properties-to-store-byline-properties) reads `title` and `tooltip` from a content property on initial render. The existing icon can remain static.

---

## Delivery and branch setup

The implementation is larger than the current has-content removal. After the **has-content removal PR #466** lands, create a fresh worktree from updated `main`:

```bash
git fetch origin
git worktree add ../conf-app-prepared-diagram-curation \
  -b feat/prepared-diagram-curation origin/main
```

Before changing code:

```bash
cd ../conf-app-prepared-diagram-curation
git status --short --branch
pnpm install --frozen-lockfile
```

Expected: a clean feature branch. Do not copy uncommitted files from another worktree.

The first code commit must be Task 1's analytics contract, per repository policy.

---

## Target file map

### New shared backend modules

- `functions/curation/constants.ts` — property key, product mapping, closed state vocabularies
- `functions/curation/types.ts` — candidate/revision/publication/operation contracts
- `functions/curation/bylineCopy.ts` — short-title fallback and tooltip derivation
- `functions/curation/tokenLease.ts` — authenticated encryption, expiry, and lease persistence
- `functions/curation/confluenceClient.ts` — installation-scoped page/property reads and writes
- `functions/curation/repository.ts` — parameterized D1 access and state transitions
- `functions/curation/analytics.ts` — privacy-safe backend event builders
- `functions/curation/publication.ts` — publish/replace/rollback compensation state machine
- `functions/curation/invalidation.ts` — stale marking and regeneration enqueue
- `functions/curation/*.spec.ts` — unit tests beside each module
- `functions/migrations/0017_add_prepared_diagram_curation.sql` — **prepared-diagram curation schema migration 0017**

### New ops Worker and portal

- `workers/prepared-diagram-ops/package.json`
- `workers/prepared-diagram-ops/tsconfig.json`
- `workers/prepared-diagram-ops/vite.config.ts`
- `workers/prepared-diagram-ops/wrangler.toml`
- `workers/prepared-diagram-ops/src/index.ts` — fetch, queue, and scheduled handlers
- `workers/prepared-diagram-ops/src/env.ts` — binding and secret types
- `workers/prepared-diagram-ops/src/auth/access.ts` — Access JWT validation and roles
- `workers/prepared-diagram-ops/src/auth/csrf.ts` — strict-origin and signed double-submit token
- `workers/prepared-diagram-ops/src/api/router.ts` — route dispatch and response hardening
- `workers/prepared-diagram-ops/src/api/*.ts` — session, intake, candidates, review, publish APIs
- `workers/prepared-diagram-ops/src/generation/*.ts` — page text extraction, prompt, AI call, Mermaid validation
- `workers/prepared-diagram-ops/ui/index.html`
- `workers/prepared-diagram-ops/ui/main.ts`
- `workers/prepared-diagram-ops/ui/App.vue`
- `workers/prepared-diagram-ops/ui/api.ts`
- `workers/prepared-diagram-ops/ui/components/*.vue` — intake, queue, review panes, audit history
- `workers/prepared-diagram-ops/ui/styles.css`
- `workers/prepared-diagram-ops/**/*.spec.ts`

### Existing files to modify

- `src/utils/analytics/catalog.ts`
- `src/utils/analytics/types.ts`
- `src/utils/analytics/trackAnalyticsEvent.ts`
- `functions/service/analyticsTypes.ts`
- `functions/forge-user-behavior.ts`
- `functions/forge-user-behavior.spec.ts` — create if absent
- `functions/activation-prepared.ts`
- `functions/activation-prepared.spec.ts`
- `src/services/ActivationPrepared.ts`
- `src/services/ActivationPrepared.spec.ts`
- `src/components/Byline/BylineActivationDialog.vue`
- `src/components/Byline/BylineActivationDialog.spec.ts`
- `manifest.yml`
- `scripts/forge-wizard.mjs`
- `.github/workflows/staging-deploy.yml`
- `.github/workflows/release.yml`
- `.github/workflows/prepared-diagram-ops-deploy.yml`
- `wrangler-stg.toml`
- `wrangler-prod.toml`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tests/e2e-tests/helpers/bylineActivation.ts`
- `tests/e2e-tests/tests/insert/byline-activation.spec.ts`
- `docs/ops/prepared-diagram-curation.md`

---

## Task 1: Register the analytics contract — first feature commit

**Files:**

- Modify: `src/utils/analytics/catalog.ts`
- Modify: `src/utils/analytics/types.ts`
- Modify: `functions/service/analyticsTypes.ts`
- Modify: `src/utils/analytics/trackAnalyticsEvent.spec.ts`

- [ ] Add the seven approved events to `AnalyticsEventName`:

  - `curation_candidate_generation_requested`
  - `curation_candidate_generated`
  - `curation_candidate_generation_failed`
  - `curation_review_decided`
  - `curation_publish_succeeded`
  - `curation_publish_failed`
  - `curation_publication_staled`

- [ ] Add `curation` to `FeatureArea` and `ops_portal` to `Surface`; automated paths reuse existing `forge_trigger` and `scheduled_job` surfaces.
- [ ] Add typed properties with closed vocabularies where possible:

  - `curation_candidate_id`, `curation_revision_id`, `curation_operation_id`
  - `review_action`: `approve | replace | reject | rollback`
  - `generation_attempt`, `prompt_version`, `model_id`
  - `generation_latency_bucket`
  - `publish_failure_stage`
  - `source_change_reason`
  - `byline_topic`
  - `byline_label_variant`: `topic_diagram | explore_visually`
  - `byline_label_fallback_reason`: `missing_short_topic | too_long | invalid`
  - `label_length_bucket`: `1_15 | 16_23 | 24_30 | fallback`

- [ ] Document the privacy boundary beside the properties: `byline_topic` is the only raw topic text intentionally sent; page bodies, excerpts, Mermaid source, page titles, hostnames, tokens, Atlassian IDs, and raw errors are forbidden.
- [ ] Add the same seven names to the backend `CANONICAL_EVENT_NAME_LIST`; add a parity test that fails when the frontend union and backend runtime list drift for these events.
- [ ] Extend the analytics type-contract test so all new names compile and an invalid `review_action` does not.

Run:

```bash
pnpm test:unit -- trackAnalyticsEvent
```

Expected: PASS.

Commit this task by itself before any feature implementation:

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts \
  src/utils/analytics/trackAnalyticsEvent.spec.ts functions/service/analyticsTypes.ts
git commit -m "feat(analytics): register curation lifecycle events"
```

---

## Task 2: Add the curation schema and compatibility projection fields

**Files:**

- Create: `functions/migrations/0017_add_prepared_diagram_curation.sql`
- Create: `functions/curation/types.ts`
- Create: `functions/curation/repository.ts`
- Create: `functions/curation/repository.spec.ts`

- [ ] Write repository tests first for installation-scoped reads, candidate transitions, immutable revisions, one active publication per installation/page, and operation-id idempotency.
- [ ] Add these tables with foreign-key-like identity columns and indexes:

  - `CurationCandidate`
  - `PreparedDiagramRevision`
  - `PreparedDiagramPublication`
  - `PreparedDiagramOperation` — durable step journal and compensation inputs
  - `CurationGenerationDispatch` — transactional outbox for Queue delivery/retry
  - `CurationAuditLog`
  - `ForgeTokenLease`

- [ ] Use `CHECK` constraints for candidate/publication/action states and integer booleans.
- [ ] Keep property payload/version snapshots in `PreparedDiagramOperation` as JSON text; reserve R2 for page bodies/excerpts. Cap and schema-validate these snapshots before insert.
- [ ] Scope candidate, revision, publication, and operation uniqueness by `installationId`, `cloudId`, `pageId`, `appId`, and environment as applicable. Never use page ID alone.
- [ ] Add these compatibility fields to `PreparedDiagram`: `revisionId`, `sourcePageVersion`, `fullTopic`, `shortTopic`, `bylineTitle`, and `bylineTooltip`.
- [ ] Keep `PreparedDiagram` as the only customer-read projection; do not make the activation UI join the new tables.
- [ ] Ensure audit rows contain structured before/after metadata but no body, excerpt, or diagram-source duplication.

Apply and inspect locally:

```bash
pnpm db:migrate:local
pnpm exec wrangler d1 execute conf-zenuml-dev --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%Curation%' OR name LIKE 'PreparedDiagram%' OR name='ForgeTokenLease' ORDER BY name"
pnpm test:unit -- functions/curation/repository
```

Expected: migration succeeds; all new tables appear; repository tests PASS.

Commit:

```bash
git add functions/migrations/0017_add_prepared_diagram_curation.sql functions/curation
git commit -m "feat(curation): add candidate and publication schema"
```

---

## Task 3: Implement copy, validation, and privacy-safe analytics builders

**Files:**

- Create: `functions/curation/constants.ts`
- Create: `functions/curation/bylineCopy.ts`
- Create: `functions/curation/bylineCopy.spec.ts`
- Create: `functions/curation/analytics.ts`
- Create: `functions/curation/analytics.spec.ts`
- Create: `workers/prepared-diagram-ops/src/generation/mermaidValidator.ts`
- Create: `workers/prepared-diagram-ops/src/generation/mermaidValidator.spec.ts`

- [ ] Write table-driven tests for `{short topic} diagram` at 29/30/31 Unicode code points, emoji/code-point counting, blank/invalid topics, and the exact `Explore visually` fallback.
- [ ] Test the tooltip is always `Understand {full topic} at a glance`, uses the full topic, and is never derived from the fallback label.
- [ ] Centralize the property key `zenuml-prepared-diagram`, **prepared-property schema v2**, Diagramly app mapping, and state vocabularies.
- [ ] Build analytics payloads from explicit allowlists. Test that page title, client domain, excerpt, page body, Mermaid source, token, and raw error keys cannot enter the payload.
- [ ] Deliver backend lifecycle events through the existing idempotent `mixpanelImportServiceEvents` path, using installation ID as `distinct_id` and a deterministic operation/transition-based `$insert_id`. Retries must not double-count.
- [ ] Validate Mermaid source using the same **Mermaid renderer 11.6.0** package currently used by the product. Add one valid and several invalid flowchart tests.
- [ ] Add a Worker-runtime parser smoke-test module that invokes the validator in a Worker-compatible harness during CI and staging verification; it must parse a fixed valid flowchart and reject a fixed invalid one. Do not expose a diagnostic HTTP endpoint. This catches DOM/runtime incompatibility that Node unit tests cannot prove.
- [ ] Run `wrangler deploy --dry-run --env stg` for the ops Worker as soon as its shell exists in Task 4. If the renderer cannot execute under Workers, add the renderer's parser package as a direct dependency and keep the product/worker compatibility test; do not replace validation with a regex.

Run:

```bash
pnpm test:unit -- bylineCopy analytics mermaidValidator
```

Expected: PASS.

Commit:

```bash
git add functions/curation workers/prepared-diagram-ops/src/generation
git commit -m "feat(curation): validate topics diagrams and telemetry"
```

---

## Task 4: Scaffold the authenticated ops Worker and SPA shell

**Files:**

- Create: `workers/prepared-diagram-ops/package.json`
- Create: `workers/prepared-diagram-ops/tsconfig.json`
- Create: `workers/prepared-diagram-ops/vite.config.ts`
- Create: `workers/prepared-diagram-ops/wrangler.toml`
- Create: `workers/prepared-diagram-ops/src/env.ts`
- Create: `workers/prepared-diagram-ops/src/index.ts`
- Create: `workers/prepared-diagram-ops/src/api/router.ts`
- Create: `workers/prepared-diagram-ops/src/auth/access.ts`
- Create: `workers/prepared-diagram-ops/src/auth/access.spec.ts`
- Create: `workers/prepared-diagram-ops/src/auth/csrf.ts`
- Create: `workers/prepared-diagram-ops/src/auth/csrf.spec.ts`
- Create: `workers/prepared-diagram-ops/ui/index.html`
- Create: `workers/prepared-diagram-ops/ui/main.ts`
- Create: `workers/prepared-diagram-ops/ui/App.vue`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

- [ ] Configure separate staging and production Worker names, shared product D1 binding, existing page-snapshot bucket as `SOURCE_SNAPSHOT_BUCKET`, dedicated `CURATION_BUCKET`, `CURATION_QUEUE` producer/consumer, Workers AI binding, and SPA assets. Curation code may only `head/get` from `SOURCE_SNAPSHOT_BUCKET`; it never writes or changes lifecycle there.
- [ ] The ops Worker is the Queue consumer, but product Pages Functions are also Queue producers for invalidation. Add the same environment-specific Queue names to `wrangler-stg.toml` and `wrangler-prod.toml` in Task 11; keep staging and production queues/buckets fully separate.
- [ ] Configure the Worker to run first for every request, authenticate before `env.ASSETS.fetch()`, add no-store/security headers to static responses, and serve the SPA for navigation fallback. This is a low-volume internal portal, so the extra Worker invocations are intentional.
- [ ] Add `jose`, Vue, Vite, Mermaid, and Cloudflare Worker types as explicit workspace dependencies rather than depending on accidental root resolution.
- [ ] Validate `Cf-Access-Jwt-Assertion` using remote JWKS, exact issuer, exact audience, expiry, and algorithm. Derive reviewer email only from the verified JWT.
- [ ] Apply an origin-side reviewer allowlist even though Access also has one. Normalize emails case-insensitively; default deny on missing config.
- [ ] Accept only human reviewer JWTs on HTTP routes. Deny Access service credentials at both edge policy and origin. Automated invalidation/generation enters through the bound Cloudflare Queue, not a browser/API credential, so it can never call approve, reject, replace, or rollback routes.
- [ ] Use a server-generated signed double-submit CSRF token: HttpOnly/Secure/SameSite=Strict cookie plus an in-memory client token from `/api/session`. Require exact allowed `Origin` and `X-CSRF-Token` for mutations.
- [ ] Add `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, a restrictive CSP, and frame denial to every API and SPA response.
- [ ] Never store auth/customer data in localStorage or sessionStorage. Add a source test that fails if either token appears under `workers/prepared-diagram-ops/ui`.
- [ ] Provide `/api/health` with binding/config presence only; never echo secrets or identifiers.

Run:

```bash
pnpm install --lockfile-only
pnpm test:unit -- workers/prepared-diagram-ops/src/auth
pnpm --filter prepared-diagram-ops build
pnpm --filter prepared-diagram-ops exec wrangler deploy --dry-run --env stg
```

Expected: tests PASS, SPA builds, Worker bundles with all required bindings.

Commit:

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml workers/prepared-diagram-ops
git commit -m "feat(curation): scaffold protected ops portal"
```

---

## Task 5: Capture encrypted app-system token leases through the existing Forge endpoint

**Files:**

- Create: `functions/curation/tokenLease.ts`
- Create: `functions/curation/tokenLease.spec.ts`
- Modify: `functions/forge-user-behavior.ts`
- Create/modify: `functions/forge-user-behavior.spec.ts`
- Modify: `manifest.yml`
- Modify: `scripts/forge-wizard.mjs`
- Modify: `manifest.spec.ts`
- Modify: `tests/unit/forgeWizard.spec.ts`
- Modify: `.github/workflows/staging-deploy.yml`
- Modify: `.github/workflows/release.yml`

- [ ] Test AES-GCM round-trip, random IVs, tamper rejection, wrong-key rejection, expiry rejection, and key-ID rotation.
- [ ] Test heartbeat recognition by the exact scheduled module key `prepared-diagram-token-heartbeat`; an ordinary page-update event must continue through the current analytics path.
- [ ] After validating the Forge invocation token, read `x-forge-oauth-system`, decode only its `exp` claim, encrypt the opaque token, and upsert a lease keyed by installation identity.
- [ ] Persist only verified FIT fields: installation ID, app ID, environment, cloud ID, API base URL, encrypted token, key ID, expiry, and last seen. Never accept identity fields from the request body.
- [ ] Do not log the header, ciphertext, plaintext, or raw JWT claims.
- [ ] Add an hourly scheduled trigger pointing to existing `remote-page-behavior-endpoint`. Do not add or modify an endpoint entry.
- [ ] Ensure Lite, Full, and Diagramly builds retain the heartbeat. Update all three independent manifest-rewrite locations so AsyncAPI strips it.
- [ ] Extend `manifest.spec.ts` and `tests/unit/forgeWizard.spec.ts` to prove exactly that variant matrix and prevent the wizard/CI rewrite copies from drifting.
- [ ] Record and inspect actual `forge deploy` output in staging to confirm whether the new scheduled trigger is a minor auto-upgrade. If deploy reports otherwise, stop before any production release and update the release plan; do not infer classification from memory.

Run:

```bash
pnpm test:unit -- tokenLease forge-user-behavior manifest forgeWizard
pnpm build:lite
pnpm build:full
pnpm build:diagramly
```

The unit tests assert wizard-level variant edits. During staging CI, also inspect the generated manifest artifacts and assert the same matrix with `yq` so the two workflow copies are exercised rather than merely read.

Commit:

```bash
git add functions/curation/tokenLease.* functions/forge-user-behavior* \
  manifest.yml manifest.spec.ts scripts/forge-wizard.mjs tests/unit/forgeWizard.spec.ts \
  .github/workflows/staging-deploy.yml .github/workflows/release.yml
git commit -m "feat(curation): refresh installation token leases"
```

---

## Task 6: Implement two-step page intake

**Files:**

- Create: `functions/curation/confluenceClient.ts`
- Create: `functions/curation/confluenceClient.spec.ts`
- Create: `workers/prepared-diagram-ops/src/api/intake.ts`
- Create: `workers/prepared-diagram-ops/src/api/intake.spec.ts`
- Create: `workers/prepared-diagram-ops/ui/api.ts`
- Create: `workers/prepared-diagram-ops/ui/components/PageIntake.vue`
- Create: `workers/prepared-diagram-ops/ui/components/PageIntake.spec.ts`

- [ ] Test domain normalization for a bare subdomain and `atlassian.net` hostname; reject protocols, paths, ports, Unicode lookalikes, and non-Atlassian hosts.
- [ ] Require ASCII-digit page IDs and an exact target installation.
- [ ] Resolve domain through `AtlassianInstance`, join eligible `ForgeInstallation` rows, and map product by app ID through one shared function.
- [ ] Keep the service product-neutral, then filter API/UI results to Diagramly for the pilot. Return no Lite/Full target from pilot routes; reject AsyncAPI at both service and API boundaries.
- [ ] Decrypt a non-expired installation lease, call the Confluence API v2 page endpoint `${apiBaseUrl}/api/v2/pages/{pageId}?body-format=storage`, and verify returned page ID/version.
- [ ] Return only confirmation data to the browser: normalized domain, page ID, title, current version, target product, and an opaque intake token signed over installation/page/version.
- [ ] Do not persist the page body during resolve and do not put the lease/token in the response.
- [ ] Require the signed intake token plus explicit confirmation before candidate generation. Reject changed domain/page/product fields.
- [ ] Render the convenience page URL in the browser from confirmed domain and page ID; do not persist the full URL.

Run:

```bash
pnpm test:unit -- confluenceClient intake PageIntake
```

Expected: PASS, including cross-tenant and expired-lease failures.

Commit:

```bash
git add functions/curation/confluenceClient* workers/prepared-diagram-ops/src/api/intake* \
  workers/prepared-diagram-ops/ui
git commit -m "feat(curation): resolve and confirm target pages"
```

---

## Task 7: Generate candidates through Cloudflare Queues

**Files:**

- Create: `workers/prepared-diagram-ops/src/generation/pageText.ts`
- Create: `workers/prepared-diagram-ops/src/generation/pageText.spec.ts`
- Create: `workers/prepared-diagram-ops/src/generation/prompt.ts`
- Create: `workers/prepared-diagram-ops/src/generation/prompt.spec.ts`
- Create: `workers/prepared-diagram-ops/src/generation/generateCandidate.ts`
- Create: `workers/prepared-diagram-ops/src/generation/generateCandidate.spec.ts`
- Create: `workers/prepared-diagram-ops/src/api/candidates.ts`
- Create: `workers/prepared-diagram-ops/src/api/candidates.spec.ts`
- Modify: `workers/prepared-diagram-ops/src/index.ts`
- Modify: `workers/prepared-diagram-ops/wrangler.toml`

- [ ] Convert Confluence storage HTML into bounded structured plain text while preserving headings, lists, tables, and ordered steps. Strip scripts/styles/macros not needed for understanding.
- [ ] Test size limits, nested tables/lists, malformed HTML, and absence of page chrome.
- [ ] On confirmed manual generation, read the confirmed current page through the installation lease, store its temporary body in `CURATION_BUCKET`, then create one `queued` candidate plus pending `CurationGenerationDispatch` in a D1 transaction. Send `{candidateId, attemptNumber, objectKey}` and mark dispatched only after Queue acknowledges it.
- [ ] A failed Queue send leaves the dispatch pending; scheduled maintenance retries it with the same candidate/attempt. A crash after send but before the dispatched mark is harmless because the consumer is idempotent.
- [ ] Make enqueue idempotent by operation ID; repeated browser submits return the original candidate.
- [ ] Prompt for one useful subset rather than whole-page coverage. Require the schema fields `relevantExcerpt`, `fullTopic`, `shortTopic`, `diagramType`, and `diagramSource`.
- [ ] Keep model ID in deployment config and prompt version in code. Persist both with attempt and source page version.
- [ ] Validate output schema, topics, and Mermaid. Allow one repair call containing only the bounded parser error and original generated source; never send a second full page copy unnecessarily.
- [ ] Transition `queued → generating → pending_review` or `generation_failed` with closed failure stages. Retries with the same candidate/attempt are no-ops after terminal success.
- [ ] Delete the temporary full body in `finally` after success or terminal failure. If deletion fails, record an opaque cleanup failure for the scheduled retention job.
- [ ] Store the relevant excerpt in R2, not D1, and emit only privacy-safe analytics.

Run:

```bash
pnpm test:unit -- pageText prompt generateCandidate candidates
pnpm --filter prepared-diagram-ops exec wrangler deploy --dry-run --env stg
```

Expected: PASS; queue handler and bindings appear in dry-run output.

Commit:

```bash
git add workers/prepared-diagram-ops
git commit -m "feat(curation): generate review candidates via queue"
```

---

## Task 8: Build the human review API and three-pane UI

**Files:**

- Create: `workers/prepared-diagram-ops/src/api/review.ts`
- Create: `workers/prepared-diagram-ops/src/api/review.spec.ts`
- Create: `workers/prepared-diagram-ops/ui/components/ReviewQueue.vue`
- Create: `workers/prepared-diagram-ops/ui/components/CandidateReview.vue`
- Create: `workers/prepared-diagram-ops/ui/components/MermaidEditor.vue`
- Create: `workers/prepared-diagram-ops/ui/components/MermaidPreview.vue`
- Create: `workers/prepared-diagram-ops/ui/components/BylinePreview.vue`
- Create: `workers/prepared-diagram-ops/ui/components/AuditHistory.vue`
- Add colocated component specs

- [ ] List pending work with priority `publish_failed`, invalidation replacement, then oldest pending review. Support tenant/product/state/reviewer filters without exposing tokens.
- [ ] Fetch excerpt only for an authenticated candidate detail request; return `410 excerpt_expired` after retention cleanup.
- [ ] Show coordinated source excerpt, editable Mermaid/topics, rendered preview, byline label, and tooltip.
- [ ] Keep the full topic visible in the tooltip preview even when the label falls back to `Explore visually`.
- [ ] Revalidate every edit on the server. Invalid Mermaid or topics cannot enter an approvable state.
- [ ] Implement Generate alternative, Regenerate, and Reject with required reason. Each mutation has an operation ID and append-only audit row.
- [ ] `Generate alternative` creates a new candidate for the same confirmed installation/page/version; it does not overwrite the current candidate.
- [ ] UI copy must distinguish signals: generated, awaiting review, approved, published, failed, stale. Never describe “generated” as “published.”
- [ ] Add keyboard and narrow-width behavior so the three panes remain usable on a laptop without hiding approval state.

Run:

```bash
pnpm test:unit -- review ReviewQueue CandidateReview MermaidEditor MermaidPreview BylinePreview
pnpm --filter prepared-diagram-ops build
```

Expected: PASS and production SPA build succeeds.

Commit:

```bash
git add workers/prepared-diagram-ops
git commit -m "feat(curation): add candidate review workspace"
```

---

## Task 9: Implement compensated publish, replace, and rollback

**Files:**

- Create: `functions/curation/publication.ts`
- Create: `functions/curation/publication.spec.ts`
- Modify: `functions/curation/repository.ts`
- Modify: `functions/curation/confluenceClient.ts`
- Create: `workers/prepared-diagram-ops/src/api/publication.ts`
- Create: `workers/prepared-diagram-ops/src/api/publication.spec.ts`

- [ ] Build failure-injection tests for every numbered transition: version read, revision insert, old-property delete, D1 pointer switch, new-property create, final mark/audit, and each compensation action.
- [ ] Before approval, re-read the page. A changed version transitions to `source_changed`, emits the stale/source-change event, enqueues a replacement candidate, and refuses force-publish.
- [ ] Revalidate Mermaid/topics and authenticated reviewer immediately before the write.
- [ ] Insert an immutable revision and a durable `PreparedDiagramOperation` journal containing previous revision ID, exact previous property JSON/version, and current step.
- [ ] For replacement, delete the old property before switching the compatibility row. For first publish, assert no property exists.
- [ ] In one D1 transaction, switch `PreparedDiagramPublication.activeRevisionId` and project the exact revision into `PreparedDiagram`.
- [ ] Create the **prepared-property schema v2** value with title, tooltip, revision ID, and source page version.
- [ ] Mark published and append the audit event only after Confluence acknowledges the property.
- [ ] On failure after the old property is removed, restore both the exact previous D1 projection/pointer and exact property value. A failed first publish must leave no property.
- [ ] Reconciliation by operation ID compares the revision ID in D1 with the property revision ID before taking action. It may safely complete or compensate; it must never blindly replay.
- [ ] Treat more than one property with the prepared key as a consistency fault. Do not choose an arbitrary row: block publication, surface a repair action in the portal, and test that no D1 pointer changes. The repair action must retain the property matching the active revision or remove all properties when there is no active revision.
- [ ] Add a post-write version fence before marking published: after creating the new property, re-read the page version. If it changed during publication, delete the newly created property, transition the candidate to `source_changed`, leave the prior publication stale with no visible property, and enqueue the current version. Do not compensate by restoring a now-stale property.
- [ ] If no valid lease exists, persist `awaiting_publish`. A later heartbeat schedules reconciliation; it does not create a second approval or bypass reviewer identity.
- [ ] After a successful heartbeat upsert, query only awaiting operations for that exact installation and enqueue/reconcile them idempotently. A heartbeat for one installation must never wake another installation's work.
- [ ] Rollback creates a new immutable revision that copies the selected historical source/topics and records `review_action=rollback`; never reactivate a historical row in place.
- [ ] Emit success/failure events with stage and opaque internal IDs, never raw Confluence errors.

Run:

```bash
pnpm test:unit -- publication
```

Expected: PASS, including all compensation and idempotency cases.

Commit:

```bash
git add functions/curation workers/prepared-diagram-ops/src/api/publication*
git commit -m "feat(curation): publish prepared revisions safely"
```

---

## Task 10: Wire dynamic byline copy and real-topic customer analytics

**Files:**

- Modify: `manifest.yml`
- Modify: `functions/activation-prepared.ts`
- Modify: `functions/activation-prepared.spec.ts`
- Modify: `src/services/ActivationPrepared.ts`
- Modify: `src/services/ActivationPrepared.spec.ts`
- Modify: `src/components/Byline/BylineActivationDialog.vue`
- Modify: `src/components/Byline/BylineActivationDialog.spec.ts`
- Modify: `src/utils/analytics/trackAnalyticsEvent.ts`
- Modify: `src/utils/analytics/trackAnalyticsEvent.spec.ts`
- Modify: `tests/e2e-tests/helpers/bylineActivation.ts`
- Modify: `tests/e2e-tests/tests/insert/byline-activation.spec.ts`

- [ ] Add `contentPropertyKey: zenuml-prepared-diagram` to `zenuml-byline-newuser`; retain `entityPropertyExists`, the static purple icon, and safe static fallback title/tooltip. Do not add `dynamicProperties`.
- [ ] Extend the activation read projection with `revisionId`, `fullTopic`, `shortTopic`, `bylineTitle`, `bylineTooltip`, and `sourcePageVersion`.
- [ ] Keep cloud/app identity derived only from verified Forge context. Preserve 404 miss behavior.
- [ ] Remove the legacy browser-callable POST write from `/activation-prepared` (return 405 and delete its client/service assumptions). The ops publication state machine becomes the only writer; an end user must not bypass immutable review by calling the compatibility endpoint.
- [ ] Send the actual `fullTopic` as `byline_topic` on `activation_served`; do not send label/fallback text in its place.
- [ ] Add an explicit analytics enrichment policy for `activation_served` that omits `client_domain`. Test the final object passed to Mixpanel, not only the caller properties; the shared tracker currently auto-adds tenant hostname, which would violate the approved privacy boundary unless deliberately suppressed.
- [ ] The same event-specific policy omits ambient tenant/content identifiers (`confluence_space`, `macro_uuid`, `page_id`, `content_id`, `custom_content_id`, and `attachment_name`) so the raw topic is not coupled to a particular customer page in Mixpanel.
- [ ] Send `byline_label_variant`, `byline_label_fallback_reason`, and `label_length_bucket` from stored publication metadata. Do not re-derive them differently in the browser.
- [ ] Ensure no title, topic, or property is logged by the customer path.
- [ ] Update test helpers to seed the full **prepared-property schema v2**, including revision/source version.
- [ ] Add UI assertions for:

  - short topic label such as `Release process diagram`
  - long/invalid short topic fallback `Explore visually`
  - tooltip always containing the full topic
  - click opens the exact revision's Mermaid preview
  - no property means no byline

- [ ] Preserve one legacy `{v: 1}` staging control until the pre-release spot check establishes the real fallback behavior. Rewrite all pilot properties before production manifest deployment.

Run:

```bash
pnpm test:unit -- ActivationPrepared BylineActivationDialog activation-prepared
pnpm build:diagramly
```

Expected: PASS/build success. E2E is run only after staging deploy in Task 14.

Commit:

```bash
git add manifest.yml functions/activation-prepared* src/services/ActivationPrepared* \
  src/components/Byline/BylineActivationDialog* tests/e2e-tests/helpers/bylineActivation.ts \
  tests/e2e-tests/tests/insert/byline-activation.spec.ts \
  src/utils/analytics/trackAnalyticsEvent*
git commit -m "feat(byline): show approved topic-specific copy"
```

---

## Task 11: Invalidate on every page update and auto-generate for review

**Files:**

- Create: `functions/curation/invalidation.ts`
- Create: `functions/curation/invalidation.spec.ts`
- Modify: `functions/forge-user-behavior.ts`
- Modify/create: `functions/forge-user-behavior.spec.ts`
- Create: `workers/prepared-diagram-ops/src/generation/sourcePage.ts`
- Create: `workers/prepared-diagram-ops/src/generation/sourcePage.spec.ts`
- Modify: `wrangler-stg.toml`
- Modify: `wrangler-prod.toml`
- Modify: `workers/prepared-diagram-ops/wrangler.toml`

- [ ] Handle invalidation in the existing `remote-page-behavior-trigger`, whose verified FIT supplies exact app/installation/cloud identity and whose reused endpoint already receives `x-forge-oauth-system`. Do not add another trigger or route.
- [ ] On an ordinary `avi:confluence:updated:page` event, compare the event version to the installation-scoped D1 publication, read the current prepared property through the system token, and delete it when the event version exceeds `sourcePageVersion`. The function returns a non-success response when this critical path fails so Forge can redeliver; duplicate delivery remains safe.
- [ ] Never infer relevance: every page version update invalidates in the pilot.
- [ ] Before deleting the property, insert an idempotent invalidation operation journal keyed by installation/page/new-version. If deletion succeeds but D1 state transition or Queue send later fails, scheduled reconciliation must finish from this journal without needing another Confluence event.
- [ ] If the immediate property delete fails, mark `stale_hide_failed`; the backend/ops retry uses the installation lease. Never leave the publication marked fresh.
- [ ] The backend must compare the incoming page version against the D1 active publication even when the property is already absent. This recovers the case where the Forge function deleted the property but its first backend notification failed; a retry must still mark stale and enqueue exactly one replacement.
- [ ] For a stale active Diagramly publication, atomically mark the old publication stale and insert one pending `CurationGenerationDispatch`, then send it through the Pages `CURATION_QUEUE` producer binding. This handler must await the property-hide decision and D1 transaction before responding; it may use `waitUntil` only for the best-effort Queue send and non-critical analytics/archival work. Scheduled maintenance retries any pending dispatch.
- [ ] Keep the existing page-capture pipeline unchanged. The generation consumer first checks its exact-version `SOURCE_SNAPSHOT_BUCKET` snapshot key and verifies the payload version; a miss/stale snapshot falls back to an authenticated Confluence read through the lease. It copies the selected input into `CURATION_BUCKET` only for the generation attempt and never extends the general snapshot's retention.
- [ ] Ignore curation for AsyncAPI and, during the pilot, for Lite/Full. Still keep shared service code capable of accepting them once the rollout filter changes.
- [ ] Deduplicate duplicate Confluence events by installation/page/version. They may update `lastSeen`, but must not create duplicate candidates.
- [ ] Auto-generated replacements stop at `pending_review`. No update path can call approval/publish.
- [ ] Emit `curation_publication_staled` once per publication/source version and never treat it as proof that regeneration succeeded.

Run:

```bash
pnpm test:unit -- forge-user-behavior invalidation sourcePage
pnpm --filter prepared-diagram-ops exec wrangler deploy --dry-run --env stg
```

Expected: PASS; Pages configs show the Queue producer, and the ops Worker shows `SOURCE_SNAPSHOT_BUCKET`, dedicated curation R2, and Queue consumer bindings.

Commit:

```bash
git add functions/forge-user-behavior* functions/curation/invalidation* \
  workers/prepared-diagram-ops/src/generation/sourcePage* \
  workers/prepared-diagram-ops/wrangler.toml wrangler-stg.toml wrangler-prod.toml
git commit -m "feat(curation): stale prepared diagrams on page updates"
```

---

## Task 12: Add retention, reconciliation, kill switches, and audit controls

**Files:**

- Create: `workers/prepared-diagram-ops/src/maintenance.ts`
- Create: `workers/prepared-diagram-ops/src/maintenance.spec.ts`
- Modify: `workers/prepared-diagram-ops/src/index.ts`
- Modify: `workers/prepared-diagram-ops/wrangler.toml`
- Modify: `workers/prepared-diagram-ops/src/api/router.ts`

- [ ] Add scheduled maintenance that deletes expired token leases, terminal-job full-body leftovers, and excerpts 30 days after approval/rejection.
- [ ] Keep Mermaid source, topics, immutable revisions, decisions, and audit records long term.
- [ ] Add reconciliation for interrupted `publishing`, `awaiting_publish`, and `stale_hide_failed` operations using the durable operation journal.
- [ ] Retry pending `CurationGenerationDispatch` rows with bounded backoff; mark dispatched only after Queue acknowledgement and keep consumer idempotency as the second line of defense.
- [ ] Add server-side kill switches:

  - `CURATION_ENABLED` — deny new manual/automatic generation
  - `CURATION_PUBLISH_ENABLED` — deny new publish/replace/rollback
  - `CURATION_AUTO_REGENERATE_ENABLED` — continue hiding stale bylines but stop enqueueing replacements
  - `CURATION_ALLOWED_PRODUCTS` — `diagramly` in the pilot

- [ ] Defaults must fail closed. Turning off publish must not interrupt compensation/reconciliation needed to restore consistency.
- [ ] Redact request bodies and auth headers before Sentry/logging. Use opaque IDs plus closed stages.
- [ ] Add API pagination, bounded request bodies, method allowlists, and rate limits for generation mutations.
- [ ] Configure the curation R2 lifecycle as defense in depth, with application deletion remaining authoritative.

Run:

```bash
pnpm test:unit -- maintenance
pnpm --filter prepared-diagram-ops build
```

Expected: PASS/build success.

Commit:

```bash
git add workers/prepared-diagram-ops
git commit -m "feat(curation): add retention and recovery controls"
```

---

## Task 13: Add isolated deployment automation and operations runbook

**Files:**

- Create: `.github/workflows/prepared-diagram-ops-deploy.yml`
- Create: `docs/ops/prepared-diagram-curation.md`
- Modify: `workers/prepared-diagram-ops/wrangler.toml`

- [ ] Mirror the isolated `agent-link` Worker pattern: deploy only the staging ops Worker on changes under its Worker/shared curation paths; keep production human-gated.
- [ ] Build/test the portal before `wrangler deploy --env stg`.
- [ ] Document creation/configuration of:

  - `ops.zenuml.com` and staging hostname
  - Cloudflare Access human application with explicit named-user allowlist and four-hour session
  - required Cloudflare MFA policy
  - explicit deny for Access service credentials on the portal application
  - Access team domain and audience variables
  - reviewer allowlist
  - D1, `CURATION_BUCKET`, and `CURATION_QUEUE` bindings
  - Workers AI model binding
  - Mixpanel token
  - CSRF signing secret
  - token-encryption key ring/current key ID

- [ ] Document key rotation: add new decrypt key, switch current encrypt key, wait beyond maximum token TTL, remove old key.
- [ ] Create staging and production Queues/buckets explicitly and verify each binding resolves before application deploy. Record their non-customer-sensitive resource names in the runbook; keep IDs and secrets out of the public repo when they reveal account details.
- [ ] Document emergency actions for each kill switch, stuck operation reconciliation, stale-hide retry, and Access removal.
- [ ] Document deployment order:

  1. apply **prepared-diagram curation schema migration 0017** to staging;
  2. deploy ops Worker and verify auth/bindings plus the parser smoke test;
  3. deploy Pages backend producer/invalidation changes;
  4. deploy Diagramly staging Forge manifest and confirm token heartbeat;
  5. publish and test one staging candidate;
  6. rewrite legacy pilot properties;
  7. only then enable the byline `contentPropertyKey` in production release.

- [ ] Document production rollback order: disable generation/publish, let compensation finish, remove/hide prepared properties if required, roll back manifest/backend, then roll back Worker. Do not delete immutable revisions during rollback.

Run:

```bash
pnpm --filter prepared-diagram-ops build
pnpm --filter prepared-diagram-ops exec wrangler deploy --dry-run --env stg
git diff --check
```

Expected: build/dry-run PASS; no whitespace errors.

Commit:

```bash
git add .github/workflows/prepared-diagram-ops-deploy.yml \
  docs/ops/prepared-diagram-curation.md workers/prepared-diagram-ops/wrangler.toml
git commit -m "chore(curation): add deployment and operations runbook"
```

---

## Task 14: Validate locally, deploy to staging, and gather UI evidence

### Local validation

- [ ] Run the branch validation skill/pipeline.
- [ ] At minimum run:

```bash
pnpm test:unit
pnpm lint
pnpm build:lite
pnpm build:full
pnpm build:diagramly
pnpm build:asyncapi
pnpm --filter prepared-diagram-ops build
pnpm --filter prepared-diagram-ops exec wrangler deploy --dry-run --env stg
git diff --check origin/main...HEAD
```

Expected: all PASS. The AsyncAPI build must contain neither the byline nor the heartbeat.

### Staging deployment

- [ ] Apply the staging D1 migration.
- [ ] Deploy the staging ops Worker, then Pages backend, then Diagramly staging Forge app.
- [ ] Save the Forge deploy output with its actual upgrade classification. Every reported app version in the release note must include its product/feature label.
- [ ] Confirm a heartbeat creates one non-expired Diagramly staging lease without exposing token material.
- [ ] Configure Access with two test identities: one allowlisted reviewer and one denied internal account. Verify the four-hour policy and MFA requirement from the Cloudflare configuration, not by assumption.

### PVT and spot-check scenarios

Use the repository's `pvt` and `spot-check` skills. UI claims require screenshots, snapshots, or network intercepts; unit tests are not UI evidence.

- [ ] Allowed reviewer can sign in; denied user cannot reach SPA/API.
- [ ] Intake accepts domain + page ID, then shows correct title/version/product before generation.
- [ ] One candidate reaches pending review and displays source excerpt, editor, Mermaid preview, byline label, and full-topic tooltip.
- [ ] Long/invalid short topic shows `Explore visually` while tooltip still contains the real full topic.
- [ ] Invalid Mermaid cannot be approved.
- [ ] Changed source version blocks approval and creates a replacement candidate; there is no force-publish control.
- [ ] Approval publishes D1 projection and property; the rendered Confluence byline opens the exact approved diagram.
- [ ] Inject failure after old-property deletion during replacement; verify exact old property/body are restored and the byline never shows new label with old diagram or vice versa.
- [ ] Remove/expire lease before approval; verify `awaiting_publish`, then verify next heartbeat resumes exactly once.
- [ ] Edit the page after publication; verify byline disappears, publication becomes stale, a replacement is generated, and nothing republishes without review.
- [ ] Verify rollback produces a new revision and restores the selected historical content/copy.
- [ ] Inspect Mixpanel: lifecycle events arrive, `activation_served` contains the real `byline_topic`, and prohibited fields are absent.
- [ ] Verify full-body R2 object deletion after generation and excerpt deletion through a shortened staging retention override.
- [ ] Keep a legacy `{v: 1}` property control and observe its actual rendering after `contentPropertyKey` is enabled; record PASS/FAIL/SKIPPED with UI evidence.

### Handoff gate

Do not mark ready for production until all acceptance scenarios pass or are explicitly marked SKIPPED with a concrete blocker. A green unit suite does not substitute for the Confluence byline UI checks.

Commit only test/runbook corrections discovered during staging; do not commit screenshots containing customer data to the public repository.

---

## Task 15: Submit, land, release Diagramly, and verify production

- [ ] Use `submit-branch`; include the approved specs, migration/deploy order, privacy boundary, actual Forge upgrade classification, and staging evidence in the PR.
- [ ] Use `babysit-pr`; ignore the expected duplicate cancelled push run and require the surviving pull-request run to succeed.
- [ ] Use `land-pr` only after review and all required checks pass.
- [ ] Apply production schema and deploy the production ops Worker/Pages backend before the Diagramly Forge release.
- [ ] Rewrite all existing pilot properties to **prepared-property schema v2** before enabling dynamic byline copy in production.
- [ ] Use `release-app diagramly`; report the Diagramly version together with the label “prepared-diagram curation and topic byline.”
- [ ] Run `pvt`, including the prior failure cases, then a production `spot-check` with real UI evidence.
- [ ] Watch error rate, queue backlog, `publish_failed`, `stale_hide_failed`, `activation_cache_miss`, and topic-bearing `activation_served` for the initial rollout window.
- [ ] Leave Lite/Full disabled in `CURATION_ALLOWED_PRODUCTS`; expanding them is a later explicit rollout decision, not part of this release.

---

## Definition of done

- The internal portal is protected twice: Cloudflare Access at the edge and JWT/allowlist/CSRF enforcement at origin.
- Diagramly intake resolves an installation-scoped page and requires confirmation of title/version/product.
- Generation is queued, idempotent, subset-oriented, schema-validated, and Mermaid-validated with one repair attempt.
- Review is mandatory; generation never publishes.
- Publication, replacement, and rollback are version-checked, immutable, idempotent, and compensated across D1 and Confluence.
- The byline uses topic-specific copy when short enough, `Explore visually` otherwise, and the full-topic tooltip always.
- Any page update hides the byline and generates only a pending-review replacement.
- Expired/missing token leases cannot cross installations and safely enter `awaiting_publish`.
- Full bodies and excerpts follow retention; diagrams/topics/audit evidence remain available.
- Mixpanel receives the real `byline_topic` and none of the prohibited content/token fields.
- Lite/Full are architecturally supported but disabled; AsyncAPI has neither heartbeat nor byline.
- Staging and production UI assertions are backed by screenshots, snapshots, or network evidence.
