---
name: diagram-refinement
description: Refine a Mermaid flowchart from a local source file or an explicitly scoped newest-diagram selection, preserving meaning through semantic planning and visual review. Use for diagram layout repair, original/refined comparisons, or an explicitly requested production staging handoff.
---

# Diagram Refinement

Default to refinement and preview. Accept a local Mermaid file, or an explicit newest-diagram scope with client, product, environment and count (default one within that supplied scope). Do not infer a customer or production target. This skill provides a workflow and offline staging helper; generation requires an external verified runtime.

Honor a requested subtask such as review-only or handoff-only. Reuse supplied evidence after checking its hashes and relevance; run only the missing phases needed for that subtask.

Example request: `Use $diagram-refinement on /absolute/source.mmd; preview only`. Expected deliverables: frozen source/hash, semantic plan, original and refined renders, a comparison page, and review evidence with tradeoffs or blockers. If the external runtime is unavailable, supply those reviewable artifacts to continue review; generation remains blocked.

## Prepare

Read repository rules. Keep customer diagram bodies, model outputs, SVGs and screenshots in gitignored `private/local-data` or private external run directories; never commit them, including in the private submodule. Verified customer identities and runbooks may be tracked only in the private submodule. Never commit real tenant data to public files. For newest-diagram selection use verified D1/Mixpanel evidence only; do not open customer Confluence pages/APIs, request access or bypass permissions. Private preview copies do not establish customer identity.

Read [operations.md](references/operations.md#external-runtime-and-local-input) before choosing tools. The historical runtime is absent from main; accept a verified external package/Pi executable. If unavailable, report generation blocked and review supplied artifacts where possible. Do not restore historical branches automatically. Before any model call disclose the provider, billing channel, authentication, model, budget and cost/access implications; configured access does not establish consent for this task. Never silently change the provider or billing channel.

## Freeze source and plan meaning

For a local file, preserve exact bytes and SHA256. For scoped newest selection follow [selection and identity](references/operations.md#selection-and-identity): creation order requires creation/version-one evidence, not views, updates, ingestion times or largest IDs. Freeze source, exact identity and evidence freshness. Report existing Refined/queue state; never silently skip a newer unresolved candidate for an older convenient one.

Read [quality.md](references/quality.md). Extract the semantic contract and explain roles, relations, hierarchy, groups and reading order before drawing. Preserve text, diacritics, shapes, membership, edge multiplicity/direction/style/labels and semantic color meaning.

## Generate, refine and review

Capture the original render and runtime versions. Choose generation/review roles using current project routing; independent review requires an actual independent inspection, not a configured role. Inspect the whole diagram, fit view and difficult crops. Move nodes with ports, routes and labels. Repeat where a concrete improvement remains; honor preferences and explain tradeoffs without a forced layout pattern or repair count.

Keep every candidate and actual review evidence. Tie review and scores to exact source/SVG/runtime hashes; invalidate them after any change. Structural checks do not prove visible arrows, paint or interaction. Mark unavailable UI checks unverified. Provide a readable original/refined comparison with hashes and actual association highlighting/dimming. Namespace every mounted SVG’s references, including hidden copies. A timeout remains a draft until separately reviewed.

## Optional stage and verify

Only run this phase when the user explicitly requests staging for the exact target. A bare refinement request, discovery or installation authorizes preview only. Prepare the concrete artifact and plan before asking for missing authorization; reuse authorization already given. Follow [staging](references/operations.md#staging) for fresh identity/source evidence, deployed sanitizer/validator/binder compatibility, separate reviewed/prepared/sanitized hashes, and the offline helper.

Require explicit client domain, product and environment when freezing. Preserve the guarded parameter-bound SQL, unique delivery, two-minute send window, exactly 30 days from queue creation, attempt record before a single send, and exact readback. Never overwrite a delivery, retry an unknown outcome, refresh expired rows or broaden scope. Offline receipt consistency is not visual, identity, authorization or production evidence.

If monitoring is requested, prepare the selected existing monitor before queue writes and follow [monitoring handoff](references/operations.md#monitoring-handoff). Preserve scope/history/expiry and existing schedule; no automatic scheduler creation or forced cadence. Report incomplete handoff plainly.

## Report

Provide the comparison, source/artifact hashes, review result, tradeoffs and unverified checks. For scoped selection include creation evidence and limits. For requested staging include exact target, queue result/expiry and monitoring state. Distinguish queued, backend write observed and Refined display observed; telemetry alone does not bind this exact artifact. State what is complete, blocked or paused.
