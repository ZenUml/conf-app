# L3: Local Versioned AI Chat Job

The derived manifest for this run must use the same `reasoningDisabled` value as L2; the script sends it as `disableReasoning` and verifies the value reported by the job. If an ordinary AI Chat UI request omits this field, establish its effective value from the target backend's `ai-config.ts` and environment; do not treat a missing field as `false`.

This layer covers Diagramly diagram binding, team/credits, versioned asynchronous jobs, deterministic syntax validation, and polling; it does not pass through the conf-app Forge bridge. An ordinary modification request must include a non-empty `command` and **must not include `errorMessage`**. The script follows the type mapping in conf-app `functions/service/diagramlyService.js`, converting client `mermaid` to backend `flow` and `OpenAPI` to `openapi`; update the script first if the mapping changes. The actual routes are in Diagramly `apps/web/app/api/chat/{ensure-diagram,modify-version-async,job-status}`.

Preparation: use the `joint-debug` skill to start local Diagramly and PostgreSQL. Confirm `DATABASE_URL` points to localhost and `GET /api/health?deep=1` reports database `up`. Load `DIAGRAMLY_API_KEY` from Diagramly's local `.env` without printing it. First use `--dry-run` to check the input hash, model, and URL; the script rejects non-local hosts by default.

```bash
pnpm exec dotenv -c -- uv run \
  ../conf-app/.claude/skills/ai-chat-case-validation/scripts/run_versioned_job.py \
  --manifest /absolute/private/local-data/ai-chat-regression/cases/<id>/manifest.json \
  --output-dir /absolute/private/local-data/ai-chat-regression/runs/<run-id>/l3 \
  --dry-run
```

Remove `--dry-run` to actually create a local diagram and job and call the model. The default model is read from conf-app `DEFAULT_AI_CHAT_MODEL`; if the manifest specifies another model, label it clearly in the results. The script writes the full response to the private output directory; the terminal displays only status, hashes, and paths. One call per case is the default; retries must consume a separate budget allocation and preserve earlier attempts.

The script's `technicalStatus: PASS` covers only a returned result, no job Error, a non-empty candidate, and (for expected modifications) a version and non-no-op result. To mark the full layer PASS, also check parsing and actual rendering for the applicable language, instruction fulfillment, and preservation criteria. Judge `noChange: true` only against the case's explicit expected outcome. `FAILED`, `CANCELLED`, timeout, or missing output/version means this layer failed or was blocked by the environment; a raw model response cannot substitute for the job result. Retain the jobId, polling count, wall time, backend duration, and errors, but do not expose the original content in public output.
