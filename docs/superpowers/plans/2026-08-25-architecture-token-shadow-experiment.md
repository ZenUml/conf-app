# Architecture Tokens: read-only static Flowchart locator audit

## Authoritative phase order

This phase follows the task-provided **Source Binding Engine** design. Its
pipeline is a set of strict preconditions:

1. **Official syntax check** through Mermaid's public `parse()` API.
2. **Flowchart Source Parser** without Mermaid AST internals.
3. **Canonical elements**: nodes, edges, and subgraphs, with nodes as the only
   current binding candidates.
4. **Locator + Fingerprint** as static revision evidence.
5. **Revision update** begins only after those static gates: Stage 0 validates
   both revisions; Stage 1 prepares Git-style source-diff hunks and exact
   UTF-8 source-address relocation evidence. It neither identifies an element
   nor retains a binding.
6. **Exact native-ID candidates (Stage 2)** are node-kind-checked evidence
   only. A same native Mermaid ID proceeds to fingerprint scoring; it does not
   identify an element or retain a binding.
7. **Fingerprint scoring (Stage 3)** records transparent component evidence
   for Stage 2 candidates only. It still does not identify an element or
   retain a binding.
8. **Global maximum-weight assignment (Stage 4)** makes one-to-one candidate
   selection evidence from Stage 3 scores only. It still does not identify an
   element or retain a binding.
9. **Structural/topology assessment** compares directed neighbors through Gate
   4's provisional assignments only. It still does not identify an element or
   retain a binding.
10. **Identity resolution (deferred)**: iterative topology using confirmed
    mappings, split/merge, AI suggestions, and user confirmation.

The Source Binding Engine's Stage 0 is a precondition to later version work.
The Stage 1 helper is a source-address preparation seam only; it is not a
Phase 1 identity, binding, or retention outcome. All semantic stages remain
downstream of this audit.

## Purpose

Test whether a single, current Mermaid source can safely yield static
Flowchart-node locators. This is evidence gathering only: it must never write
D1, Confluence, token bindings, or user-visible content.

Architecture Tokens are source-agnostic: diagrams, Confluence prose/ADF,
specifications, and later code/config are future evidence adapters. This
experiment tests one adapter (`mermaid_flowchart`) only. Its syntax and locator
eligibility cannot establish token coverage, token precision, or the quality
of other adapters; a source occurrence remains an extracted candidate until
separately confirmed as a logical token.

The product remains Confluence-first. Future source and binding metadata is
canonical in Confluence custom content; the D1 mirror is an optional,
best-effort projection and may be incomplete, delayed, or unavailable.

## Scope and boundaries

- Mermaid only; Flowchart nodes only.
- Syntax is checked through Mermaid's public `parse()` API via the existing
  isomorphic parser. No Mermaid AST internals are read.
- Canonicalisation, UTF-8 locators, and static fingerprint facts reuse the
  Architecture Tokens domain modules. They do not migrate an identity here.
- The experiment uses only `SELECT`/`WITH` statements against current
  `CustomContent` bodies. It does not read `CustomContentVersion` in this
  phase.
- A bounded general current-content sample supplies static locator coverage. A
  separately labelled, bounded `flowchart`/`graph` text-candidate sample may
  enrich supported syntax. It is not a prevalence sample and must never be
  compared as one.
- Version-change reconciliation, relocation, relationship discovery, global
  matching, topology, split/merge, AI, and user confirmation are deferred.
  The sole exception is a pure source-diff helper that classifies
  `unchanged`/`insert`/`delete`/`replace` hunks and can map an old UTF-8 span
  wholly inside an unchanged hunk to its new address at confidence `1.0`.
  That evidence has no element ID, Mermaid ID, binding, or retention decision.

## Static locator contract

One `CanonicalNode` represents the logical node for one native Mermaid ID in a
revision and may have multiple `NodeOccurrence`s. A locator records its
UTF-8 node span, enclosing statement span, and syntax role
(`declaration` or `edge_endpoint`). The canonical node is the primary element;
the locators are its source occurrences. Its primary locator is deterministic:
the first explicit declaration when one exists, otherwise the first
edge-endpoint occurrence. All remaining occurrences stay attached as evidence.

The static audit verifies every supplied locator against a fresh parse of the
same source, decodes its UTF-8 span, reparses the decoded fragment as exactly
one expected node, and checks its declaration/edge-endpoint statement context.
It also verifies that the primary locator is one of that node's syntax-derived
occurrences. It rejects an unsafe locator with an explicit reason. Edge labels, style/class
references, subgraph labels, edges, subgraphs, and other non-node text are
never node locators or v1 binding targets. Unsupported syntax fails closed.

## Static fingerprint facts (single revision only)

After a source has passed the locator contract, the next static layer records
evidence *about that same parsed revision*. It does not receive a previous
revision, a binding, or a candidate mapping, and consequently cannot transfer
or confirm an identity.

- `SourceRevision.normalizedSourceSha256` is the source-wide SHA-256 of the
  transport-normalized Mermaid text. It is revision provenance, not a node
  identity key.
- Each canonical node has a versioned `flowchart_node_static_v1` fingerprint
  with `single_revision_static` provenance. Its syntax facts are kind, native
  Mermaid ID, normalized label, shape, and a deterministic normalized syntax
  key.
- Its structural facts are only what the owned parser already observes in this
  source: normalized container path, statement contexts, and undirected
  incident native IDs. Empty values remain facts of this revision; they are not
  inferred relationships and have no cross-revision interpretation.

The audit reports `locatorEligibility` separately from
`staticFingerprintFacts`. The former proves a byte-exact, syntax-role-aware
source address; the latter records available facts once that address is safe.
Neither metric measures logical identity, binding retention, precision, or
recall. Cross-revision comparison remains a later, explicitly gated stage.

## Source-diff relocation preparation (Stage 1 only)

`sourceDiffRelocation.ts` operates on two source texts and caller-supplied old
UTF-8 locator spans, after each revision has independently passed the earlier
syntax/parser/locator gates. It tokenizes only on Unicode code-point boundaries
and uses a Git-style array diff to retain valid UTF-8 byte boundaries. It emits
`unchanged`, `insert`, `delete`, and `replace` hunks. A locator produces an
exact relocation evidence record only when its full old span is inside one
`unchanged` hunk and the mapped new bytes decode to exactly the same text.

Any locator that is invalid, empty, duplicated, crosses a changed hunk, or
fails the final byte-for-byte check is unresolved with a reason. The result is
address evidence (`source_diff_unchanged`, confidence `1.0`) only. It must not
be consumed as a logical-element match, native-ID match, fingerprint match, or
binding transfer; those are separate later stages in the authoritative design.

## Exact native-ID candidate assessment (Stage 2 only)

`nativeIdCandidate.ts` accepts only canonical Flowchart **nodes**, so the v1
kind check is explicit at the module boundary: edges and subgraphs cannot
enter this stage. For every old node it accepts a candidate only when exactly
one old and one new canonical node have the same native Mermaid ID. The
candidate carries the old/new `kind: node` facts, plus any independently
verified Stage 1 relocation records whose old and new byte spans correspond to
occurrences of those nodes.

This is deliberately a candidate assessment, not a match result. It returns
`nextRequiredGate: fingerprint_scoring` for every same-ID candidate. Missing
or duplicate IDs are explicit unmatched evidence; it does not select among
duplicates. A source-diff record and a same native ID remain independent
signals: neither confirms logical-element identity, transfers a TokenBinding,
or changes a binding status.

## Fingerprint scoring (Stage 3 only)

`fingerprintScoring.ts` consumes only the Stage 2 candidate assessment plus
the versioned, single-revision static fingerprints. Each score has six visible
components from the authoritative design: native ID (0.35), kind (0.20),
normalized label (0.15), shape (0.10), raw native-ID neighborhood Jaccard
(0.15), and ordered container path (0.05). Statement-context comparison and
the presence or absence of an independently proven Stage 1 relocation are
also emitted, but neither adds an unapproved weight.

The neighborhood score deliberately compares only the static native-ID sets;
it does not use mapped neighbors or iterate topology. A missing, duplicate, or
invalid static fingerprint produces an explicit unresolved result rather than
a partial score. Known-but-empty label, shape, or neighborhood evidence remains
visible as `unavailable` with zero weight contribution. The returned score is
an audit value with `nextRequiredGate: global_assignment`, never an acceptance,
logical identity, TokenBinding transfer, or user-facing status.

## Global maximum-weight assignment (Stage 4 only)

`globalAssignment.ts` accepts Stage 3 scored candidates and solves each
connected bipartite candidate component as a maximum-weight one-to-one
assignment. It uses the design's `< 0.65` unresolved band as an assignment
eligibility floor, not an acceptance threshold. Scores are scaled to fixed
integer precision for the solver. Candidate edges below that floor, non-finite
or absent at runtime, and duplicate old/new candidate edges are explicit
unresolved evidence.

For every proposed solution, the solver reruns each selected edge as forbidden.
If any equally weighted optimum remains, that connected component is a
non-unique maximum and all of its candidate edges are unresolved as an
assignment tie. Independent components can still yield their own unique
selection. A unique selection records its component maximum score and proof
`unique_maximum_weight_assignment`, then stops at
`nextRequiredGate: structural_topology_assessment`. It is not a logical
identity, binding retention/transfer, status update, or split/merge result.

## Structural/topology assessment (after Gate 4 only)

`structuralTopologyAssessment.ts` derives directed incoming and outgoing
neighbors from the owned Flowchart canonical edges, then maps old neighbor IDs
through Gate 4's one-to-one selected assignments. It compares each non-empty
direction with the corresponding new neighbor set using Jaccard similarity and
emits the mapped old and new sets for audit. The Gate 4 mapping is explicitly
labelled *provisional assignment evidence*, not an identity or a confirmed
mapping.

The stage fails closed if its supplied Gate 4 selections are no longer
one-to-one, either revision lacks a unique canonical node, a node has no
topology, or one of its old neighbors lacks provisional assignment evidence.
The design's recursive rounds require **confirmed** neighbor mappings; this
stage creates none, so it reports zero rounds and
`deferred_requires_confirmed_neighbor_mappings`. Its output is evidence for
the next split/merge assessment only—not rename acceptance, identity
confirmation, a TokenBinding action, or an iterative topology result.

## Reproducible execution

`scripts/architecture-token-shadow.mjs` is intentionally inert unless passed
`--run`. Its default operation is a dry run that performs schema and aggregate
count validation only. The live run has a default sample cap of 250 contents,
a hard cap of 500, and a hard batch cap of 50. It pages deterministically by
offset and keeps a numeric checkpoint in `/private/tmp`; no body, content ID,
tenant, title, or source fragment is persisted by the harness.

The runner invokes Wrangler with `--remote`, `--config wrangler-prod.toml`,
and `--env production`, but admits only a single read-only SQL statement. It
rejects mutation, DDL, PRAGMA, attachment, and multiple-statement tokens
before spawning Wrangler. A local report is aggregate/deidentified JSON and
is written outside the worktree by default. Any caller choosing a worktree
path is responsible for keeping it ignored; reports are not committed.

Run sequence:

1. `node --experimental-strip-types --experimental-loader ./scripts/architecture-token-shadow-loader.mjs scripts/architecture-token-shadow.mjs --dry-run`
2. Review schema/count output and the mirror-coverage caveat.
3. Run a bounded general static audit with
   `--run --limit 250 --batch-size 25`.
4. Run a separate, bounded prefiltered static audit with
   `--flowchart-candidates --state-dir <new-local-dir>`.
   The prefilter is only `body LIKE '%flowchart%' OR body LIKE '%graph%'`; the
   public parser, canonical parser, and locator audit still decide eligibility.
5. Read aggregate reports only. Do not inspect or copy captured source.

## Measures

The report records only counts/rates for:

- stored-body JSON availability and `code` extraction;
- public Mermaid parseability, owned canonical-parser support, and unsupported
  syntax reason buckets as separate measures;
- safe versus unsafe static locator sources, unsafe-locator reason buckets,
  primary-locator count, and declaration/edge-endpoint occurrence counts;
- logical-node/occurrence counts, repeated source occurrences per logical
  node, separately counted static syntax and structural fingerprint facts, and
  explicitly labelled heuristic native-ID shapes.

No outcome in this report is token confirmation, retention, or reconciliation
precision. Without manual review or external identity ground truth, every
precision/recall interpretation remains unverified and out of scope.

## Coverage limitations

The D1 rows are a best-effort mirror written after a Confluence refetch. A
missing row/body is therefore mirror coverage evidence, not evidence that the
canonical Confluence revision never existed. The report distinguishes
missing/unreadable stored bodies, Mermaid parse failures, non-Flowchart
sources, canonical-parser unsupported syntax, and unsafe locators so future
product design does not overgeneralise from the mirror.

## Static locator audit evidence (2026-08-25)

The revised harness completed a current-body-only dry run against the
production D1 mirror using guarded read-only queries. It found 44,968 Mermaid
contents in that optional mirror. It then ran two bounded, separate cohorts.
No source body, content ID, title, tenant, native ID, locator, or fingerprint
was retained outside process memory; local reports/checkpoints contain
aggregate counts only.

| Cohort | Body extraction | Public Mermaid valid | Owned syntax supported | Safe locator sources | Unsafe locator sources |
| --- | ---: | ---: | ---: | ---: | ---: |
| 250 recent Mermaid bodies (general, not Flowchart prevalence) | 250/250 | 241/250 | 68/241 | 68/68 | 0/68 |
| 500 `flowchart`/`graph` text candidates (candidate-enriched, **not prevalence**) | 500/500 | 499/500 | 253/499 | 253/253 | 0/253 |

For every source that passed both syntax gates, the static audit found no
unsafe locator reason. It decoded and round-tripped 1,711 source occurrences
in the general cohort (292 `declaration`, 1,419 `edge_endpoint`) and 6,241 in
the candidate cohort (1,023 `declaration`, 5,218 `edge_endpoint`). The audit
also produced one preliminary static base-fingerprint count per canonical
node: 700 in the general cohort and 2,594 in the candidate cohort, together
with the same number of verified primary locators. Those reports predate the
explicit `staticFingerprintFacts.syntax` and
`staticFingerprintFacts.structural` schema introduced after this audit; no new
corpus run is claimed for that schema here. The facts remain static evidence
only: no fingerprint was used to compare revisions, retain a binding, or
confirm a token.

The audit initially exposed two harness-context errors, corrected before the
reported run with public fixtures: declarations may be indented within their
statement, and an edge endpoint such as `end` must be round-tripped in its
edge-endpoint syntax role rather than as a standalone statement. The final
audit keeps both checks explicit and still rejects a span tampered to a label
as `locator_not_syntax_derived`. Thus zero unsafe results mean “no failure of
this tested source-derived locator contract in these bounded cohorts,” not a
claim of complete Mermaid grammar coverage or externally verified semantic
identity.

The remaining public-valid but owned-parser-unsupported current sources have
these explicit fail-closed buckets:

| Cohort | Not a Flowchart | Unsupported Flowchart statement | Unsupported edge endpoint |
| --- | ---: | ---: | ---: |
| General | 123 | 47 | 3 |
| Text candidate | 37 | 195 | 14 |

`unsupported_flowchart_statement` is the largest remaining static syntax gap.
The next parser slice must classify it with sanitized fixtures before adding
support. It must not be relaxed into a locator guess.

## Pre-gate historical context — deferred, not a Phase 1 result (2026-08-25)

These read-only aggregate results were gathered before the static-locator gate
was restored. They are retained only because no source or identifier was
persisted, but they do **not** demonstrate locator correctness and must not
guide version-change implementation. The current harness no longer fetches
historical versions or emits reconciliation metrics.

The harness completed its schema/count dry run against the production D1
mirror using only read-only queries. At the time of the run it reported 44,958
Mermaid contents, 13,286 contents with a mirrored history, and 80,314 mirrored
versions. These are live-mirror counts, not Confluence-canonical counts.

Two separate bounded samples were run. Neither retained a source body,
content ID, title, tenant identifier, or native ID outside process memory.

| Sample | Body extraction | Public Mermaid valid | Canonical Flowchart eligible | Adjacent history pairs | Eligible pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| 250 recent Mermaid contents (general prevalence sample) | 250/250 | 241/250 | 15/250 | 74 | 3 |
| 500 Mermaid contents prefiltered only by `flowchart`/`graph` text (candidate-enriched, **not prevalence**) | 500/500 | 499/500 | 80/500 | 172 | 18 |

In the candidate-enriched sample, 420/500 sources were rejected by the owned
canonical parser; at least 419 of those had passed Mermaid's public parser
(the parser-result bucket also contains the one public-parse failure). The
largest explicit reason bucket was unsupported edge-endpoint syntax (275);
this is a parser-coverage finding, not a Mermaid validity finding. The 80 eligible
sources yielded 641 canonical nodes and 1,389 source occurrences; 468 nodes
had repeated occurrences. Native-ID shapes were 361 very short and 280
identifier-like, reinforcing that an ID alone is weak evidence.

Across the 18 eligible adjacent version pairs, the current deliberately narrow
reconciler emitted 91 `confirmed_automatic`, 36 `needs_confirmation`, 8
`ambiguous`, and 1 `orphaned` node decisions. It found 125 unique exact-span
relocation candidates, 133 same-native-ID candidates, and 136 nodes with a
non-empty topology signal. These are algorithm outcome counts, **not true
identity labels**: no manual review or external ground truth was used, and the
experiment has not implemented weighted global assignment or topology scoring.
They must not be read as precision, recall, token-confirmation, or token
coverage measurements.

### Superseded interpretation

The historical-pair and reconciler values above are explicitly deferred. They
do not establish a reconciliation seam, identity continuity, ambiguity
distribution, or production viability. The only still-relevant static evidence
is bounded parser coverage; the next required evidence is the current-source
locator audit described above.

## Parser-slice static syntax context — pre-locator-audit (2026-08-25)

After the labelled-edge parser slice, the same guarded harness was run again
against the production D1 mirror. It first completed the schema/count dry run,
then processed two independent bounded cohorts: a 250-content general Mermaid
sample and a 500-content `flowchart`/`graph` text-candidate sample. The latter
is candidate-enriched and is **not** a prevalence sample. The harness issued
only its single-statement `SELECT` queries; source bodies, content IDs, titles,
tenants, and native IDs remained in memory and only local aggregate
checkpoints/reports were written under `/private/tmp`.

The fresh mirror dry run reported 44,965 Mermaid contents. It describes the
optional D1 mirror rather than canonical Confluence.

| Cohort | Extractable body | Public Mermaid valid | Current canonical parser eligible |
| --- | ---: | ---: | ---: |
| 250 recent Mermaid contents (general, not Flowchart prevalence) | 250/250 | 241/250 | 68/250 |
| 500 `flowchart`/`graph` text candidates (candidate-enriched, **not prevalence**) | 500/500 | 499/500 | 253/500 |

For context, the first run using the prior parser reported 15/250 eligible in
the general cohort and 80/500 in the candidate-enriched cohort. The second run
therefore observed +53 and +173 eligible current sources respectively under
the same bounded sampling framing. This is a compatible live-mirror comparison,
not a controlled replay of an identical stored corpus: the mirror grew from
44,958 to 44,965 Mermaid rows between runs, and the privacy-preserving harness
does not retain row identifiers or bodies. It supports the limited conclusion
that the parser slice materially improved observed eligibility; it does not
establish an exact causal percentage for a fixed population.

### Deferred reconciliation simulation counts

These pre-gate counts are retained only as local aggregate context. They are
not parsed as static-locator success, must not be compared or extended in this
phase, and do not justify change handling.

| Cohort | Pair outcomes (eligible / unsupported) | `confirmed_automatic` | `needs_confirmation` | `ambiguous` | `orphaned` | Relocation evidence | Same-native-ID candidates | Nodes with topology signal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| General | 21 / 59 | 174 | 27 | 0 | 0 | 193 | 201 | 190 |
| Text candidate | 70 / 101 | 498 | 159 | 8 | 5 | 634 | 663 | 655 |

No manual review or external ground truth was used. These values make no
precision, recall, token-confirmation, retention, or global-matching claim.

### Remaining explicit parser gaps

The owned parser rejected 182/250 current general sources and 247/500 current
text candidates. Its explicit fail-closed buckets were:

| Cohort | Not a Flowchart | Unsupported Flowchart statement | Unsupported edge endpoint |
| --- | ---: | ---: | ---: |
| General | 132 | 47 | 3 |
| Text candidate | 38 | 195 | 14 |

`unsupported_flowchart_statement` is now the largest owned-syntax gap in both
cohorts and is the highest-value next investigation. It needs a separate,
fixture-driven classification before support is added; this aggregate run does
not retain source text and therefore cannot safely name a more granular syntax
family. `unsupported_edge_endpoint` remains explicitly fail-closed rather
than being relaxed. Public Mermaid validity stays intentionally separate from
owned canonical-parser support (241/250 valid general sources and 499/500
valid text candidates).

### Corrected decision interpretation after the second run

The parser enhancement makes static locator measurement practical: the
candidate-enriched cohort has 253 current parser-eligible sources. It does not
yet prove a safe locator, justify version-change handling, product persistence,
UI, backend indexing, or a change to the Confluence-first boundary. The next
output is the static locator coverage and failure taxonomy from the revised
harness. Keep the general and text-prefiltered cohorts separate and do not
treat D1 mirror data as Confluence ground truth.

## Safe committed artifacts

Only the runner, its read-only loader, focused unit tests, and this plan are
committed. Reports, checkpoints, raw query responses, diagram bodies, content
identifiers, titles, and tenant identifiers are never committed.
