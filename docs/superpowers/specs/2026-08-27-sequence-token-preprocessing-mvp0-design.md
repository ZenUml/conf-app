# Sequence Token Preprocessing MVP-0 (pilot tenant scope)

**Date:** 2026-08-27
**Status:** Approved design (MVP-0 scope)

## Purpose and target

Create a backend-only pilot that converts one approved tenant’s active Mermaid sequence diagrams into
structured, service-level candidate data for future Enterprise Token workflows.

Only source preprocessing is in scope. No customer-facing Viewer, Editor, Catalog, or required manual user
actions are added in this phase.

## Scope and constraints

- **Tenant filter:** one pilot tenant alias `example-tenant` (actual identity tracked in private runtime config).
- **Diagram filter:** active current records with `raw.value.diagramType = 'mermaid'`.
- **Diagram family:** active non-empty `raw.value.mermaidCode` whose leading non-whitespace directive is
  `sequenceDiagram` after guarded `%%` preamble handling.
- **Workload:** prior aggregate = **117** active sequence candidates.
- **Pilot order:**
  1. sample **10** diagrams for calibration
  2. manual human comparison and acceptance check
  3. if accepted, process remaining **107**; no full batch run until calibration passes.

## Data handled

- Source authority remains **Confluence custom content**.
- D1 is rebuildable processing output and can be regenerated from CC source.
- Diagram text, page-level titles/keys, and tenant identifiers are never written to logs, analytics, or
  non-rebuildable output.

## Candidate extraction model

Use **GPT-5.3 Codex Spark** with a pinned prompt version for each run. For each eligible source,
emit candidates only for explicitly represented participants.

Include only:

- Service
- API
- External-service

Exclude:

- actors (`actor`), clients/UIs, workflow steps, data stores, database-like labels, generic modules, and inferred
  or merged candidates.

For each candidate emit:

- source identity
- source revision/version
- candidate label (exact or sanitized equivalent)
- candidate type (Service/API/External-service)
- observed role (one sentence)
- evidence line context
- extractor model and prompt version
- confidence bucket (high/medium/low)
- extraction status (`accepted`, `rejected`, `abstained`)

## Candidate payload contract

Persist one row per `(run, source, candidate)` with:

- `run_id` (ULID/UUID)
- `tenant_scope = example-tenant`
- `source_id` (Confluence/custom-content identity)
- `source_revision`
- `source_hash` (hash only, for idempotency)
- `source_family` (`sequenceDiagram`)
- `candidate_label`
- `candidate_type`
- `candidate_role`
- `evidence_snippet`
- `extractor_model`
- `extractor_prompt_version`
- `status` (`accepted` / `rejected` / `abstained`)
- `retry_of` (optional parent run id)
- `created_at`, `updated_at`

All fields are non-PII and scoped to the pilot tenant.

## Processing behavior

- deterministic ordering by `(source_id, source_revision, candidate_type, candidate_label)`
- idempotent reruns by `(source_hash, run_id)`; duplicate candidate keys upsert deterministically
- conservative abstention when no explicit candidate exists, source is invalid, or ambiguity is high
- source-level run status: `queued`, `running`, `succeeded`, `failed`, `partial`
- malformed/empty/invalid sources are recorded as failed run entries, not dropped

## Privacy and leakage controls

- Do not log or persist full diagram text.
- Do not emit candidate text in analytics events.
- Analytics (if any) records only aggregate counts (`eligible_count`, `sample_count`, `accepted_count`, `abstained_count`)
  and pilot-tenant marker only (`tenant_alias`).
- Restrict all storage keys and debug logs to the pilot tenant and run identifier.

## Rollout and quality gates (mandatory)

### Calibration phase (10 diagrams)

1. Run extraction on exactly 10 distinct sequence sources.
2. Human reviewers validate each output candidate.
3. Compute:
   - explicit candidate precision
   - false-positive count
   - abstention rate
   - critical data leakage incidents
4. Proceed only if:
   - precision ≥ 0.90
   - false positives = 0
   - ≥80% of non-empty candidates are explicit-service-level forms
   - zero leakage incidents

### Controlled full pilot (107 diagrams)

If calibration passes, run remaining 107 in one batch and produce only internal pilot tables.
If it fails, stop and refine prompt/model settings before re-running calibration.

## Test and acceptance requirements

- Unit/integration checks for:
  - sequence classifier gate (`sequenceDiagram` preamble)
  - non-empty source enforcement
  - tenant scope filtering
  - cross-tenant isolation (must be impossible by design)
  - deterministic idempotent upsert
- Manual QA artifact:
  - side-by-side calibration sheet (extractor output vs human labels)
  - documented acceptance signoff before full pilot run
- Regression check:
  - no customer-visible behavior changes (Viewer/Editor/Catalog untouched)

## Open risks

- Prompt drift/model-version changes can increase uncertainty; pin model/prompt in metadata.
- Ambiguous labels can produce false positives; unresolved cases must be output as `abstained`.
- Re-run semantics must require source hash change or explicit replay request.

## Non-goals

- Final Token identity resolution, dedupe, and cross-diagram merging
- Cross-tenant association
- Viewer surfaces or permission-filtered display
- Token Catalog/ACL integration
- Editor prompts/actions
- Non-sequence Mermaid ingestion

## Implementation outline

Backend job/controller with two execution modes:

1. **Calibration mode:** fixed-size read of 10 eligible sequence sources; write run + candidate rows.
2. **Pilot mode:** remaining eligible records only, in pilot tenant, once calibration passes.

No UI/API customer-facing changes are required for MVP-0.
