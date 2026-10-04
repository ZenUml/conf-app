# Pi diagram agent — design v2 (draft)

Status: implemented MVP, K=1 (design r2, revised after Opus critique); two-phase gate added (see "Two-phase gate" below). `/magic` runs this loop by default; `PI_DIAGRAM_V2=0` restores the single-session loop described in `agent-loop.md`. Parallel authors (`--authors K`) and reviewer thinking-level tuning are not implemented.

Implementation notes (deviations from the text below are listed here, not hidden):

- Code: `src/orchestrator.mjs` (rounds, ledger, revert, budgets, manifest), `src/findings.mjs`, `src/early-checks.mjs` (forbidden constructs, binding checks, region signatures, reviewer-vs-auditor coverage table), `src/reviewer.mjs`, `src/gate.mjs`, `src/manifest.mjs`; wiring in `pi-extension.ts`.
- Missing bindings: the auditor reports a candidate with no `data-node` / `data-source` / group ids as NOT-CHECKABLE (it cannot FAIL what it cannot see). The early checks treat that as a blocking finding.
- Node-to-group relations (`A --> SomeGroup`, the parser's `groupEdges`) are checked, not a not-checkable caveat (2026-10-04). In a layout spec an edge `source`/`target` may be a group id; the endpoint sits on the group rectangle with a perpendicular leg, and the SVG path carries `data-source-kind="group"` / `data-target-kind="group"`. The spec census pools node and group relations, so a group relation redrawn to a member node is `extra relation` + `missing relation`. The auditor binds a group end by that attribute or, without it, by a source group id; it splits group relations off before the route checks and verifies them by binding (`relations`: missing or extra FAIL, even when other caveats such as `--o` or `<-->` leave the node relations NOT-CHECKABLE), arrowhead (`markerDrawing`) and dashing (`relationStyle`). Route geometry checks (intrusion, crossings, parallel clearance, shaft, lower bend) still cover node-to-node routes only. Spec census findings reach only the author's render report; the gate decides on the audit, so `relations` is what blocks.
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
- Per-call model limit (`PI_DIAGRAM_MAX_CALL_S`, default 480 s): one author model call (provider request to end of the assistant message) may not outlast the limit. One stuck call (observed: 1500 s, 60,649 stream events, no text, no tool call) must not spend the whole 15-minute wall clock, and it is not a transport error, so nothing retried it. The timer lives in `pi-extension.ts` on `before_provider_request` / `message_start` (start) and assistant `message_end` (stop), so interactive `/magic` and the bench share it; tools, the reviewer and the Judge are outside it. On expiry the extension calls `ctx.abort()` (the same abort the wall-clock watchdog uses). At the resulting `agent_end` it records the timeout in `run.json` (`modelCallTimeouts`: n, at, elapsedS, limitS, action) and, for the first timeout, sends a follow-up user message that tells the author to continue from its current state (same session, history intact, no new session). A timeout of the retried call ends the run as `CANDIDATE` with reason `MODEL_CALL_TIMEOUT`, keeping the best candidate. A call that completes normally resets the count, so only two consecutive timeouts end a run. The bench treats `MODEL_CALL_TIMEOUT` (run.json `statusReason`) and `AGENT_ERROR` as retryable (`isRetryableRun`, `retryable` in `summary.json`), and its run tracker cancels the 5 s settle grace when a new `agent_start` follows `agent_end`, so the retry continuation is not cut off. Limit: Pi gives an extension no per-request signal; `ctx.abort()` aborts the whole agent operation, which is why recovery is a re-prompt rather than a transparent re-send. If the abort itself does not end the turn, only the wall clock remains. With the 15-minute default wall clock, two consecutive 8-minute call timeouts (16 minutes) cannot both finish, so the wall clock ends such a run first as `WALL_CLOCK`.

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
| Judge | Fresh model session per scoring pass, **no tools**; runs inside the loop under the relaxed gate (default) and explicitly via `/magic-judge` | Comparative visual scores and the IMPROVED / NOT_IMPROVED verdict, which decides acceptance in relaxed mode | Know which image is the candidate in a scoring pass; see source text, audit, review or the author's reasoning; find defects |
| Coach (in-loop, part of the Judge) | One short extra no-tools call after a NOT_IMPROVED verdict, told which drawing is the new one | The top 3 improvements to the candidate, as author feedback | Change the verdict |
| User | Human | Adjudications (e.g. group conflicts), accepting residual NOT-CHECKABLE items | — |

## Judge (comparative visual gate at acceptance)

Question: is the final SVG visibly better than the original Mermaid render? Spec: `docs/superpowers/specs/2026-10-03-pi-diagram-judge-design.md`.

- `/magic-judge <runDir> [--vs-old <runDir>]` renders the original and the candidate (full and 1200x710 fit), then runs two passes in fresh no-tool sessions in an empty temp cwd, order swapped (original = A, then candidate = A). The model gets only four images and a fixed prompt; the candidate is never named. Pass 2 is negated, a dimension where the passes disagree is 0 and `uncertain`, and `grouping` is null (and excluded) when the diagram has no groups (read from the original render's clusters).
- Six dimensions in -1..+1: balance, readability, aesthetics, lineClarity, pageWidth, grouping. IMPROVED = every merged dimension >= `PI_DIAGRAM_JUDGE_MIN_DIM` (-0.2) and mean >= `PI_DIAGRAM_JUDGE_MIN_MEAN` (+0.2); more than half uncertain = NOT_IMPROVED `UNSTABLE`; a pass failing after one retry = JUDGE_ERROR (never IMPROVED).
- `judgement.json` (`pi-diagram-judgement/1`, sealed like `run.json`) binds the candidate and original sha256. `/magic-accept` refuses a missing, NOT_IMPROVED, JUDGE_ERROR, stale (hash differs) or tampered judgement unless `--override-judge "<reason>"` is given; the reason is recorded in `acceptance.judgeOverride`. `--waive` is unchanged.
- Env: `PI_DIAGRAM_JUDGE_MODEL` (default the reviewer model), `PI_DIAGRAM_JUDGE_THINKING` (medium), `PI_DIAGRAM_JUDGE_TIMEOUT_S` (300 per pass). Native `openai-codex` only. Under the strict gate the Judge never runs inside `/magic` (explicit `/magic-judge` only); under the relaxed gate (default) it runs inside the loop, see [Relaxed gate](#relaxed-gate). Offline batch scoring (`bench/judge.mjs`) never gates.
- Residual: like `run.json`, the run directory is author-writable, so a hostile author with a shell could re-seal `judgement.json`. The gate protects against forgetting and accidents, and the recorded hashes make a forged judgement visible afterwards.

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
- `CANDIDATE` — did not pass the gate; residual findings listed. Relaxed reasons added: `NOT_IMPROVED (...)` with `ROUNDS_EXHAUSTED` or `WALL_CLOCK`, and `JUDGE_ERROR`.
- `REVIEWED` — passed the gate (under the relaxed gate, default: no blocking finding, review passed, and the Judge said IMPROVED at the in-loop threshold; see "Relaxed gate"); NOT-CHECKABLE rules (e.g. routeGeometry, visualQuality) listed. A model reviewer cannot certify them (rules: "AI does not substitute for … validation").
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

- Per run: max rounds (default 4), max wall clock (default 15 minutes, `PI_DIAGRAM_MAX_WALL_MIN`), max 3 author self-inspections per round (was 8).
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

## Relaxed gate

Why: the user's direction (2026-10-04) was "use visual judgement and relax the constraints, so the author focuses on what actually adds value; we want a better diagram, not one that satisfies hard-coded requirements". Approved: (1) only defects that make the diagram wrong or unreadable block; (2) spacing and geometry checks become advice; (3) the Judge decides acceptance: clearly better than the original; (4) on a rejection the author gets only the 3 most valuable improvements.

Mode: `PI_DIAGRAM_GATE=relaxed` (default) or `strict`. `strict` is the previous behaviour exactly (every check blocks, no Judge in the loop, waivers as above). Code: `src/relaxed.mjs` (single source of truth for the blocking set and the advice impact table), `auditToFindings(audit,{relaxed})`, `geometryFindings(g,model,{relaxed})`, `auditGateReasons({relaxed})`, the Judge phase in `src/orchestrator.mjs`.

```
build_check / submit
  │  script checks  ──blocking?──yes──▶ REVISE (blocking findings + top-3 advice)
  ▼
reviewer (blocking only: shape-change, label-ownership, text-overflow, heading-overlap)
  │  blocking? ──yes──▶ REVISE
  ▼
gate (hash identity, no blocking audit FAIL, semantics PASS or ADJUDICATED)
  ▼
Judge, both passes, exact final bytes vs original   (in-loop thresholds)
  ├─ IMPROVED ───────────▶ REVIEWED  (judgement.json sealed, /magic-accept unchanged)
  ├─ NOT_IMPROVED ───────▶ coach call ──▶ REVISE (judge top-3 improvements + blocking + top-3 advice); costs a round
  └─ JUDGE_ERROR ────────▶ CANDIDATE JUDGE_ERROR (never REVIEWED)
rounds / wall clock spent while NOT_IMPROVED ──▶ CANDIDATE, reason "NOT_IMPROVED (...): ROUNDS_EXHAUSTED | WALL_CLOCK"
```

### Check feedback loop (relaxed gate)

Why: two live runs (per-check log) showed 7-9 blocking rule kinds on the first check, only 2-5 kinds fixed per check, a rule fixed at check 2 and broken again at check 3, an 8-finding cap that hid the full blocking list, and a spare check spent on advisory items after CHECK_PASS. Changes, relaxed gate only (strict keeps `maxFindingsPerCheck` = 8 and its old texts):

1. **Complete blocking list.** The `diagram_build_check` reply lists every blocking finding (`omittedBlocking` is always 0). Above 8 findings the evidence text is compressed (measured 200 chars, threshold 80, suggestion 240), never the list. Advice stays at the 3 highest-impact items plus `advisoryMore` (the count of the rest, also written as "+N more" in `next`).
2. **Regression flag.** The orchestrator keeps, per run, the history of each blocking finding key (`rule|elements`). A key that was present, absent at check #N, and present again is marked `REGRESSION: fixed in check #N, broken again`, listed first (state `regressed`), and echoed in a top-level `regressions` array. Each `run.json` `twoPhase.checks` entry carries `regressions` (count). Cache hits advance the history like any other check; implicit submit-time checks do not.
3. **Submit right after a pass.** A CHECK_PASS reply says: "No blocking findings. Submit now with diagram_submit (svgHash ...). Do not spend more checks on advisory items." Since 2026-10-05 it carries no advisory detail: no `advice`, no `advisoryMore`, no `advisoryRules` (only the `minorCount` number), and its `checks` map shows an audit check that failed with advisory severity only as `ADVISORY`, not `FAIL`; advice is sent with CHECK_FAIL replies only. Why: in a rank-39 run the author kept polishing after check #2 passed at 120 s and made 4 more edit+check cycles (all CHECK_PASS) before submitting at 339 s; across 13 runs 9 of 67 checks were same-round checks after a pass. Two more texts point the same way: the direct-draft prompt line now reads "After that inspection, fix what blocks; if the latest check passed, submit it." (it used to ask for revision "with full rigour"), and a `diagram_inspect` result gets a `next` text while the round holds a CHECK_PASS: "Check #N passed for hash H. Submit it now with diagram_submit; advisory items are not a reason for another check." (or, when `candidate.svg` has changed since, that the passing hash exists and the current bytes are unchecked or failing). Prompt-only by decision: no hard refusal of further checks after a pass beyond item 4.
4. **Repeat check refused (decision, 2026-10-04).** After a CHECK_PASS, a further `diagram_build_check` is refused (`status REFUSED`, `code UNCHANGED_PASSING_BYTES`, `countedAsCheck false`) while `candidate.svg` still has the hash of that pass. The refusal is not a check: `checksUsed*` do not move and the entry is not in `twoPhase.checks`; it is recorded in `twoPhase.refusals`. Any change to the bytes allows the next check. Safe because the check is a deterministic function of the bytes (a repeat is a cache hit and returns the same findings), `diagram_submit` reads the same cache so nothing is lost, and failing bytes may still be re-checked. The latch is cleared when a submit round ends, so after a revise message the author can check again. A generator (`make.py` / `layout.json`) still runs before the comparison, because only the built bytes show whether anything changed.
5. **First-draft semantics.** The author prompt (relaxed, two-phase) tells the author to verify every node's group and every edge's endpoints and direction against the source facts before the first `diagram_build_check`. One short paragraph (`RELAXED_CHECK_PARAGRAPH`).

Tests: `test/check-feedback.test.mjs`.

### Check cap

The relaxed gate briefly defaulted to 3 checks per round (c35656e7). A 14-run A/B on 7 customer diagrams (cap 3 against cap 6, 1 run per diagram per arm) reverted it: cap 3 gave a median of 905 s against 829 s for cap 6, 14 rounds against 11, and a median Judge score of 0.55 against 0.60. The relaxed default is back to 6, the same as strict. `PI_DIAGRAM_MAX_CHECKS_PER_ROUND` still overrides it. The advisory pass-through after the cap, the per-check log, and the check feedback loop above are unchanged.

### Blocking-set mapping

Evidence fields written by the auditor drive the partial checks. Evidence that lacks the needed field fails closed (stays blocking).

| Check / rule id | Relaxed severity | Rule |
|---|---|---|
| `svgWellFormed`, `nodeIdentity`, `nodeText`, `nodeShape`, `relations`, `relationStyle`, `groups`, `groupMembership`, `originalGroupParity`, `semanticPreservation`, `sourceDefinitionConflicts` | blocking | what the diagram says |
| early binding findings (no `data-node` / `data-source` / group id), `forbidden-construct` (incl. `context-stroke`), `candidate-missing`, `render-or-audit-failed`, `gate-*` | blocking | structural |
| `markerDrawing` | blocking | missing or invisible arrowhead |
| `labelCoversRoute` | blocking | a label background hides a line. Decision: `edgeLabelStyle` (border, opaque background) is style and is advice; only an actual overlap with another route is "a label covering a line" |
| `textFit` | blocking per node | `overflows`: the largest side overflow is more than the 8-unit inset (text outside the shape itself); `structureOverlaps`: gap <= 0 (text touches a drawn stroke). Smaller overflows, gaps of 0..4 units and `labelBoxWarnings` are advice |
| `labelClearance` | blocking per label | the label box overlaps a node whose text it covers (`coversNodeText`, new evidence field). A label touching only an outline (node or container) is advice |
| `nodeHeadingClearance` | blocking per node | `kind: heading` with gap 0 (overlap). The 8-unit heading margin and the container-border margin are advice |
| `routeHeadingClearance` | blocking per edge | the route is sampled inside the heading text box (`headingOverlaps`, new evidence field). The 2-unit guard is advice |
| `routeNodeIntrusion` | blocking per edge | the route is sampled inside another node's text box (`textIntrusions`, new evidence field). Fill-only intrusions and endpoint misses are advice |
| `label-ambiguous` (geometry) | blocking when the label box is within 0.5 units of the other route, else advice | a label on the wrong edge |
| `label-detached`, `route-border-clearance` | advice | gap and clearance distances |
| `routeContainerClearance`, `routePairClearance`, `routeLowerBend`, `routeCrossings`, `routeDetour`, `labelFontFit`, `legendCompleteness`, `connectorStrokeWidth`, `filletUniformity`, `markerUniformity`, `textContrast`, `labelFontWeight`, `routeCornerAnchor`, `routeUnrelatedContainerTransit`, `arrowShaft`, `edgeLabelStyle` | advice | geometry and style niceties |
| reviewer `shape-change`, `label-ownership`, `text-overflow`, `heading-overlap` | blocking | |
| every other reviewer rule (`detour`, `legend`, `balance`, `route-node-intrusion`, `route-crossing`, `node-heading-clearance`, `label-clearance`, `other`) | advice | |

Advice findings keep the finding format with `severity: minor` and `impact` (0..1, `ADVICE_IMPACT` in `src/relaxed.mjs`: crossings 0.7, detour 0.6, label font fit 0.6, ... legend 0.1). The relaxed gate ignores audit FAILs that have no blocking part, so a passing run can still carry FAIL-status advice; the manifest residual lists it. Waivers and escalation apply only to blocking findings; advice never needs a waiver.

### Judge in the loop

- The Judge runs only when the round has no blocking finding, the reviewer passed and the gate's hash identity holds, on the exact final bytes against the original render (`judgeSvgs`, same renderer and prompt as `/magic-judge`). The same two passes (order swapped) apply.
- In-loop thresholds (`acceptThresholdsFromEnv`): merged mean >= `PI_DIAGRAM_ACCEPT_MIN_MEAN` (default +0.2 since 2026-10-04, the user's decision; the calibration showed the Judge is about 2x more generous than the user, and +0.4 matched the user on 5 of 5 pairs, so the new default is deliberately looser than the calibrated point), every merged dimension >= `PI_DIAGRAM_ACCEPT_MIN_DIM` (default -0.2), and each pass's own mean (candidate direction) >= `PI_DIAGRAM_ACCEPT_MIN_PASS` (default +0.1, a separate and lower threshold than the merged mean; history: 0.4 under the first relaxed gate, which timed out 5 of 5 retried customer diagrams after Judge rejections, then 0.3 (26e10d9b), then 0.1 on 2026-10-04), so two votes must lean the same way. A failing pass mean is reported as `PASS_MEAN_BELOW_MIN`. `/magic-judge` keeps its own thresholds (+0.2). In-loop history: merged 0.4 with both passes at 0.4, then 0.4/0.3 (26e10d9b), then 0.2/0.1 on 2026-10-04.
- `judgement.json` is written in the run directory for every in-loop judgement (sealed, bound to the candidate and original hashes, `inLoop: true`, `passMeans`, `improvements`). `/magic-accept` verifies it exactly as before; a NOT_IMPROVED or JUDGE_ERROR judgement refuses acceptance.
- **How the improvements are produced:** the scoring passes stay blind (the candidate is never named, so the verdict is not biased). After a NOT_IMPROVED verdict, one separate short no-tools call (the coach) receives the four images (original full, original fit, candidate full, candidate fit), is told which drawing is the new one and which dimensions scored lowest, and returns up to 3 `{change, dimension, why}` items, best first. The coach never changes the verdict; if it fails twice the author gets the Judge's dimension scores with `improvements: []`.
- Revise message (relaxed): `findings` (blocking only, at most 5), `advice` (the 3 highest-impact items) with `adviceTotal`, `minorCount`, and for a NOT_IMPROVED round `judge: {verdict, reason, mean, passMeans, dimensions, improvements[<=3]}`. The full advice list is never sent.
- Statuses: `REVIEWED` needs IMPROVED; `CANDIDATE` with reason `NOT_IMPROVED (<judge reason>): ROUNDS_EXHAUSTED | WALL_CLOCK` when the budget ends first; `CANDIDATE` with `JUDGE_ERROR: ...` when a pass still fails after its retry (treated like a reviewer error, ends the run). Best-candidate order: fewest blocking, then highest Judge mean (a judged candidate beats an unjudged one), then fewest minor findings, then the newer. A judged round does not count toward the blocking-count stagnation rule; rounds and wall clock bound it.
- Manifest: `gate`, `judge: {enabled, thresholds, model, rounds[]}`, per-round `judgement`, `modelCalls.judge`, `tokens.judge`, `timings.judgeMs`.
