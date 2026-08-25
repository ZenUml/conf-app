# Architecture Tokens source binding — Mermaid Flowchart v1

**Status:** discovery and implementation plan. No production code or data migration is included in this slice.

## Decision summary

V1 binds an enterprise Architecture Token to a **stable DiagramElement**, not
to a Mermaid locator and not to a Mermaid node ID. A locator is a
revision-specific address into a UTF-8 Mermaid source revision. Each saved,
valid Flowchart revision contributes locators and fingerprints for its logical
nodes. A binding is retained only when reconciliation produces an unambiguous,
one-to-one, policy-qualified match. Otherwise the existing binding remains
visible as `orphaned` or `unresolved`; it is never silently transferred.

The first vertical slice is deliberately restricted to **Mermaid Flowchart
nodes**. It records subgraphs and edges in the canonical model only as context
for nodes and future support. It neither creates token bindings for them nor
claims to reconcile them.

## Repository evidence

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Mermaid diagram source is the `mermaidCode` field. | `src/model/Diagram/Diagram.ts:21-39` | Source capture must use that field, not `code`. |
| The normal save seam is `saveToPlatform`, which saves custom content before post-save telemetry and D1 mirroring. | `src/model/ContentProvider/Persistence.ts:36-168` | Revision capture belongs after a successful custom-content save, and must never make that save unavailable. |
| Mermaid has an existing public-API validation path: `mermaid.parse(code)`; the Worker-safe parser also does so behind a DOM shim. | `src/utils/mermaid/validate.ts:10-72`; `functions/agent-link/parseDsl.ts:78-116,145-164` | Validate with Mermaid's public parser. Do not inspect Mermaid parser/renderer AST objects. |
| The Worker parser module is explicitly isomorphic and uses lazy imports. | `functions/agent-link/parseDsl.ts:1-39` | A pure canonical Flowchart parser can be shared independently; validation stays an adapter around public Mermaid parsing. |
| Existing D1 data is tenant/app/content scoped and tested for that scope. | `functions/migrations/0018_add_diagram_audience.sql:3-15`; `functions/diagram-impact/repository.ts:3-20` | Every new persistent row must include `cloudId`, `forgeAppId`, and `customContentId`; no cross-tenant lookup is allowed. |
| A Pages Function route must be explicitly included. | `public/_routes.json:1-40` | Any future `/api/architecture-tokens/*` route requires an allowlist entry. |
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

### Non-negotiable invariants

1. `diagramElementId`, `tokenId`, and a Mermaid native ID are three distinct
   identities. A native ID is evidence, not a durable identity.
2. All persisted source positions are offsets in the UTF-8 byte sequence;
   JavaScript UTF-16 string indexes never cross a persistence or API boundary.
3. Confluence custom content remains the system of record for diagram source.
   D1 stores binding/reconciliation metadata, never a required source-recovery
   copy. If a needed source revision cannot be read, reconciliation fails
   closed.
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

## Persistent model

All records are scoped by `(cloudId, forgeAppId, customContentId)`. IDs below
are generated opaque UUID/ULID values; Mermaid IDs and token IDs remain plain
data, never primary keys for logical elements.

| Record | Required fields | Purpose |
| --- | --- | --- |
| `SourceRevision` | scope, `sourceRevisionId`, `parentSourceRevisionId?`, `confluenceVersion?`, `normalizedSourceSha256`, `parserVersion`, `validationStatus`, timestamps | Immutable fact that one source version was observed and classified. The source body stays in Confluence; the reconciliation job receives readable old/new bodies. |
| `DiagramElement` | scope, `diagramElementId`, `kind = node`, `createdInRevisionId`, lifecycle status | Stable logical element identity. It is not a source address or a token. |
| `RevisionLocator` | `sourceRevisionId`, `diagramElementId`, `kind`, UTF-8 `spanStartByte`/`spanEndByte`, statement span, occurrence role, `nativeId?` | Revision-specific address(es) for one element. A logical node can have multiple rows for its occurrences. |
| `ElementFingerprint` | revision + element, normalized label/shape, container path, native ID, statement context signature, neighbor signature | Explainable matching evidence. No raw full source in the fingerprint. |
| `TokenBinding` | scope, `tokenBindingId`, `diagramElementId`, opaque external `tokenId`, `status`, confirmation method, timestamps | The user intent: a token is bound to an element. Only an explicit bind or a safe reconciliation can produce `confirmed`. |
| `ReconciliationRun` + `ReconciliationDecision` | old/new revision IDs, algorithm/parser versions, candidate scores, outcome, reasons, timestamps | Immutable audit provenance, including rejected alternatives and a user decision if one is later supplied. |

`TokenBinding.status` is one of `confirmed`, `unresolved`, `orphaned`, or
`retired`. `ReconciliationDecision.status` is one of `confirmed_automatic`,
`needs_confirmation`, `ambiguous`, `orphaned`, `invalid_source`, or
`unsupported_source`. The latter records a decision about a specific revision
transition; it does not overwrite historical evidence.

The initial migration should use a dedicated sequence number (next is `0021`
at the time of writing), foreign keys where D1 supports them, and indexes for:

- scope + latest source revision;
- revision + locator byte span;
- element + latest fingerprint;
- active binding + element;
- run + old element and run + candidate new element.

Do not write the new source revision, locators, or binding state until the
custom-content save has succeeded. A post-save capture failure records a
non-fatal telemetry failure and schedules no implicit transfer; it must not
turn a successful diagram save into an error.

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

### 3. D1 metadata persistence and protected backend service

Add migration `functions/migrations/0021_add_architecture_token_binding.sql`,
repository code under `functions/architecture-tokens/`, and unit tests with
the repository's parameterized-SQL/fake-D1 style. Reuse the verified Forge
request-scoping pattern in `functions/diagram-impact/service.ts`; never accept
scope identity from request query/body fields.

Expose only the minimum authenticated mutation/read endpoints after the domain
tests are green. Add their paths to `public/_routes.json` in the same change.
The service must:

- derive tenant/app/account scope from Forge request data;
- verify the target custom content is readable and Mermaid Flowchart before a
  binding or capture can be written;
- persist source revision + node metadata transactionally;
- make revision capture idempotent by normalized-source hash within scope;
- refuse source capture/reconciliation on invalid or unsupported source;
- write a reconciliation run and preserve unresolved bindings;
- never use D1 source bodies as a diagram recovery mechanism.

### 4. Save integration (feature-flagged)

At the existing `saveToPlatform` seam, queue a post-save capture with the
saved custom-content ID and version. The custom-content save remains the
success boundary: capture is best-effort and observable, and it must not
affect the existing save event or macro-config writeback. Initially gate the
call behind a dedicated Forge feature flag and enable it only for internal
testing after unit and authenticated-service tests pass.

### 5. Binding UX and confirmation (later vertical slice)

Only after the data/reconciliation contract is proven, add a Flowchart-node
selection surface and explicit confirmation UI for ambiguous results. The UI
must show a human-readable reason and retain the old binding as unresolved.
There is no v1 AI control. A later AI suggestion API may write a candidate with
`suggested_by = ai`; its state must require an explicit user decision.

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
