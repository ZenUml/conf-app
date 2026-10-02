# Pi diagram agent benchmark

Small synthetic benchmark for the Pi `/magic` diagram agent: five generic Mermaid flowcharts (4-8 nodes, no customer data), a harness that runs the real agent on each, and an independent audit of every final SVG. Use it to compare two package variants (for example a frozen baseline against one with an experimental change) on the same inputs.

**Warning: this calls the real model.** Every run is a full `pi --mode rpc` agent turn on native `openai-codex` `gpt-5.6-sol` at high thinking, typically 4-10 minutes and tens of thousands of output tokens. It spends your subscription quota. Do not run it in a loop or at high concurrency without checking the quota first. Run outputs (event logs, SVGs, audits, summaries) are never committed: `--out` must be outside the repository.

## Fixtures

`fixtures/*.mmd` use only syntax `src/parser.mjs` supports (all synthetic); each has `<name>.expected.json` (node ids and text, directed edges with label and dashed flag, group membership).

| fixture | covers |
|---|---|
| f1-chain-fold | six equal nodes A to F in `flowchart LR` (the rules' fold fixture) |
| f2-decision | process, decision with Yes/No labelled branches, two outcomes, merge |
| f3-groups | two subgraphs, a cross-group edge, one ungrouped node |
| f4-stores | cylinder store, queue-like subroutine shape `[[...]]`, one dashed edge |
| f5-converge-labels | three sources converge on one target, edge labels, one dashed relation |
| f6-td-pipes | `flowchart TD`, pipe labels, a dashed and a thick relation |
| f7-classes-shapes | `:::class` suffixes, stadium, subroutine, cylinder, circle and hexagon shapes |
| f8-nested-groups | a subgraph inside a subgraph, `direction` inside a group, membership paths |

Parser limits worth knowing when adding fixtures: HTML other than `<br>` and formatting tags (`b i u s em strong code span small sub sup mark kbd`, text kept) is refused; a node declared twice with different text is refused (`conflicting node text`); the `@{ shape: ... }` node syntax and edge ids (`e1@-->`) are refused. Every refusal is `PARSE_UNSUPPORTED line N: <construct>`. A node's declared group is the subgraph where its text is defined, else where it is first referenced; `mermaidGroupPath` is where Mermaid itself places it (first completed subgraph that references the node).

## Run

```sh
node tools/pi-diagram-agent/bench/run-bench.mjs \
  --package /path/to/package/tools/pi-diagram-agent \
  --fixtures tools/pi-diagram-agent/bench/fixtures/*.mmd \
  --reps 3 --concurrency 4 \
  --out /tmp/pi-bench/my-run \
  [--magic-options '--some-flag'] [--timeout-min 15] [--pi-bin /path/to/pi] [--env KEY=VALUE]...
```

`--fixtures` takes a comma-separated list of paths, bare fixture names (`f2-decision`) or globs (quote them so the shell does not expand them if you want the harness to). `--pi-bin` selects the Pi executable (default `pi` on PATH), e.g. a separate npm install of another Pi version. A run finishes on `agent_settled` (Pi docs/rpc.md: `agent_end` is not final); if `agent_end` arrives and no `agent_settled` follows within 5 s (Pi 0.84.x never emits it) the run finishes as `AGENT_END_NO_SETTLE`. All of `AGENT_SETTLED`, `AGENT_END_NO_SETTLE` and legacy `AGENT_END` count as completed. `--env KEY=VALUE` (repeatable) is added to the spawned Pi's environment (e.g. `PI_DIAGRAM_FIRST_DRAFT_THINKING=high`); the event log then carries `thinking-level` and `thinking-note` records. `--package` is the package root whose `pi-extension.ts` is loaded; the auditor is always this worktree's `src/agent-audit.mjs` (override with `--auditor`). The Playwright, Chromium and Mermaid bundle environment variables default to the paths used by the existing smoke driver; export `PI_DIAGRAM_*` to override.

## Outputs (in `--out`)

Per run: `<fixture>-r<n>.jsonl` (event log), `.candidate.svg`, `.audit.json`. Overall: `summary.json` and `summary.md`, rewritten after every finished run so a partial batch is still readable.

Per run the summary records elapsed time, time to the first `diagram_inspect` (fixed overhead before any candidate exists), input/output tokens, tool calls, inspections, done reason, SHA-256 of the final `candidate.svg`, whether that exact SVG was inspected (its hash-prefixed render `candidate.<sha12>.*.png` exists in the run directory), and the audit result. Audit `routeGeometry` and `visualQuality` are NOT-CHECKABLE by design, so the overall audit status is always NOT-CHECKABLE; the summary lists only FAIL checks and other NOT-CHECKABLE checks.

Timing and token statistics (median, min, max) cover completed runs only (`AGENT_END`, no rate limit). Rate-limit detection matches provider error text in stderr, failed responses, failed tool results and assistant error messages, never numbers; once seen, no further runs start.

## Tests

`node --test tools/pi-diagram-agent/bench/bench-lib.test.mjs` covers the aggregation, the rate-limit matcher and fixture/expected consistency. It needs no network or model. It is not wired into `npm test`.
