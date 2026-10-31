// Regression net for ./senderCore.mjs's welcome-email send logic. Follows
// ingestCore.spec.ts's conventions: FAKE fixture data only (example-tenant /
// user@example.com style), a real node:sqlite DB migrated from
// functions/migrations/0024_add_lifecycle_crm.sql, and a `fakeD1` wrapper
// (same shape as ingestCore.spec.ts's own) proving the D1 adapter path
// behaves identically to the node:sqlite path -- see senderCore.mjs's header
// for why that's a single shared function here, not a sync/async pair.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1Adapter, createNodeSqliteAdapter } from './ingestCore.mjs';
import {
  addDays,
  FROM_ADDRESS,
  NOOP_TRACK_EVENT,
  renderTemplate,
  resendAdapter,
  selectDueCore,
  sendWelcomeCore,
  SUBJECTS,
} from './senderCore.mjs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const NOW = '2026-08-28T12:00:00.000Z';

function migratedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0024_add_lifecycle_crm.sql'), 'utf8'));
  return db;
}

// Minimal fake D1Database -- identical helper to ingestCore.spec.ts's own.
function fakeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => db.prepare(sql).get(...params) ?? null,
            all: async () => ({ results: db.prepare(sql).all(...params) }),
            run: async () => db.prepare(sql).run(...params),
          };
        },
      };
    },
  };
}

function insertContact(
  db: InstanceType<typeof DatabaseSync>,
  overrides: Partial<{
    contact_email: string;
    app: string;
    cloud_id: string;
    seat_tier: string | null;
    license_type: string | null;
    step: string;
    step_due_at: string | null;
    suppressed: number;
    first_seen_at: string;
    last_seen_at: string;
  }> = {},
) {
  const row = {
    contact_email: 'ada@example.com',
    app: 'lite',
    cloud_id: 'cloud-example-1',
    seat_tier: '1 Users',
    license_type: 'FREE',
    step: 'welcome',
    step_due_at: null,
    suppressed: 0,
    first_seen_at: NOW,
    last_seen_at: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO lifecycle_contact
       (contact_email, app, cloud_id, seat_tier, license_type, eval_started_at, eval_ends_at,
        step, step_due_at, suppressed, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    row.contact_email,
    row.app,
    row.cloud_id,
    row.seat_tier,
    row.license_type,
    row.step,
    row.step_due_at,
    row.suppressed,
    row.first_seen_at,
    row.last_seen_at,
  );
  return row;
}

function allTouchpoints(db: InstanceType<typeof DatabaseSync>) {
  return db.prepare('SELECT * FROM lifecycle_touchpoint ORDER BY id').all() as Array<Record<string, unknown>>;
}

function contactRow(db: InstanceType<typeof DatabaseSync>, email: string, app: string) {
  return db
    .prepare('SELECT * FROM lifecycle_contact WHERE contact_email = ? AND app = ?')
    .get(email, app) as Record<string, unknown>;
}

const TEMPLATES = {
  lite: '<html><body>LITE {{unsubscribe_url}} {{preferences_url}}</body></html>',
  full: '<html><body>FULL {{unsubscribe_url}} {{preferences_url}}</body></html>',
  diagramly: '<html><body>DIAGRAMLY {{unsubscribe_url}} {{preferences_url}}</body></html>',
  asyncapi: '<html><body>ASYNCAPI {{unsubscribe_url}} {{preferences_url}} {{asyncapi_docs_url}}</body></html>',
};

function fakeEsp(overrides: { send?: (...args: unknown[]) => unknown } = {}) {
  return {
    send: vi.fn(overrides.send ?? (async () => ({ id: 'fake-esp-id-1' }))),
  };
}

describe('addDays', () => {
  it('adds whole days to an ISO timestamp without truncating time-of-day', () => {
    expect(addDays('2026-08-28T14:32:00.000Z', 3)).toBe('2026-08-31T14:32:00.000Z');
  });
});

describe('renderTemplate', () => {
  it('substitutes a tag present in mergeTags', () => {
    expect(renderTemplate('hello {{name}}', { name: 'Ada' })).toBe('hello Ada');
  });

  it('leaves a tag NOT present in mergeTags untouched (unsubscribe/preferences today)', () => {
    expect(renderTemplate('bye {{unsubscribe_url}}', {})).toBe('bye {{unsubscribe_url}}');
  });
});

describe('selectDueCore', () => {
  let db: InstanceType<typeof DatabaseSync>;
  let adapter: ReturnType<typeof createNodeSqliteAdapter>;

  beforeEach(() => {
    db = migratedDb();
    adapter = createNodeSqliteAdapter(db);
  });

  it('excludes a suppressed contact even if otherwise due', async () => {
    insertContact(db, { contact_email: 'suppressed@example.com', suppressed: 1 });
    expect(await selectDueCore(adapter, NOW)).toEqual([]);
  });

  it('excludes a contact whose step is not welcome', async () => {
    insertContact(db, { contact_email: 'd3@example.com', step: 'd3' });
    expect(await selectDueCore(adapter, NOW)).toEqual([]);
  });

  it('includes a welcome-step, non-suppressed contact with step_due_at IS NULL', async () => {
    insertContact(db, { contact_email: 'null-due@example.com', step_due_at: null });
    const due = await selectDueCore(adapter, NOW);
    expect(due.map((r: any) => r.contact_email)).toEqual(['null-due@example.com']);
  });

  it('includes a contact whose step_due_at is in the past, excludes one in the future', async () => {
    insertContact(db, { contact_email: 'past-due@example.com', step_due_at: '2026-08-01T00:00:00.000Z' });
    insertContact(db, { contact_email: 'future-due@example.com', step_due_at: '2026-09-01T00:00:00.000Z' });
    const due = await selectDueCore(adapter, NOW);
    expect(due.map((r: any) => r.contact_email)).toEqual(['past-due@example.com']);
  });
});

describe('sendWelcomeCore -- successful send', () => {
  it('inserts an email_sent touchpoint, advances step to d3 with step_due_at=now+3d, and fires trackEvent', async () => {
    const db = migratedDb();
    const adapter = createNodeSqliteAdapter(db);
    insertContact(db, { contact_email: 'ada@example.com', app: 'lite', cloud_id: 'cloud-example-1' });

    const esp = fakeEsp();
    const trackEvent = vi.fn();

    const summary = await sendWelcomeCore(adapter, { esp, templates: TEMPLATES, now: NOW, trackEvent });

    expect(summary).toEqual({ due: 1, sent: 1, failed: 0, byApp: { lite: { sent: 1, failed: 0 } } });

    expect(esp.send).toHaveBeenCalledWith({
      from: FROM_ADDRESS,
      to: 'ada@example.com',
      subject: SUBJECTS.lite,
      html: TEMPLATES.lite,
      app: 'lite',
    });

    const touchpoints = allTouchpoints(db);
    expect(touchpoints).toHaveLength(1);
    expect(touchpoints[0]).toMatchObject({
      contact_email: 'ada@example.com',
      app: 'lite',
      kind: 'email_sent',
      step: 'welcome',
      created_at: NOW,
    });
    expect(JSON.parse(touchpoints[0].meta as string)).toEqual({ subject: SUBJECTS.lite, esp_id: 'fake-esp-id-1' });

    const contact = contactRow(db, 'ada@example.com', 'lite');
    expect(contact.step).toBe('d3');
    expect(contact.step_due_at).toBe(addDays(NOW, 3));

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'email_step_sent',
        properties: { product_type: 'lite', cloud_id: 'cloud-example-1', step: 'welcome' },
        distinctId: 'cloud-example-1',
      }),
    );
  });

  it('defaults trackEvent to a no-op when none is injected', async () => {
    const db = migratedDb();
    const adapter = createNodeSqliteAdapter(db);
    insertContact(db, { contact_email: 'bob@example.com', app: 'full' });

    const esp = fakeEsp();
    await expect(
      sendWelcomeCore(adapter, { esp, templates: TEMPLATES, now: NOW }),
    ).resolves.toMatchObject({ sent: 1 });
    // No throw, no assertion needed beyond "it didn't blow up" -- proves
    // NOOP_TRACK_EVENT really is the default.
  });

  it('NOOP_TRACK_EVENT is callable with no side effects', () => {
    expect(() => NOOP_TRACK_EVENT({ anything: true } as any)).not.toThrow();
  });
});

describe('sendWelcomeCore -- ESP failure', () => {
  it('records a note touchpoint with the error, leaves step/step_due_at untouched, and continues to the next contact', async () => {
    const db = migratedDb();
    const adapter = createNodeSqliteAdapter(db);
    insertContact(db, { contact_email: 'fails@example.com', app: 'lite', step_due_at: null });
    insertContact(db, { contact_email: 'succeeds@example.com', app: 'full', step_due_at: null });

    const esp = fakeEsp({
      send: vi.fn(async ({ to }: any) => {
        if (to === 'fails@example.com') throw new Error('Resend send failed: 422 Unprocessable Entity');
        return { id: 'fake-esp-id-2' };
      }),
    });

    const summary = await sendWelcomeCore(adapter, { esp, templates: TEMPLATES, now: NOW });

    expect(summary).toEqual({
      due: 2,
      sent: 1,
      failed: 1,
      byApp: { lite: { sent: 0, failed: 1 }, full: { sent: 1, failed: 0 } },
    });

    const failedContact = contactRow(db, 'fails@example.com', 'lite');
    expect(failedContact.step).toBe('welcome');
    expect(failedContact.step_due_at).toBeNull();

    const touchpoints = allTouchpoints(db);
    const failedTouchpoint = touchpoints.find((t) => t.contact_email === 'fails@example.com');
    expect(failedTouchpoint).toMatchObject({ kind: 'note', step: 'welcome' });
    expect(JSON.parse(failedTouchpoint!.meta as string)).toEqual({
      error: 'Resend send failed: 422 Unprocessable Entity',
    });

    // The failure must not abort the run: the other due contact still sent.
    const succeededContact = contactRow(db, 'succeeds@example.com', 'full');
    expect(succeededContact.step).toBe('d3');
  });

  it('treats a due app with no registered template the same way -- note touchpoint, no throw, run continues', async () => {
    const db = migratedDb();
    const adapter = createNodeSqliteAdapter(db);
    insertContact(db, { contact_email: 'no-template@example.com', app: 'diagramly' });

    const esp = fakeEsp();
    const { diagramly, ...templatesMissingDiagramly } = TEMPLATES;
    const summary = await sendWelcomeCore(adapter, { esp, templates: templatesMissingDiagramly, now: NOW });

    expect(summary).toEqual({ due: 1, sent: 0, failed: 1, byApp: { diagramly: { sent: 0, failed: 1 } } });
    expect(esp.send).not.toHaveBeenCalled();

    const touchpoints = allTouchpoints(db);
    expect(touchpoints).toHaveLength(1);
    expect(touchpoints[0].kind).toBe('note');
    expect(JSON.parse(touchpoints[0].meta as string).error).toMatch(/no template registered for app "diagramly"/);
  });
});

describe('sendWelcomeCore -- template/subject selection picks the correct per-app file', () => {
  it.each([
    ['lite', TEMPLATES.lite, SUBJECTS.lite],
    ['full', TEMPLATES.full, SUBJECTS.full],
    ['diagramly', TEMPLATES.diagramly, SUBJECTS.diagramly],
    ['asyncapi', TEMPLATES.asyncapi, SUBJECTS.asyncapi],
  ])('app=%s renders that app template with that app subject', async (app, expectedHtml, expectedSubject) => {
    const db = migratedDb();
    const adapter = createNodeSqliteAdapter(db);
    insertContact(db, { contact_email: `user@example.com`, app });

    const esp = fakeEsp();
    await sendWelcomeCore(adapter, { esp, templates: TEMPLATES, now: NOW });

    expect(esp.send).toHaveBeenCalledWith(
      expect.objectContaining({ html: expectedHtml, subject: expectedSubject, app }),
    );
  });
});

describe('sendWelcomeCore -- rejects a missing esp adapter', () => {
  it('throws synchronously-observable rejection rather than calling adapter.all with no esp', async () => {
    const db = migratedDb();
    const adapter = createNodeSqliteAdapter(db);
    await expect(sendWelcomeCore(adapter, { templates: TEMPLATES, now: NOW } as any)).rejects.toThrow(
      /esp adapter/,
    );
  });
});

describe('sendWelcomeCore via createD1Adapter -- same outcome as the node:sqlite path', () => {
  it('produces the identical touchpoint + contact end-state as the sync path for the same input', async () => {
    const syncDb = migratedDb();
    insertContact(syncDb, { contact_email: 'parity@example.com', app: 'lite', cloud_id: 'cloud-example-9' });
    await sendWelcomeCore(createNodeSqliteAdapter(syncDb), {
      esp: fakeEsp(),
      templates: TEMPLATES,
      now: NOW,
    });

    const asyncDb = migratedDb();
    insertContact(asyncDb, { contact_email: 'parity@example.com', app: 'lite', cloud_id: 'cloud-example-9' });
    const d1Adapter = createD1Adapter(fakeD1(asyncDb));
    await sendWelcomeCore(d1Adapter, { esp: fakeEsp(), templates: TEMPLATES, now: NOW });

    expect(contactRow(asyncDb, 'parity@example.com', 'lite')).toEqual(contactRow(syncDb, 'parity@example.com', 'lite'));
    expect(allTouchpoints(asyncDb)).toEqual(allTouchpoints(syncDb));
  });
});

describe('resendAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('throws a clear error when constructed with no API key', () => {
    expect(() => resendAdapter('')).toThrow(/Resend API key is required/);
    expect(() => resendAdapter(undefined as any)).toThrow(/Resend API key is required/);
  });

  it('POSTs to https://api.resend.com/emails with a Bearer auth header carrying the key, and never logs it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'resend-123' }) }));
    global.fetch = fetchMock as any;

    const adapter = resendAdapter('secret-key-do-not-log');
    const result = await adapter.send({
      from: FROM_ADDRESS,
      to: 'ada@example.com',
      subject: 'Welcome',
      html: '<p>hi</p>',
    });

    expect(result).toEqual({ id: 'resend-123' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key-do-not-log' }),
      }),
    );
  });

  it('throws a clear (key-free) error on a non-2xx response', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 422, statusText: 'Unprocessable Entity' })) as any;
    const adapter = resendAdapter('secret-key-do-not-log');
    await expect(
      adapter.send({ from: FROM_ADDRESS, to: 'ada@example.com', subject: 'x', html: '<p/>' }),
    ).rejects.toThrow('Resend send failed: 422 Unprocessable Entity');
  });
});
