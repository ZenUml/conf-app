import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./fullscreenRecoveryEligibility', async (importOriginal) => ({
  ...await importOriginal<typeof import('./fullscreenRecoveryEligibility')>(),
  recoveryEligibility: vi.fn(async () => 'eligible'),
}));
import {
  activateRecovery, createRecoveryRequest, recoverySnapshot, type RecoveryEnv, type RecoveryIdentity,
} from './fullscreenRecoveryService';

// The feature column is written and read through a bound parameter; an absent feature is `fullscreen`.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const identity: RecoveryIdentity = { cloudId: 'site-a', accountId: 'user-a', forgeAppId: '8ad26115-211f-4216-971b-0540f606303d' };
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const input = {
  action: 'request' as const, attemptId: '34307364-d627-453f-948f-3cf183955a81',
  scenarios: ['present' as const], note: '', email: 'person@example.test',
  consent: true as const, consentVersion: 'fullscreen-contact-v1' as const, spaceKey: 'ENG',
};

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0033_fullscreen_recovery.sql'), 'utf8'));
  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const prepared = sqlite.prepare(sql);
      const statement = {
        bind(...values: unknown[]) { params = values; return statement; },
        first<T>() { return Promise.resolve((prepared.get(...params) || null) as T | null); },
        run() { const meta = prepared.run(...params); return Promise.resolve({ meta: { changes: Number(meta.changes) } }); },
      };
      return statement;
    },
  } as unknown as D1Database;
  const env: RecoveryEnv = {
    DB: db, FULLSCREEN_RECOVERY_ENCRYPTION_KEY: key,
    KV_FEATURE_FLAGS: { get: async (name: string) => name === 'fullscreen-recovery:policy:site-a' ? JSON.stringify({ enabled: true }) : null } as KVNamespace,
  };
  return { sqlite, env };
}

describe('recovery persistence by feature', () => {
  it('stores an absent feature as fullscreen and finds the row again', async () => {
    const { sqlite, env } = setup();
    const created = await createRecoveryRequest(env, identity, input, new Date('2026-10-10T00:00:00.000Z'));
    expect(created.outcome).toBe('created');
    expect((sqlite.prepare('SELECT feature FROM FullscreenRecoveryRequest').get() as { feature: string }).feature).toBe('fullscreen');
    const snapshot = await recoverySnapshot(env, identity, new Date('2026-10-10T01:00:00.000Z'), 'ENG');
    expect(snapshot.state).toBe('pending_activation');
    expect(snapshot.policyVersion).toBe('fullscreen-contact-v1');
    expect(snapshot.request?.id).toBe(created.snapshot.request?.id);
  });

  it('an explicit fullscreen feature reuses the same row instead of adding one', async () => {
    const { sqlite, env } = setup();
    await createRecoveryRequest(env, identity, input, new Date('2026-10-10T00:00:00.000Z'));
    const again = await createRecoveryRequest(env, identity, { ...input, feature: 'fullscreen' }, new Date('2026-10-11T00:00:00.000Z'));
    expect(again.outcome).toBe('reused');
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoveryRequest').get()).toEqual({ total: 1 });
    const activated = await activateRecovery(env, identity, {
      action: 'activate', attemptId: input.attemptId, requestId: again.snapshot.request!.id, spaceKey: 'ENG', feature: 'fullscreen',
    }, new Date('2026-10-12T00:00:00.000Z'));
    expect(activated.outcome).toBe('activated');
  });
});
