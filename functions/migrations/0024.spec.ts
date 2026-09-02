import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function migrated() {
  const db = new DatabaseSync(':memory:');
  // the pre-migration shape: no gateVersion column yet
  db.exec(`
    CREATE TABLE DiagramAudience (
      cloudId TEXT NOT NULL,
      forgeAppId TEXT NOT NULL,
      customContentId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      firstViewedAt TEXT NOT NULL,
      lastViewedAt TEXT NOT NULL,
      viewDays INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (cloudId, forgeAppId, customContentId, accountId)
    ) WITHOUT ROWID;
    INSERT INTO DiagramAudience (
      cloudId, forgeAppId, customContentId, accountId, firstViewedAt, lastViewedAt, viewDays
    ) VALUES ('cloud-1', 'app-a', 'content-1', 'account-1', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1);
  `);
  db.exec(readFileSync(
    resolve(process.cwd(), 'functions/migrations', '0024_add_diagram_audience_gate_version.sql'),
    'utf8',
  ));
  return db;
}

describe('0024_add_diagram_audience_gate_version', () => {
  it('adds a NOT NULL gateVersion column defaulting to 1', () => {
    const db = migrated();
    const cols = db.prepare("PRAGMA table_info('DiagramAudience')").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const col = cols.find((c) => c.name === 'gateVersion');
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe('1');
  });

  it('backfills every pre-existing row to gateVersion 1, not NULL or 0', () => {
    const db = migrated();
    const rows = db
      .prepare('SELECT accountId, gateVersion FROM DiagramAudience ORDER BY accountId')
      .all() as Array<{ accountId: string; gateVersion: number }>;
    expect(rows).toEqual([{ accountId: 'account-1', gateVersion: 1 }]);
  });

  it('defaults a post-migration row to gateVersion 1 when the column is omitted from the INSERT', () => {
    const db = migrated();
    db.exec(`
      INSERT INTO DiagramAudience (
        cloudId, forgeAppId, customContentId, accountId, firstViewedAt, lastViewedAt, viewDays
      ) VALUES ('cloud-1', 'app-a', 'content-2', 'account-2', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z', 1);
    `);
    const row = db
      .prepare("SELECT gateVersion FROM DiagramAudience WHERE accountId = 'account-2'")
      .get() as { gateVersion: number };
    expect(row.gateVersion).toBe(1);
  });
});
