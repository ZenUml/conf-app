# Pi diagram agent — design v2 (draft)

Status: draft r2 — revised after Opus critique (private review record design-v2-review.md). Supersedes the single-session loop described in `agent-loop.md` once implemented.

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
- `VALIDATED` — a REVIEWED candidate whose exact SVG hash a human accepted through the command line, recorded like an adjudication. Never set by a model.

## Interfaces

- **Findings format** (auditor and reviewer share it): `{id, source: "audit"|"review", severity: "blocking"|"minor", rule, element ids, region bbox, evidence, suggested direction}`. The author receives findings, never the reviewer's free-form opinion of style.
- **Deterministic checks return reasons, not just exceptions**: every FAIL names the rule, the elements, the measured value and the threshold. (Kit lesson.)
- **Findings ledger**: stable key = rule id + sorted element ids; each finding is `open | fixed | regressed` across rounds. At most 5 blocking findings are sent per round, highest severity first.
- **Verifying reviewer findings**: a reviewer blocking finding is downgraded only when the auditor actually measured those elements with a method that covers that geometry (e.g. straight-span checks do not cover curves or fillets). Otherwise it stands.
- **Reviewer checklist** (defects the auditor cannot see, all observed in runs): group/section reading order, label on the wrong edge or detached from it, avoidable long detours, legend completeness (colour, shape and line keys), heading or text overflowing its frame, overall balance at 1200×710.
- **Early mechanical checks at every author inspection**, not only at the gate: `context-stroke`, missing node/relation/group bindings, uninspected final bytes.
- **Manifest** (`run.json`): source, rules, adjudication, final SVG and media hashes; per-round audit and review results; per-role timings and token counts; final status.

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
