#!/usr/bin/env node
// Merge cohort seed files into a `wrangler kv bulk put`-compatible JSON:
// one key per user, cohort:user:<accountId> -> {"cohorts":[...all cohorts...]}.
// Seeds live in private/growth/cohorts/ (client data — NEVER commit them to
// the public repo). The output also contains accountIds: write it to a temp
// path outside the repo.
//
// Usage:
//   node scripts/cohorts/build-kv-bulk.mjs private/growth/cohorts/*.json > /tmp/cohort-bulk.json
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: build-kv-bulk.mjs <cohort-seed.json>...');
  process.exit(1);
}

const byUser = new Map();
for (const f of files) {
  const seed = JSON.parse(readFileSync(f, 'utf8'));
  if (!seed.cohort || !Array.isArray(seed.accountIds)) {
    console.error(`skipping ${f}: not a cohort seed (need {cohort, accountIds})`);
    continue;
  }
  for (const id of seed.accountIds) {
    if (typeof id !== 'string' || !id) continue;
    if (!byUser.has(id)) byUser.set(id, new Set());
    byUser.get(id).add(seed.cohort);
  }
}

const bulk = [...byUser.entries()].map(([id, cohorts]) => ({
  key: `cohort:user:${id}`,
  value: JSON.stringify({ cohorts: [...cohorts].sort() }),
}));

process.stdout.write(JSON.stringify(bulk, null, 2));
console.error(`${bulk.length} users from ${files.length} seed file(s)`);
