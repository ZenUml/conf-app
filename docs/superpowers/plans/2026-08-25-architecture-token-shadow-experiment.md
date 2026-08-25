# Architecture Tokens: read-only reconciliation shadow experiment

## Purpose

Test whether the existing D1 mirror contains enough **Mermaid Flowchart**
source and adjacent historical revisions to justify further work on
locator/fingerprint/topology reconciliation. This is evidence gathering only:
it must never write D1, Confluence, token bindings, or user-visible content.

Architecture Tokens are source-agnostic: diagrams, Confluence prose/ADF,
specifications, and later code/config are future evidence adapters. This
experiment tests one adapter (`mermaid_flowchart`) only. Its eligibility and
outcome distribution cannot establish token coverage, token precision, or the
quality of other adapters; a source occurrence remains an extracted candidate
until separately confirmed as a logical token.

The product remains Confluence-first. Future source and binding metadata is
canonical in Confluence custom content; the D1 mirror is an optional,
best-effort projection and may be incomplete, delayed, or unavailable.

## Scope and boundaries

- Mermaid only; Flowchart nodes only.
- Syntax is checked through Mermaid's public `parse()` API via the existing
  isomorphic parser. No Mermaid AST internals are read.
- Canonicalisation, UTF-8 locators, fingerprints, and stage-one reconciliation
  reuse the Architecture Tokens domain modules.
- The experiment uses only `SELECT`/`WITH` statements against
  `CustomContent` and `CustomContentVersion`.
- A bounded general current-content sample supplies eligibility and ID-shape
  metrics; adjacent version pairs from the same sample supply historical
  simulations. A separately labelled, bounded `flowchart`/`graph`
  text-candidate sample may enrich historical Flowchart pairs. It is not a
  prevalence sample and must never be compared as one.
- The current reconciler can auto-confirm only a unique exact node-span
  relocation plus an exact fingerprint. Native Mermaid IDs are evidence only.
  Delete/recreate, split/merge, conflicts, and uncertainty remain
  fail-closed.
- Topology is measured as signal availability and exact-neighbour agreement.
  The planned global maximum-weight and iterative topology assignment is not
  implemented by this experiment, so it cannot be claimed validated.

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
3. Run a bounded general sample with `--run --limit 250 --batch-size 25`.
4. If eligible historical pairs are insufficient, run a separate, bounded
   prefiltered sample with `--flowchart-candidates --state-dir <new-local-dir>`.
   The prefilter is only `body LIKE '%flowchart%' OR body LIKE '%graph%'`; the
   public parser and canonical parser still decide eligibility.
5. Read aggregate reports only. Do not inspect or copy captured source.

## Measures

The report records only counts/rates for:

- stored-body JSON availability and `code` extraction;
- public Mermaid parseability and Flowchart canonical-parser eligibility;
- node/occurrence counts, repeated source occurrences per logical node, and
  explicitly labelled heuristic native-ID shapes;
- same-content adjacent-version availability and pair coverage;
- reconciliation outcomes: `confirmed_automatic`, `needs_confirmation`,
  `ambiguous`, `orphaned`, and `unsupported`;
- relocation evidence availability and topology-signal availability.

`confirmed_automatic` in this report means only the current narrow algorithm
could prove continuity for a Mermaid-source candidate. It is **not token
confirmation or precision**. Without manual review or external identity ground
truth, every precision/recall interpretation remains unverified.

## Coverage limitations

The D1 rows are a best-effort mirror written after a Confluence refetch. A
missing row/version/body is therefore mirror coverage evidence, not evidence
that the canonical Confluence revision never existed. The report distinguishes
missing/unreadable stored bodies, Mermaid parse failures, non-Flowchart
sources, and canonical-parser unsupported syntax so future product design does
not overgeneralise from the mirror.

## Sanitized run evidence (2026-08-25)

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

### Decision interpretation

The D1 mirror has ample Mermaid content and historical-edit volume to continue
the experiment, and the 18 supported historical pairs establish a preliminary
fail-closed reconciliation seam. It does **not** yet establish production
viability: the parser accepts only 16% of the candidate-enriched sample and
the supported historical set is too small to validate ambiguity/topology
distributions. Before productising reconciliation, broaden the owned parser's
explicit Flowchart subset (starting with the observed endpoint/statement
classes), add fixture tests, then repeat a larger stratified experiment. Keep
the general and candidate-enriched samples separate, and retain the
Confluence-first storage boundary throughout.

## Safe committed artifacts

Only the runner, its read-only loader, focused unit tests, and this plan are
committed. Reports, checkpoints, raw query responses, diagram bodies, content
identifiers, titles, and tenant identifiers are never committed.
