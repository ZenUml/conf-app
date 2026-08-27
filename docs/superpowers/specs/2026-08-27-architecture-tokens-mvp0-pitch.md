# Architecture Tokens MVP-0 — decision brief

**Decision requested:** approve a controlled, internal ten-diagram calibration once the required deployment safeguards are configured and reviewed.

## The opportunity

Architecture Tokens is a low-friction way to turn the explicit service and API participants already present in sequence diagrams into conservative, structured candidates for future architecture discovery. It gives us evidence about whether useful architecture context can be derived without asking authors to maintain another catalogue or changing the diagram authoring experience.

MVP-0 is deliberately an evidence-gathering step, not a customer feature. It tests candidate quality before we expose, merge, or act on any inferred identity.

## Deliberately narrow scope

This release is limited to the approved pilot tenant and exactly ten selected, current Mermaid sequence diagrams. It considers only diagrams that clearly declare a `sequenceDiagram` source and only participants explicitly represented as a Service, API, or external service.

The GPT-5.3 Codex/Spark calibration runs entirely in the backend. It produces candidate occurrences only; it does not create a canonical architecture catalogue, connect candidates across diagrams or tenants, or change what anyone sees in Confluence.

The wider pilot inventory is intentionally out of scope. No full-tenant batch is enabled by this work.

## Data, permissions, and privacy model

Confluence custom content remains the source of truth for diagram bodies. Diagram source is read only by a trusted, tenant-scoped executor, used transiently for calibration, and is never returned to a caller, logged, or added to analytics.

The derived store contains only the information needed to reproduce and assess a calibration run: content identity and version markers, a content hash, participant labels, conservative candidate type and evidence, model and prompt versions, and run/retry state. It is not a replacement for Confluence content.

Execution is protected by all of the following:

- A trusted Forge backend invocation rather than a browser or public caller.
- A configured tenant and Forge app identity match.
- An explicit execution enablement before any model request can occur.
- A separate explicit write enablement before derived records can be stored.
- A server-side model credential that is never delivered to the client.

The feature is disabled by default. Dry-run behavior is available for the controlled executor, but it still requires the explicit execution enablement so a customer source cannot be sent unintentionally.

## What is ready

The backend calibration capability is implemented, including:

- Strict intake validation for exactly ten distinct, current Mermaid sequence sources.
- A constrained model request and post-validation that accept only literal, explicitly evidenced service/API/external-service candidates.
- Conservative exclusions for people, clients and UIs, workflow steps, data stores, generic modules, and ambiguous participants.
- Derived run, per-source, and candidate records that can be safely rebuilt when the source changes.
- Read-only defaults, separate execution/write controls, and aggregate-only operational telemetry.

The implementation was verified with the full unit suite (259 test files, 3,050 tests), a production-style Pages Functions bundle, and the Lite build. No migration, model request involving customer content, production write, deployment, or feature enablement was performed.

## Controlled activation path

Before the first calibration, an operator must complete and review these prerequisites:

1. Deploy the reviewed backend change without enabling the feature.
2. Configure the protected runtime values for the approved pilot tenant, trusted Forge app, and server-side model credential.
3. Deliberately enable execution and, only when persistence is desired, the separate write control.
4. Provide the tenant-bound trusted executor that reads exactly ten approved current sequence sources and submits them to the backend.
5. Run the calibration, review every candidate against its declared participant and evidence, then record the go/no-go result.

The exact remaining prerequisite for a real ten-source calibration is step 4 together with the protected deployment configuration in steps 2–3. Until then, the capability cannot send a diagram source to the model or persist calibration data.

## Success criteria

The calibration is successful only if manual review confirms all of the following:

- At least 90% precision for accepted service/API/external-service candidates.
- No false positives for actors, clients/UIs, workflow steps, data stores, or generic modules.
- At least 80% of non-empty candidates are explicit service-level forms.
- No raw diagram text is retained or exposed outside the trusted processing path.

The outcome is a calibrated quality decision, not an automatic expansion. Any next phase requires a separate decision using the reviewed evidence.

## Explicit non-goals

MVP-0 does not provide a Viewer, Editor, Catalogue, or other customer-visible UI. It does not modify diagrams, create a final identity, merge entities, infer relationships between candidates, or connect information across tenants. It does not process non-sequence diagrams, broad tenant inventories, or unapproved sources.

## Key decisions and risks

| Decision or risk | MVP-0 response |
| --- | --- |
| Over-inference could make the output untrustworthy. | Prefer abstention: accept only explicit participants with literal supporting evidence; reject ambiguous roles. |
| Model behavior can change over time. | Record the model and prompt versions with each derived run so results remain auditable and rebuildable. |
| Diagram content may change between selection and processing. | Bind derived output to the current content identity/version and content hash; do not treat stale output as current. |
| Customer content needs a narrow trust boundary. | Permit source processing only from a tenant-scoped trusted executor after explicit activation; keep credentials server-side. |
| A positive result might invite premature expansion. | Keep the ten-source calibration separate from any broader processing, customer experience, or identity-resolution work. |

The proposed next action is therefore modest: authorize the controlled calibration prerequisites, then assess the ten reviewed outcomes before deciding whether Architecture Tokens should progress beyond MVP-0.
