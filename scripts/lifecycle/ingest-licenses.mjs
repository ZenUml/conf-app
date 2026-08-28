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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// node:sqlite is still experimental in Node 22 — loaded via createRequire to
// match the pattern already established in functions/migrations/0024.spec.ts.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const EXPORT_URL =
  'https://marketplace.atlassian.com/rest/2/vendors/1215266/reporting/licenses/export?accept=json';

// Which of our four Forge app variants each Marketplace addonKey belongs to.
export const ADDON_APP_MAP = {
  'com.zenuml.confluence-addon-lite': 'lite',
  'com.zenuml.confluence-addon': 'full',
  'my-api': 'asyncapi',
  'com.pnd.jira.plugins.diagramly': 'diagramly',
};

// The export row's own activity flag (verified against the live export,
// mirrors marketplace/scripts/mp_report.py's `r.get("status") == "active"`
// convention used elsewhere in this repo). Lowercase, exact match.
const ACTIVE_STATUS = 'active';

// PK-shaped map key shared between the upsert path and the lapse pass below.
// NUL-separated so an unusual (quoted-local-part) email containing an
// ordinary character sequence can never collide with a different email+app
// pair.
function lapseKey(email, app) {
  return `${email}\u0000${app}`;
}

// ---------------------------------------------------------------------------
// Row transform
// ---------------------------------------------------------------------------

export function extractTechnicalEmail(row) {
  return row?.contactDetails?.technicalContact?.email ?? null;
}

export function shouldSkipEmail(email) {
  return !email || email === 'RTBF';
}

// Eval-window mapping decision (verified against a live Marketplace export
// fetched during this session, 2026-08-28 — 1844 total license rows across
// all vendor addons, 232 EVALUATION rows across our four target apps):
//
//   eval_started_at <- row.latestEvaluationStartDate
//   eval_ends_at    <- row.maintenanceEndDate
//
// Why: the export has no explicit "evaluationEndDate" field. Two maintenance-
// window fields exist — maintenanceStartDate/maintenanceEndDate — plus
// latestEvaluationStartDate. On a sampled EVALUATION row (my-api addon,
// an example-tenant.atlassian.net-style Cloud site) maintenanceStartDate ==
// latestEvaluationStartDate and maintenanceEndDate == start + 30 days, i.e.
// for an EVALUATION license
// Atlassian sets the maintenance window equal to the trial window — so
// maintenanceEndDate reliably reads as "trial expires on". We deliberately did
// NOT use maintenanceStartDate for eval_started_at: it tracks the *license*
// window and drifts across renewals/upgrades, while latestEvaluationStartDate
// is Marketplace's own "most recent evaluation began on" field. Of the 232
// eval rows sampled, 3 diverged (multi-year-old entitlements re-evaluated
// after an earlier commercial/free period), and in every one
// latestEvaluationStartDate was the semantically correct trial-start date.
// Both fields are left null for every non-EVALUATION licenseType — reusing a
// lapsed trial's dates would mislead a step-due-date scheduler built on top of
// this table.
export function mapEvalWindow(row) {
  if (row.licenseType !== 'EVALUATION') {
    return { evalStartedAt: null, evalEndsAt: null };
  }
  return {
    evalStartedAt: row.latestEvaluationStartDate ?? null,
    evalEndsAt: row.maintenanceEndDate ?? null,
  };
}

// Maps one raw Marketplace export row to either `{ record }` (ready to
// upsert) or `{ skipped: reason }`.
export function transformRow(row) {
  // `row?.addonKey` (not `row.addonKey`): guards a literal malformed entry in
  // the export array (null/undefined), not just a missing property on an
  // otherwise-valid row object -- both fall through to the same
  // 'unmapped_addon' skip rather than throwing.
  const app = ADDON_APP_MAP[row?.addonKey];
  if (!app) return { skipped: 'unmapped_addon' };

  // The export also carries legacy Server/DC-hosted rows (hosting: 'Server')
  // for these addonKeys, left over from before the app went Forge/Cloud-only
  // (see CLAUDE.md "Pure Forge — no Connect code"). Those rows have no
  // cloudId at all — lifecycle_contact.cloud_id is NOT NULL and matches the
  // Cloud-only AtlassianInstance.cloudId convention used elsewhere in this
  // D1 schema, so there is nothing meaningful to store for them. Observed:
  // 67/1610 target-app rows in the 2026-08-28 export lack cloudId, all
  // hosting: 'Server'.
  if (!row.cloudId) return { skipped: 'no_cloud_id' };

  const email = extractTechnicalEmail(row);
  if (shouldSkipEmail(email)) {
    return { skipped: email === 'RTBF' ? 'rtbf' : 'missing_email' };
  }

  const { evalStartedAt, evalEndsAt } = mapEvalWindow(row);
  return {
    record: {
      contactEmail: email,
      app,
      cloudId: row.cloudId ?? null,
      cloudSiteHostname: row.cloudSiteHostname ?? null,
      seatTier: row.tier ?? null,
      licenseType: row.licenseType ?? null,
      evalStartedAt,
      evalEndsAt,
    },
  };
}

// ---------------------------------------------------------------------------
// D1 upsert
// ---------------------------------------------------------------------------

// Insert-or-update one lifecycle_contact row keyed by (contact_email, app).
// New row: first_seen_at = last_seen_at = now, step = 'welcome',
//   suppressed = bootstrap ? 1 : 0.
// Existing row: cloud_id/seat_tier/license_type/eval_*/last_seen_at refresh;
//   step_due_at, suppressed, first_seen_at are never touched.
//
// `step` is normally left untouched too, with ONE exception: re-appearance.
// If the contact is being seen ACTIVE in this run (isActive) and its stored
// step is currently 'lapsed', step resets to 'welcome'. This is the simplest
// rule implementable without a schema change (no step_before_lapse column):
// a lapsed contact that comes back restarts the nurture sequence from the
// top rather than resuming wherever it left off. Documented tradeoff: a
// contact that had reached e.g. 'trial_day_7' before lapsing does NOT resume
// at 'trial_day_7' on reappearance -- it resumes at 'welcome'.
export function upsertContact(
  db,
  record,
  { bootstrap = false, now = new Date().toISOString(), isActive = false } = {},
) {
  const existing = db
    .prepare('SELECT 1 FROM lifecycle_contact WHERE contact_email = ? AND app = ?')
    .get(record.contactEmail, record.app);

  if (existing) {
    db.prepare(
      `UPDATE lifecycle_contact
          SET cloud_id = ?, seat_tier = ?, license_type = ?,
              eval_started_at = ?, eval_ends_at = ?, last_seen_at = ?,
              step = CASE WHEN step = 'lapsed' AND ? = 1 THEN 'welcome' ELSE step END
        WHERE contact_email = ? AND app = ?`,
    ).run(
      record.cloudId,
      record.seatTier,
      record.licenseType,
      record.evalStartedAt,
      record.evalEndsAt,
      now,
      isActive ? 1 : 0,
      record.contactEmail,
      record.app,
    );
    return 'updated';
  }

  db.prepare(
    `INSERT INTO lifecycle_contact
        (contact_email, app, cloud_id, seat_tier, license_type, eval_started_at, eval_ends_at,
         step, step_due_at, suppressed, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'welcome', NULL, ?, ?, ?)`,
  ).run(
    record.contactEmail,
    record.app,
    record.cloudId,
    record.seatTier,
    record.licenseType,
    record.evalStartedAt,
    record.evalEndsAt,
    bootstrap ? 1 : 0,
    now,
    now,
  );
  return 'inserted';
}

// Lapse pass, run once per ingestRows() call after every row in this run's
// export has been upserted. A contact counts as "not actively seen this run"
// -- and gets step='lapsed' -- in EVERY one of these cases:
//   - its (email, app) never appeared in `seenActiveKeys` at all, i.e. it's
//     absent from the export entirely, OR
//   - it appeared with a non-'active' status (isActive=false in the loop
//     below, so it was never added to seenActiveKeys), OR
//   - its row this run was skipped by transformRow (RTBF, missing email,
//     unmapped addon, no cloudId) -- we have no valid contactable signal for
//     it this run, so it's treated the same as "absent".
// Two invariants enforced here: (1) a row already at the terminal step
// 'done' is never overwritten -- excluded via the WHERE guard below; (2) the
// UPDATE touches ONLY the `step` column, so `suppressed` (and every other
// column) is never modified by lapsing.
function markLapsedContacts(db, seenActiveKeys) {
  const rows = db.prepare("SELECT contact_email, app FROM lifecycle_contact WHERE step NOT IN ('done', 'lapsed')").all();
  const stmt = db.prepare(`UPDATE lifecycle_contact SET step = 'lapsed' WHERE contact_email = ? AND app = ?`);
  let lapsed = 0;
  for (const row of rows) {
    if (seenActiveKeys.has(lapseKey(row.contact_email, row.app))) continue;
    stmt.run(row.contact_email, row.app);
    lapsed += 1;
  }
  return lapsed;
}

// Ingests a full array of raw export rows into `db`. Returns a summary for
// reporting, plus an in-memory cloudId -> cloudSiteHostname map built from
// this run's export (used by buildSnapshot — the D1 schema itself only keeps
// cloud_id, matching the AtlassianInstance.cloudId convention used elsewhere
// in this repo's D1 schema, so hostnames never get persisted redundantly).
//
// `seenActiveKeys` (this run's export only, not persisted across calls) also
// drives the lapse pass at the end -- see markLapsedContacts() above.
export function ingestRows(db, rawRows, { bootstrap = false, now = new Date().toISOString() } = {}) {
  const summary = {
    inserted: 0,
    updated: 0,
    lapsed: 0,
    skipped: { unmapped_addon: 0, no_cloud_id: 0, rtbf: 0, missing_email: 0 },
    byApp: {},
  };
  const hostnameByCloudId = new Map();
  const seenActiveKeys = new Set();

  db.exec('BEGIN');
  try {
    for (const raw of rawRows) {
      if (raw?.cloudId && raw?.cloudSiteHostname) {
        hostnameByCloudId.set(raw.cloudId, raw.cloudSiteHostname);
      }

      const { record, skipped } = transformRow(raw);
      if (skipped) {
        summary.skipped[skipped] = (summary.skipped[skipped] ?? 0) + 1;
        continue;
      }

      const isActive = raw?.status === ACTIVE_STATUS;
      if (isActive) {
        seenActiveKeys.add(lapseKey(record.contactEmail, record.app));
      }

      const result = upsertContact(db, record, { bootstrap, now, isActive });
      summary[result] += 1;
      summary.byApp[record.app] ??= { inserted: 0, updated: 0 };
      summary.byApp[record.app][result] += 1;
    }

    summary.lapsed = markLapsedContacts(db, seenActiveKeys);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { summary, hostnameByCloudId };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

// Whole-CALENDAR-day (UTC) countdown to eval_ends_at, computed at snapshot
// time (`nowIso` = the snapshot's own generatedAt, never wall-clock time at
// read time -- the snapshot is a point-in-time view). Deliberately a
// calendar-day difference, not a 24h-duration division: both timestamps are
// truncated to UTC midnight first, so "ends today" always reads 0 and "ended
// yesterday" always reads -1, regardless of what time of day either
// timestamp carries. Returns null unless license_type is EVALUATION AND
// eval_ends_at is present -- a non-eval contact, or an eval contact whose
// eval_ends_at didn't map (see mapEvalWindow), has no countdown to show.
export function computeEvalDaysRemaining(licenseType, evalEndsAt, nowIso) {
  if (licenseType !== 'EVALUATION' || !evalEndsAt) return null;

  const end = new Date(evalEndsAt);
  const now = new Date(nowIso);
  if (Number.isNaN(end.getTime()) || Number.isNaN(now.getTime())) return null;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const endUtcDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const nowUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((endUtcDay - nowUtcDay) / MS_PER_DAY);
}

// Aggregated view JSON: funnel counts (from D1, the source of truth for
// every contact ever ingested) + a per-tenant list keyed by domain (never
// email — email stays only in D1). `hostnameByCloudId` resolves cloud_id ->
// cloudSiteHostname from the export fetched in this same run; a tenant whose
// cloudId doesn't appear in that map (e.g. removed from the export between
// runs) falls back to `domain: null` rather than leaking the raw cloud_id.
export function buildSnapshot(db, hostnameByCloudId, { generatedAt = new Date().toISOString() } = {}) {
  const funnel = db
    .prepare(
      `SELECT app, step, license_type, COUNT(*) as count
         FROM lifecycle_contact
        GROUP BY app, step, license_type
        ORDER BY app, step, license_type`,
    )
    .all()
    .map((r) => ({ app: r.app, step: r.step, license_type: r.license_type, count: r.count }));

  const tenantRows = db
    .prepare(
      `SELECT cloud_id, app, license_type, step, eval_ends_at, suppressed, last_seen_at
         FROM lifecycle_contact
        ORDER BY app, last_seen_at DESC`,
    )
    .all();

  const tenants = tenantRows.map((r) => ({
    domain: hostnameByCloudId.get(r.cloud_id) ?? null,
    app: r.app,
    license_type: r.license_type,
    step: r.step,
    eval_ends_at: r.eval_ends_at,
    eval_days_remaining: computeEvalDaysRemaining(r.license_type, r.eval_ends_at, generatedAt),
    suppressed: r.suppressed,
    last_seen_at: r.last_seen_at,
  }));

  return { generated_at: generatedAt, funnel, tenants };
}

// ---------------------------------------------------------------------------
// Credentials + fetch (real network — not exercised by unit tests)
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

export async function fetchExport({ email, token }, fetchImpl = fetch) {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const res = await fetchImpl(EXPORT_URL, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Marketplace export fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
