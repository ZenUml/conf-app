import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('0027_store_feedback_screenshot_in_d1', () => {
  it('adds private screenshot bytes while preserving the 30-day metadata index', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0025_add_feedback_report.sql'), 'utf8'));
    db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0026_add_feedback_screenshot_metadata.sql'), 'utf8'));
    db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0027_store_feedback_screenshot_in_d1.sql'), 'utf8'));

    const columns = db.prepare("PRAGMA table_info('FeedbackReport')").all().map((column: any) => column.name);
    expect(columns).toContain('screenshotData');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_feedback_report_screenshot_expiry'").get()).toEqual({ name: 'idx_feedback_report_screenshot_expiry' });
  });
});
