// Shared, portable ingest core for the Marketplace -> D1 lifecycle CRM
// (functions/migrations/0024_add_lifecycle_crm.sql: lifecycle_contact /
// lifecycle_touchpoint). This module has NO Node-only imports (no node:fs,
// node:child_process, node:sqlite) so it can be imported unmodified from
// both the node CLI script (scripts/lifecycle/ingest-licenses.mjs) and a
// Cloudflare Worker (workers/lifecycle-ingest/src/index.ts) running the same
// ingest on a schedule against the D1 binding directly.
//
// ---------------------------------------------------------------------------
// Why there are TWO db-touching cores (sync + async), not one
// ---------------------------------------------------------------------------
// node:sqlite's DatabaseSync is synchronous; D1Database is asynchronous
// (every prepare().bind().run()/.all()/.first() returns a Promise). A single
// JS function cannot serve both shapes: the existing 29 tests in
// ingest.spec.ts call `ingestRows(db, rows, opts)` synchronously and
// destructure its return value on the same line with no `await`, so the
// node-facing entry point MUST stay a plain synchronous function forever
// (making it `async` would return every caller a Promise instead of
// `{ summary, hostnameByCloudId }` and break all of them). D1 access can
// never be made synchronous in a Worker either. So:
//   - `*Core` functions below are SYNCHRONOUS, driven through a "sync
//     adapter" (get/all/run take (sql, params) and return values directly;
//     see `createNodeSqliteAdapter`).
//   - `*AsyncCore` functions are the ASYNC twins, driven through an "async
//     adapter" with the identical (sql, params) call shape but Promise
//     returns (see `createD1Adapter`).
// Both twins share every SQL string (the SQL constants below) and every
// pure, DB-free helper (transformRow, mapEvalWindow, ...), so the two can
// never drift on *what* they do — only on *how* they await it.
//
// Adapter interface (both `createNodeSqliteAdapter` and `createD1Adapter`
// produce an object of this shape):
//   get(sql, params?): row | undefined              (async adapter: Promise)
//   all(sql, params?): row[]                          (async adapter: Promise)
//   run(sql, params?): { changes?: number } | unknown  (async adapter: Promise)
//   exec(sqlText): void   -- sync adapter only; see markTransaction note below.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXPORT_URL =
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
const LAPSE_KEY_SEPARATOR = String.fromCharCode(0);
function lapseKey(email, app) {
  return `${email}${LAPSE_KEY_SEPARATOR}${app}`;
}

// SQL text shared verbatim between the sync and async cores -- the single
// source of truth for "what" each core does.
const SQL = {
  SELECT_EXISTING: 'SELECT 1 FROM lifecycle_contact WHERE contact_email = ? AND app = ?',
  UPDATE_CONTACT: `UPDATE lifecycle_contact
      SET cloud_id = ?, seat_tier = ?, license_type = ?,
          eval_started_at = ?, eval_ends_at = ?, last_seen_at = ?,
          step = CASE WHEN step = 'lapsed' AND ? = 1 THEN 'welcome' ELSE step END
    WHERE contact_email = ? AND app = ?`,
  INSERT_CONTACT: `INSERT INTO lifecycle_contact
      (contact_email, app, cloud_id, seat_tier, license_type, eval_started_at, eval_ends_at,
       step, step_due_at, suppressed, first_seen_at, last_seen_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'welcome', NULL, ?, ?, ?)`,
  SELECT_LAPSE_CANDIDATES:
    "SELECT contact_email, app FROM lifecycle_contact WHERE step NOT IN ('done', 'lapsed')",
  MARK_LAPSED: `UPDATE lifecycle_contact SET step = 'lapsed' WHERE contact_email = ? AND app = ?`,
  // One row per lapse TRANSITION, not per lapse pass -- markLapsedContactsCore
  // only ever calls this for a row returned by SELECT_LAPSE_CANDIDATES, and
  // that query's `step NOT IN ('done', 'lapsed')` guard already excludes a
  // contact that lapsed on a prior run, so re-running the ingest against an
  // already-lapsed contact never re-inserts a touchpoint for it (see
  // ingestCore.spec.ts's "does not duplicate" test).
  INSERT_LAPSE_TOUCHPOINT: `INSERT INTO lifecycle_touchpoint
      (contact_email, app, kind, step, meta, created_at)
   VALUES (?, ?, 'lapsed', 'lapsed', ?, ?)`,
  SELECT_FUNNEL: `SELECT app, step, license_type, COUNT(*) as count
     FROM lifecycle_contact
    GROUP BY app, step, license_type
    ORDER BY app, step, license_type`,
  // contact_email is selected here ONLY to join against
  // SELECT_LATEST_LAPSE_TOUCHPOINTS below (lapseKey()) -- buildSnapshotCore /
  // buildSnapshotAsyncCore must never put it in the returned tenant object
  // (privacy: the snapshot carries domains, never emails).
  SELECT_TENANTS: `SELECT contact_email, cloud_id, app, seat_tier, license_type, step, eval_ends_at, suppressed, last_seen_at
     FROM lifecycle_contact
    ORDER BY app, last_seen_at DESC`,
  // Latest lapse touchpoint per (contact_email, app) -- a contact can only be
  // "not lapsed" (never lapsed) or "currently lapsed" (SELECT_LAPSE_CANDIDATES
  // excludes step='lapsed' from ever lapsing again), so MAX(created_at) here
  // is really "the" lapse touchpoint, but MAX is used defensively rather than
  // assuming exactly one row.
  SELECT_LATEST_LAPSE_TOUCHPOINTS: `SELECT contact_email, app, MAX(created_at) as lapsed_at
     FROM lifecycle_touchpoint
    WHERE kind = 'lapsed'
    GROUP BY contact_email, app`,
};

// JSON meta stored on every lapse touchpoint -- one constant so the insert
// and any future reader agree on shape without re-deriving it.
const LAPSE_TOUCHPOINT_META = JSON.stringify({ reason: 'absent-or-inactive' });

// ---------------------------------------------------------------------------
// Row transform (pure, DB-free -- identical in both node and Worker runtime)
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

// ---------------------------------------------------------------------------
// Adapters -- translate a real driver (node:sqlite DatabaseSync, or a D1
// binding) into the minimal (sql, params) get/all/run[/exec] shape the two
// cores below are written against.
// ---------------------------------------------------------------------------

// node:sqlite's DatabaseSync already exposes `.prepare(sql).get(...params)`
// / `.all(...params)` / `.run(...params)` and `.exec(sqlText)` natively, so
// this adapter is intentionally a thin pass-through -- it exists as an
// explicit, single documented DI seam (and a place to absorb any future
// shape drift) rather than because DatabaseSync needs translating today.
export function createNodeSqliteAdapter(db) {
  return {
    get: (sql, params = []) => db.prepare(sql).get(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    exec: (sqlText) => db.exec(sqlText),
  };
}

// D1Database's native shape is `.prepare(sql).bind(...params).first()` /
// `.all()` (returns `{ results, ... }`) / `.run()` -- all Promise-returning.
// This adapter normalizes that to the same (sql, params) call shape as the
// node adapter above, so `*AsyncCore` reads structurally parallel to its
// sync twin. D1 has no manual BEGIN/COMMIT/ROLLBACK (each statement
// autocommits), so there is deliberately no `exec()` here -- see the
// "no transaction wrapping" note on `ingestRowsAsyncCore` below.
export function createD1Adapter(d1) {
  return {
    get: (sql, params = []) => d1.prepare(sql).bind(...params).first(),
    all: async (sql, params = []) => (await d1.prepare(sql).bind(...params).all()).results,
    run: (sql, params = []) => d1.prepare(sql).bind(...params).run(),
  };
}

// ---------------------------------------------------------------------------
// Sync core (node:sqlite / any sync adapter)
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
export function upsertContactCore(
  adapter,
  record,
  { bootstrap = false, now = new Date().toISOString(), isActive = false } = {},
) {
  const existing = adapter.get(SQL.SELECT_EXISTING, [record.contactEmail, record.app]);

  if (existing) {
    adapter.run(SQL.UPDATE_CONTACT, [
      record.cloudId,
      record.seatTier,
      record.licenseType,
      record.evalStartedAt,
      record.evalEndsAt,
      now,
      isActive ? 1 : 0,
      record.contactEmail,
      record.app,
    ]);
    return 'updated';
  }

  adapter.run(SQL.INSERT_CONTACT, [
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
  ]);
  return 'inserted';
}

// Lapse pass, run once per ingestRowsCore() call after every row in this
// run's export has been upserted. A contact counts as "not actively seen
// this run" -- and gets step='lapsed' -- in EVERY one of these cases:
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
//
// Each transition also appends ONE lifecycle_touchpoint row (kind='lapsed',
// step='lapsed', meta={reason:'absent-or-inactive'}, created_at=now) -- see
// SQL.INSERT_LAPSE_TOUCHPOINT above for why this never duplicates on re-run.
export function markLapsedContactsCore(adapter, seenActiveKeys, now = new Date().toISOString()) {
  const rows = adapter.all(SQL.SELECT_LAPSE_CANDIDATES, []);
  let lapsed = 0;
  for (const row of rows) {
    if (seenActiveKeys.has(lapseKey(row.contact_email, row.app))) continue;
    adapter.run(SQL.MARK_LAPSED, [row.contact_email, row.app]);
    adapter.run(SQL.INSERT_LAPSE_TOUCHPOINT, [row.contact_email, row.app, LAPSE_TOUCHPOINT_META, now]);
    lapsed += 1;
  }
  return lapsed;
}

// Ingests a full array of raw export rows into `adapter`. Returns a summary
// for reporting, plus an in-memory cloudId -> cloudSiteHostname map built
// from this run's export (used by buildSnapshotCore — the D1 schema itself
// only keeps cloud_id, matching the AtlassianInstance.cloudId convention
// used elsewhere in this repo's D1 schema, so hostnames never get persisted
// redundantly).
//
// `seenActiveKeys` (this run's export only, not persisted across calls) also
// drives the lapse pass at the end -- see markLapsedContactsCore() above.
export function ingestRowsCore(adapter, rawRows, { bootstrap = false, now = new Date().toISOString() } = {}) {
  const summary = {
    inserted: 0,
    updated: 0,
    lapsed: 0,
    skipped: { unmapped_addon: 0, no_cloud_id: 0, rtbf: 0, missing_email: 0 },
    byApp: {},
  };
  const hostnameByCloudId = new Map();
  const seenActiveKeys = new Set();

  adapter.exec('BEGIN');
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

      const result = upsertContactCore(adapter, record, { bootstrap, now, isActive });
      summary[result] += 1;
      summary.byApp[record.app] ??= { inserted: 0, updated: 0 };
      summary.byApp[record.app][result] += 1;
    }

    summary.lapsed = markLapsedContactsCore(adapter, seenActiveKeys, now);

    adapter.exec('COMMIT');
  } catch (err) {
    adapter.exec('ROLLBACK');
    throw err;
  }

  return { summary, hostnameByCloudId };
}

// Aggregated view: funnel counts (from D1, the source of truth for every
// contact ever ingested) + a per-tenant list keyed by domain (never email —
// email stays only in D1). `hostnameByCloudId` resolves cloud_id ->
// cloudSiteHostname from the export fetched in this same run; a tenant whose
// cloudId doesn't appear in that map (e.g. removed from the export between
// runs) falls back to `domain: null` rather than leaking the raw cloud_id.
export function buildSnapshotCore(adapter, hostnameByCloudId, { generatedAt = new Date().toISOString() } = {}) {
  const funnel = adapter
    .all(SQL.SELECT_FUNNEL, [])
    .map((r) => ({ app: r.app, step: r.step, license_type: r.license_type, count: r.count }));

  const tenantRows = adapter.all(SQL.SELECT_TENANTS, []);
  const lapsedAtByContact = new Map(
    adapter.all(SQL.SELECT_LATEST_LAPSE_TOUCHPOINTS, []).map((r) => [lapseKey(r.contact_email, r.app), r.lapsed_at]),
  );

  const tenants = tenantRows.map((r) => ({
    domain: hostnameByCloudId.get(r.cloud_id) ?? null,
    app: r.app,
    seat_tier: r.seat_tier,
    license_type: r.license_type,
    step: r.step,
    eval_ends_at: r.eval_ends_at,
    eval_days_remaining: computeEvalDaysRemaining(r.license_type, r.eval_ends_at, generatedAt),
    lapsed_at: lapsedAtByContact.get(lapseKey(r.contact_email, r.app)) ?? null,
    suppressed: r.suppressed,
    last_seen_at: r.last_seen_at,
  }));

  return { generated_at: generatedAt, funnel, tenants };
}

// ---------------------------------------------------------------------------
// Async core (D1 / any async adapter) -- structurally identical to the sync
// core above (same SQL, same branching), just await-ing every adapter call.
// See the module header for why this can't be the same function as the sync
// core.
// ---------------------------------------------------------------------------

export async function upsertContactAsyncCore(
  adapter,
  record,
  { bootstrap = false, now = new Date().toISOString(), isActive = false } = {},
) {
  const existing = await adapter.get(SQL.SELECT_EXISTING, [record.contactEmail, record.app]);

  if (existing) {
    await adapter.run(SQL.UPDATE_CONTACT, [
      record.cloudId,
      record.seatTier,
      record.licenseType,
      record.evalStartedAt,
      record.evalEndsAt,
      now,
      isActive ? 1 : 0,
      record.contactEmail,
      record.app,
    ]);
    return 'updated';
  }

  await adapter.run(SQL.INSERT_CONTACT, [
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
  ]);
  return 'inserted';
}

export async function markLapsedContactsAsyncCore(adapter, seenActiveKeys, now = new Date().toISOString()) {
  const rows = await adapter.all(SQL.SELECT_LAPSE_CANDIDATES, []);
  let lapsed = 0;
  for (const row of rows) {
    if (seenActiveKeys.has(lapseKey(row.contact_email, row.app))) continue;
    await adapter.run(SQL.MARK_LAPSED, [row.contact_email, row.app]);
    await adapter.run(SQL.INSERT_LAPSE_TOUCHPOINT, [row.contact_email, row.app, LAPSE_TOUCHPOINT_META, now]);
    lapsed += 1;
  }
  return lapsed;
}

// No BEGIN/COMMIT/ROLLBACK wrapping here, unlike ingestRowsCore: D1 does not
// support manual transaction control (each prepared statement autocommits
// independently — see createD1Adapter). Accepted tradeoff: a mid-run failure
// (e.g. the Worker is evicted) can leave a partial write. This is judged
// safe because the whole ingest is idempotent and re-run-safe by
// construction — every upsert is keyed on (contact_email, app) and every
// column it touches is either recomputed from the export or left alone, and
// the lapse pass only reacts to *this run's* seenActiveKeys, so simply
// re-running to completion converges to the same end state a single atomic
// run would have produced.
export async function ingestRowsAsyncCore(adapter, rawRows, { bootstrap = false, now = new Date().toISOString() } = {}) {
  const summary = {
    inserted: 0,
    updated: 0,
    lapsed: 0,
    skipped: { unmapped_addon: 0, no_cloud_id: 0, rtbf: 0, missing_email: 0 },
    byApp: {},
  };
  const hostnameByCloudId = new Map();
  const seenActiveKeys = new Set();

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

    const result = await upsertContactAsyncCore(adapter, record, { bootstrap, now, isActive });
    summary[result] += 1;
    summary.byApp[record.app] ??= { inserted: 0, updated: 0 };
    summary.byApp[record.app][result] += 1;
  }

  summary.lapsed = await markLapsedContactsAsyncCore(adapter, seenActiveKeys, now);

  return { summary, hostnameByCloudId };
}

export async function buildSnapshotAsyncCore(adapter, hostnameByCloudId, { generatedAt = new Date().toISOString() } = {}) {
  const funnelRows = await adapter.all(SQL.SELECT_FUNNEL, []);
  const funnel = funnelRows.map((r) => ({ app: r.app, step: r.step, license_type: r.license_type, count: r.count }));

  const tenantRows = await adapter.all(SQL.SELECT_TENANTS, []);
  const lapsedTouchpointRows = await adapter.all(SQL.SELECT_LATEST_LAPSE_TOUCHPOINTS, []);
  const lapsedAtByContact = new Map(
    lapsedTouchpointRows.map((r) => [lapseKey(r.contact_email, r.app), r.lapsed_at]),
  );

  const tenants = tenantRows.map((r) => ({
    domain: hostnameByCloudId.get(r.cloud_id) ?? null,
    app: r.app,
    seat_tier: r.seat_tier,
    license_type: r.license_type,
    step: r.step,
    eval_ends_at: r.eval_ends_at,
    eval_days_remaining: computeEvalDaysRemaining(r.license_type, r.eval_ends_at, generatedAt),
    lapsed_at: lapsedAtByContact.get(lapseKey(r.contact_email, r.app)) ?? null,
    suppressed: r.suppressed,
    last_seen_at: r.last_seen_at,
  }));

  return { generated_at: generatedAt, funnel, tenants };
}

// ---------------------------------------------------------------------------
// Credentials + fetch (real network — not exercised by unit tests). Portable:
// only touches global `fetch` and `Buffer`, both present in Node and in a
// Worker with `compatibility_flags = ["nodejs_compat"]` (see
// workers/cron-aggregate/wrangler.toml for the existing precedent this repo
// already deploys with that flag).
// ---------------------------------------------------------------------------

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
