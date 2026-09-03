import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const MIGRATION = '0024_add_paywall_survey_response.sql';

function sql(): string {
  return readFileSync(resolve(process.cwd(), 'functions/migrations', MIGRATION), 'utf8');
}

function migrated(applications = 1) {
  const db = new DatabaseSync(':memory:');
  for (let i = 0; i < applications; i += 1) {
    db.exec(sql());
  }
  return db;
}

describe('0024_add_paywall_survey_response', () => {
  it('creates the table with every survey column', () => {
    const db = migrated();
    const cols = db
      .prepare("PRAGMA table_info('PaywallSurveyResponse')")
      .all()
      .map((c: any) => c.name);
    expect(cols).toEqual([
      'responseId',
      'cloudId',
      'clientDomain',
      'spaceKey',
      'userAccountId',
      'macroCount',
      'appVersion',
      'role',
      'priceTooCheap',
      'priceBargain',
      'priceExpensive',
      'priceTooExpensive',
      'unitMost',
      'unitLeast',
      'blocker',
      'comment',
      'submitted',
      'grantStatus',
      'grantExpiresAt',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('creates the three lookup indexes', () => {
    const db = migrated();
    const indexes = db
      .prepare("PRAGMA index_list('PaywallSurveyResponse')")
      .all()
      .map((i: any) => i.name);
    expect(indexes).toContain('idx_paywall_survey_tenant_space');
    expect(indexes).toContain('idx_paywall_survey_user');
    expect(indexes).toContain('idx_paywall_survey_submitted');
  });

  it('defaults submitted to 0 so a partial save reads as abandoned', () => {
    const db = migrated();
    db.exec(`
      INSERT INTO PaywallSurveyResponse (responseId, cloudId, spaceKey, userAccountId, createdAt, updatedAt)
      VALUES ('r-1', 'cloud-1', 'ENG', 'user-1', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
    `);
    const row = db
      .prepare("SELECT submitted, comment, grantStatus FROM PaywallSurveyResponse WHERE responseId = 'r-1'")
      .get() as any;
    expect(row.submitted).toBe(0);
    expect(row.comment).toBeNull();
    expect(row.grantStatus).toBeNull();
  });

  it('is idempotent — migrations are applied by hand, so a re-run must not fail', () => {
    // IF NOT EXISTS on the table and all three indexes; a second application
    // is a no-op rather than "table already exists".
    expect(() => migrated(2)).not.toThrow();
  });
});
