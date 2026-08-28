#!/usr/bin/env node
// Marketplace -> D1 lifecycle ingest for the minimal in-house CRM defined by
// functions/migrations/0024_add_lifecycle_crm.sql (lifecycle_contact /
// lifecycle_touchpoint).
//
// Pulls the vendor "all licenses" export from the Atlassian Marketplace
// reporting API, maps each row to one of our four Forge apps, and
// insert-or-updates a `lifecycle_contact` row keyed by (contact_email, app) —
// never resetting `step`/`first_seen_at`/`suppressed` on an existing contact.
//
// Usage:
//   node scripts/lifecycle/ingest-licenses.mjs --db <sqlite-path> [--bootstrap] [--snapshot <path>]
//
//   --db <path>        Required. Path to a D1-shaped sqlite file (the local
//                       miniflare D1 file, or a temp file in tests).
//   --bootstrap         Mark every NEWLY inserted row suppressed=1. Use this
//                       exactly once, for the first run against a fresh DB, so
//                       the pre-existing Marketplace backlog never enters the
//                       email drip. Rows that already exist are never touched
//                       by this flag (their suppressed value is left alone).
//   --snapshot <path>   After ingest, write an aggregated view JSON (funnel +
//                       per-tenant rows, no raw export dump, no emails) to
//                       this path.
//
// Credentials: FORGE_EMAIL / FORGE_API_TOKEN, read from `.env.forge.local` at
// the repo root of the MAIN git checkout (this script is designed to run from
// a worktree that doesn't carry its own copy of that git-ignored file). Falls
// back to the same-named environment variables if the main checkout or its
// .env.forge.local can't be found. The token is never logged.
//
// The actual ingest logic (row transform, upsert, lapse pass, snapshot
// aggregation) lives in ./ingestCore.mjs, which has no Node-only imports and
// is also consumed directly by workers/lifecycle-ingest/src/index.ts (the
// flag-guarded Cloudflare cron equivalent of this script — see that file's
// header for why it needs an async twin of the sync functions re-exported
// below). This file keeps only what's genuinely Node/CLI-specific: argv
// parsing, credential resolution from the filesystem, the real network fetch
// entry point, and the node:sqlite driver.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ADDON_APP_MAP,
  buildSnapshotCore,
  computeEvalDaysRemaining,
  createNodeSqliteAdapter,
  fetchExport,
  ingestRowsCore,
  mapEvalWindow,
  transformRow,
  upsertContactCore,
} from './ingestCore.mjs';

// node:sqlite is still experimental in Node 22 — loaded via createRequire to
// match the pattern already established in functions/migrations/0024.spec.ts.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

// ---------------------------------------------------------------------------
// Re-exports -- same names, same signatures as before this file was split.
// `ingest.spec.ts` imports ADDON_APP_MAP / buildSnapshot / computeEvalDaysRemaining
// / ingestRows / mapEvalWindow / transformRow from here unchanged; each
// db-touching one is now a thin wrapper that adapts the raw node:sqlite `db`
// object into ingestCore's adapter shape and delegates to the shared core.
// ---------------------------------------------------------------------------

export { ADDON_APP_MAP, computeEvalDaysRemaining, mapEvalWindow, transformRow };
export { fetchExport };

export function upsertContact(db, record, opts) {
  return upsertContactCore(createNodeSqliteAdapter(db), record, opts);
}

export function ingestRows(db, rawRows, opts) {
  return ingestRowsCore(createNodeSqliteAdapter(db), rawRows, opts);
}

export function buildSnapshot(db, hostnameByCloudId, opts) {
  return buildSnapshotCore(createNodeSqliteAdapter(db), hostnameByCloudId, opts);
}

// ---------------------------------------------------------------------------
// Credentials (real filesystem — Node-only)
// ---------------------------------------------------------------------------

function parseDotEnv(content) {
  const out = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// The main checkout is always the first entry of `git worktree list` — this
// script is designed to run from a worktree (which usually doesn't carry its
// own copy of the git-ignored .env.forge.local).
function findMainWorktreePath() {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const firstWorktreeLine = out.split('\n').find((l) => l.startsWith('worktree '));
    return firstWorktreeLine ? firstWorktreeLine.slice('worktree '.length).trim() : null;
  } catch {
    return null;
  }
}

export function resolveCredentials(env = process.env) {
  const mainPath = findMainWorktreePath();
  if (mainPath) {
    const envFile = path.join(mainPath, '.env.forge.local');
    if (existsSync(envFile)) {
      const parsed = parseDotEnv(readFileSync(envFile, 'utf8'));
      const email = parsed.FORGE_EMAIL || env.FORGE_EMAIL;
      const token = parsed.FORGE_API_TOKEN || env.FORGE_API_TOKEN;
      if (email && token) return { email, token };
    }
  }
  if (env.FORGE_EMAIL && env.FORGE_API_TOKEN) {
    return { email: env.FORGE_EMAIL, token: env.FORGE_API_TOKEN };
  }
  throw new Error(
    'Could not resolve FORGE_EMAIL/FORGE_API_TOKEN: no usable .env.forge.local found at the main ' +
      `checkout ${mainPath ? `(${mainPath})` : '(no main worktree found via "git worktree list")'}, ` +
      'and neither var is set in the environment.',
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { db: null, bootstrap: false, snapshot: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--bootstrap') args.bootstrap = true;
    else if (a === '--snapshot') args.snapshot = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node scripts/lifecycle/ingest-licenses.mjs --db <sqlite-path> [--bootstrap] [--snapshot <path>]',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.db) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const creds = resolveCredentials();
  console.log(`[ingest-licenses] fetching Marketplace export as ${creds.email}...`);
  const rawRows = await fetchExport(creds);
  console.log(`[ingest-licenses] fetched ${rawRows.length} total license rows from Marketplace`);

  const db = new DatabaseSync(args.db);
  const now = new Date().toISOString();
  const { summary, hostnameByCloudId } = ingestRows(db, rawRows, { bootstrap: args.bootstrap, now });

  console.log(
    `[ingest-licenses] mode: ${args.bootstrap ? 'BOOTSTRAP (newly-inserted rows suppressed=1)' : 'incremental (newly-inserted rows suppressed=0)'}`,
  );
  console.log(
    `[ingest-licenses] this run: inserted=${summary.inserted} updated=${summary.updated} lapsed=${summary.lapsed}`,
  );
  console.log(
    `[ingest-licenses] this run skipped: unmapped_addon=${summary.skipped.unmapped_addon} no_cloud_id=${summary.skipped.no_cloud_id} rtbf=${summary.skipped.rtbf} missing_email=${summary.skipped.missing_email}`,
  );
  console.log('[ingest-licenses] this run, per app:');
  for (const [app, counts] of Object.entries(summary.byApp).sort()) {
    console.log(`  ${app}: inserted=${counts.inserted} updated=${counts.updated}`);
  }

  const dbTotals = db
    .prepare(
      'SELECT app, COUNT(*) as total, SUM(suppressed) as suppressed_total FROM lifecycle_contact GROUP BY app ORDER BY app',
    )
    .all();
  console.log('[ingest-licenses] lifecycle_contact totals in D1 (all-time, all runs):');
  for (const row of dbTotals) {
    console.log(`  ${row.app}: total=${row.total} suppressed=${row.suppressed_total}`);
  }

  const exportAddonCounts = {};
  for (const row of rawRows) {
    const app = ADDON_APP_MAP[row.addonKey];
    if (!app) continue;
    exportAddonCounts[app] = (exportAddonCounts[app] ?? 0) + 1;
  }
  console.log('[ingest-licenses] raw export row counts per mapped app (before email filtering/dedup — for reconciliation):');
  for (const [app, count] of Object.entries(exportAddonCounts).sort()) {
    console.log(`  ${app}: ${count}`);
  }

  if (args.snapshot) {
    const snapshot = buildSnapshot(db, hostnameByCloudId, { generatedAt: now });
    writeFileSync(args.snapshot, JSON.stringify(snapshot, null, 2));
    console.log(
      `[ingest-licenses] snapshot written to ${args.snapshot} (${snapshot.tenants.length} tenants, ${snapshot.funnel.length} funnel rows)`,
    );
  }

  db.close();
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) {
  main().catch((err) => {
    console.error('[ingest-licenses] FAILED:', err.message);
    process.exit(1);
  });
}
