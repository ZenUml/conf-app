import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('0021_add_architecture_token_occurrence', () => {
  it('creates the table with the composite primary key and both indexes', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      readFileSync(
        resolve(
          process.cwd(),
          'functions/migrations/0021_add_architecture_token_occurrence.sql',
        ),
        'utf8',
      ),
    );
    const cols = db
      .prepare("PRAGMA table_info('ArchitectureTokenOccurrence')")
      .all()
      .map((c: any) => c.name);
    expect(cols).toEqual([
      'cloudId',
      'spaceId',
      'contentId',
      'pageId',
      'contentVersion',
      'actorId',
      'rawLabel',
      'comparisonKey',
      'declKind',
      'lineNumber',
      'runId',
      'indexedAt',
    ]);
    const idx = db
      .prepare("PRAGMA index_list('ArchitectureTokenOccurrence')")
      .all()
      .map((i: any) => i.name);
    expect(idx).toEqual(
      expect.arrayContaining([
        'ArchitectureTokenOccurrence_key',
        'ArchitectureTokenOccurrence_content',
      ]),
    );
    // duplicate anchor + line is rejected; same anchor on another line is allowed
    const ins = db.prepare(
      "INSERT INTO ArchitectureTokenOccurrence VALUES ('c','s','1','p',1,'PA','Partner App','partner.app','participant',?, 'r','2026-08-27T00:00:00Z')",
    );
    ins.run(2);
    ins.run(9);
    expect(() => ins.run(2)).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() =>
      db.exec(
        "INSERT INTO ArchitectureTokenOccurrence VALUES ('c','s','1','p',1,'X','X','x','box',3,'r','t')",
      ),
    ).toThrow(/CHECK/);
  });
});
