import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('0025_add_feedback_report', () => {
  it('creates an idempotent report table without screenshot or diagram-body columns', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0025_add_feedback_report.sql'), 'utf8'));

    const columns = db.prepare("PRAGMA table_info('FeedbackReport')").all().map((column: any) => column.name);
    expect(columns).toContain('contentId');
    expect(columns).toContain('customContentId');
    expect(columns).toContain('macroUuid');
    expect(columns).not.toContain('screenshot');
    expect(columns).not.toContain('diagramSource');

    const insert = db.prepare(`
      INSERT INTO FeedbackReport (
        reportReference, submissionId, installationId, cloudId, forgeAppId, accountId,
        description, surface, hostModule, diagramType, diagramTitle,
        spaceName, macroUuid, contentId, customContentId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const values = ['FBR-ONE', 'submission-1', 'installation-1', 'cloud-1', 'app-1', 'account-1',
      '- literal\n`text`', 'viewer', 'macro', 'mermaid', 'Title', 'SPACE', 'macro-1', 'page-1', 'cc-1'];
    insert.run(...values);
    expect(() => insert.run('FBR-TWO', ...values.slice(1))).toThrow(/UNIQUE/);
    expect(db.prepare('SELECT description FROM FeedbackReport').get()).toEqual({ description: '- literal\n`text`' });
  });
});
