# Production Intake and Private Corpus Storage

## Evidence sources

- conf-app's src/utils/analytics/catalog.ts / types.ts: ai_repair_requested, succeeded, failed, and applied provide only lifecycle, model, failure-stage, and other closed-set properties; they do not include DSL, raw errors, or jobId. See .claude/skills/mixpanel/SKILL.md and docs/analytics/reference.md for the Mixpanel project and query method. Use these events to determine the time window, product variant, and failure scope; event counts do not imply a one-to-one mapping to backend jobs.
- Diagramly's packages/database/prisma/schema.prisma: Job.type = diagram_modification is the repair path. Observed input fields include diagramCode, errorMessage, diagramType, languageKey, subTypeKey, and model; output may include diagramCode and repairAttempts. Follow the runtime schema and records, and explicitly note missing fields.
- **Default production access:** use the Diagramly checkout's `@prisma/client` + `@prisma/adapter-pg` programmatic database API with the verified production `DATABASE_URL`. On this machine it is recorded at `~/Projects/secrets/zenuml/production/database.yml` (`service: diagramly_database`, `environment: production`). Inspect the credential's role and follow the user's account-authorization rule before use; the currently stored credential is not marked `role:test`. Confirm the target using that metadata and the database identity returned by the query. Never use Diagramly's `.env` for production: it points to local `diagramly_test` on this machine. Use a read-only transaction, a statement timeout, a UTC window, and bounded pages. Prefer a read-only database role when available. See diagramly.ai/scripts/db-access.md for Neon project/branch identity. Do not print connection strings, run Prisma writes or migrations, or write raw query results to terminal logs.
- **CLI fallback:** diagramly.ai/scripts/db.sh requires Neon CLI authentication and `psql`. Use it only when the programmatic connection is unavailable; do not treat a missing CLI login as proof that production data is inaccessible.
- Existing private samples: private/local-data/ai-repair-2026-10-10/ and private/local-data/ai-repair-regression/. The former's production-jobs.json, failure-index.json, and mixpanel-evidence.json document a past retrieval, classification, and reconciliation; these are historical snapshots and do not prove current production state.

## Count first

Convert the user's range to a UTC half-open interval. If none was provided, use the main skill's default: seven completed `Asia/Shanghai` calendar days before today, ending at today's 00:00 exclusive. If the production read-only connection fails, report BLOCKED and the reason; do not guess current DSL counts from old snapshots or Mixpanel. First run an aggregate-only query that returns numbers, then apply the main skill's case, destination, and regression defaults or ask where they do not apply. Confirm the connection really targets production and the transaction is read-only; do not export input/output. From the Diagramly checkout, the default API path is the sibling [count helper](../scripts/count-production-jobs.cjs). Load the verified production URL into its process environment without printing it:

~~~bash
(
  export DATABASE_URL="$(uv run python - <<'PY'
import os, yaml
path = os.path.expanduser('~/Projects/secrets/zenuml/production/database.yml')
record = yaml.safe_load(open(path))
assert record.get('service') == 'diagramly_database'
assert record.get('environment') == 'production'
print(record['config']['DATABASE_URL'], end='')
PY
)"
  node <conf-app>/.claude/skills/ai-repair-improvement/scripts/count-production-jobs.cjs \
    <window-start-utc-iso> <window-end-utc-iso>
)
~~~

Resolve the actual conf-app path first. The helper uses Prisma's PostgreSQL driver adapter, a read-only transaction, and `maxWait: 30000` for Neon startup; it emits only identity, time, and aggregate counts. The caller must verify that the production credential was authorized. Its output is not a substitute for confirming the Neon main branch when the credential metadata is uncertain.

~~~sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
WITH scoped AS (
  SELECT j.status::text AS status,
         COALESCE(j.input->>'languageKey',
                  j.input->>'diagramType', 'unknown') AS language,
         j.input->>'diagramCode' AS dsl,
         j.output->>'diagramCode' AS candidate
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= TIMESTAMPTZ '<window-start-utc>'
    AND j."createdAt" < TIMESTAMPTZ '<window-end-utc>'
    AND NULLIF(j.input->>'diagramCode', '') IS NOT NULL
    AND j.status IN ('FAILED', 'COMPLETED')
), classified AS (
  SELECT *,
         status = 'FAILED' AS failed,
         status = 'COMPLETED'
           AND (
             NULLIF(BTRIM(candidate), '') IS NULL
             OR BTRIM(REPLACE(candidate, E'\r\n', E'\n'))
                = BTRIM(REPLACE(dsl, E'\r\n', E'\n'))
           ) AS completed_empty_or_noop
  FROM scoped
)
SELECT COUNT(*) FILTER (WHERE failed) AS failed_jobs,
       COUNT(DISTINCT (language, dsl)) FILTER (WHERE failed)
         AS distinct_failed_dsls,
       COUNT(*) FILTER (WHERE completed_empty_or_noop)
         AS completed_empty_or_noop_jobs,
       COUNT(DISTINCT (language, dsl))
         FILTER (WHERE failed OR completed_empty_or_noop)
         AS distinct_known_failure_dsls
FROM classified;
COMMIT;
~~~

The SQL above defines the count criteria; the helper executes the same query with bound UTC parameters. Show the user only aggregate values, together with the window, timezone, all tenants or the verified scope, and query time. Here, “number of cases” means unique (language + original DSL); report job count separately. Failed jobs without errorMessage still count, but later mark their cases as missing error evidence; do not fabricate errors. COMPLETED cases whose output has another invalid syntax will be discovered during later parsing/rendering, so the initial counts are known failures and are not guaranteed to cover all false successes. If the query's criteria differ from the later import filter, report each count separately rather than combining them.

## Query and filtering

First inspect the current database schema, target environment identity, and read-only status. Use the same PrismaPg API and read-only transaction as the count helper for bounded SELECT pagination. Write each page directly to a local private JSONL file with mode `0600`; display only counts, hashes, and non-sensitive statuses. The following `psql` template is a fallback when the programmatic connection is unavailable. Create a target directory readable only on this machine, then replace the absolute output path and UTC time window with this run's values. Do not use `url`/`q` subcommands that print connection strings or raw rows.

~~~text
scripts/db.sh psql main <<'SQL'
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT current_database(), current_user,
       current_setting('transaction_read_only');
\pset format unaligned
\pset tuples_only on
\o /absolute/private/local-data/ai-repair-regression/import/jobs-page.jsonl
SELECT row_to_json(r)::text FROM (
  SELECT j.id, j."createdAt", j.status, j.input, j.output,
         j.error, j.message
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= TIMESTAMPTZ '<window-start-utc>'
    AND j."createdAt" < TIMESTAMPTZ '<window-end-utc>'
    AND NULLIF(j.input->>'diagramCode', '') IS NOT NULL
    AND j.status IN ('FAILED', 'COMPLETED')
  ORDER BY j."createdAt" DESC, j.id DESC
  LIMIT <bounded-page-size>
) AS r;
\o
COMMIT;
SQL
~~~

If an environment needs a read-only account or the current neonctl session targets the wrong project, correct the target using scripts/db-access.md first; do not assume an unknown database is production. Query files may contain complete customer DSL. During processing, output only counts, hashes, field names, and anonymized case IDs. Check the exit code, that every JSONL line parses, and the query window; failed or partial files must not be imported. Paginate with the (createdAt, id) cursor until the user-approved case count is reached or the window is exhausted. Do not claim LIMIT N yielded N distinct DSLs.

After confirming production, exclude internal data using the verified internal test-account/tenant list. Do not infer customer identity from domain appearance or missing Mixpanel events. If needed, include User / Team association fields in a private on-disk query; do not print identity fields. Preserve original input for FAILED jobs. Also inspect whether COMPLETED output.diagramCode is empty, equal to input after trimming and newline normalization, or still fails in the current parser/browser. Record the latter cases as “suspected false successes” and retain validation evidence; textual SQL comparison alone cannot establish semantic correctness. If there is a client ai_repair_failed event with no matching Job, record a retrieval gap; do not reconstruct DSL from Session Replay.

## Corpus conventions

Default root directory: <conf-app>/private/local-data/ai-repair-regression/. First confirm Git will not include that path; do not initialize or commit the private submodule to store customer diagram content. Each case directory must contain at least:

~~~text
cases/<opaque-case-id>/
  input.<dsl-extension>       Original DSL, complete and unmodified
  errors.json                 One or more actual errors and their source attempts
  source.json                 Source job, UTC time, status, model, language, input SHA-256
  manifest.json               Relative paths for ai-repair-case-validation
  attempts/                   Append-only candidates, responses, scores, and versions
  l4/                         UI evidence and final preview
~~~

Derive opaque-case-id from language, input hash, and error hash to avoid customer names. When the same DSL fails more than once, merge source records but do not lose distinct errors. corpus.json records case path, status, source summary, first/most recent observation time, and next step; preserve existing entries when updating it. Never paste complete customer DSL, tenant names, account IDs, request headers, or secrets into public files, task titles, PRs, or chat messages. Keep original input and final repair separate; never replace the original regression input with the final repair.
