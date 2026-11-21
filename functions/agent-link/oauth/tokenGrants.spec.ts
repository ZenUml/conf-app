// Pins the token endpoint's observable behaviour on the D1 ledger path (the
// only path production runs): exact status, header, body text (so key order is
// pinned) and telemetry for each outcome. Random token values are masked.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeAuthorization, handleToken, type AsDeps } from './authServer';
import { REFRESH_TOKEN_TTL_SECONDS, issueRefreshToken, type GrantStoreLike } from './asStore';
import { challengeFor } from './pkce';
import { createRefreshLedger } from './refreshLedger';
import { resourceFor } from './asMetadata';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const ORIGIN = 'https://example.zenuml.com';
const REDIRECT = 'http://127.0.0.1:53682/callback';
const VERIFIER = 'a'.repeat(64);
const SECRET = 'test-only-grant-secret';
const T0 = 1_000_000;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0032_agent_link_oauth_refresh_ledger.sql'), 'utf8'));
  let failNext = false;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...args as []) ?? null) as T | null; },
        async run() { const r = sqlite.prepare(sql).run(...args as []); return { success: true, meta: { changes: Number(r.changes) } }; },
      };
    },
    async batch(statements: any[]) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) {
          out.push(await s.run());
          if (failNext) { failNext = false; throw new Error('injected D1 batch failure'); }
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  const kv = new Map<string, string>();
  const store: GrantStoreLike = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  const events: unknown[] = [];
  const deps = (nowMs: number, extra: Partial<AsDeps> = {}): AsDeps => ({
    store,
    refreshLedger: createRefreshLedger(db as never, SECRET, ORIGIN),
    nowMs: () => nowMs,
    onRefreshCompleted: (e) => { events.push({ completed: e }); },
    onChainRevoked: (e) => { events.push({ revoked: e }); },
    ...extra,
  });
  return { store, events, deps, failNextBatch: () => { failNext = true; } };
}

function post(body: Record<string, string>) {
  return new Request(`${ORIGIN}/agent-link/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

async function codeFor(store: GrantStoreLike) {
  const res = await completeAuthorization({ store, nowMs: () => T0 }, 'pending-1', {
    clientId: 'client-A', redirectUri: REDIRECT, codeChallenge: await challengeFor(VERIFIER),
    scope: 'diagram.read diagram.write', resource: resourceFor(ORIGIN), createdAtMs: T0,
  }, 'acct-1');
  return new URL(res.headers.get('location')!).searchParams.get('code')!;
}

const exchange = (code: string, extra: Record<string, string> = {}) =>
  post({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A', ...extra });
const refreshReq = (refresh_token: string, client_id = 'client-A') => post({ grant_type: 'refresh_token', refresh_token, client_id });

/** Status, headers and raw body text, with the random token values masked. */
async function snap(res: Response) {
  const text = await res.text();
  const tokens = { access: '', refresh: '' };
  const masked = text
    .replace(/"access_token":"([^"]+)"/, (_, v) => { tokens.access = v; return '"access_token":"<access>"'; })
    .replace(/"refresh_token":"([^"]+)"/, (_, v) => { tokens.refresh = v; return '"refresh_token":"<refresh>"'; });
  return {
    status: res.status,
    cache: res.headers.get('cache-control'),
    type: res.headers.get('content-type'),
    body: masked,
    tokens,
  };
}
const view = (s: Awaited<ReturnType<typeof snap>>) => ({ status: s.status, cache: s.cache, type: s.type, body: s.body });

const err = (status: number, error: string, description?: string) => ({
  status, cache: 'no-store', type: 'application/json',
  body: JSON.stringify(description ? { error, error_description: description } : { error }),
});
const ok = (expiresIn: number, scope = 'diagram.read diagram.write') => ({
  status: 200, cache: 'no-store', type: 'application/json',
  body: `{"access_token":"<access>","token_type":"Bearer","expires_in":${expiresIn},"refresh_token":"<refresh>","scope":"${scope}"}`,
});
const REVOKED = 'the refresh token is invalid or this sign-in was revoked; sign in again';

describe('token endpoint on the D1 ledger (pinned)', () => {
  describe('authorization_code', () => {
    it('succeeds with a fixed key order and fields', async () => {
      const f = fixture();
      const s = await snap(await handleToken(exchange(await codeFor(f.store), { redirect_uri: REDIRECT }), f.deps(T0)));
      expect(view(s)).toEqual(ok(3600));
      expect(s.tokens.access).toBeTruthy();
      expect(s.tokens.refresh).toBeTruthy();
      expect(f.events).toEqual([]);
    });

    it('rejects missing code, verifier and client_id', async () => {
      const f = fixture();
      const base = { grant_type: 'authorization_code', code: 'c', code_verifier: VERIFIER, client_id: 'client-A' };
      for (const [drop, msg] of [['code', 'code is required'], ['code_verifier', 'code_verifier is required'], ['client_id', 'client_id is required']] as const) {
        const { [drop]: _omit, ...body } = base;
        expect(view(await snap(await handleToken(post(body), f.deps(T0))))).toEqual(err(400, 'invalid_request', msg));
      }
      expect(f.events).toEqual([]);
    });

    it('rejects an unknown or reused code, a foreign client, a bad redirect_uri and a bad verifier', async () => {
      const f = fixture();
      expect(view(await snap(await handleToken(exchange('nope'), f.deps(T0)))))
        .toEqual(err(400, 'invalid_grant', 'the code is unknown, used, or expired'));
      const used = await codeFor(f.store);
      await handleToken(exchange(used), f.deps(T0));
      expect(view(await snap(await handleToken(exchange(used), f.deps(T0)))))
        .toEqual(err(400, 'invalid_grant', 'the code is unknown, used, or expired'));
      expect(view(await snap(await handleToken(exchange(await codeFor(f.store), { client_id: 'client-B' }), f.deps(T0)))))
        .toEqual(err(400, 'invalid_grant', 'the code was issued to a different client'));
      expect(view(await snap(await handleToken(exchange(await codeFor(f.store), { redirect_uri: 'http://127.0.0.1:1/x' }), f.deps(T0)))))
        .toEqual(err(400, 'invalid_grant', 'redirect_uri does not match the authorization request'));
      expect(view(await snap(await handleToken(exchange(await codeFor(f.store), { code_verifier: 'b'.repeat(64) }), f.deps(T0)))))
        .toEqual(err(400, 'invalid_grant', 'code_verifier does not match the code_challenge'));
    });

    it('answers 503 when the ledger cannot record the new chain', async () => {
      const f = fixture();
      const code = await codeFor(f.store);
      f.failNextBatch();
      expect(view(await snap(await handleToken(exchange(code), f.deps(T0)))))
        .toEqual(err(503, 'temporarily_unavailable', 'token service is temporarily unavailable'));
    });
  });

  describe('refresh_token', () => {
    async function signIn(f: ReturnType<typeof fixture>) {
      return (await snap(await handleToken(exchange(await codeFor(f.store)), f.deps(T0)))).tokens;
    }

    it('rotates: 200 in the same body shape, telemetry rotated', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      const s = await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 1000)));
      expect(view(s)).toEqual(ok(3600));
      expect(s.tokens.refresh).not.toBe(t0.refresh);
      expect(f.events).toEqual([{ completed: { outcome: 'rotated', userId: 'acct-1', reuseAgeMs: undefined } }]);
    });

    it('retries a replay inside the retry window with the same pair', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      const first = await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 1000)));
      f.events.length = 0;
      const retry = await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 61_000)));
      expect(view(retry)).toEqual(ok(3540));
      expect(retry.tokens).toEqual(first.tokens);
      expect(f.events).toEqual([{ completed: { outcome: 'retried', userId: 'acct-1', reuseAgeMs: 60_000 } }]);
    });

    it('revokes the chain on reuse after the retry window', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      const t1 = await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 1000)));
      f.events.length = 0;
      expect(view(await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 1000 + 400_000))))).toEqual(err(400, 'invalid_grant', REVOKED));
      expect(f.events).toEqual([
        { revoked: { reason: 'refresh_reused', userId: 'acct-1', clientId: 'client-A' } },
        { completed: { outcome: 'rejected', reason: 'reused', userId: 'acct-1', reuseAgeMs: 400_000 } },
      ]);
      f.events.length = 0;
      expect(view(await snap(await handleToken(refreshReq(t1.tokens.refresh), f.deps(T0 + 500_000))))).toEqual(err(400, 'invalid_grant', REVOKED));
      expect(f.events).toEqual([{ completed: { outcome: 'rejected', reason: 'revoked', userId: 'acct-1', reuseAgeMs: undefined } }]);
    });

    it('revokes the chain when another client presents the token', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      expect(view(await snap(await handleToken(refreshReq(t0.refresh, 'client-B'), f.deps(T0 + 1000))))).toEqual(err(400, 'invalid_grant', REVOKED));
      expect(f.events).toEqual([
        { revoked: { reason: 'client_mismatch', userId: 'acct-1', clientId: 'client-A' } },
        { completed: { outcome: 'rejected', reason: 'client_mismatch', userId: 'acct-1', reuseAgeMs: undefined } },
      ]);
    });

    it('rejects an unknown token', async () => {
      const f = fixture();
      expect(view(await snap(await handleToken(refreshReq('nope'), f.deps(T0))))).toEqual(err(400, 'invalid_grant', REVOKED));
      expect(f.events).toEqual([{ completed: { outcome: 'rejected', reason: 'unknown', userId: undefined, reuseAgeMs: undefined } }]);
    });

    it('rejects an expired token', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      const late = T0 + REFRESH_TOKEN_TTL_SECONDS * 1000 + 1;
      expect(view(await snap(await handleToken(refreshReq(t0.refresh), f.deps(late))))).toEqual(err(400, 'invalid_grant', REVOKED));
      expect(f.events).toEqual([{ completed: { outcome: 'rejected', reason: 'expired', userId: 'acct-1', reuseAgeMs: undefined } }]);
    });

    it('imports a live legacy KV token on first use', async () => {
      const f = fixture();
      const rec = { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN), chainId: 'chain-a' };
      const legacy = await issueRefreshToken(f.store, rec);
      expect(view(await snap(await handleToken(refreshReq(legacy), f.deps(T0))))).toEqual(ok(3600, 'diagram.read'));
    });

    it('rejects missing refresh_token and client_id with one rejected event each', async () => {
      const f = fixture();
      expect(view(await snap(await handleToken(post({ grant_type: 'refresh_token', client_id: 'client-A' }), f.deps(T0)))))
        .toEqual(err(400, 'invalid_request', 'refresh_token is required'));
      expect(view(await snap(await handleToken(post({ grant_type: 'refresh_token', refresh_token: 'x' }), f.deps(T0)))))
        .toEqual(err(400, 'invalid_request', 'client_id is required'));
      expect(f.events).toEqual([
        { completed: { outcome: 'rejected', reason: 'missing_refresh_token' } },
        { completed: { outcome: 'rejected', reason: 'missing_client_id' } },
      ]);
    });

    it('answers 503 and reports unavailable when D1 fails mid-rotation', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      f.failNextBatch();
      expect(view(await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 1000)))))
        .toEqual(err(503, 'temporarily_unavailable', 'refresh service is temporarily unavailable'));
      expect(f.events).toEqual([{ completed: { outcome: 'unavailable', reason: 'storage_unavailable' } }]);
    });

    it('does not let a throwing telemetry callback change the response', async () => {
      const f = fixture();
      const t0 = await signIn(f);
      const boom = () => { throw new Error('mixpanel down'); };
      expect(view(await snap(await handleToken(refreshReq(t0.refresh), f.deps(T0 + 1000, { onRefreshCompleted: boom, onChainRevoked: boom })))))
        .toEqual(ok(3600));
    });
  });

  it('rejects an unsupported grant_type', async () => {
    const f = fixture();
    expect(view(await snap(await handleToken(post({ grant_type: 'password', username: 'x', client_id: 'client-A' }), f.deps(T0)))))
      .toEqual(err(400, 'unsupported_grant_type', 'supported: authorization_code, refresh_token'));
    expect(view(await snap(await handleToken(post({ client_id: 'client-A' }), f.deps(T0)))))
      .toEqual(err(400, 'unsupported_grant_type', 'supported: authorization_code, refresh_token'));
  });
});
