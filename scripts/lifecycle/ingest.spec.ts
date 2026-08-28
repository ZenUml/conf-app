import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADDON_APP_MAP,
  buildSnapshot,
  ingestRows,
  mapEvalWindow,
  transformRow,
} from './ingest-licenses.mjs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

// FAKE fixture data only — example-tenant domains, user@example.com emails.
// Shaped like the real Marketplace `reporting/licenses/export?accept=json`
// response (verified against a live export during this session), trimmed to
// the fields ingest-licenses.mjs actually reads.
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

describe('ADDON_APP_MAP', () => {
  it('maps all four addon keys to their app slug', () => {
    expect(ADDON_APP_MAP).toEqual({
      'com.zenuml.confluence-addon-lite': 'lite',
      'com.zenuml.confluence-addon': 'full',
      'my-api': 'asyncapi',
      'com.pnd.jira.plugins.diagramly': 'diagramly',
    });
  });
});

describe('mapEvalWindow', () => {
  it('maps latestEvaluationStartDate -> eval_started_at and maintenanceEndDate -> eval_ends_at for EVALUATION rows', () => {
    const row = makeRow({
      licenseType: 'EVALUATION',
      tier: 'Evaluation',
      latestEvaluationStartDate: '2026-08-01',
      maintenanceStartDate: '2026-08-01',
      maintenanceEndDate: '2026-08-31',
    });
    expect(mapEvalWindow(row)).toEqual({
      evalStartedAt: '2026-08-01',
      evalEndsAt: '2026-08-31',
    });
  });

  it('leaves both eval fields null for non-EVALUATION rows, even if the source has stale eval dates', () => {
    const row = makeRow({
      licenseType: 'COMMERCIAL',
      latestEvaluationStartDate: '2025-01-01',
      maintenanceEndDate: '2027-01-01',
    });
    expect(mapEvalWindow(row)).toEqual({ evalStartedAt: null, evalEndsAt: null });
  });
});

describe('transformRow', () => {
  it('skips rows whose addonKey is not one of the four mapped apps', () => {
    const row = makeRow({ addonKey: 'gptdock-confluence' });
    expect(transformRow(row)).toEqual({ skipped: 'unmapped_addon' });
  });

  it('skips rows with a missing technical contact email', () => {
    const row = makeRow({ contactDetails: {} });
    expect(transformRow(row)).toEqual({ skipped: 'missing_email' });
  });

  it("skips rows whose technical contact email is the literal 'RTBF'", () => {
    const row = makeRow({ contactDetails: { technicalContact: { email: 'RTBF' } } });
    expect(transformRow(row)).toEqual({ skipped: 'rtbf' });
  });

  it('skips legacy Server/DC-hosted rows that carry no cloudId at all', () => {
    const row = makeRow({ cloudId: undefined, cloudSiteHostname: undefined, hosting: 'Server' });
    expect(transformRow(row)).toEqual({ skipped: 'no_cloud_id' });
  });

  it('builds a full record for a mapped, contactable row', () => {
    const row = makeRow({
      addonKey: 'com.zenuml.confluence-addon',
      cloudId: 'cloud-example-2',
      tier: '10 Users',
      licenseType: 'COMMERCIAL',
      contactDetails: { technicalContact: { email: 'bob@example.com' } },
    });
    expect(transformRow(row)).toEqual({
      record: {
        contactEmail: 'bob@example.com',
        app: 'full',
        cloudId: 'cloud-example-2',
        cloudSiteHostname: 'example-tenant.atlassian.net',
        seatTier: '10 Users',
        licenseType: 'COMMERCIAL',
        evalStartedAt: null,
        evalEndsAt: null,
      },
    });
  });
});

describe('ingestRows', () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(() => {
    db = migratedDb();
  });

  it('inserts a new contact with first_seen_at = last_seen_at = now and step = welcome', () => {
    const row = makeRow({ contactDetails: { technicalContact: { email: 'ada@example.com' } } });
    const now = '2026-08-28T00:00:00.000Z';
    const { summary } = ingestRows(db, [row], { bootstrap: false, now });

    expect(summary.inserted).toBe(1);
    expect(summary.updated).toBe(0);

    const rows = allContacts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contact_email: 'ada@example.com',
      app: 'lite',
      step: 'welcome',
      suppressed: 0,
      first_seen_at: now,
      last_seen_at: now,
    });
  });

  it('is idempotent on re-run: no duplicate row, last_seen_at advances, first_seen_at and step untouched', () => {
    const row = makeRow({ contactDetails: { technicalContact: { email: 'ada@example.com' } } });
    const firstRun = '2026-08-20T00:00:00.000Z';
    const secondRun = '2026-08-28T00:00:00.000Z';

    ingestRows(db, [row], { bootstrap: false, now: firstRun });
    // simulate the contact having progressed past the welcome step between runs
    db.prepare('UPDATE lifecycle_contact SET step = ? WHERE contact_email = ? AND app = ?').run(
      'trial_day_3',
      'ada@example.com',
      'lite',
    );

    const { summary } = ingestRows(
      db,
      [row, row], // duplicate row within the same export, must still collapse to one contact
      { bootstrap: false, now: secondRun },
    );

    expect(summary.updated).toBe(2); // both duplicate rows hit the UPDATE path
    expect(summary.inserted).toBe(0);

    const rows = allContacts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contact_email: 'ada@example.com',
      app: 'lite',
      step: 'trial_day_3', // never reset by an update
      first_seen_at: firstRun, // never reset by an update
      last_seen_at: secondRun, // advances
    });
  });

  it('skips RTBF and missing-email rows without creating any contact row', () => {
    const rtbfRow = makeRow({ contactDetails: { technicalContact: { email: 'RTBF' } } });
    const missingRow = makeRow({ contactDetails: {}, cloudId: 'cloud-example-3' });
    const { summary } = ingestRows(db, [rtbfRow, missingRow], { bootstrap: false, now: '2026-08-28T00:00:00.000Z' });

    expect(summary.inserted).toBe(0);
    expect(summary.skipped).toMatchObject({ rtbf: 1, missing_email: 1 });
    expect(allContacts(db)).toHaveLength(0);
  });

  it('suppresses rows first seen during a --bootstrap run, and does not suppress rows first seen afterward', () => {
    const bootstrapRow = makeRow({
      contactDetails: { technicalContact: { email: 'backlog@example.com' } },
      cloudId: 'cloud-example-backlog',
    });
    ingestRows(db, [bootstrapRow], { bootstrap: true, now: '2026-08-20T00:00:00.000Z' });

    const postBootstrapRow = makeRow({
      contactDetails: { technicalContact: { email: 'newcomer@example.com' } },
      cloudId: 'cloud-example-newcomer',
    });
    ingestRows(db, [bootstrapRow, postBootstrapRow], { bootstrap: false, now: '2026-08-28T00:00:00.000Z' });

    const rows = allContacts(db);
    const backlog = rows.find((r) => r.contact_email === 'backlog@example.com');
    const newcomer = rows.find((r) => r.contact_email === 'newcomer@example.com');

    expect(backlog).toMatchObject({ suppressed: 1 }); // seeded during bootstrap, stays suppressed
    expect(newcomer).toMatchObject({ suppressed: 0 }); // first seen on a later incremental run
  });
});

describe('buildSnapshot', () => {
  it('aggregates funnel counts by app/step/license_type and lists tenants by domain with no emails', () => {
    const db = migratedDb();
    const now = '2026-08-28T00:00:00.000Z';

    const hostnameByCloudId = new Map([
      ['cloud-example-1', 'example-tenant-one.atlassian.net'],
      ['cloud-example-2', 'example-tenant-two.atlassian.net'],
    ]);

    ingestRows(
      db,
      [
        makeRow({
          cloudId: 'cloud-example-1',
          licenseType: 'FREE',
          contactDetails: { technicalContact: { email: 'ada@example.com' } },
        }),
        makeRow({
          addonKey: 'com.zenuml.confluence-addon',
          cloudId: 'cloud-example-2',
          licenseType: 'COMMERCIAL',
          tier: '10 Users',
          contactDetails: { technicalContact: { email: 'bob@example.com' } },
        }),
      ],
      { bootstrap: false, now },
    );

    const snapshot = buildSnapshot(db, hostnameByCloudId, { generatedAt: now });

    expect(snapshot.generated_at).toBe(now);
    expect(snapshot.funnel).toEqual(
      expect.arrayContaining([
        { app: 'full', step: 'welcome', license_type: 'COMMERCIAL', count: 1 },
        { app: 'lite', step: 'welcome', license_type: 'FREE', count: 1 },
      ]),
    );
    expect(snapshot.funnel).toHaveLength(2);

    expect(snapshot.tenants).toHaveLength(2);
    const liteTenant = snapshot.tenants.find((t: Record<string, unknown>) => t.app === 'lite');
    expect(liteTenant).toEqual({
      domain: 'example-tenant-one.atlassian.net',
      app: 'lite',
      license_type: 'FREE',
      step: 'welcome',
      eval_ends_at: null,
      suppressed: 0,
      last_seen_at: now,
    });

    // no raw export dump, no email anywhere in the tenants payload
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/@example\.com/);
    expect(serialized).not.toMatch(/contactDetails/);
  });
});
