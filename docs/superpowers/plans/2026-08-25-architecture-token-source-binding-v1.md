# Architecture Tokens source binding — Mermaid Flowchart v1

**Status:** staged implementation plan. Static ingestion/load and the first
Confluence-first save-time reconciliation seam are implemented; no migration,
backend index, or user binding workflow is included.

## Decision summary

Architecture Tokens are not diagram-only: Confluence prose/ADF pages,
specifications (including OpenAPI), and later code/config are potential
**source adapters**. Each adapter emits revision-scoped extracted candidates
with locators, confidence, and provenance. Candidates are evidence, not
confirmed tokens; no adapter may auto-confirm an enterprise Architecture Token
solely from extraction.

This v1 slice implements only the Mermaid Flowchart-node adapter. Within that
adapter, a candidate refers to a stable **DiagramElement**, not to a Mermaid
locator and not to a Mermaid node ID. A locator is a revision-specific address
into a UTF-8 Mermaid source revision. Each saved, valid Flowchart revision
contributes locators and fingerprints for its logical nodes. A binding is
retained only when reconciliation produces an unambiguous, one-to-one,
policy-qualified match. Otherwise the existing binding remains visible as
`orphaned` or `unresolved`; it is never silently transferred.

The first vertical slice is deliberately restricted to **Mermaid Flowchart
nodes**. It records subgraphs and edges in the canonical model only as context
for nodes and future support. It neither creates token bindings for them nor
claims to reconcile them.

Mermaid public `parse()` is the sole syntax/acceptance authority. A version-
pinned Jison provider and the legacy handwritten provider supply only
parser-derived source-position evidence to the distinct Locator domain layer.
Selecting either provider must never change whether Mermaid accepts the same
source; it affects only the evidence that Locator converts into its typed,
UTF-8 product locator.

## Repository evidence

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Mermaid diagram source is the `mermaidCode` field. | `src/model/Diagram/Diagram.ts:21-39` | Source capture must use that field, not `code`. |
| The normal save seam is `saveToPlatform`, which saves custom content before post-save telemetry and its optional D1 mirror. | `src/model/ContentProvider/Persistence.ts:36-168` | Binding state must be prepared for the custom-content write; any later projection must never make that save unavailable. |
| Mermaid has an existing public-API validation path: `mermaid.parse(code)`; the Worker-safe parser also does so behind a DOM shim. | `src/utils/mermaid/validate.ts:10-72`; `functions/agent-link/parseDsl.ts:78-116,145-164` | Validate with Mermaid's public parser. Do not inspect Mermaid parser/renderer AST objects. |
| The Worker parser module is explicitly isomorphic and uses lazy imports. | `functions/agent-link/parseDsl.ts:1-39` | A pure canonical Flowchart parser can be shared independently; validation stays an adapter around public Mermaid parsing. |
| The Diagram's `metadata` object is serialized into the raw custom-content body; sanitization removes only explicit UI-only fields. | `src/model/Diagram/Diagram.ts:70-84`; `src/model/ApWrapper2.ts:446-472`; `src/model/ApWrapper2.ts:474-500` | A namespaced metadata field can carry v1 binding/revision state without a backend dependency, but must preserve unrelated metadata. |
| Custom-content source versions can be fetched from Confluence. | `src/model/ApWrapper2.ts:1890-1938` | Historical source/mappings remain recoverable from Confluence versions rather than a backend copy. |
| Unit tests run through Vitest. | `package.json:6-8` | Parser, canonical-model, reconciliation, repository, and service tests are unit-testable without a browser or cloud access. |
| SHA-256 using UTF-8 `TextEncoder` and Web Crypto is established in this codebase. | `src/services/debugBundle.ts:74-84`; `functions/metrics-cache/snapshot/common.ts:353-355` | Use the same primitives for normalized-source hashes and byte locators. |

## V1 scope and invariants

### Included

- Mermaid documents whose first significant directive is `flowchart` or
  `graph`.
- Explicit node declarations and implicit node occurrences introduced by edge
  endpoints.
- Chains and multi-node edge forms, for example `A --> B --> C`.
- Nodes with a Mermaid native ID, optional label and supported shape syntax.
- Nested `subgraph … end` blocks as a node's container-path context.
- Multiple source occurrences of one semantic node.
- Capture of valid source revisions and fail-closed node reconciliation.

### Explicitly not supported in V1

- Token binding or automatic reconciliation for subgraphs and edges.
- Non-Flowchart Mermaid diagram types.
- Recovering a binding when either revision is syntactically invalid or contains
  a Flowchart construct the small parser does not understand.
- A user-facing confirmation UI, token catalogue integration, or AI matching.
  The domain statuses and audit records are designed so those can be added
  later without changing confirmed identity.
- Adapters for Confluence prose/ADF pages, specifications, OpenAPI, code, or
  configuration. They are future evidence producers, not alternative automatic
  confirmation paths.

### Non-negotiable invariants

1. A confirmed logical token, an extracted candidate, `diagramElementId`,
   `tokenId`, and a Mermaid native ID are distinct identities. A native ID is
   evidence, not a durable identity; a diagram is one evidence source, not the
   sole origin of a token.
2. All persisted source positions are offsets in the UTF-8 byte sequence;
   JavaScript UTF-16 string indexes never cross a persistence or API boundary.
3. Confluence custom content is the canonical v1 store for diagram source,
   binding state, current revision locators, fingerprints, and reconciliation
   provenance. Core editing, rendering, recovery, and binding continuity make
   no backend request. If a needed Confluence source revision cannot be read,
   reconciliation fails closed.
4. The same Mermaid native ID after deletion and recreation is a candidate only,
   never automatic proof of identity continuity.
5. A split, merge, tied best candidate, or candidate below the confirmation
   threshold cannot transfer a token binding automatically.
6. AI, when introduced later, can add an unconfirmed suggestion only. It cannot
   create or confirm a binding or alter a reconciliation result.

## Canonical Flowchart model

### Validation and parsing boundary

`validateMermaidFlowchart(source)` has two independent jobs:

1. Call Mermaid's documented/public `parse()` capability. A failed call returns
   `invalid` with Mermaid's error location; it never attempts reconciliation.
2. On a successful Mermaid parse, invoke `parseFlowchartSource(source)`, our
   small, owned parser. It returns either a canonical Flowchart model or an
   explicit `unsupported_construct` reason. It does not consume Mermaid AST
   internals.

The parser first tokenizes source while preserving raw byte spans. It handles
quoted text, bracket nesting, comments, newline and semicolon statement
boundaries so an arrow-shaped string in a quoted label is not treated as an
edge. It accepts the Flowchart subset above and recognises unsupported syntax
rather than guessing. Its input/output is deterministic and has no DOM,
network, Vue, Forge, or D1 dependency.

### Implemented edge subset (Phase 1 parser slice)

For node extraction, an edge is context rather than a bindable element. The
parser currently accepts direct normal, thick, and dotted links (including
documented length modifiers); `A -->|label| B`; and whitespace-delimited text
labels in normal, thick, and dotted arrow links such as `A -- label --> B`.
It records only the endpoint nodes and the original statement context, so the
label never becomes a node or a binding target.

It deliberately still returns `unsupported` for Mermaid's `@{…}` expanded
shape syntax, circle/cross edge forms, edge IDs, styling/class/link directives,
and any connector/label spelling not explicitly covered above. The public
Mermaid parser remains the first syntax gate; passing it does not widen this
owned canonical subset.

### Elements versus occurrences

One `CanonicalNode` represents one semantic node per **native Mermaid ID** in
a revision. It has zero or more `NodeOccurrence`s. For example, in
`A[API] --> B; A --> C`, `A` is one node with two occurrences; it must not
create two DiagramElements or two possible token targets. Later explicit
syntax enriches the same node inferred from an earlier edge endpoint.

```ts
type Utf8ByteSpan = { start: number; end: number }; // end exclusive

type NodeOccurrence = {
  span: Utf8ByteSpan;
  statementSpan: Utf8ByteSpan;
  role: 'declaration' | 'edge_endpoint';
};

type CanonicalNode = {
  kind: 'node';
  nativeId: string;
  label: string | null;
  shape: string | null;
  containerPath: readonly string[]; // subgraph native IDs/titles, outer → inner
  occurrences: readonly NodeOccurrence[];
  incidentNativeIds: readonly string[];
  statementContexts: readonly string[];
};

type CanonicalFlowchart = {
  kind: 'flowchart';
  direction: string | null;
  nodes: readonly CanonicalNode[];
  // Recorded only for context/future expansion in V1:
  edges: readonly CanonicalEdge[];
  subgraphs: readonly CanonicalSubgraph[];
};
```

`CanonicalEdge` and `CanonicalSubgraph` keep native syntax, byte spans, and
their relevant endpoint/container data. They are intentionally not assigned a
`diagramElementId` in V1.

### Source normalization and bytes

`normalizeSourceForHash` normalizes line endings to `\n` and removes only a
leading UTF-8 BOM. It must not trim, reflow, normalise Unicode, rewrite
comments, or canonically reorder statements: source-diff relocation needs a
faithful source text. `sourceSha256` is SHA-256 over UTF-8 bytes of that
normalized source.

The tokenizer produces character boundaries only while scanning. Before it
returns a locator it converts every boundary through a single UTF-8 byte-offset
index (`TextEncoder`-based), and tests use astral-plane and combining-character
labels to prove no UTF-16 index leaks through.

## Source-agnostic evidence model and canonical Confluence storage

The cross-source architecture has one deliberately narrow rule: source
adapters produce evidence, while confirmation is a separate governed action.
For v1, only `sourceType = mermaid_flowchart` is implemented and its candidate
points at a `DiagramElement`. The future model must not force ADF, OpenAPI, or
code/config locators into a Mermaid-shaped schema.

| Record | Required fields | Purpose |
| --- | --- | --- |
| `Source` | `sourceId`, `sourceType`, Confluence/content reference or future external reference | Identifies an evidence origin without claiming it is a token. |
| `SourceRevision` | `sourceRevisionId`, `sourceId`, parent, normalized-source hash, parser/extractor version, validation status | Immutable observed revision for any source adapter. |
| `SourceLocator` | `sourceRevisionId`, locator kind/payload, extracted-candidate ID | Revision-specific address. Mermaid uses UTF-8 byte spans; ADF/spec/code adapters define their own typed locator. |
| `ExtractedCandidate` | `candidateId`, source/revision/locator reference, candidate kind, confidence, provenance, extraction status | A fallible observation from a source adapter. It remains unconfirmed until an explicit policy/user action. |
| `ConfirmedLogicalToken` | `logicalTokenId`, external `tokenId?`, confirmation method/status, audit reference | Stable confirmed architectural concept, distinct from every source occurrence and locator. |

The raw custom-content body is the canonical v1 envelope for the Mermaid
adapter's source, bindings, and evidence. Future adapters use their own
canonical Confluence content/page representations; a backend remains only an
optional projection/index and never a recovery dependency.

Store an `architectureTokenBindingV1` namespace inside `Diagram.metadata`,
preserving all existing metadata keys. IDs below are generated opaque UUID/ULID
values; Mermaid IDs and token IDs remain plain data, never primary keys for
logical elements. Do not copy Mermaid source into this namespace: its sibling
`mermaidCode` remains authoritative.

| Record | Required fields | Purpose |
| --- | --- | --- |
| `SourceRevision` | `sourceRevisionId`, `sourceId`, `parentSourceRevisionId?`, `confluenceVersion?`, `normalizedSourceSha256`, `parserVersion`, `validationStatus`, timestamps | Mermaid-adapter instance of the source-agnostic revision fact. The source body is its sibling `mermaidCode`; Confluence content versions retain earlier state. |
| `DiagramElement` | `diagramElementId`, `kind = node`, `createdInRevisionId`, lifecycle status | Stable logical element identity. It is not a source address or a token. |
| `RevisionLocator` | `sourceRevisionId`, `diagramElementId`, `kind`, UTF-8 `spanStartByte`/`spanEndByte`, statement span, occurrence role, `nativeId?` | Mermaid-specific `SourceLocator`. A logical node can have multiple rows for its occurrences. |
| `ElementFingerprint` | revision + element, normalized label/shape, container path, native ID, statement context signature, neighbor signature | Explainable matching evidence. No raw full source in the fingerprint. |
| `ExtractedCandidate` | `candidateId`, `diagramElementId`, source/revision/locator references, confidence, provenance, status | Mermaid node evidence that may be associated with a logical token later; never auto-confirms it. |
| `TokenBinding` | `tokenBindingId`, `diagramElementId`, `logicalTokenId`, opaque external `tokenId`, `status`, confirmation method, timestamps | The user intent: a confirmed logical token is associated with a diagram element. Only an explicit bind or a safe reconciliation can preserve `confirmed`. |
| `ReconciliationRun` + `ReconciliationDecision` | old/new revision IDs, algorithm/parser versions, candidate scores, outcome, reasons, timestamps | Immutable audit provenance, including rejected alternatives and a user decision if one is later supplied. |

`TokenBinding.status` is one of `confirmed`, `unresolved`, `orphaned`, or
`retired`. `ReconciliationDecision.status` is one of `confirmed_automatic`,
`needs_confirmation`, `ambiguous`, `orphaned`, `invalid_source`, or
`unsupported_source`. The latter records a decision about a specific revision
transition; it does not overwrite historical evidence.

The current body needs only the latest revision mapping, its stable elements,
active bindings, and a bounded reconciliation audit. On a later source edit,
the editor reconciles the loaded current mapping against the new source and
replaces that latest mapping in the same custom-content body write. Earlier
source/mapping states are retained by Confluence custom-content version history
and can be read on demand for a future retry; v1 does not duplicate an
unbounded revision ledger in the current body.

Do not issue a second backend write after a successful diagram save. The state
is part of the custom-content write itself. A state serialization/validation
failure must fail closed (keep the editor open and leave the old content
unchanged), rather than save Mermaid source while silently discarding bindings.

### Implemented first reconciliation seam

On an `available` Mermaid load, conf-app retains the authoritative loaded
`mermaidCode` only in editor-session memory; sanitization removes it from the
outgoing custom-content body. If that same diagram is later saved with changed
source, the save path validates both revisions and runs source-diff, exact-ID,
fingerprint, global-assignment, topology, split/merge, and delete/recreate
policy modules as **audit evidence**.

The only automatic retention currently allowed is narrower than candidate
matching: every stored occurrence for a previously confirmed node must have a
confidence-1 exact source-diff relocation to one unique new canonical node,
and its full static fingerprint must be unchanged. Only then may the binding
move to the new `diagramElementId` and record reconciliation provenance. Same
native ID, a fingerprint score, assignment, or topology alone never moves it.
All other outcomes retain the old binding record as `unresolved` (or
`orphaned` when a later policy gate establishes that state), write a compact
source-free reconciliation audit, and do not transfer a token. A missing or
hash-mismatched session snapshot fails the save before any custom-content
write.

### Size and shape trade-offs

- **Shape:** a raw custom-content body already serializes `Diagram` as JSON,
  and `sanitizeCustomContentBody` retains non-UI metadata. The v1 codec must
  merge only `metadata.architectureTokenBindingV1`; replacing `metadata` as a
  whole would risk unrelated data. The state must be schema-versioned and
  decoded defensively: malformed/unknown state is read-only/unresolved, never
  erased by a normal save.
- **Versions and conflicts:** binding actions and source saves update one raw
  custom-content document, so each creates a Confluence content version and
  can encounter the existing optimistic version conflict/retry path. This is
  the cost of atomic source-plus-binding continuity, but avoids a separate
  availability dependency.
- **Bounded footprint:** store hashes, byte locators, compact fingerprints,
  stable element IDs, token IDs, and bounded audit summaries—not raw source,
  full candidate matrices, or duplicate historical revisions. Enforce an
  application-level UTF-8 metadata budget before writing; the exact Confluence
  custom-content body limit was not found in the consulted official REST/module
  documentation, so it must be verified before selecting a production cap.
- **Content properties:** per-content properties are a possible secondary
  canonical location, but are a worse v1 fit: they require a separate,
  versioned write and are not coupled atomically to the raw source body.
  Prefer the namespaced custom-content metadata envelope. Do not use page or
  space properties for per-diagram bindings.
- **Optional backend projection:** D1/KV/search indexes may later consume a
  best-effort projection of canonical Confluence state for cross-diagram
  search, team graphing, heavyweight reconciliation, or analytics. Projection
  absence/staleness/outage must be invisible to core editing, rendering,
  recovery, and binding continuity.

## Reconciliation algorithm and safety policy

Input is two valid, supported canonical Flowchart revisions and the old
revision's bound nodes. Output is a complete decision per old bound node.

1. **Exact source-diff relocation.** Compute a line/token-aware source diff.
   An old locator whose complete relevant statement is unchanged may relocate
   through the diff and become a high-confidence anchor only if the resulting
   node has the same kind and fingerprint. Text movement alone is not a stable
   identity claim.
2. **Candidate generation.** For every unmatched old node, make candidates of
   the same kind only. Native Mermaid ID yields a candidate, not a match.
   Additional candidate evidence: normalized syntax/label/shape, container
   path, statement context, and neighborhood signature.
3. **Delete/recreate guard.** If the native-ID candidate has no relocated
   unchanged occurrence or independent contextual/topological support, classify
   it `needs_confirmation`; do not carry the binding merely because IDs match.
4. **Global assignment.** Score all candidates together and choose a maximum
   weight one-to-one assignment over eligible candidates. Greedy matching is
   prohibited. An eligible edge must meet the auto-confirm threshold and beat
   the old element's next-best assignment by the configured ambiguity margin.
5. **Topology iteration.** Only confirmed anchors can add neighborhood score;
   repeat the global assignment a bounded number of times. No unconfirmed or
   AI-suggested mapping participates in topology scoring.
6. **Terminal outcomes.** No eligible candidate → `orphaned`. More than one
   materially equivalent candidate, many-to-one pressure, one-to-many pressure,
   split, or merge → `ambiguous`/`needs_confirmation`. Preserve the old binding
   and never attach it to a different element automatically.

Scoring weights, thresholds, ambiguity margin, parser version, and algorithm
version are data carried in the audit row, not unexplained constants. The
initial implementation will expose a pure `ReconciliationPolicy` in tests and
keep the production policy conservative. It must have fewer automatic matches
rather than one unsafe automatic match.

## First vertical-slice implementation plan

### 0. Analytics contract — first code commit

Before feature code, extend `src/utils/analytics/catalog.ts` and
`src/utils/analytics/types.ts`, as required by the repository policy. Use a
new `feature_area: 'architecture_tokens'` and add only closed-vocabulary,
non-source properties (no Mermaid text, labels, native IDs, token names, page
titles, or tenant data):

| Event | Trigger | Key properties |
| --- | --- | --- |
| `architecture_token_bind_requested` | User asks to bind a selected node and token. | `macro_type`, `surface`, `element_kind`, `source_revision_state` |
| `architecture_token_bind_succeeded` / `architecture_token_bind_failed` | Explicit bind completes/fails. | `element_kind`, `result`, `failure_reason` |
| `architecture_source_revision_captured` / `_failed` | Successful diagram save is captured or the non-fatal capture fails. | `macro_type`, `validation_status`, `source_revision_state`, `failure_reason` |
| `architecture_reconciliation_completed` | A supported old→new revision run terminates. | `element_kind`, `result`, `reconciliation_status`, `candidate_count_bucket`, `confidence_bucket`, `algorithm_version` |
| `architecture_binding_requires_confirmation` | The product presents an unresolved/ambiguous binding. | `element_kind`, `reconciliation_status`, `ambiguity_reason` |

### 1. Pure source-domain foundation

Create a runtime-neutral module, proposed at
`src/domain/architectureTokens/mermaidFlowchart.ts`, plus colocated tests. It
owns UTF-8 spans, source normalization/hash input, Flowchart tokenization, and
the canonical model. It must not import Mermaid. Create a thin validation
adapter that calls the existing public Mermaid parse gate before this parser.

Test fixtures must cover:

- explicit declaration; implicit nodes from an edge; a chain `A-->B-->C`;
- repeated occurrences of one node; later explicit declaration enriching an
  implicit node;
- semicolon-separated statements, quoted labels, comments, and an arrow in a
  quoted label;
- nested subgraphs and node container paths;
- each supported node shape form chosen for v1;
- unsupported Flowchart syntax reported explicitly rather than guessed;
- emoji and combining-character labels proving all exported spans are UTF-8
  bytes, and no span is a JavaScript string index;
- Mermaid-valid non-Flowchart and Mermaid-invalid input rejected before
  canonicalization.

### 2. Pure reconciliation seam

Create `src/domain/architectureTokens/reconcileFlowchartNodes.ts` with an
in-memory repository interface. It accepts canonical old/new models, old
element/locator/fingerprint records, and `ReconciliationPolicy`; it returns
immutable decisions/audit facts without database or UI access.

Tests precede persistence and must demonstrate:

- whitespace/comment insertion and statement movement relocate an unchanged
  node safely;
- native-ID + independently preserved syntax/context can confirm;
- delete then recreate with the same native ID is not auto-confirmed;
- renamed label/shape has the expected lower confidence;
- repeated similar nodes produce an ambiguity, never an arbitrary greedy pick;
- source split and source merge create unresolved outcomes;
- global assignment beats the intentionally constructed greedy counterexample;
- topology adds evidence only after an anchor is confirmed;
- invalid/unsupported inputs return terminal non-transfer decisions;
- every confirmed result is one-to-one and every decision contains auditable
  reasons, policy version, and alternatives.

### 3. Confluence custom-content state codec and atomic save integration

Create a typed `ArchitectureTokenBindingStateV1` codec that reads/writes only
`Diagram.metadata.architectureTokenBindingV1`. Tests must prove it preserves
unrelated metadata, rejects malformed or oversized state, carries the current
revision/element/locator/fingerprint/binding/audit records, and never writes a
UTF-16 locator. Add an explicit byte-budget constant only after confirming the
upstream custom-content limit; until then, measure and report the serialized
size in development without relying on an undocumented ceiling.

Integrate the codec before `saveToPlatform` serializes the Diagram so the
Mermaid source and its updated canonical state travel in one Confluence
custom-content PUT. On source changes, reconcile the loaded current state to
the new valid supported canonical source. On unchanged source, bind/unbind can
update state without inventing a new source revision. Do not add a backend
call, a migration, a Pages route, or a background job to this vertical slice.

### 4. Binding UX and confirmation (later vertical slice)

Only after the data/reconciliation contract is proven, add a Flowchart-node
selection surface and explicit confirmation UI for ambiguous results. The UI
must show a human-readable reason and retain the old binding as unresolved.
There is no v1 AI control. A later AI suggestion API may write a candidate with
`suggested_by = ai`; its state must require an explicit user decision.

### 5. Optional backend projection (explicitly later)

Only after core Confluence-backed binding is proven, consider a separate,
authenticated and allowlisted projection service. It reads canonical state and
may fail, be delayed, or be disabled without changing the behavior of a macro
that is edited, rendered, recovered, or reconciled locally. It is never an
authoritative write path.

## Verification gates

Before any staging check:

1. Run focused Vitest suites for parser, reconciler, repository, and service.
2. Run `pnpm test:unit` and the relevant type/build check.
3. Inspect migrations and route allowlist for exact scope and endpoint paths.
4. Use a local/fake-D1 integration test to prove an account in one scope cannot
   read/write a binding in another scope.
5. For a later UI slice, run a real Forge iframe spot check and retain UI
   evidence; unit tests alone cannot mark the UI behavior passed.

## Open decisions deliberately deferred

- The Architecture Token catalogue ownership, token authorization model, and
  whether one element can hold multiple token bindings.
- Exact user experience for selecting rendered Mermaid nodes (SVG mapping is
  not part of the source-binding proof).
- Retention period for audit evidence and whether Confluence version retrieval
  alone is sufficient for a deferred reconciliation retry.
- The numerical scoring policy and automatic-confirm threshold; their test
  corpus must be reviewed with realistic diagrams before enabling automatic
  transfer.

These are not blockers for the pure parser/reconciliation foundation, but they
are blockers for making binding UI or automatic transfer generally available.
