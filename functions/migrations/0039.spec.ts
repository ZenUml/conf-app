import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const sql = (file: string) => readFileSync(resolve(process.cwd(), 'functions/migrations', file), 'utf8');

describe('0039_custom_content_page_index', () => {
  it('lets a lookup by pageId use the index instead of scanning CustomContent', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql('0004_add-custom-content.sql'));
    const plan = () => JSON.stringify(
      db.prepare("EXPLAIN QUERY PLAN SELECT contentId FROM CustomContent WHERE pageId IN ('1', '2')").all(),
    );
    expect(plan()).toContain('SCAN CustomContent');

    db.exec(sql('0039_custom_content_page_index.sql'));
    expect(plan()).toContain('USING INDEX idx_custom_content_page');
    expect(plan()).not.toContain('SCAN CustomContent');
  });
});
