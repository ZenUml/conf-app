# L3: Diagramly Async Job

L3 tests authentication, credits, job creation, background processing, deterministic validation, database state, and polling against the local Diagramly API. It simulates the request payload from conf-app but does not pass through the Forge Worker.

## Prerequisites

- Use local PostgreSQL as directed by the `joint-debug` skill; `DATABASE_URL` must point to localhost/127.0.0.1.
- `GET http://127.0.0.1:3000/api/health?deep=1` must return `db: "up"`.
- Inject `DIAGRAMLY_API_KEY` from Diagramly `.env`; do not print it.
- By default, derive `x-external-id` and `x-team-id` from the input hash to isolate local samples. The manifest may explicitly override the team ID with `externalTeamId`.
- The default backend must be `http://127.0.0.1:3000` or `http://localhost:3000`. Remote runs require separate user authorization.

## Command

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-repair-case-validation/scripts/run_job_matrix.py \
  --manifest /tmp/ai-repair-case-validation/<run-id>/manifest.json \
  --trials 1 \
  --output-dir /tmp/ai-repair-case-validation/<run-id>/l3-primary
```

If no model is specified, the script reads `DEFAULT_AI_REPAIR_MODEL` from conf-app's `src/utils/aiModelConfig.ts`. A single-model manifest may specify the model for that run; a multi-model manifest requires explicitly selecting one with `--model <model>`. Stronger-model retries test L2 only by default. If the user explicitly asks to continue that model through L3, first confirm that **the same model** passed L2, then run L3 with a single-model manifest or `--model`. Test one model and one trial at a time, with 1-second polling and a 135-second deadline. The script runs a health check before creating a job. First verify the model and paths with the same command plus `--dry-run`. Use a local external ID derived from the input hash and do not print the key.

## Evaluation

- The create response must contain a non-empty jobId.
- At least one job-status poll must occur.
- The final status must be COMPLETED and include diagramCode.
- Preserve the last output and error for FAILED/CANCELLED/timeout.
- Use the same candidate validation rules as L2.
- Report wall time, backend duration, LLM duration, and poll count separately.

The current job schema does not expose the OpenRouter generation id, tokens, or cost. Do not calculate “actual cost” from static prices. You may show the corresponding L2 median cost as an estimate, labeled `estimated_from_l2`.
