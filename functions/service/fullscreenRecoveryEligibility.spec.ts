import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activateRecovery, createRecoveryRequest, recoverySnapshot, type RecoveryEnv,
  type RecoveryIdentity,
} from './fullscreenRecoveryService';
import { onRequestGet, onRequestPost } from '../api/fullscreen-recovery';
import { onRequest as queryMetrics } from '../metrics-cache/query';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const NOW = new Date('2026-10-25T00:00:00.000Z');
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const IDENTITY: RecoveryIdentity = {
  cloudId: 'example-cloud-id', accountId: 'example-user-id',
  forgeAppId: '8ad26115-211f-4216-971b-0540f606303d',
};
const REQUEST = {
  action: 'request' as const, attemptId: '34307364-d627-453f-948f-3cf183955a81',
  scenarios: ['present' as const], note: '', email: 'person@example.test',
  consent: true as const, consentVersion: 'fullscreen-contact-v1' as const, spaceKey: 'ENG',
};

function localDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0033_fullscreen_recovery.sql'), 'utf8'));
  sqlite.exec(`CREATE TABLE AtlassianInstance (cloudId TEXT PRIMARY KEY, clientDomain TEXT);
    CREATE TABLE ForgeInstallation (cloudId TEXT, appId TEXT, createdAt TEXT, clientDomain TEXT);
    INSERT INTO AtlassianInstance VALUES ('example-cloud-id', 'example-tenant.atlassian.net');`);
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let params: unknown[] = [];
      const bound = {
        bind(...values: unknown[]) { params = values; return bound; },
        first<T>() { return Promise.resolve((statement.get(...params) || null) as T | null); },
        run() { const result = statement.run(...params); return Promise.resolve({ meta: { changes: Number(result.changes) } }); },
        all<T>() { return Promise.resolve({ results: statement.all(...params) as T[] }); },
      };
      return bound;
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}

function setup() {
  const { sqlite, db } = localDb();
  const fixture = {
    counts: { ENG: 100, OTHER: 5 } as Record<string, unknown>,
    capturedAt: NOW.toISOString(),
    metricsMissing: false,
    snapshotManaged: false,
    exemptions: { '*': false } as Record<string, boolean> | null,
    policy: { enabled: true, exemptionOverrideReviewed: false },
    licenses: {} as Record<string, string>,
  };
  const env: RecoveryEnv = {
    DB: db, FULLSCREEN_RECOVERY_ENCRYPTION_KEY: KEY,
    KV_FEATURE_FLAGS: {
      get: async (key: string) => key === 'fullscreen-recovery:policy:example-cloud-id'
        ? JSON.stringify(fixture.policy)
        : key === 'PAYWALL_EXEMPTIONS'
          ? fixture.exemptions === null ? null : JSON.stringify(fixture.exemptions)
          : key === 'CUSTOMER_SUCCESS_SERVICE'
            ? JSON.stringify({ 'example-tenant': fixture.snapshotManaged })
          : null,
    } as KVNamespace,
    SPACE_LICENSE_KV: { get: async (key: string) => fixture.licenses[key] ?? null } as KVNamespace,
    confluence_plugin_features: {
      get: async (key: string) => key === 'metrics:example-tenant:lite' && !fixture.metricsMissing
        ? { domain: 'example-tenant', spaces: Object.fromEntries(
          Object.entries(fixture.counts).map(([space, total]) => [space, {
            space, total, isLite: true, lastUpdated: fixture.capturedAt,
          }]),
        ) } : null,
    } as KVNamespace,
    MACRO_COUNT_SNAPSHOT_BUCKET: {
      get: async () => fixture.snapshotManaged
        ? { json: async () => ({ state: 'completed', runId: 'run-1' }) } : null,
    } as unknown as R2Bucket,
  };
  return { sqlite, env, fixture };
}

const requestCount = (sqlite: InstanceType<typeof DatabaseSync>) =>
  (sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoveryRequest').get() as { total: number }).total;

function activeLicense() {
  return JSON.stringify({ status: 'active', expiresAt: '2026-11-01T00:00:00.000Z' });
}

describe('Fullscreen recovery server-side eligibility', () => {
  it('uses the existing current Space count; 99 is ordinary and 100 is eligible', async () => {
    const { sqlite, env, fixture } = setup();
    fixture.counts.ENG = 99;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    await expect(createRecoveryRequest(env, IDENTITY, REQUEST, NOW)).rejects.toMatchObject({ code: 'not_eligible' });
    expect(requestCount(sqlite)).toBe(0);
    fixture.counts.ENG = 100;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('not_requested');
    const created = await createRecoveryRequest(env, IDENTITY, REQUEST, NOW);
    expect(created.snapshot.state).toBe('pending_activation');
    expect(requestCount(sqlite)).toBe(1);
  });

  it('fails open on missing context, missing or invalid metrics, and missing exemption decision', async () => {
    const { sqlite, env, fixture } = setup();
    expect((await recoverySnapshot(env, IDENTITY, NOW)).state).toBe('unavailable');
    fixture.metricsMissing = true;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    fixture.metricsMissing = false;
    fixture.counts.ENG = -1;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    await expect(createRecoveryRequest(env, IDENTITY, REQUEST, NOW)).rejects.toMatchObject({ code: 'unavailable' });
    fixture.counts.ENG = '100';
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    fixture.counts.ENG = 100;
    fixture.capturedAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('not_requested');
    fixture.exemptions = null;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    await expect(createRecoveryRequest(env, IDENTITY, REQUEST, NOW)).rejects.toMatchObject({ code: 'unavailable' });
    expect(requestCount(sqlite)).toBe(0);
  });

  it.each([false, true])('uses the same KV count as existing %s snapshot mode', async (snapshotManaged) => {
    const { sqlite, env, fixture } = setup();
    fixture.snapshotManaged = snapshotManaged;
    const read = await queryMetrics({
      request: new Request('https://api.example.test/metrics-cache/query?contract=2&space=ENG'),
      env: env as any,
      data: { forgeContext: { ...IDENTITY, installationId: 'example-installation-id',
        invocationSource: 'frontend', environmentType: 'STAGING' } },
    } as any);
    expect(await read.json()).toMatchObject({ mode: snapshotManaged ? 'snapshot' : 'legacy',
      metrics: { total: 100 } });
    // Recovery follows the existing KV count even when no snapshot bucket is bound.
    env.MACRO_COUNT_SNAPSHOT_BUCKET = undefined;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('not_requested');
    fixture.counts.ENG = 5;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    await expect(createRecoveryRequest(env, IDENTITY, REQUEST, NOW)).rejects.toMatchObject({ code: 'not_eligible' });
    fixture.counts.ENG = 100;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('not_requested');
    expect(requestCount(sqlite)).toBe(0);
  });

  it('fails open when trusted site mapping, entitlement KV, or paid rail D1 is unavailable', async () => {
    const { sqlite, env } = setup();
    sqlite.prepare('DELETE FROM AtlassianInstance').run();
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    sqlite.prepare(`INSERT INTO AtlassianInstance VALUES ('example-cloud-id', 'example-tenant.atlassian.net')`).run();
    env.SPACE_LICENSE_KV = undefined;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    env.SPACE_LICENSE_KV = { get: async () => null } as KVNamespace;
    sqlite.prepare('DROP TABLE ForgeInstallation').run();
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('unavailable');
    await expect(createRecoveryRequest(env, IDENTITY, REQUEST, NOW)).rejects.toMatchObject({ code: 'unavailable' });
    expect(requestCount(sqlite)).toBe(0);
  });

  it('preserves paid and exempt access, allowing only a reviewed site-specific operational override', async () => {
    const { sqlite, env, fixture } = setup();
    fixture.licenses['license:example-cloud-id:ENG:example-user-id'] = activeLicense();
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    fixture.policy.exemptionOverrideReviewed = true;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    delete fixture.licenses['license:example-cloud-id:ENG:example-user-id'];
    fixture.licenses['license:example-cloud-id:ENG'] = activeLicense();
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    delete fixture.licenses['license:example-cloud-id:ENG'];
    sqlite.prepare(`INSERT INTO ForgeInstallation (cloudId,appId,createdAt)
      VALUES ('example-cloud-id','d9e4002b-120b-426b-834b-402a4a5adce7',?1)`).run(NOW.toISOString());
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    sqlite.prepare('DELETE FROM ForgeInstallation').run();
    fixture.policy.exemptionOverrideReviewed = false;
    fixture.exemptions = { '*': false, 'example-tenant': true };
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    fixture.policy.exemptionOverrideReviewed = true;
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('not_requested');
    fixture.exemptions = { '*': true, 'example-tenant': true };
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'ENG')).state).toBe('disabled');
    expect(requestCount(sqlite)).toBe(0);
  });

  it('rechecks the current Space on activation and ignores an old site-wide grant in an under-limit Space', async () => {
    const { sqlite, env, fixture } = setup();
    const created = await createRecoveryRequest(env, IDENTITY, REQUEST, NOW);
    const requestId = created.snapshot.request!.id;
    const activation = { action: 'activate' as const, attemptId: REQUEST.attemptId, requestId, spaceKey: 'OTHER' };
    await expect(activateRecovery(env, IDENTITY, activation, NOW)).rejects.toMatchObject({ code: 'not_eligible' });
    expect((sqlite.prepare('SELECT activatedAt FROM FullscreenRecoveryRequest').get() as { activatedAt: string | null }).activatedAt).toBeNull();
    expect((await recoverySnapshot(env, IDENTITY, NOW, 'OTHER')).state).toBe('disabled');
    fixture.counts.OTHER = 100;
    const active = await activateRecovery(env, IDENTITY, activation, NOW);
    expect(active.outcome).toBe('activated');
    expect(active.snapshot.state).toBe('active');
    fixture.counts.OTHER = 5;
    const expiredTime = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    fixture.capturedAt = expiredTime.toISOString();
    expect((await recoverySnapshot(env, IDENTITY, expiredTime, 'OTHER')).state).toBe('disabled');
    await expect(activateRecovery(env, IDENTITY, activation, expiredTime)).rejects.toMatchObject({ code: 'not_eligible' });
    expect(requestCount(sqlite)).toBe(1);
  });

  it('requires a current Space in GET/request/activate API calls even with forged body counts', async () => {
    const { sqlite, env, fixture } = setup();
    const get = await onRequestGet({
      request: new Request('https://api.example.test/api/fullscreen-recovery'), env,
      data: { forgeContext: IDENTITY },
    } as any);
    expect((await get.json() as any).snapshot.state).toBe('unavailable');
    const valid = await onRequestGet({
      request: new Request('https://api.example.test/api/fullscreen-recovery?spaceKey=ENG'), env,
      data: { forgeContext: IDENTITY },
    } as any);
    expect((await valid.json() as any).snapshot.state).toBe('not_requested');
    const post = await onRequestPost({
      request: new Request('https://api.example.test/api/fullscreen-recovery', {
        method: 'POST', body: JSON.stringify({ ...REQUEST, spaceKey: undefined, macroCount: 9999, isPaid: false }),
      }), env, data: { forgeContext: IDENTITY }, waitUntil: () => {},
    } as any);
    expect(post.status).toBe(400);
    fixture.counts.OTHER = 5;
    const spoofed = await onRequestPost({
      request: new Request('https://api.example.test/api/fullscreen-recovery', {
        method: 'POST', body: JSON.stringify({ ...REQUEST, spaceKey: 'OTHER', macroCount: 9999, isPaid: false }),
      }), env, data: { forgeContext: IDENTITY }, waitUntil: () => {},
    } as any);
    expect(spoofed.status).toBe(409);
    expect((await spoofed.json() as any).error).toBe('not_eligible');
    expect(requestCount(sqlite)).toBe(0);
    const created = await createRecoveryRequest(env, IDENTITY, REQUEST, NOW);
    const activation = await onRequestPost({
      request: new Request('https://api.example.test/api/fullscreen-recovery', {
        method: 'POST', body: JSON.stringify({ action: 'activate', attemptId: REQUEST.attemptId,
          requestId: created.snapshot.request!.id }),
      }), env, data: { forgeContext: IDENTITY }, waitUntil: () => {},
    } as any);
    expect(activation.status).toBe(400);
    expect((sqlite.prepare('SELECT activatedAt FROM FullscreenRecoveryRequest').get() as { activatedAt: string | null }).activatedAt)
      .toBeNull();
  });
});
