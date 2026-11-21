# Mermaid position parsers (sequence and flowchart)

Inline editing on the canvas needs to know where each participant and message
(sequence diagrams), or each node label and edge label (flowcharts), lives in
the Mermaid source. conf-app does this without matching any content:

1. The diagram is rendered by **official Mermaid**, unchanged.
2. Positions come from **the same upstream grammar** plus a small patch that records token offsets:

   | Grammar | Upstream file | Patch | Generated parser |
   |---|---|---|---|
   | `sequence` | `sequenceDiagram.jison` | `loc.patch` | `sequenceLocParser.js` |
   | `flowchart` | `flow.jison` | `flowchart.loc.patch` | `flowchartLocParser.js` |

3. At runtime the patched parser's result is compared record by record with Mermaid's own database. Any disagreement means no source map, and the diagram stays read-only.

The folder keeps its historic name (`mermaid-seq-loc`): the generated sequence
parser names it in its header, and renaming it would change that file.

This folder holds only the build inputs and tools. The runtime code is in `src/features/mermaidInlineEdit/sourcemap/`.

## File map

| Path | Role |
|---|---|
| `upstream/sequenceDiagram.<version>.jison`, `upstream/flow.<version>.jison` | Pristine upstream grammars, vendored. Never edit them. |
| `loc.patch` | Sequence change: attach token offsets. Applied with `patch --fuzz=0`. Fits the pinned Mermaid. |
| `loc.<version>.patch` | Optional. The same change cut from a newer upstream grammar whose context lines differ (today `loc.12.3.0.patch`). See "Patch selection" below. |
| `flowchart.loc.patch` | Flowchart change: `%options ranges`, a `yy.__idLoc(id, range)` call in every `vertex` production, and `loc` (plus `inline: true` for `-- text -->` edge text) on every label text object. Fits 11.17.2 and 12.3.0 as is. `flowchart.loc.<version>.patch` follows the same selection rule as `loc.<version>.patch`. |
| `build.mjs` | Applies each patch and compiles with jison (a patched grammar with conflicts fails the build). Modes: build, `--check`, `--fetch <version>`; `--grammar sequence|flowchart` limits any mode to one grammar. |
| `extract-corpus.mjs` | Extracts the sources from Mermaid's own test files into a fixture (`--grammar flowchart` for the flowchart parser specs). |
| `src/features/mermaidInlineEdit/sourcemap/generated/{sequence,flowchart}LocParser.js` | Build output, checked in. Do not edit. |
| `src/features/mermaidInlineEdit/sourcemap/__fixtures__/upstream-{sequence,flowchart}-corpus.<version>.json` | Corpus fixtures, version-specific. |
| `.github/workflows/mermaid-seq-loc-sync.yml` | Weekly check against the newest published Mermaid. |

## Commands

| Goal | Command |
|---|---|
| Rebuild the generated parsers | `node scripts/mermaid-seq-loc/build.mjs` |
| Fail if a checked-in file is stale | `node scripts/mermaid-seq-loc/build.mjs --check` |
| Download the pristine grammars | `node scripts/mermaid-seq-loc/build.mjs --fetch <version>` |
| Only one grammar (any mode) | add `--grammar sequence` or `--grammar flowchart` |
| Regenerate the corpus fixtures | `node scripts/mermaid-seq-loc/extract-corpus.mjs <version>` and `... <version> --grammar flowchart` |
| Run the tests | `pnpm vitest --run src/features/mermaidInlineEdit/sourcemap` |

`build.mjs` needs GNU or BSD `patch` on the PATH. The environment variable `MERMAID_SEQ_LOC_VERSION` overrides the version constant in `build.mjs`. Only the sync workflow uses it.

### Patch selection

One patch cannot fit two grammars when upstream changes a line the patch edits: `--fuzz=0` needs exact context. So a newer grammar gets its own patch file, and the pinned build keeps `loc.patch`.

| Target version | Patch used |
|---|---|
| Lower than every `loc.<v>.patch` (the pinned 11.17.2 today) | `loc.patch` |
| Equal to or higher than some `loc.<v>.patch` (12.3.0, 12.3.1, 13.x today) | The highest such `loc.<v>.patch` |

The generated file names the patch it was built from in its header. A future grammar that breaks the selected patch still fails loudly. The flowchart patch uses the same rule with the prefix `flowchart.loc` (`flowchart.loc.patch`, `flowchart.loc.<v>.patch`).

What `loc.12.3.0.patch` changes compared with `loc.patch`: only the `actor` hunk. Mermaid 12.3.0 turned `actor: ACTOR {...};` into a two-alternative rule (`ACTOR` or the `'link'` keyword token, because `link`, `links`, `properties` and `details` are now keywords only when followed by whitespace and a name). Both alternatives record `idLoc`.

## Upgrading Mermaid in conf-app

Do these in one PR together with the `mermaid` bump in `package.json`.

1. Fetch the new grammars: `node scripts/mermaid-seq-loc/build.mjs --fetch <new>`. A 404 means upstream moved or removed the file (see Langium below).
2. Set `MERMAID_VERSION` in `build.mjs` to `<new>`.
3. Build: `node scripts/mermaid-seq-loc/build.mjs`.
   - Before you build: if a `loc.<v>.patch` (or `flowchart.loc.<v>.patch`) with `<v>` <= `<new>` exists, rename it to `loc.patch` (or `flowchart.loc.patch`), replacing the old one, and delete any other versioned patch of that grammar that is now unused.
   - If it prints `... does not apply`, repair the named patch: diff `upstream/<file>.<old>.jison` against `<new>`, re-apply the same changes by hand to a copy of the new grammar, then regenerate the patch with `diff -u` (paths and headers as in the current file). Keep the context lines exact: `--fuzz=0` is deliberate, so a silent wrong placement cannot happen.
4. Install the new Mermaid (`pnpm add -w mermaid@<new>`; `-w` because the repo is a pnpm workspace), so `build.spec.ts` can compare versions.
5. Regenerate both corpora: `node scripts/mermaid-seq-loc/extract-corpus.mjs <new>` and `node scripts/mermaid-seq-loc/extract-corpus.mjs <new> --grammar flowchart`. Update the fixture imports in `sourcemap/corpus.spec.ts`, `sourcemap/flowchartCorpus.spec.ts` and `sourcemap/vendoredBundle.spec.ts` to the new file names and delete the old fixtures.
6. Run the tests (command above).
7. Delete `upstream/sequenceDiagram.<old>.jison` and `upstream/flow.<old>.jison`.

What a failing test means:

| Test | Meaning |
|---|---|
| `build.spec.ts` "up to date" | A generated file was not rebuilt after a patch or grammar change. Run the build. |
| `build.spec.ts` "installed mermaid version" | `MERMAID_VERSION` and the installed `mermaid` differ. |
| `corpus.spec.ts` or `svgKeys.spec.ts` | Our parse and Mermaid's own db disagree for a real upstream sample: a new grammar rule, or a changed db behavior. Read the failing source, then fix `loc.patch` or `getSourceMap.ts`. Never weaken the parity check: it is the safety net. |
| `flowchartCorpus.spec.ts` | The same for flowcharts: fix `flowchart.loc.patch` or `getFlowchartSourceMap.ts`. |
| `vendoredBundle.spec.ts` | Same, on the minified vendored bundle. |

## If versions drift at runtime

The pinned `mermaid` and the generated parsers are checked together by unit tests, so users normally never see a mismatch. If one occurs anyway (for example Mermaid's own db changed behavior for a rare construct), `getSourceMap` returns `null`. The diagram renders normally and is read-only for inline editing, and the app sends the `editor_inline_edit_unavailable` analytics event. Nothing breaks and nothing is edited at wrong positions.

## Weekly sync workflow

`.github/workflows/mermaid-seq-loc-sync.yml` runs weekly and on manual dispatch. It does not run on pushes or PRs.

| Job | Checks | Failure means |
|---|---|---|
| `installed` | `--check` and the tests on the pinned Mermaid, on Linux | `patch` or the build differs on Linux, or the pin is broken |
| `latest` | Fetches the newest published grammars, applies both patches, builds, installs that Mermaid in the CI workspace only, runs the tests | The next upgrade needs work. One GitHub issue (label `mermaid-seq-loc-sync`) is opened or updated, with the failing step. |

Nothing is committed by the workflow. The `latest` job does not use the new corpus fixture: the tests still read the pinned one. Regenerate it as part of the upgrade.

## If upstream moves sequence diagrams or flowcharts to Langium

The `.jison` fetch fails with a 404 and the weekly issue says so. Then this approach is no longer needed for that grammar:

1. Replace only the implementation behind the `GetSourceMap` type in `src/features/mermaidInlineEdit/types.ts` (`sourcemap/getSourceMap.ts` for sequence, `sourcemap/getFlowchartSourceMap.ts` for flowcharts). Langium CST nodes carry offsets, so the new implementation reads them directly. Keep returning `null` whenever the result cannot be trusted.
2. Keep the parity check against the official db and the corpus tests.
3. Delete that grammar's entry in `GRAMMARS` (`build.mjs`), its patch, vendored grammar and generated parser (the whole folder once both are gone).

The edit functions and the UI depend only on `SequenceSourceMap` / `FlowchartSourceMap`, so they do not change.

## Optional upstream contribution

Mermaid could let `sequenceDb` and `FlowDB` record source positions themselves. That would remove the patch. We do not depend on it, and nothing here waits for it.
