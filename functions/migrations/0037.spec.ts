import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('0037_feedback_report_custom_content_version', () => {
  it('adds a nullable integer customContentVersion column', () => {
    const db = new DatabaseSync(':memory:');
    for (const file of [
      '0025_add_feedback_report.sql',
      '0026_add_feedback_screenshot_metadata.sql',
      '0027_store_feedback_screenshot_in_d1.sql',
      '0037_feedback_report_custom_content_version.sql',
    ]) {
      db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations', file), 'utf8'));
    }
    const column = db.prepare("PRAGMA table_info('FeedbackReport')").all()
      .find((c: any) => c.name === 'customContentVersion') as any;
    expect(column).toMatchObject({ type: 'INTEGER', notnull: 0 });
  });
});
