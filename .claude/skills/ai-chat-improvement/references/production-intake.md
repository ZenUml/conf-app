# Ordinary AI Chat Production Data Intake

Read Diagramly `scripts/db-access.md` first. Verify that the current connection points to the intended production database, that the account or transaction is read-only, and that the UTC time window and query timeout are correct. The SQL below is a candidate filter for the current versioned-job structure; verify the live schema before running it. `Job.input`/`output` store JSON and may contain customer diagrams and complete instructions; initially return aggregate counts only.

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
WITH scoped AS (
  SELECT j.status::text AS status,
         j.input->>'languageKey' AS language,
         j.input->>'diagramCode' AS dsl,
         j.input->>'command' AS command,
         j.output->>'noChange' AS no_change
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= TIMESTAMPTZ '<start-utc>'
    AND j."createdAt" < TIMESTAMPTZ '<end-utc>'
    AND NULLIF(BTRIM(j.input->>'diagramId'), '') IS NOT NULL
    AND NULLIF(BTRIM(j.input->>'diagramCode'), '') IS NOT NULL
    AND NULLIF(BTRIM(j.input->>'command'), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(j.input->>'errorMessage', '')), '') IS NULL
)
SELECT COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_jobs,
       COUNT(DISTINCT (language, dsl, command)) FILTER (WHERE status = 'FAILED')
         AS distinct_failed_requests,
       COUNT(*) FILTER (WHERE status = 'COMPLETED' AND no_change = 'true')
         AS no_change_review_candidates
FROM scoped;
COMMIT;
```

These are only **versioned ordinary-modification candidates**: native Diagramly pages may call the same route. Call them conf-app traffic only after verifying a trusted external team/user mapping; `Job.source = api` is not sufficient proof. Distinguish internal tests from customer records using a verified identity allowlist; do not guess based on domain appearance. Report the counting window, timezone, query time, filters, and identity verification result. `no_change_review_candidates` is not a failure count.

After the user selects a limit, page through the required jobs into a private directory, exporting `id/createdAt/status/input/output/error` with a bounded `(createdAt,id)` cursor. Do not print raw rows to the terminal. Check export completeness and JSON parseability; record retrieval conditions, selected count, and uncovered count. If the source is only a frontend error event with no corresponding job, record the evidence gap in the flow; do not infer its DSL or instruction.

Prioritize error results with explicit user reports and `FAILED` jobs. For `COMPLETED` jobs with a created version that the user undid or reported as wrong, first verify the instruction semantics and original/output diagrams. The trigger points for `ai_chat_change_*` events may change with implementation; read the current catalog and panel code before querying. A success event reflects only its defined client-side state; it does not prove user satisfaction, acceptance, or persistence in Confluence.
