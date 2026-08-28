import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function migrated() {
  const db = new DatabaseSync(':memory:');
  // the shape the column is added to, plus the view-time table the backfill reads
  db.exec(`
    CREATE TABLE CustomContent (
      contentId TEXT, type TEXT, latestVersionNumber INTEGER, body TEXT, createdAt TEXT,
      appId TEXT, spaceId TEXT, title TEXT, pageId TEXT, macroUuid TEXT, diagramType TEXT, status TEXT
    );
    CREATE TABLE DiagramAudience (
      cloudId TEXT, forgeAppId TEXT, customContentId TEXT, accountId TEXT,
      firstViewedAt TEXT, lastViewedAt TEXT, viewDays INTEGER
    );
    INSERT INTO CustomContent (contentId, appId, status) VALUES ('1', 'app-a', 'current');
    INSERT INTO CustomContent (contentId, appId, status) VALUES ('2', 'app-a', 'current');
    INSERT INTO CustomContent (contentId, appId, status) VALUES ('3', 'app-b', 'current');
    INSERT INTO DiagramAudience (cloudId, forgeAppId, customContentId) VALUES ('cloud-1', 'app-a', '1');
    INSERT INTO DiagramAudience (cloudId, forgeAppId, customContentId) VALUES ('cloud-9', 'app-b', '1');
  `);
  db.exec(
    readFileSync(
      resolve(process.cwd(), 'functions/migrations/0022_add_custom_content_cloud_id.sql'),
      'utf8',
    ),
  );
  return db;
}

describe('0022_add_custom_content_cloud_id', () => {
  it('adds the column and the lookup index', () => {
    const db = migrated();
    const cols = db.prepare("PRAGMA table_info('CustomContent')").all().map((c: any) => c.name);
    expect(cols).toContain('cloudId');
    const indexes = db.prepare("PRAGMA index_list('CustomContent')").all().map((i: any) => i.name);
    expect(indexes).toContain('idx_custom_content_cloud_id');
  });

  it('backfills from the view-time table, matching on the app as well as the content', () => {
    const db = migrated();
    const rows = db
      .prepare('SELECT contentId, cloudId FROM CustomContent ORDER BY contentId')
      .all() as Array<{ contentId: string; cloudId: string | null }>;
    expect(rows).toEqual([
      { contentId: '1', cloudId: 'cloud-1' },
      // never viewed: stays NULL until the next save stamps it
      { contentId: '2', cloudId: null },
      // same content id under another app must not borrow the first app's tenant
      { contentId: '3', cloudId: null },
    ]);
  });
});
