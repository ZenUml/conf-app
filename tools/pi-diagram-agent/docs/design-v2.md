# Pi diagram agent — design v2 (draft)

Status: implemented MVP, K=1 (design r2, revised after Opus critique); two-phase gate added (see "Two-phase gate" below). `/magic` runs this loop by default; `PI_DIAGRAM_V2=0` restores the single-session loop described in `agent-loop.md`. Parallel authors (`--authors K`) and reviewer thinking-level tuning are not implemented.

Implementation notes (deviations from the text below are listed here, not hidden):

- Code: `src/orchestrator.mjs` (rounds, ledger, revert, budgets, manifest), `src/findings.mjs`, `src/early-checks.mjs` (forbidden constructs, binding checks, region signatures, reviewer-vs-auditor coverage table), `src/reviewer.mjs`, `src/gate.mjs`, `src/manifest.mjs`; wiring in `pi-extension.ts`.
- Missing bindings: the auditor reports a candidate with no `data-node` / `data-source` / group ids as NOT-CHECKABLE (it cannot FAIL what it cannot see). The early checks treat that as a blocking finding.
- Audit-derived findings carry element ids but `region: null`; only reviewer findings have a region (a fraction of the full image, converted to SVG units).
- Manifest location: the orchestrator writes the authoritative sealed manifest to `~/.pi-diagram-agent/manifests/<runId>.json` (directory 0700, file 0600; `PI_DIAGRAM_MANIFEST_DIR` overrides) before the first model turn, keeps the latest copy in memory, and mirrors it to `run.json` in the run directory. `/magic-accept` reads the authoritative copy, compares it with the live process's in-memory manifest when this process orchestrated the run, rejects the run if `run.json` disagrees, then checks status REVIEWED, the named hash and the candidate bytes. Residual risk: the author's shell runs as the same OS user, so it can reach `~/.pi-diagram-agent` too; for a run from another process only file consistency is checked. The real guarantee is that acceptance is a human command naming one exact SVG hash, re-checked against the bytes on disk.
- Semantics for a source without groups: the auditor reports `originalGroupParity` (and so `semanticPreservation`) PASS, with evidence "source declares no groups and original render has no clusters", only when the original render was supplied and BOTH facts hold; a cluster in the original that the parser did not see, or no original, stays NOT-CHECKABLE. The gate has no group-less exception: semantics must be PASS or ADJUDICATED. (The first live smoke found the auditor's old default, "original rendered SVG was not supplied", for every group-less source.)
- Reviewer defaults follow the offline recall measurement (114 s per review with seven images at high thinking): images are original + candidate + fit (+ quadrant crops of regions flagged by earlier open findings), thinking `medium`, both configurable. Label detachment (> 25 units) and route-to-border clearance (< 12 units) are deterministic early checks from measured geometry (`src/geometry.mjs`), not reviewer judgement; the reviewer is also given those coordinates and must cite measured values.
- Reviewer instability: a reviewer blocking finding that is new in a review while the geometry it concerns is unchanged since the previous kept review is logged `unstable` but stays blocking (fail closed): per-run reviewer recall is about 67%, so "missed last time, caught now" is usually a real defect. The baseline is the last review of a kept round; a reverted round's review never becomes the comparison. The mirror case (reported, then gone on unchanged geometry) is counted as a false-block candidate.
- The reviewer session runs in a fresh empty temp directory, never the author-writable run directory.
- Reviewer inputs that are author-controlled: element ids in the measured geometry come from SVG attributes, so only ids the source declares reach the prompt; text drawn in the images is declared to the reviewer as diagram content, never instructions (drawn text addressing a reviewer is itself a blocking finding). Residual: `nodeText` binds node labels only, so legend/title/free text in the images remains an injection channel that only the prompt instruction guards.
- Reviewer timeout: each attempt is bounded (`PI_DIAGRAM_REVIEWER_TIMEOUT_S`, default 300 s); a timeout is a failed attempt and two failures are `REVIEWER_ERROR`. A reviewer error never marks earlier reviewer findings fixed: they stay open, are counted against the unreviewed candidate when choosing the best candidate, and are listed (`carried`) in the residual.
- Measured-geometry checks (label gap > 25 units, route clearance < 12 units) report NOT-CHECKABLE (`labelDetachment`, `routeBorderClearance` in the manifest's `notCheckable` and in `diagram_inspect` early checks) when geometry is unavailable or a source-labelled edge has no measured label or route; they are never a silent PASS.
- A reviewer error (malformed output twice, provider error) ends the run as CANDIDATE with `REVIEWER_ERROR`; it is never a pass and does not consume further author rounds.
- Revert and best-candidate comparison use the lexicographic pair (audit-side blocking, reviewer blocking), then minor count. An audit failure outranks any number of reviewer opinions.
- Wall clock: checked at each submit, and also enforced without one. A watchdog timer set at `/magic` (budget + 50 ms) and every author `message_end` past the budget call `ctx.abort()` on the author turn and finalise the run as CANDIDATE `WALL_CLOCK` (best submitted candidate, or the final bytes audited but not reviewed). Finalisation is serialised behind any in-flight submit, so it never races one. Not verified against a live Pi session: whether `abort()` on the command's context still stops the turn after the command handler has returned; the run's status is bounded either way, because later submits return the final status.

## Why v2

Evidence from the 2026-10-02 runs (private run records; no customer content here):

| Observation | Evidence | Consequence |
|---|---|---|
| Unreviewed `/magic` output quality varies widely | 8 fresh runs: ~2 near accepted quality; others had reversed group order, Safari-black arrowheads (`context-stroke`), missing relation bindings, route crossings, labels on the wrong edge | One model session cannot be the only judge |
| The author sometimes never inspects its final SVG | 1 of 8 runs edited the SVG after its last `diagram_inspect` | The orchestrator must re-render the final bytes itself |
| Self-review misses defects that independent review finds | Case A/B: label ownership, border grazing, text overflow found only by an outside reviewer, over 3–5 rounds | Review needs a separate context |
| Model output dominates time | 96.6% of wall clock; ~20–25 s per 1k output tokens | Speed work targets output tokens and rounds, not rendering |
| Strict helpers that only raise cause retry loops | Kit experiment: 16 error→retry cycles in one run, +26% time | Every deterministic check must return an actionable reason |

## Roles

| Role | Kind | Owns | Must not |
|---|---|---|---|
| Orchestrator | Extension code (deterministic) | Run state, budgets, hashes, rendering, gate, manifest | Choose layout or judge aesthetics |
| Author | Model session | Every position, port, route, label placement; the SVG | Certify its own output |
| Reviewer | Separate in-process model session, fresh context, **no tools** | Visual/semantic findings with evidence | Edit files; read the run dir; see SVG text or the author's reasoning (author-controlled text is an injection channel) |
| Auditor | Deterministic code | Mechanical rule checks with PASS / FAIL / NOT-CHECKABLE / ADJUDICATED | Turn missing evidence into PASS |
| User | Human | Adjudications (e.g. group conflicts), accepting residual NOT-CHECKABLE items | — |

## Control flow

```
/magic source.mmd [--adjudication f] [--authors K]
  │
  ▼
Orchestrator: hash source+rules, render original once, freeze adjudications
  │
  ├──▶ Author_1 … Author_K   (parallel, independent; K=1 default)
  │       write candidate → diagram_inspect → revise
  │       signals "ready"
  ▼
Orchestrator: re-render FINAL bytes itself, run Auditor
  │   audit FAIL? ──yes──▶ structured findings back to that Author (round+1)
  ▼
Reviewer (fresh session): original + candidate full/crops/fit + audit JSON
  │   returns findings JSON {id, severity, rule, region, evidence}
  │   blocking findings? ──yes──▶ back to Author (round+1)
  ▼
Gate (deterministic):
  - reviewed hash == final hash == last orchestrator-rendered hash
  - auditor: no FAIL; semantics PASS or ADJUDICATED
  - no forbidden constructs (script, foreignObject, context-stroke)
  - reviewer: no open blocking findings
  │
  ├── pass → status REVIEWED (K>1: fewest blocking, then fewest minor findings wins)
  └── budget exhausted / no progress → BEST candidate so far, status CANDIDATE + residual list

User (optional): /magic-accept <run> <svg-sha256>  → status VALIDATED for exactly that hash
```

Status semantics:
- `CANDIDATE` — did not pass the gate; residual findings listed.
- `REVIEWED` — passed the gate; NOT-CHECKABLE rules (e.g. routeGeometry, visualQuality) listed. A model reviewer cannot certify them (rules: "AI does not substitute for … validation").
- `REVIEWED_WITH_EXCEPTIONS` — passed the gate except for code-permitted waivers (routePairClearance, routeContainerClearance, routeCrossings with no code-found repair) that the reviewer's diagnosis requested; each waived check, its element ids, measured value and the reviewer's reason are listed. Never auto-published as the default Magic image. A human promotes it with `/magic-accept <run> <sha> --waive <every waived check>`.
- `VALIDATED` — a REVIEWED or REVIEWED_WITH_EXCEPTIONS candidate whose exact SVG hash a human accepted through the command line, recorded like an adjudication. Never set by a model.

## Interfaces

- **Findings format** (auditor and reviewer share it): `{id, source: "audit"|"review", severity: "blocking"|"minor", rule, element ids, region bbox, evidence, suggested direction}`. The author receives findings, never the reviewer's free-form opinion of style.
- **Deterministic checks return reasons, not just exceptions**: every FAIL names the rule, the elements, the measured value and the threshold. (Kit lesson.)
- **Findings ledger**: stable key = rule id + sorted element ids; each finding is `open | fixed | regressed` across rounds. At most 5 blocking findings are sent per round, highest severity first.
- **Verifying reviewer findings**: a reviewer blocking finding is downgraded only when the auditor actually measured those elements with a method that covers that geometry (e.g. straight-span checks do not cover curves or fillets). Otherwise it stands.
- **Reviewer checklist** (defects the auditor cannot see, all observed in runs): label on the wrong edge or detached from it, avoidable long detours, legend consistency (a legend is optional; a drawn entry that contradicts actual use is blocking, missing keys are minor), heading or text overflowing its frame, overall balance at 1200×710.
- **Early mechanical checks at every author inspection**, not only at the gate: `context-stroke`, missing node/relation/group bindings, uninspected final bytes.
- **Manifest** (authoritative copy outside the run directory, mirrored to `run.json`): source, rules, adjudication, final SVG and media hashes; per-round audit and review results; per-role timings and token counts; final status.

## Budgets and speed

- Per run: max rounds (default 4), max wall clock, max 3 author self-inspections per round (was 8).
- Convergence: a round that increases blocking findings is reverted to the previous candidate; the loop stops when blocking findings stop decreasing for 2 rounds.
- Author session stays alive between rounds (first write currently costs 186–277 s and 100–200k input tokens per fresh session).
- Parallel authors (`--authors K`) cut tail latency; selection is fewest blocking findings, not first-passing (first-passing rewards a reviewer that misses defects); cost scales ×K. Default K=1 until the small-example benchmark shows the pass rate.
- Reviewer runs at a lower thinking level than the author if the benchmark shows no loss in finding recall.
- Fixed overhead (rules + source + first script) is measured separately on the small-example benchmark and optimised there first.

## Safety

- Author tools confined to the run directory (sandbox later); reviewer gets read-only inspection only.
- Adjudications only from the command line, outside the run directory, hash-recorded before any model turn and included in both author and reviewer prompts.
- Source text is data; instructions inside it are ignored.

## Pi runtime

Target Pi 1.0.0 (verified: extension type-checks with 0 errors; no built-in sub-agents). Reviewer runs as an in-process `createAgentSession()` with no tools and images passed inline — to be proven by a spike, since no shipped example passes images to a nested session. Fallback: spawned `pi` process (subagent example pattern). RPC consumers must finish on `agent_settled` (1.0.0 `docs/rpc.md`), falling back to `agent_end`. Author and reviewer share a model family, so reviewer recall is measured, not assumed.

## Measurement plan

1. Baseline: small-example benchmark on 0.84.2 (running).
2. Same benchmark on 1.0.0, no other change → upgrade effect.
3. v2 loop with K=1 → pass rate, rounds, time.
4. v2 with K=2/3 → tail latency vs cost.
5. Reviewer recall offline: private regression set of the 8 experiment SVGs + Case A/B candidates labelled with coordinator verdicts; no author runs needed.
6. Final validation on Case A and Case B against past multi-round totals (~1,920 s A, ~2,417 s B).

Benchmark metrics per run: time to first candidate, rounds, author and reviewer seconds/tokens, gate status, false blocks (reviewer blocking findings later judged invalid), oscillations (finding regressed after fixed).

## Two-phase gate

Why: in 441 real submit rounds 31% were script rejects with no reviewer call, and 74% of those submitted bytes had never been inspected (inspect is capped at 3 per round, and it is the author's only look at the audit).

```
Author: edit make.py ──▶ diagram_build_check (jobId; text only)
  │   1 run make.py via ctx.executeTool(bash) (60 s) | render layout.json (spec mode) | candidate.svg as written
  │   2 sha256 of the bytes   3 full auditor + measured geometry + early findings   4 text result   5 cache by hash
  │   caps: 6 per round, 16 per run (every call counts); diagram_inspect (images) <= 3 per round, not a gate
  ▼
diagram_submit [svgHash]  ── bytes unchecked / latest check FAIL / stale hash ──▶ REFUSED (not a round)
  │   no FAIL: reuse cached phase 1, render, reviewer (visual focus + report-anything breadth)
  │   last allowed check of the round still FAILs and the author submits ──▶ ESCALATION
  │        semantic or structural FAIL ──▶ reject as today (no reviewer, never waived)
  │        else reviewer DIAGNOSIS (images + remaining findings + repair/move hints)
  │             waiver (code-validated: routePairClearance | routeContainerClearance | routeCrossings with null hints)
  │                   ──▶ REVIEWED_WITH_EXCEPTIONS      invalid/partial waiver ──▶ REVISE
  │             relayout advice (direction, group-order, branch-side, split, merge) ──▶ REVISE, counts as a round
  ▼
REVIEWED (zero script FAILs) | REVIEWED_WITH_EXCEPTIONS (human acceptance per waiver) | CANDIDATE
```

Decisions and why:

- The check is binding in code, not advice: the submit refusal is the only enforcement the author cannot talk its way around, and a refusal is not a round, so being told "fix this first" costs no budget.
- A check is one tool call that includes the build, so the author's loop has no separate "run the script" turn (fewer tiny model turns). Generator failures are text, not tool errors, so the author reads them as feedback.
- Waivers are narrow on purpose. Border grazing and a crossing that code itself confirmed has no repair are the only things a geometric rule can be wrong about in a way a picture can settle; every other rule failure has a repair. Semantic failures can never be waived. The reviewer proposes, code disposes, and a human accepts each waiver by name.
- Caps (6/16) are first estimates; run.json records per-round build_check calls, refusals, cache hits and generator errors so they can be re-measured.
- `PI_DIAGRAM_TWO_PHASE=0` restores the one-phase submit for benchmark comparability.
