// Guard-flag + adapter-wiring coverage for the lifecycle-ingest Worker.
//
// No pattern for testing a Cloudflare `scheduled()` handler exists anywhere
// else in this repo (workers/cron-aggregate has no test file at all), so per
// the T6b task instructions this deliberately does NOT invent a new
// Miniflare/D1-simulation harness. Scope is exactly:
//   1. the LIFECYCLE_INGEST_ENABLED guard — off by default, on only when the
//      literal string "true" is set, and the off path touches neither fetch
//      nor D1;
//   2. the credential guard — missing FORGE_EMAIL/FORGE_API_TOKEN fails
//      loudly instead of silently no-op-ing;
//   3. adapter wiring — when enabled, `scheduled()` reaches
//      runLifecycleIngest, which drives createD1Adapter + ingestRowsAsyncCore
//      end-to-end against a fake D1 binding (the same lightweight fakeD1
//      pattern already established in scripts/lifecycle/ingestCore.spec.ts —
//      reused, not reinvented) and an injected fetchImpl fixture, proving the
//      wiring produces the correct D1 end-state without a real network call
//      or a real Cloudflare binding.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { runLifecycleIngest, type Env } from './index.ts';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function migratedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(resolve(process.cwd(), 'functions/migrations/0024_add_lifecycle_crm.sql'), 'utf8'),
  );
  return db;
}

function allContacts(db: InstanceType<typeof DatabaseSync>) {
  return db
    .prepare('SELECT * FROM lifecycle_contact ORDER BY app, contact_email')
    .all() as Array<Record<string, unknown>>;
}

// Same minimal fake D1Database as ingestCore.spec.ts: real node:sqlite
// underneath, wrapped to match D1's prepare().bind().first()/.all()/.run()
// shape, Promise-returning.
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
  } as unknown as D1Database;
}

const FIXTURE_ROW = {
  addonKey: 'com.zenuml.confluence-addon-lite',
  cloudId: 'cloud-example-1',
  cloudSiteHostname: 'example-tenant.atlassian.net',
  licenseType: 'FREE',
  tier: '1 Users',
  status: 'active',
  contactDetails: { technicalContact: { email: 'ada@example.com' } },
};

function fakeFetchImpl(rows: unknown[]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => rows,
  })) as unknown as typeof fetch;
}

function fakeExecutionContext() {
  const waited: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as ExecutionContext,
    waited,
  };
}

describe('LIFECYCLE_INGEST_ENABLED guard', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it.each([undefined, 'false', 'TRUE', '1', ''])('skips without touching fetch or D1 when LIFECYCLE_INGEST_ENABLED=%s', async (flag) => {
    const fetchSpy = fakeFetchImpl([]);
    const env: Env = {
      DB: fakeD1(migratedDb()),
      FORGE_EMAIL: 'bot@example.com',
      FORGE_API_TOKEN: 'token',
      LIFECYCLE_INGEST_ENABLED: flag,
    };
    const { ctx, waited } = fakeExecutionContext();
    const controller = { scheduledTime: Date.parse('2026-08-28T03:00:00.000Z') } as ScheduledController;

    await worker.scheduled(controller, env, ctx);

    expect(waited).toHaveLength(0); // never scheduled the ingest work at all
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skipping (no-op guard)'));
  });

  it('runs (schedules ingest work via ctx.waitUntil) when LIFECYCLE_INGEST_ENABLED="true"', async () => {
    const db = migratedDb();
    const env: Env = {
      DB: fakeD1(db),
      FORGE_EMAIL: 'bot@example.com',
      FORGE_API_TOKEN: 'token',
      LIFECYCLE_INGEST_ENABLED: 'true',
    };
    const { ctx, waited } = fakeExecutionContext();
    const controller = { scheduledTime: Date.parse('2026-08-28T03:00:00.000Z') } as ScheduledController;

    // scheduled() reaches into module-scope `fetch` via ingestCore's default
    // param, so stub the global for this one test rather than threading a
    // fetchImpl through the Worker's public (env, ctx) surface.
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetchImpl([FIXTURE_ROW]));

    await worker.scheduled(controller, env, ctx);
    expect(waited).toHaveLength(1);
    await waited[0];

    expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    expect(allContacts(db)).toMatchObject([{ contact_email: 'ada@example.com', app: 'lite', step: 'welcome' }]);

    globalFetchSpy.mockRestore();
  });
});

describe('runLifecycleIngest adapter wiring', () => {
  it('throws when FORGE_EMAIL/FORGE_API_TOKEN are not set on the environment', async () => {
    const env: Env = { DB: fakeD1(migratedDb()) };
    await expect(runLifecycleIngest(env)).rejects.toThrow(/FORGE_EMAIL/);
  });

  it('drives createD1Adapter + ingestRowsAsyncCore end-to-end via an injected fetchImpl, producing the expected D1 state', async () => {
    const db = migratedDb();
    const env: Env = {
      DB: fakeD1(db),
      FORGE_EMAIL: 'bot@example.com',
      FORGE_API_TOKEN: 'token',
    };
    const now = '2026-08-28T03:00:00.000Z';

    const summary = await runLifecycleIngest(env, now, { fetchImpl: fakeFetchImpl([FIXTURE_ROW]) });

    expect(summary).toMatchObject({ inserted: 1, updated: 0, lapsed: 0 });
    expect(allContacts(db)).toMatchObject([
      { contact_email: 'ada@example.com', app: 'lite', step: 'welcome', first_seen_at: now, last_seen_at: now },
    ]);
  });
});
