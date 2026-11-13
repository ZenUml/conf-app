import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleToken } from './authServer';
import { hashSecret, issueAccessToken, issueRefreshToken, revokeChain, type GrantStoreLike } from './asStore';
import { createRefreshLedger } from './refreshLedger';
import { resourceFor } from './asMetadata';
import { authenticateHeadless } from './headlessAuth';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const ORIGIN = 'https://example.zenuml.com';
const SECRET = 'test-only-grant-secret';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0032_agent_link_oauth_refresh_ledger.sql'), 'utf8'));
  let batchTail: Promise<unknown> = Promise.resolve();
  let failAfterFirst = false;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...args as []) ?? null) as T | null; },
        async run() { const result = sqlite.prepare(sql).run(...args as []); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements: any[]) {
      const work = batchTail.then(async () => {
        sqlite.exec('BEGIN');
        try { const results = [];
          for (const statement of statements) {
            results.push(await statement.run());
            if (failAfterFirst) { failAfterFirst = false; throw new Error('injected D1 batch failure'); }
          }
          sqlite.exec('COMMIT'); return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      batchTail = work.catch(() => undefined);
      return work;
    },
  };
  const kv = new Map<string, string>();
  const store: GrantStoreLike = {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => { kv.set(key, value); },
    delete: async (key) => { kv.delete(key); },
  };
  return { sqlite, db, store, ledger: createRefreshLedger(db as never, SECRET, ORIGIN), failNextBatch: () => { failAfterFirst = true; } };
}

function refresh(token: string, clientId = 'client-A') {
  return new Request(`${ORIGIN}/agent-link/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId }),
  });
}

describe('D1 refresh retry ledger', () => {
  it('returns the same pair to two independent handlers and a retry at 90.258 seconds', async () => {
    const { db, store } = fixture();
    const ledgerA = createRefreshLedger(db as never, SECRET, ORIGIN);
    const ledgerB = createRefreshLedger(db as never, SECRET, ORIGIN);
    const initial = await ledgerA.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const [first, second] = await Promise.all([
      handleToken(refresh(initial), { store, refreshLedger: ledgerA, nowMs: () => 1_000_000 }),
      handleToken(refresh(initial), { store, refreshLedger: ledgerB, nowMs: () => 1_000_000 }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await first.json() as any, b = await second.json() as any;
    expect(b.access_token).toBe(a.access_token);
    expect(b.refresh_token).toBe(a.refresh_token);
    const later = await handleToken(refresh(initial), { store, refreshLedger: ledgerB, nowMs: () => 1_090_258 });
    expect(later.status).toBe(200);
    const c = await later.json() as any;
    expect(c.access_token).toBe(a.access_token);
    expect(c.refresh_token).toBe(a.refresh_token);
    expect(c.expires_in).toBeLessThan(a.expires_in);
  });

  it('accepts a retry after two minutes but keeps the original absolute expiry', async () => {
    const { store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const first = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    const original = await first.json() as any;
    const retry = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_250_000 });
    expect(retry.status).toBe(200);
    const returned = await retry.json() as any;
    expect(returned.access_token).toBe(original.access_token);
    expect(returned.refresh_token).toBe(original.refresh_token);
    expect(returned.expires_in).toBeLessThan(original.expires_in);
  });

  it('accepts a retry at 299.999 seconds and records age from first consumption', async () => {
    const { store, ledger } = fixture();
    const events: unknown[] = [];
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const first = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000,
      onRefreshCompleted: (event) => { events.push(event); } });
    const original = await first.json() as any;
    const retry = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_299_999,
      onRefreshCompleted: (event) => { events.push(event); } });
    expect(retry.status).toBe(200);
    const returned = await retry.json() as any;
    expect(returned.access_token).toBe(original.access_token);
    expect(returned.refresh_token).toBe(original.refresh_token);
    expect(events[0]).toMatchObject({ outcome: 'rotated', userId: 'acct-1' });
    expect(events[1]).toEqual({ outcome: 'retried', userId: 'acct-1', reuseAgeMs: 299_999 });
  });

  it('rejects a same-client reuse at the 300 second boundary without revoking the chain', async () => {
    const { db, store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const first = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    const pair = await first.json() as any;
    const events: unknown[] = [];
    const revoked: unknown[] = [];
    const replay = await handleToken(refresh(initial), { store, refreshLedger: createRefreshLedger(db as never, SECRET, ORIGIN), nowMs: () => 1_300_000,
      onRefreshCompleted: (event) => { events.push(event); }, onChainRevoked: (event) => { revoked.push(event); } });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant', error_description: expect.stringContaining('other sessions stay signed in') });
    expect(await ledger.isRevoked('chain-a')).toBe(false);
    expect(revoked).toEqual([]);
    const auth = await authenticateHeadless(new Request(`${ORIGIN}/agent-link/mcp`, {
      headers: { authorization: `Bearer ${pair.access_token}` },
    }), store, 1_300_000, ledger);
    expect(auth).toMatchObject({ ok: true });
    expect(events).toEqual([{ outcome: 'rejected', reason: 'stale', userId: 'acct-1', reuseAgeMs: 300_000 }]);
  });

  it('keeps the live successor working after an idle process replays its old token hours later', async () => {
    // Field case 2026-10-22..26: many agent processes share one sign-in; one
    // that slept for hours presents the token another process already rotated.
    const { store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const pair = await (await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000 })).json() as any;
    const hourLater = 1_000_000 + 3_812_447;
    expect((await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => hourLater })).status).toBe(400);
    const current = await handleToken(refresh(pair.refresh_token), { store, refreshLedger: ledger, nowMs: () => hourLater + 1_000 });
    expect(current.status).toBe(200);
    expect(await ledger.isRevoked('chain-a')).toBe(false);
  });

  it('imports an unused legacy token but refuses a used one', async () => {
    const { store, ledger } = fixture();
    const record = { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'legacy-chain' };
    const unused = await issueRefreshToken(store, record);
    const used = await issueRefreshToken(store, { ...record, usedAtMs: 12 });
    const rotated = await handleToken(refresh(unused), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    expect(rotated.status).toBe(200);
    const successor = await rotated.json() as any;
    expect((await handleToken(refresh(successor.refresh_token), { store, refreshLedger: ledger, nowMs: () => 1_001_000 })).status).toBe(200);
    expect((await handleToken(refresh(used), { store, refreshLedger: ledger, nowMs: () => 1_000_000 })).status).toBe(400);
  });

  it('rejects a retry after its successor has been consumed', async () => {
    const { store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const first = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    const pair = await first.json() as any;
    expect((await handleToken(refresh(pair.refresh_token), { store, refreshLedger: ledger, nowMs: () => 1_001_000 })).status).toBe(200);
    expect((await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_002_000 })).status).toBe(400);
  });

  it('does not persist plaintext token handles in D1', async () => {
    const { sqlite, store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const response = await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    const pair = await response.json() as any;
    const rows = JSON.stringify(sqlite.prepare('SELECT * FROM AgentLinkOAuthRefreshToken').all());
    expect(rows).not.toContain(initial);
    expect(rows).not.toContain(pair.refresh_token);
    expect(rows).not.toContain(pair.access_token);
  });

  it('recovers the original pair after KV publication fails', async () => {
    const { store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    let writes = 0;
    const flaky = { ...store, put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      if (++writes === 1) throw new Error('KV unavailable');
      await store.put(key, value, options);
    } };
    expect((await handleToken(refresh(initial), { store: flaky, refreshLedger: ledger, nowMs: () => 1_000_000 })).status).toBe(503);
    const recovered = await handleToken(refresh(initial), { store: flaky, refreshLedger: ledger, nowMs: () => 1_030_000 });
    expect(recovered.status).toBe(200);
    const pair = await recovered.json() as any;
    expect((await authenticateHeadless(new Request(`${ORIGIN}/agent-link/mcp`, {
      headers: { authorization: `Bearer ${pair.access_token}` },
    }), store, 1_030_000, ledger)).ok).toBe(true);
  });

  it('revokes for a different client before consumption', async () => {
    const { store, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    expect((await handleToken(refresh(initial, 'client-B'), { store, refreshLedger: ledger, nowMs: () => 1_000_000 })).status).toBe(400);
    expect(await ledger.isRevoked('chain-a')).toBe(true);
  });

  it('rolls back a parent consume if successor insertion cannot commit', async () => {
    const { store, ledger, failNextBatch } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    failNextBatch();
    expect((await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_000_000 })).status).toBe(503);
    expect((await handleToken(refresh(initial), { store, refreshLedger: ledger, nowMs: () => 1_001_000 })).status).toBe(200);
  });

  it('keeps the issuer boundary even when D1 is shared', async () => {
    const { db, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    const other = createRefreshLedger(db as never, SECRET, 'https://another.example');
    expect((await other.rotate(initial, 'client-A', resourceFor(ORIGIN), 1_000_000)).status).toBe('unknown');
    expect((await ledger.rotate(initial, 'client-A', resourceFor(ORIGIN), 1_000_000)).status).toBe('rotated');
  });

  it('fails a wrong-key receipt read without revoking a valid chain', async () => {
    const { db, ledger } = fixture();
    const initial = await ledger.issue({ userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' }, 1_000_000);
    expect((await ledger.rotate(initial, 'client-A', resourceFor(ORIGIN), 1_000_000)).status).toBe('rotated');
    const wrongKey = createRefreshLedger(db as never, 'different-secret', ORIGIN);
    await expect(wrongKey.rotate(initial, 'client-A', resourceFor(ORIGIN), 1_001_000)).rejects.toThrow();
    expect(await ledger.isRevoked('chain-a')).toBe(false);
    expect((await ledger.rotate(initial, 'client-A', resourceFor(ORIGIN), 1_001_000)).status).toBe('retried');
  });

  it('rejects legacy access after an imported chain is revoked in D1', async () => {
    const { store, ledger } = fixture();
    const record = { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' };
    const oldAccess = await issueAccessToken(store, record, 1_000_000);
    const legacy = await issueRefreshToken(store, record);
    expect((await handleToken(refresh(legacy), { store, refreshLedger: ledger, nowMs: () => 1_000_000 })).status).toBe(200);
    await ledger.revoke('chain-a', 1_001_000);
    const auth = await authenticateHeadless(new Request(`${ORIGIN}/agent-link/mcp`, {
      headers: { authorization: `Bearer ${oldAccess.token}` },
    }), store, 1_001_000, ledger);
    expect(auth).toEqual({ ok: false, reason: 'invalid' });
  });

  it('honors a legacy KV revocation marker for a D1 successor', async () => {
    const { store, ledger } = fixture();
    const record = { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' };
    const legacy = await issueRefreshToken(store, record);
    const rotated = await handleToken(refresh(legacy), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    const successor = await rotated.json() as any;
    await revokeChain(store, 'chain-a', 1_001_000);
    expect((await handleToken(refresh(successor.refresh_token), { store, refreshLedger: ledger, nowMs: () => 1_001_000 })).status).toBe(400);
    expect(await ledger.isRevoked('chain-a')).toBe(true);
  });

  it('returns a committed legacy receipt after the old KV token expires during grace', async () => {
    const { store, ledger } = fixture();
    const record = { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' };
    const legacy = await issueRefreshToken(store, record);
    const first = await handleToken(refresh(legacy), { store, refreshLedger: ledger, nowMs: () => 1_000_000 });
    expect(first.status).toBe(200);
    const original = await first.json() as any;
    await store.delete(`agent-link:oauth-refresh:${await hashSecret(legacy)}`);
    const retry = await handleToken(refresh(legacy), { store, refreshLedger: ledger, nowMs: () => 1_090_258 });
    expect(retry.status).toBe(200);
    const returned = await retry.json() as any;
    expect(returned.access_token).toBe(original.access_token);
    expect(returned.refresh_token).toBe(original.refresh_token);
    expect(returned.expires_in).toBeLessThan(original.expires_in);
  });

  it('requires the original KV row before first use of an imported legacy token', async () => {
    const { store, ledger } = fixture();
    const record = { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' };
    const legacy = await issueRefreshToken(store, record);
    await ledger.importLegacy(legacy, record, 1_000_000);
    await store.delete(`agent-link:oauth-refresh:${await hashSecret(legacy)}`);
    expect((await handleToken(refresh(legacy), { store, refreshLedger: ledger, nowMs: () => 1_000_000 })).status).toBe(400);
  });

  it('emits exactly one rejected outcome for a malformed refresh request', async () => {
    const { store, ledger } = fixture();
    const events: unknown[] = [];
    const request = new Request(`${ORIGIN}/agent-link/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'client-A' }),
    });
    const response = await handleToken(request, { store, refreshLedger: ledger,
      onRefreshCompleted: (event) => { events.push(event); } });
    expect(response.status).toBe(400);
    expect(events).toEqual([{ outcome: 'rejected', reason: 'missing_refresh_token' }]);
  });
});
