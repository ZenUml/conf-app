import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  activateRecovery, createRecoveryRequest, decryptRecoveryField, encryptRecoveryField,
  recoverySnapshot, type RecoveryEnv, type RecoveryIdentity,
} from './fullscreenRecoveryService';
import { onRequestPost as supportPost } from '../api/support/fullscreen-recovery';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const policy = {
  enabled: true,
  noticeStartsAt: '2026-10-01T00:00:00.000Z',
  enforceAt: '2026-10-08T00:00:00.000Z',
  noticeVersion: 'pilot-1',
};
const identity: RecoveryIdentity = {
  cloudId: 'site-a', accountId: 'user-a', forgeAppId: '8ad26115-211f-4216-971b-0540f606303d',
};
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const requestInput = {
  action: 'request' as const,
  attemptId: '34307364-d627-453f-948f-3cf183955a81',
  scenarios: ['present' as const], note: 'private context', email: 'person@example.test',
  consent: true as const, consentVersion: 'fullscreen-contact-v1' as const,
};

function memoryDb() {
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
        all<T>() { return Promise.resolve({ results: prepared.all(...params) as T[] }); },
      };
      return statement;
    },
    async batch(statements: Array<{run: () => Promise<unknown>}>) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}
function env(db: D1Database): RecoveryEnv {
  return {
    DB: db, FULLSCREEN_RECOVERY_ENCRYPTION_KEY: key,
    FULLSCREEN_RECOVERY_SUPPORT_TOKENS: JSON.stringify({ agent1: 'very-long-internal-support-token-123' }),
    SPACE_LICENSE_KV: { get: async (name: string) => name === 'fullscreen-recovery:policy:site-a' ? JSON.stringify(policy) : null } as KVNamespace,
  };
}

function supportCommand(recoveryEnv: RecoveryEnv, body: object) {
  return supportPost({
    env: recoveryEnv,
    request: new Request('https://api.example.test/api/support/fullscreen-recovery', {
      method: 'POST', headers: { Authorization: 'Bearer very-long-internal-support-token-123' },
      body: JSON.stringify(body),
    }),
    waitUntil: () => {},
  } as any);
}

describe('fullscreen recovery persistence', () => {
  it('encrypts contact fields and creates a once-only pending grant after enforcement', async () => {
    const { sqlite, db } = memoryDb();
    const e = env(db);
    const now = new Date('2026-10-10T00:00:00.000Z');
    const first = await createRecoveryRequest(e, identity, requestInput, now);
    expect(first.outcome).toBe('created');
    expect(first.snapshot.state).toBe('pending_activation');
    expect(first.snapshot.grant?.expiresAt).toBeNull();
    const raw = sqlite.prepare('SELECT * FROM FullscreenRecoveryRequest').get() as any;
    expect(raw.emailCiphertext).not.toContain('person@example.test');
    expect(raw.noteCiphertext).not.toContain('private context');
    expect(await decryptRecoveryField(raw.emailCiphertext, key)).toBe('person@example.test');
    const second = await createRecoveryRequest(e, identity, {
      ...requestInput, email: 'changed@example.test', scenarios: ['discuss'],
    }, new Date('2026-10-11T00:00:00.000Z'));
    expect(second.outcome).toBe('reused');
    expect(second.snapshot.request?.email).toBe('person@example.test');
    expect(second.snapshot.request?.scenarios).toEqual(['present']);
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoveryRequest').get()).toEqual({ total: 1 });
  });

  it('starts exactly 168 hours on first activation and expires at equality', async () => {
    const { db } = memoryDb(); const e = env(db);
    const first = await createRecoveryRequest(e, identity, requestInput, new Date('2026-10-10T00:00:00.000Z'));
    const requestId = first.snapshot.request!.id;
    const activation = { action: 'activate' as const, attemptId: requestInput.attemptId, requestId };
    const active = await activateRecovery(e, identity, activation, new Date('2026-10-12T00:00:00.000Z'));
    expect(active.outcome).toBe('activated');
    expect(active.snapshot.grant?.expiresAt).toBe('2026-10-19T00:00:00.000Z');
    const replay = await activateRecovery(e, identity, activation, new Date('2026-10-13T00:00:00.000Z'));
    expect(replay.outcome).toBe('already_active');
    expect(replay.snapshot.grant?.expiresAt).toBe(active.snapshot.grant?.expiresAt);
    expect((await recoverySnapshot(e, identity, new Date('2026-10-19T00:00:00.000Z'))).state).toBe('expired');
    await expect(activateRecovery(e, { ...identity, accountId: 'user-b' }, activation)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps one request and activation under concurrent calls', async () => {
    const { sqlite, db } = memoryDb(); const e = env(db);
    const now = new Date('2026-10-10T00:00:00.000Z');
    const [left, right] = await Promise.all([
      createRecoveryRequest(e, identity, requestInput, now),
      createRecoveryRequest(e, identity, { ...requestInput, email: 'other@example.test' }, now),
    ]);
    expect([left.outcome, right.outcome].sort()).toEqual(['created', 'reused']);
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoveryRequest').get()).toEqual({ total: 1 });
    const input = { action: 'activate' as const, attemptId: requestInput.attemptId, requestId: left.snapshot.request!.id };
    const [first, second] = await Promise.all([
      activateRecovery(e, identity, input, new Date('2026-10-12T00:00:00.000Z')),
      activateRecovery(e, identity, input, new Date('2026-10-13T00:00:00.000Z')),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['activated', 'already_active']);
    expect(first.snapshot.grant?.expiresAt).toBe(second.snapshot.grant?.expiresAt);
  });

  it('shows notice only after a full seven-day configured notice period', async () => {
    const { db } = memoryDb(); const e = env(db);
    expect((await recoverySnapshot(e, identity, new Date('2026-09-30T23:59:59.999Z'))).state).toBe('disabled');
    expect((await recoverySnapshot(e, identity, new Date('2026-10-01T00:00:00.000Z'))).state).toBe('notice');
    expect((await recoverySnapshot(e, identity, new Date('2026-10-08T00:00:00.000Z'))).state).toBe('not_requested');
  });

  it('requires an explicit boolean true before overriding a reviewed exemption', async () => {
    const { db } = memoryDb();
    const e = env(db);
    const now = new Date('2026-10-09T00:00:00.000Z');
    expect((await recoverySnapshot(e, identity, now)).exemptionOverrideReviewed).toBe(false);
    e.SPACE_LICENSE_KV = {
      get: async () => JSON.stringify({ ...policy, exemptionOverrideReviewed: true }),
    } as KVNamespace;
    expect((await recoverySnapshot(e, identity, now)).exemptionOverrideReviewed).toBe(true);
    e.SPACE_LICENSE_KV = {
      get: async () => JSON.stringify({ ...policy, exemptionOverrideReviewed: 'true' }),
    } as KVNamespace;
    const malformed = await recoverySnapshot(e, identity, now);
    expect(malformed.state).toBe('unavailable');
    expect(malformed.exemptionOverrideReviewed).toBe(false);
  });

  it('fails open when policy or encryption config is unavailable and never creates a grant', async () => {
    const { sqlite, db } = memoryDb(); const e = env(db);
    delete e.FULLSCREEN_RECOVERY_ENCRYPTION_KEY;
    expect((await recoverySnapshot(e, identity, new Date('2026-10-10T00:00:00.000Z'))).state).toBe('unavailable');
    await expect(createRecoveryRequest(e, identity, requestInput)).rejects.toMatchObject({ code: 'unavailable' });
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoveryRequest').get()).toEqual({ total: 0 });
  });

  it('applies one default 14-day support extension per command and records actor', async () => {
    const { sqlite, db } = memoryDb(); const e = env(db);
    const first = await createRecoveryRequest(e, identity, requestInput, new Date('2026-10-10T00:00:00.000Z'));
    const requestId = first.snapshot.request!.id;
    await activateRecovery(e, identity, { action: 'activate', attemptId: requestInput.attemptId, requestId },
      new Date('2026-10-12T00:00:00.000Z'));
    const command = { action: 'extend', commandId: '26eb4783-0ff2-4380-b9cb-8eeb2e0b6438', requestId, reason: 'Support approved' };
    const firstResponse = await supportCommand(e, command);
    expect(firstResponse.status).toBe(200);
    const firstExpiry = (await firstResponse.json() as any).expiresAt;
    const replay = await supportCommand(e, command);
    expect((await replay.json() as any).outcome).toBe('already_applied');
    expect((sqlite.prepare('SELECT expiresAt FROM FullscreenRecoveryRequest').get() as any).expiresAt).toBe(firstExpiry);
    expect((sqlite.prepare('SELECT actorId FROM FullscreenRecoverySupportAction').get() as any).actorId).toBe('agent1');
  });

  it('requires the configured bearer for a support outcome and never trusts a body actor', async () => {
    const { sqlite, db } = memoryDb(); const e = env(db);
    const first = await createRecoveryRequest(e, identity, requestInput, new Date('2026-10-10T00:00:00.000Z'));
    const command = {
      action: 'outcome', commandId: 'f4b4b244-86b2-44c4-9a58-83772288079d',
      requestId: first.snapshot.request!.id, reason: 'Customer replied in original thread',
      supportOutcome: 'customer_replied', actor: 'forged-actor',
    };
    const unauthorized = await supportPost({
      env: e,
      request: new Request('https://api.example.test/api/support/fullscreen-recovery', {
        method: 'POST', body: JSON.stringify(command),
      }),
    } as any);
    expect(unauthorized.status).toBe(401);
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoverySupportAction').get()).toEqual({ total: 0 });
    const recorded = await supportCommand(e, command);
    expect(recorded.status).toBe(200);
    expect((sqlite.prepare('SELECT actorId FROM FullscreenRecoverySupportAction').get() as any).actorId).toBe('agent1');
    expect((sqlite.prepare('SELECT supportOutcome FROM FullscreenRecoveryRequest').get() as any).supportOutcome).toBe('customer_replied');
  });

  it('does not let a delayed duplicate command overwrite a newer support outcome', async () => {
    const { sqlite, db } = memoryDb();
    const e = env(db);
    const first = await createRecoveryRequest(e, identity, requestInput, new Date('2026-10-10T00:00:00.000Z'));
    const requestId = first.snapshot.request!.id;
    let releaseFirstBatch!: () => void;
    let firstBatchEntered!: () => void;
    const held = new Promise<void>(resolve => { releaseFirstBatch = resolve; });
    const entered = new Promise<void>(resolve => { firstBatchEntered = resolve; });
    let holdNextBatch = true;
    e.DB = {
      ...db,
      async batch(statements: Parameters<D1Database['batch']>[0]) {
        if (holdNextBatch) {
          holdNextBatch = false;
          firstBatchEntered();
          await held;
        }
        return db.batch(statements);
      },
    } as D1Database;
    const duplicate = {
      action: 'outcome', commandId: 'f4b4b244-86b2-44c4-9a58-83772288079d',
      requestId, reason: 'Customer replied', supportOutcome: 'customer_replied',
    };
    const newer = {
      ...duplicate, commandId: '68cc65cd-4436-4cb4-af06-cb0dcab54f0b',
      reason: 'Conversation closed', supportOutcome: 'closed',
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    try {
      const delayedA = supportCommand(e, duplicate);
      await entered; // A passed its pre-read, but has not run the INSERT.
      expect((await supportCommand(e, duplicate)).status).toBe(200); // B wins.
      expect((await supportCommand(e, newer)).status).toBe(200); // C is newer.
      releaseFirstBatch();
      const replay = await delayedA;
      expect((await replay.json() as any).outcome).toBe('already_applied');
      expect((sqlite.prepare('SELECT supportOutcome FROM FullscreenRecoveryRequest').get() as any).supportOutcome)
        .toBe('closed');
      expect(sqlite.prepare('SELECT COUNT(*) AS total FROM FullscreenRecoverySupportAction').get())
        .toEqual({ total: 2 });
    } finally {
      releaseFirstBatch();
      vi.useRealTimers();
    }
  });

  it('extends an active future deadline from that deadline', async () => {
    const { sqlite, db } = memoryDb(); const e = env(db);
    const first = await createRecoveryRequest(e, identity, requestInput, new Date('2026-10-10T00:00:00.000Z'));
    const requestId = first.snapshot.request!.id;
    await activateRecovery(e, identity, { action: 'activate', attemptId: requestInput.attemptId, requestId },
      new Date('2026-10-12T00:00:00.000Z'));
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    sqlite.prepare('UPDATE FullscreenRecoveryRequest SET expiresAt=?1').run(future);
    const response = await supportCommand(e, {
      action: 'extend', commandId: '35268e24-a3d1-4af6-b725-02b4e939b8b9', requestId, reason: 'Approved',
    });
    expect(response.status).toBe(200);
    const { expiresAt } = await response.json() as { expiresAt: string };
    expect(Date.parse(expiresAt) - Date.parse(future)).toBe(14 * 86_400_000);
  });

  it('emits bounded extension failure events for unactivated and storage failures', async () => {
    const { db } = memoryDb(); const e = env(db);
    e.MIXPANEL_TOKEN = 'test-token';
    const first = await createRecoveryRequest(e, identity, requestInput, new Date('2026-10-10T00:00:00.000Z'));
    const requestId = first.snapshot.request!.id;
    const sent: Array<{ event: string; properties: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sent.push(...JSON.parse(String(init.body)));
      return Response.json({ ok: true });
    }));
    const deliveries: Promise<unknown>[] = [];
    const submit = (commandId: string) => supportPost({
      env: e,
      request: new Request('https://api.example.test/api/support/fullscreen-recovery', {
        method: 'POST', headers: { Authorization: 'Bearer very-long-internal-support-token-123' },
        body: JSON.stringify({ action: 'extend', requestId, commandId, reason: 'private support reason' }),
      }),
      waitUntil: (promise: Promise<unknown>) => { deliveries.push(promise); },
    } as any);
    try {
      const pendingCommand = '75a012e8-4ea7-4a13-90c8-b2c8c60025df';
      expect((await submit(pendingCommand)).status).toBe(409);
      await Promise.all(deliveries.splice(0));
      expect(sent[0]).toMatchObject({
        event: 'fullscreen_recovery_manual_extension_failed',
        properties: { failure_reason: 'not_activated', support_command_id: pendingCommand,
          '$insert_id': `${pendingCommand}:extend:failed:not_activated` },
      });
      await activateRecovery(e, identity, { action: 'activate', attemptId: requestInput.attemptId, requestId },
        new Date('2026-10-12T00:00:00.000Z'));
      e.DB = { ...db, batch: async () => { throw new Error('D1 unavailable'); } } as D1Database;
      const failedCommand = '4fe6f29b-97e1-4ef9-8fce-3a52d8aae254';
      expect((await submit(failedCommand)).status).toBe(503);
      await Promise.all(deliveries.splice(0));
      expect(sent[1]).toMatchObject({
        event: 'fullscreen_recovery_manual_extension_failed',
        properties: { failure_reason: 'storage_unavailable', support_command_id: failedCommand,
          '$insert_id': `${failedCommand}:extend:failed:storage_unavailable` },
      });
      expect(JSON.stringify(sent)).not.toContain('private support reason');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('round trips AES-GCM and rejects a different key', async () => {
    const cipher = await encryptRecoveryField('hello', key);
    expect(await decryptRecoveryField(cipher, key)).toBe('hello');
    const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
    await expect(decryptRecoveryField(cipher, otherKey)).rejects.toThrow();
  });
});
