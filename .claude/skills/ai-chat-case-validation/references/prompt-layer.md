# L2: Ordinary Modification Instruction and Product Prompt

Before running, read the effective `reasoningDisabled` value from the current Diagramly `ai-config.ts` and environment (reasoning is enabled only when `AI_DISABLE_REASONING=false`), write it explicitly into this run's derived manifest, and use the same value for L2/L3/L4. If you also run L1, use this value there too. Verify this field in `--dry-run`.

Use the [case format](case-format.md) for the case manifest. `command` must be the real user instruction and `errorMessage` must be absent. Before running, read conf-app `DEFAULT_AI_CHAT_MODEL` and put that model in the `models` array in the private manifest; force selection of only that model and one trial. If testing a local model override, record its source separately and do not use its result as a substitute for the default model. First record the HEAD and dirty state of both checkouts.

Run from the Diagramly checkout and use the same local `.env` as the current service. The paths below are private-directory placeholders only; replace them at runtime with existing absolute paths:

```bash
pnpm exec dotenv -c -- pnpm exec tsx --tsconfig scripts/tsconfig.json \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/build_diagramly_prompt.ts \
  --manifest /absolute/private/local-data/ai-chat-regression/cases/<id>/manifest.json \
  --output /absolute/private/local-data/ai-chat-regression/runs/<run-id>/messages.json \
  --diagramly-path "$PWD"

pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-benchmark/scripts/run_openrouter_matrix.py \
  --manifest /absolute/private/local-data/ai-chat-regression/cases/<id>/manifest.json \
  --mode diagramly \
  --messages /absolute/private/local-data/ai-chat-regression/runs/<run-id>/messages.json \
  --model <current-default-ai-chat-model> --trials 1 \
  --output-dir /absolute/private/local-data/ai-chat-regression/runs/<run-id>/l2
```

Add `--dry-run` to the model-call command first and verify the input hash, model, parameters, and Prompt hash. Before the actual call, verify authorization for the external service, data transfer, and budget for this run. The runner currently uses OpenRouter; it is not Diagramly's internal provider fallback and quality retry mechanism. Therefore L2 answers only whether a single model output is acceptable under the current Prompt; L3 validates the product job. If the product Prompt or message assembly implementation changes, confirm that the builder matches Diagramly `packages/core/ai/services/ai-diagram-service.ts` and `packages/core/ai/prompts/builder.ts`; fix the builder first if they do not match.

Use the existing `score_candidates.py` to check that the candidate is non-empty and to check syntax and `requiredAnchors`; then perform **actual rendering** for the applicable language and manually check `requiredEffects`/`forbiddenEffects`. The `repairStatus` name from `score_candidates.py` comes from a reused script and is not an AI Chat semantic conclusion. For expected `change`, returning the original text is FAIL. For expected `no_change`, pass only if the instruction is documented as already satisfied, the output has no Error, and the diagram remains valid; do not reuse the script's no-op FAIL judgment. Save the response, candidate, validation result, and Prompt hash without printing customer content in the terminal.
