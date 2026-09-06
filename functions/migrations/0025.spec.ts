import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function migrated() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0024_add_lifecycle_crm.sql', '0025_add_lifecycle_auto_welcome.sql']) {
    db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations', file), 'utf8'));
  }
  return db;
}

describe('0025_add_lifecycle_auto_welcome', () => {
  it('adds the six new lifecycle_contact columns with the expected defaults', () => {
    const db = migrated();
    const cols = db.prepare("PRAGMA table_info('lifecycle_contact')").all().map((c: any) => c.name);
    expect(cols).toEqual([
      'contact_email',
      'app',
      'cloud_id',
      'seat_tier',
      'license_type',
      'eval_started_at',
      'eval_ends_at',
      'step',
      'step_due_at',
      'suppressed',
      'first_seen_at',
      'last_seen_at',
      'welcome_state',
      'block_reason',
      'retry_count',
      'last_error',
      'last_failed_at',
      'unsubscribed_at',
    ]);
  });

  it('defaults an existing-shape insert (no new columns supplied) to welcome_state=new, retry_count=0, nulls elsewhere', () => {
    const db = migrated();
    db.prepare(
      'INSERT INTO lifecycle_contact (contact_email, app, cloud_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ).run('ada@example.com', 'lite', 'cloud-1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    const row = db
      .prepare(
        'SELECT welcome_state, block_reason, retry_count, last_error, last_failed_at, unsubscribed_at FROM lifecycle_contact WHERE contact_email = ? AND app = ?',
      )
      .get('ada@example.com', 'lite') as Record<string, unknown>;
    expect(row).toEqual({
      welcome_state: 'new',
      block_reason: null,
      retry_count: 0,
      last_error: null,
      last_failed_at: null,
      unsubscribed_at: null,
    });
  });

  it('round-trips an insert that sets every new column', () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO lifecycle_contact
        (contact_email, app, cloud_id, first_seen_at, last_seen_at,
         welcome_state, block_reason, retry_count, last_error, last_failed_at, unsubscribed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'bob@example.com',
      'full',
      'cloud-2',
      '2026-08-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
      'failed',
      null,
      2,
      'Resend send failed: 500',
      '2026-08-05T00:00:00Z',
      null,
    );
    const row = db
      .prepare('SELECT * FROM lifecycle_contact WHERE contact_email = ? AND app = ?')
      .get('bob@example.com', 'full') as Record<string, unknown>;
    expect(row).toMatchObject({
      welcome_state: 'failed',
      retry_count: 2,
      last_error: 'Resend send failed: 500',
      last_failed_at: '2026-08-05T00:00:00Z',
    });
  });

  it('creates lifecycle_setting seeded with the four conservative defaults', () => {
    const db = migrated();
    const cols = db.prepare("PRAGMA table_info('lifecycle_setting')").all().map((c: any) => c.name);
    expect(cols).toEqual(['key', 'value', 'updated_at']);

    const rows = db
      .prepare('SELECT key, value FROM lifecycle_setting ORDER BY key')
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { key: 'automation_enabled', value: 'false' },
      { key: 'max_retries', value: '3' },
      { key: 'paused_apps', value: '[]' },
      { key: 'rate_limit_per_run', value: '50' },
    ]);
  });

  it('rejects a duplicate lifecycle_setting key (PRIMARY KEY)', () => {
    const db = migrated();
    expect(() =>
      db
        .prepare('INSERT INTO lifecycle_setting (key, value, updated_at) VALUES (?, ?, ?)')
        .run('automation_enabled', 'true', '2026-08-29T00:00:00Z'),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it('creates lifecycle_run with the expected columns, autoincrement id, and defaults', () => {
    const db = migrated();
    const cols = db.prepare("PRAGMA table_info('lifecycle_run')").all().map((c: any) => c.name);
    expect(cols).toEqual([
      'id',
      'started_at',
      'finished_at',
      'mode',
      'due',
      'sent',
      'blocked',
      'failed',
      'skipped_reason',
      'meta',
    ]);

    db.prepare('INSERT INTO lifecycle_run (started_at, mode) VALUES (?, ?)').run(
      '2026-08-29T00:00:00Z',
      'dry',
    );
    db.prepare('INSERT INTO lifecycle_run (started_at, mode) VALUES (?, ?)').run(
      '2026-08-29T01:00:00Z',
      'live',
    );
    const rows = db
      .prepare('SELECT id, mode, due, sent, blocked, failed, skipped_reason FROM lifecycle_run ORDER BY id')
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { id: 1, mode: 'dry', due: 0, sent: 0, blocked: 0, failed: 0, skipped_reason: null },
      { id: 2, mode: 'live', due: 0, sent: 0, blocked: 0, failed: 0, skipped_reason: null },
    ]);
  });

  it('round-trips a fully-populated lifecycle_run row, including JSON meta', () => {
    const db = migrated();
    const meta = JSON.stringify({ rate_limited: 3, app_paused: 1 });
    db.prepare(
      `INSERT INTO lifecycle_run (started_at, finished_at, mode, due, sent, blocked, failed, skipped_reason, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('2026-08-29T00:00:00Z', '2026-08-29T00:00:05Z', 'live', 10, 6, 3, 1, null, meta);
    const row = db.prepare('SELECT * FROM lifecycle_run WHERE id = 1').get() as Record<string, unknown>;
    expect(row).toMatchObject({ due: 10, sent: 6, blocked: 3, failed: 1 });
    expect(JSON.parse(row.meta as string)).toEqual({ rate_limited: 3, app_paused: 1 });
  });
});
