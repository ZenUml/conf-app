// Adapter-parity + Worker-side coverage for the shared ingest core
// (./ingestCore.mjs). ingest.spec.ts (unchanged) is the regression net for
// the row-transform/upsert/lapse/snapshot BEHAVIOR, driven through the
// node-facing wrappers in ingest-licenses.mjs. This file additionally
// proves:
//   1. createNodeSqliteAdapter + the *Core functions produce byte-identical
//      D1 end-state to the legacy ingest-licenses.mjs wrappers, reusing the
//      same fixtures ingest.spec.ts uses (regression net that the split
//      into ingestCore.mjs didn't change behavior).
//   2. createD1Adapter + the *AsyncCore functions produce the SAME end-state
//      as the sync core, against a fake D1-shaped binding backed by the same
//      node:sqlite database (proves the async twin doesn't drift from the
//      sync one it mirrors).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestRows } from './ingest-licenses.mjs';
import {
  buildSnapshotAsyncCore,
  buildSnapshotCore,
  createD1Adapter,
  createNodeSqliteAdapter,
  ingestRowsAsyncCore,
  ingestRowsCore,
} from './ingestCore.mjs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

// Same fixture shape as ingest.spec.ts's makeRow() — FAKE data only.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    addonKey: 'com.zenuml.confluence-addon-lite',
    addonName: 'ZenUML for Confluence (Lite)',
    cloudId: 'cloud-example-1',
    cloudSiteHostname: 'example-tenant.atlassian.net',
    licenseType: 'FREE',
    tier: '1 Users',
    status: 'active',
    lastUpdated: '2026-08-28',
    latestEvaluationStartDate: undefined,
    maintenanceStartDate: '2026-08-01',
    maintenanceEndDate: '2026-09-01',
    contactDetails: {
      technicalContact: { email: 'ada@example.com' },
    },
    ...overrides,
  };
}

function migratedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(resolve(process.cwd(), 'functions/migrations/0024_add_lifecycle_crm.sql'), 'utf8'),
  );
  return db;
}

function allContacts(db: InstanceType<typeof DatabaseSync>) {
  return db
    .prepare('SELECT * FROM lifecycle_contact ORDER BY app, contact_email')
    .all() as Array<Record<string, unknown>>;
}

// Minimal fake D1Database: same node:sqlite DatabaseSync underneath, wrapped
// so `.prepare(sql).bind(...params).first()/.all()/.run()` behaves like the
// real D1 API (results wrapped in `{ results }` for `.all()`), just
// Promise-returning. Enough surface for createD1Adapter — not a full D1 mock.
function fakeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => db.prepare(sql).get(...params) ?? null,
            all: async () => ({ results: db.prepare(sql).all(...params) }),
            run: async () => db.prepare(sql).run(...params),
          };
        },
      };
    },
  };
}

const NOW = '2026-08-28T00:00:00.000Z';

describe('createNodeSqliteAdapter + ingestRowsCore parity with the legacy ingestRows wrapper', () => {
  it('produces the identical D1 end-state as ingest-licenses.mjs#ingestRows for the same input', () => {
    const rows = [
      makeRow({ contactDetails: { technicalContact: { email: 'ada@example.com' } } }),
      makeRow({
        addonKey: 'com.zenuml.confluence-addon',
        cloudId: 'cloud-example-2',
        licenseType: 'COMMERCIAL',
        contactDetails: { technicalContact: { email: 'bob@example.com' } },
      }),
    ];

    const dbViaLegacyWrapper = migratedDb();
    const legacyResult = ingestRows(dbViaLegacyWrapper, rows, { bootstrap: false, now: NOW });

    const dbViaExplicitAdapter = migratedDb();
    const adapter = createNodeSqliteAdapter(dbViaExplicitAdapter);
    const coreResult = ingestRowsCore(adapter, rows, { bootstrap: false, now: NOW });

    expect(coreResult.summary).toEqual(legacyResult.summary);
    expect(allContacts(dbViaExplicitAdapter)).toEqual(allContacts(dbViaLegacyWrapper));
  });
});

describe('createD1Adapter + ingestRowsAsyncCore parity with the sync core', () => {
  it('produces the identical D1 end-state as the sync core for the same input, across two runs (insert then lapse)', async () => {
    const rows = [
      makeRow({ contactDetails: { technicalContact: { email: 'ada@example.com' } } }),
      makeRow({
        addonKey: 'com.zenuml.confluence-addon',
        cloudId: 'cloud-example-2',
        licenseType: 'EVALUATION',
        tier: 'Evaluation',
        latestEvaluationStartDate: '2026-08-01',
        maintenanceEndDate: '2026-09-05',
        contactDetails: { technicalContact: { email: 'bob@example.com' } },
      }),
    ];

    const syncDb = migratedDb();
    ingestRowsCore(createNodeSqliteAdapter(syncDb), rows, { bootstrap: false, now: NOW });

    const asyncDb = migratedDb();
    const d1Adapter = createD1Adapter(fakeD1(asyncDb));
    const asyncFirstRun = await ingestRowsAsyncCore(d1Adapter, rows, { bootstrap: false, now: NOW });

    expect(asyncFirstRun.summary).toEqual({ inserted: 2, updated: 0, lapsed: 0, skipped: { unmapped_addon: 0, no_cloud_id: 0, rtbf: 0, missing_email: 0 }, byApp: { lite: { inserted: 1, updated: 0 }, full: { inserted: 1, updated: 0 } } });
    expect(allContacts(asyncDb)).toEqual(allContacts(syncDb));

    // Second run: nobody active this time -> both contacts lapse. Proves the
    // async lapse pass (markLapsedContactsAsyncCore) matches the sync one too.
    const secondNow = '2026-09-01T00:00:00.000Z';
    ingestRowsCore(createNodeSqliteAdapter(syncDb), [], { bootstrap: false, now: secondNow });
    const asyncSecondRun = await ingestRowsAsyncCore(d1Adapter, [], { bootstrap: false, now: secondNow });

    expect(asyncSecondRun.summary.lapsed).toBe(2);
    expect(allContacts(asyncDb)).toEqual(allContacts(syncDb));
  });

  it('buildSnapshotAsyncCore matches buildSnapshotCore for the same D1 state', async () => {
    const rows = [
      makeRow({
        licenseType: 'EVALUATION',
        tier: 'Evaluation',
        latestEvaluationStartDate: '2026-08-01',
        maintenanceEndDate: '2026-09-05',
        contactDetails: { technicalContact: { email: 'eve@example.com' } },
      }),
    ];
    const hostnameByCloudId = new Map([['cloud-example-1', 'example-tenant.atlassian.net']]);

    const syncDb = migratedDb();
    ingestRowsCore(createNodeSqliteAdapter(syncDb), rows, { bootstrap: false, now: NOW });
    const syncSnapshot = buildSnapshotCore(createNodeSqliteAdapter(syncDb), hostnameByCloudId, { generatedAt: NOW });

    const asyncDb = migratedDb();
    const d1Adapter = createD1Adapter(fakeD1(asyncDb));
    await ingestRowsAsyncCore(d1Adapter, rows, { bootstrap: false, now: NOW });
    const asyncSnapshot = await buildSnapshotAsyncCore(d1Adapter, hostnameByCloudId, { generatedAt: NOW });

    expect(asyncSnapshot).toEqual(syncSnapshot);
  });
});
