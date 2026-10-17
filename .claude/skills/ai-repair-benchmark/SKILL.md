---
name: ai-repair-benchmark
description: Compare how OpenRouter models repair the same damaged DSL; run only L1 raw-model and L2 Diagramly Prompt trials, measuring repair quality, latency, tokens, and actual cost. Use ai-repair-case-validation to investigate and regress specific cases.
---

# AI Repair Benchmark

This skill **runs only L1 and L2** to compare the effects of the model and Diagramly Prompt on repair results. Use `ai-repair-case-validation` to investigate specific AI Repair failures, verify repairs, and run regressions.

| Layer | Call | What it measures |
|---|---|---|
| L1 Raw model | OpenRouter model + minimal neutral repair instruction + original DSL + real error | The model's baseline repair ability |
| L2 Diagramly prompt | Same model + Diagramly modify prompt, repair hints, and error context from the current checkout | Repair quality with the product prompt |

## Inputs and authorization

Identify the DSL file, language, Diagramly `diagramType` / `languageKey` / `subTypeKey`, the parser's actual error, and any optional required anchors. The user specifies the model list; if none is specified, use the models in the manifest. **For direct model comparisons, every model must receive the same original DSL, error, and layer**; never use one model's output as the next model's input.

This workflow sends the full DSL to OpenRouter. If the DSL is from production or may contain customer information, first obtain the user's explicit authorization to send “this DSL → OpenRouter → the selected model.” Artifacts are written to `/tmp/ai-repair-benchmark/<run-id>/` by default; do not write customer data to the public repository. For long-term storage, use the `private/` submodule and check its privacy rules first.

Before starting, check the HEAD and working-tree status of both the conf-app and Diagramly repositories; do not overwrite existing changes. This skill does not create branches, commit, or deploy.

## Run

Read [methodology.md](references/methodology.md) first and create a run manifest. Use `scripts/build_diagramly_prompt.ts` from the current Diagramly checkout to generate the actual L2 messages and prompt hash; do not copy the prompt by hand. `reasoningDisabled` is a cross-layer setting for AI Repair and AI Chat. Within an L1/L2 comparison group, keep temperature, max tokens, and reasoning settings consistent, and record the effective values, provider, and cache information. For product regressions, these settings must also match L3/L4 on the same path.

Run raw and diagramly modes separately with `uv run scripts/run_openrouter_matrix.py`. Immediately validate each candidate after its model call with `uv run scripts/score_candidates.py`, before making the next call; do not make a batch of calls and validate afterward. By default, run each DSL once per model per layer. Add repeated trials only when the user asks to assess random variation, and report them separately. A single result is one observation, not a model success rate. Use representative DSL samples to compare general repair performance.

Candidate hard gates: non-empty, not a no-op, and successful parsing and rendering for the applicable language. Also report identifier retention, changed line ratio, required anchors, and quality grade. The current `score_candidates.py` PASS covers only its syntax check and **does not by itself prove successful rendering**. Mermaid must also be parsed and rendered in a browser using the Mermaid version in the current checkout. Mark results `UNVERIFIED` when no applicable validator or rendering evidence is available; do not call them a complete PASS. Syntactic validity does not prove that business semantics were preserved; use required anchors or manual review.

Report pass status, quality grade, p50/p95 latency, tokens, cache, provider, actual USD cost, and failure reasons by model × layer. Prefer `total_cost` from the response or generation API for actual cost; do not present static price lists as measured costs. Generate a self-contained HTML report with `uv run scripts/summarize_benchmark.py`. By default, local/private reports include the full input DSL, type, real error, line count, character count, and SHA-256. Use `--redact-dsl` only when the user explicitly requests a public/redacted report. State the sample size; do not infer a stable success rate or SLA from a small number of trials.

## Completion criteria

- Every planned model has a PASS, FAIL, or SKIPPED with a reason for both L1 and L2.
- Every candidate has the applicable parse/render checks.
- The report includes input identity, configuration, sample size, per-trial records, aggregate statistics, and cost provenance.
- No API keys, Forge tokens, or real tenant information are exposed.
