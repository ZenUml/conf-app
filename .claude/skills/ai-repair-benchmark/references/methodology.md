# L1/L2 Methodology and Commands

## Run manifest

Save the following to `/tmp/ai-repair-benchmark/<run-id>/manifest.json`:

```json
{
  "dslPath": "/absolute/path/input.dsl",
  "errorMessage": "real parser error",
  "diagramType": "mermaid",
  "languageKey": "LANG_MERMAID",
  "subTypeKey": "GENERAL",
  "command": "Please fix the reported error and change nothing else.",
  "models": ["openai/gpt-5.6-luna", "anthropic/claude-sonnet-5"],
  "requiredAnchors": [],
  "temperature": 0.2,
  "maxTokens": 10000,
  "seed": 20260919
}
```

Do not copy the DSL contents into the manifest. Record both repository HEADs, working-tree status, prompt hash, model parameters, trial count, and seed. Do not merge results produced with different prompt or code versions. For model-only comparisons, `temperature`, `maxTokens`, and `reasoningDisabled` may be omitted. For an unset `AI_DISABLE_REASONING`, the runner follows the default in Diagramly `ai-config.ts`: reasoning is enabled only when explicitly set to `false`; otherwise `reasoningDisabled: true`. **When validating the product AI Repair or AI Chat path, the derived L1/L2 manifest must explicitly include the same `reasoningDisabled` boolean used by L3/L4.** AI Repair reads `resolveRepairAIOptions` (currently defaults to `true`); AI Chat reads explicit overrides in the versioned worker and the provider defaults in `ai-config.ts` (currently defaults to `true`). Check L1/L2 model-call records, L3 requests and job output, and L4 UI requests and target-environment configuration. Results with mismatched settings cannot be compared across layers or counted as a full-path PASS. Keep effective parameters fixed within each comparison group.

## Generate the L2 prompt

Run from the Diagramly checkout, loading the same `.env` as the local service:

```bash
pnpm exec dotenv -c -- pnpm exec tsx --tsconfig scripts/tsconfig.json \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/build_diagramly_prompt.ts \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --output /tmp/ai-repair-benchmark/<run-id>/diagramly-messages.json \
  --diagramly-path "$PWD"
```

The output includes the actual messages, prompt hash, Diagramly commit, hashes of prompt/preprocessing hook source files, and cache-control settings. If generation fails, do not fall back to a hand-written approximation of the prompt.

## One model call for one layer

First use the same command with `--dry-run` to check the plan. Run the following from the Diagramly checkout. The example calls Luna once; change `--model` and use a separate output directory to test other models. Score each call before making the next model request. A real call sends the full DSL to OpenRouter and does not print the key.

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --mode raw --model openai/gpt-5.6-luna --trials 1 \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l1-luna

pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --mode diagramly \
  --messages /tmp/ai-repair-benchmark/<run-id>/diagramly-messages.json \
  --model openai/gpt-5.6-luna --trials 1 \
  --output-dir /tmp/ai-repair-benchmark/<run-id>/l2-luna
```

Immediately after each command, run the scoring command below, pointing `--results` and `--output` to that call's directory:

```bash
uv run .claude/skills/ai-repair-benchmark/scripts/score_candidates.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --results /tmp/ai-repair-benchmark/<run-id>/l1-luna/results.jsonl \
  --diagramly-path ../diagramly.ai \
  --output /tmp/ai-repair-benchmark/<run-id>/l1-luna/scored.jsonl
```

`repairStatus: PASS` from the scoring script means only that its deterministic syntax check passed. Before aggregation, check actual rendering for the applicable language and inspect `missingRequiredAnchors`. The deterministic Node parser result for Mermaid does not replace Mermaid parse/render in a browser. Write the observed render result to `renderValid` in the trial record and preserve evidence in `evidencePaths`. If this field is missing, the aggregator marks the record `UNVERIFIED/SKIPPED`; do not call it a complete repair PASS.

Allow only one model request per trial. Record network failures separately; do not silently retry in the client. If only response extraction logic needs repair, use `--reparse-only` to rebuild candidates offline from saved response JSON without another paid call. After an interruption, use `--resume`, retaining interruption records and not overwriting existing results. Record the actual provider, generation id, prompt/completion/reasoning/cache tokens, and cost provenance; report cache hits separately in raw latency analysis.

## Aggregate

Pass the scored JSONL files from the L1/L2 runs; do not pass L3/L4 files:

```bash
uv run .claude/skills/ai-repair-benchmark/scripts/summarize_benchmark.py \
  --manifest /tmp/ai-repair-benchmark/<run-id>/manifest.json \
  --input /tmp/ai-repair-benchmark/<run-id>/l1-luna/scored.jsonl \
  --input /tmp/ai-repair-benchmark/<run-id>/l2-luna/scored.jsonl \
  --html /tmp/ai-repair-benchmark/<run-id>/report.html
```

Add each other model's scored file as another `--input`. Local/private reports show the full input DSL, diagram type, real error, line count, character count, and SHA-256 by default. Add `--redact-dsl` only when the user explicitly requests a public/redacted report. State n for each group; p95 does not indicate stable performance when n is small.
