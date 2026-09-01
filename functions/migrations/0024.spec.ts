import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function migrated() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(
      resolve(process.cwd(), 'functions/migrations/0024_add_lifecycle_crm.sql'),
      'utf8',
    ),
  );
  return db;
}

describe('0024_add_lifecycle_crm', () => {
  it('creates lifecycle_contact with the expected columns, PK, and indexes', () => {
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
    ]);
    const pk = db
      .prepare("PRAGMA table_info('lifecycle_contact')")
      .all()
      .filter((c: any) => c.pk > 0)
      .sort((a: any, b: any) => a.pk - b.pk)
      .map((c: any) => c.name);
    expect(pk).toEqual(['contact_email', 'app']);
    const idx = db.prepare("PRAGMA index_list('lifecycle_contact')").all().map((i: any) => i.name);
    expect(idx).toContain('idx_lifecycle_contact_step_due');
  });

  it('creates lifecycle_touchpoint with the expected columns, autoincrement id, and its index', () => {
    const db = migrated();
    const cols = db.prepare("PRAGMA table_info('lifecycle_touchpoint')").all().map((c: any) => c.name);
    expect(cols).toEqual([
      'id',
      'contact_email',
      'app',
      'kind',
      'step',
      'meta',
      'created_at',
    ]);
    const idx = db.prepare("PRAGMA index_list('lifecycle_touchpoint')").all().map((i: any) => i.name);
    expect(idx).toContain('idx_lifecycle_touchpoint_contact');
  });

  it('round-trips an insert + select on lifecycle_contact', () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO lifecycle_contact
        (contact_email, app, cloud_id, seat_tier, license_type, eval_started_at, eval_ends_at,
         step, step_due_at, suppressed, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ada@example.com',
      'lite',
      'cloud-1',
      'seat-5',
      'EVALUATION',
      '2026-08-01T00:00:00Z',
      '2026-08-15T00:00:00Z',
      'trial_day_3',
      '2026-08-03T00:00:00Z',
      0,
      '2026-08-01T00:00:00Z',
      '2026-08-02T00:00:00Z',
    );
    const row = db
      .prepare('SELECT * FROM lifecycle_contact WHERE contact_email = ? AND app = ?')
      .get('ada@example.com', 'lite') as Record<string, unknown>;
    expect(row).toMatchObject({
      contact_email: 'ada@example.com',
      app: 'lite',
      cloud_id: 'cloud-1',
      seat_tier: 'seat-5',
      license_type: 'EVALUATION',
      step: 'trial_day_3',
      suppressed: 0,
    });
  });

  it('round-trips an insert + select on lifecycle_touchpoint, autoincrementing id', () => {
    const db = migrated();
    const insert = db.prepare(
      `INSERT INTO lifecycle_touchpoint (contact_email, app, kind, step, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run('ada@example.com', 'lite', 'email_sent', 'welcome', '{"template":"welcome-1"}', '2026-08-01T00:00:00Z');
    insert.run('ada@example.com', 'lite', 'email_engaged', 'welcome', null, '2026-08-01T01:00:00Z');
    const rows = db
      .prepare('SELECT id, contact_email, app, kind, step, meta FROM lifecycle_touchpoint ORDER BY id')
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        id: 1,
        contact_email: 'ada@example.com',
        app: 'lite',
        kind: 'email_sent',
        step: 'welcome',
        meta: '{"template":"welcome-1"}',
      },
      {
        id: 2,
        contact_email: 'ada@example.com',
        app: 'lite',
        kind: 'email_engaged',
        step: 'welcome',
        meta: null,
      },
    ]);
  });

  it('applies default step, suppressed, and app-scoped defaults on lifecycle_contact', () => {
    const db = migrated();
    db.prepare(
      'INSERT INTO lifecycle_contact (contact_email, app, cloud_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ).run('bob@example.com', 'full', 'cloud-2', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    const row = db
      .prepare('SELECT step, suppressed, step_due_at FROM lifecycle_contact WHERE contact_email = ? AND app = ?')
      .get('bob@example.com', 'full') as Record<string, unknown>;
    expect(row).toEqual({ step: 'welcome', suppressed: 0, step_due_at: null });
  });

  it('rejects a duplicate (contact_email, app) primary key on lifecycle_contact', () => {
    const db = migrated();
    const insert = db.prepare(
      'INSERT INTO lifecycle_contact (contact_email, app, cloud_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('ada@example.com', 'lite', 'cloud-1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    // same email under a different app is allowed — app is part of the PK
    expect(() =>
      insert.run('ada@example.com', 'full', 'cloud-1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    ).not.toThrow();
    // same (contact_email, app) pair is rejected
    expect(() =>
      insert.run('ada@example.com', 'lite', 'cloud-1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
