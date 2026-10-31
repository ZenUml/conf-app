#!/usr/bin/env node
// Run from the diagramly.ai checkout with DATABASE_URL set to its verified
// production connection string. This script returns aggregates only.

const { createRequire } = require('node:module');
const { join } = require('node:path');
const { existsSync } = require('node:fs');

const [start, end] = process.argv.slice(2);
const root = process.cwd();
if (
  !start || !end ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(start) ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(end) ||
  !Number.isFinite(Date.parse(start)) ||
  !Number.isFinite(Date.parse(end)) ||
  Date.parse(start) >= Date.parse(end) ||
  !existsSync(join(root, 'packages/database/prisma/schema.prisma')) ||
  !process.env.DATABASE_URL
) {
  console.error('Usage: from diagramly.ai, DATABASE_URL=... node count-production-jobs.cjs <start-UTC-ISO> <end-UTC-ISO>');
  process.exit(2);
}

const fromDiagramly = createRequire(join(root, 'package.json'));
const { PrismaClient } = fromDiagramly('@prisma/client');
const { PrismaPg } = fromDiagramly('@prisma/adapter-pg');

const sql = `WITH scoped AS (
  SELECT j.status::text AS status,
         COALESCE(j.input->>'languageKey', j.input->>'diagramType', 'unknown') AS language,
         j.input->>'diagramCode' AS dsl,
         j.output->>'diagramCode' AS candidate
  FROM "Job" AS j
  WHERE j.type = 'diagram_modification'
    AND j."createdAt" >= $1::timestamptz
    AND j."createdAt" < $2::timestamptz
    AND NULLIF(j.input->>'diagramCode', '') IS NOT NULL
    AND j.status IN ('FAILED', 'COMPLETED')
), classified AS (
  SELECT *, status = 'FAILED' AS failed,
         status = 'COMPLETED' AND (
           NULLIF(BTRIM(candidate), '') IS NULL OR
           BTRIM(REPLACE(candidate, E'\\r\\n', E'\\n')) =
             BTRIM(REPLACE(dsl, E'\\r\\n', E'\\n'))
         ) AS completed_empty_or_noop
  FROM scoped
)
SELECT COUNT(*) FILTER (WHERE failed) AS failed_jobs,
       COUNT(DISTINCT (language, dsl)) FILTER (WHERE failed) AS distinct_failed_dsls,
       COUNT(*) FILTER (WHERE completed_empty_or_noop) AS completed_empty_or_noop_jobs,
       COUNT(DISTINCT (language, dsl))
         FILTER (WHERE failed OR completed_empty_or_noop) AS distinct_known_failure_dsls
FROM classified`;

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
      const [identity] = await tx.$queryRawUnsafe(
        "SELECT current_database()::text AS database, current_user::text AS role, current_setting('transaction_read_only') AS read_only, now() AS query_time",
      );
      if (identity.read_only !== 'on') throw new Error('Transaction is not read-only');
      const [counts] = await tx.$queryRawUnsafe(sql, start, end);
      return { identity, counts };
    }, { maxWait: 30000, timeout: 90000 });
    console.log(JSON.stringify({
      start,
      end,
      queryTime: result.identity.query_time,
      database: result.identity.database,
      readOnly: result.identity.read_only,
      counts: result.counts,
    }, (_, value) => typeof value === 'bigint' ? Number(value) : value));
  } catch (error) {
    // Driver errors can contain connection details; print only safe identifiers.
    console.error('Production count failed:', error.name || 'Error', error.code || '');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
