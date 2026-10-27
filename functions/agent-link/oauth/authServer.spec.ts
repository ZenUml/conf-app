import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  completeAuthorization,
  denyAuthorization,
  handleRegister,
  handleToken,
  hasConsent,
  recordConsent,
  validateAuthorize,
  type TokenDeps,
} from './authServer';
import {
  consumeCode,
  issueRefreshToken,
  loadAccessToken,
  loadClient,
  loadPending,
  type GrantStoreLike,
  type PendingAuthorization,
} from './asStore';
import { challengeFor } from './pkce';
import { authenticateHeadless } from './headlessAuth';
import { createRefreshLedger } from './refreshLedger';
import { REGISTER_LIMIT } from './asStore';
import { buildAuthServerMetadata, buildResourceMetadata, resourceFor } from './asMetadata';
import { oauthDiscoveryResponse } from './discovery';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const REDIRECT = 'http://127.0.0.1:53682/callback';
const VERIFIER = 'a'.repeat(64);

function memoryStore(): { store: GrantStoreLike; kv: Map<string, string> } {
  const kv = new Map<string, string>();
  return {
    kv,
    store: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
    },
  };
}

async function registerClient(store: GrantStoreLike, redirectUris = [REDIRECT]) {
  const res = await handleRegister(
    new Request(`${ORIGIN}/agent-link/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: redirectUris, client_name: 'Claude Code' }),
    }),
    { store },
  );
  return { res, body: (await res.json()) as { client_id: string } };
}

function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const url = new URL(`${ORIGIN}/agent-link/oauth/authorize`);
  const params: Record<string, string> = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'client-state-1',
    ...extra,
  };
  for (const [k, v] of Object.entries(params)) if (v !== '') url.searchParams.set(k, v);
  return url.toString();
}

describe('dynamic client registration', () => {
  it('registers a public client with a loopback redirect', async () => {
    const { store } = memoryStore();
    const { res, body } = await registerClient(store);
    expect(res.status).toBe(201);
    expect(body.client_id).toBeTruthy();
    const stored = await loadClient(store, body.client_id);
    expect(stored?.redirectUris).toEqual([REDIRECT]);
    expect(stored?.clientName).toBe('Claude Code');
  });

  it('refuses a plaintext redirect that is not loopback', async () => {
    const { store } = memoryStore();
    const { res, body } = await registerClient(store, ['http://agent.example.com/cb']);
    expect(res.status).toBe(400);
    expect((body as unknown as { error: string }).error).toBe('invalid_redirect_uri');
  });

  it('refuses a registration with no redirect_uris', async () => {
    const { store } = memoryStore();
    const { res } = await registerClient(store, []);
    expect(res.status).toBe(400);
  });

  it('caps registrations per source so an unauthenticated loop cannot fill KV', async () => {
    const { store, kv } = memoryStore();
    const register = () =>
      handleRegister(
        new Request(`${ORIGIN}/agent-link/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
          body: JSON.stringify({ redirect_uris: [REDIRECT] }),
        }),
        { store },
      );

    for (let i = 0; i < REGISTER_LIMIT; i += 1) expect((await register()).status).toBe(201);
    const refused = await register();
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBeTruthy();

    // A different caller is unaffected.
    const other = await handleRegister(
      new Request(`${ORIGIN}/agent-link/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.2' },
        body: JSON.stringify({ redirect_uris: [REDIRECT] }),
      }),
      { store },
    );
    expect(other.status).toBe(201);
    expect([...kv.keys()].filter((k) => k.includes('-client:'))).toHaveLength(REGISTER_LIMIT + 1);
  });
});

describe('authorize', () => {
  it('parks a valid request and keeps the client state', async () => {
    const { store } = memoryStore();
    const { body } = await registerClient(store);
    const challenge = await challengeFor(VERIFIER);
    const result = await validateAuthorize(new Request(authorizeUrl(body.client_id, challenge)), { store });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pending = await loadPending(store, result.pendingId);
    expect(pending?.clientId).toBe(body.client_id);
    expect(pending?.state).toBe('client-state-1');
    expect(pending?.resource).toBe(resourceFor(ORIGIN));
  });

  it('renders rather than redirects when the client is unknown', async () => {
    const { store } = memoryStore();
    const challenge = await challengeFor(VERIFIER);
    const result = await validateAuthorize(new Request(authorizeUrl('nope', challenge)), { store });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(result.response.headers.get('location')).toBeNull();
  });

  it('renders rather than redirects when the redirect_uri was never registered', async () => {
    const { store } = memoryStore();
    const { body } = await registerClient(store);
    const challenge = await challengeFor(VERIFIER);
    const url = authorizeUrl(body.client_id, challenge).replace(encodeURIComponent(REDIRECT), encodeURIComponent('http://127.0.0.1:1/evil'));
    const result = await validateAuthorize(new Request(url), { store });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(result.response.headers.get('location')).toBeNull();
  });

  it('reports a missing PKCE challenge to the client, not the user', async () => {
    const { store } = memoryStore();
    const { body } = await registerClient(store);
    const result = await validateAuthorize(
      new Request(authorizeUrl(body.client_id, '', { code_challenge: '' })),
      { store },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const location = new URL(result.response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('http://127.0.0.1:53682/callback');
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('client-state-1');
    // RFC 9207: an error response carries the issuer too.
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
  });

  it('refuses code_challenge_method=plain', async () => {
    const { store } = memoryStore();
    const { body } = await registerClient(store);
    const challenge = await challengeFor(VERIFIER);
    const result = await validateAuthorize(
      new Request(authorizeUrl(body.client_id, challenge, { code_challenge_method: 'plain' })),
      { store },
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a resource that is not this server', async () => {
    const { store } = memoryStore();
    const { body } = await registerClient(store);
    const challenge = await challengeFor(VERIFIER);
    const result = await validateAuthorize(
      new Request(authorizeUrl(body.client_id, challenge, { resource: 'https://evil.example.com/mcp' })),
      { store },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new URL(result.response.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
  });

  it('refuses a scope it does not offer', async () => {
    const { store } = memoryStore();
    const { body } = await registerClient(store);
    const challenge = await challengeFor(VERIFIER);
    const result = await validateAuthorize(
      new Request(authorizeUrl(body.client_id, challenge, { scope: 'admin' })),
      { store },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new URL(result.response.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope');
  });
});

describe('consent', () => {
  const pending = (clientId: string): PendingAuthorization => ({
    clientId,
    redirectUri: REDIRECT,
    state: 'client-state-1',
    codeChallenge: 'x'.repeat(43),
    scope: 'diagram.read diagram.write',
    resource: resourceFor(ORIGIN),
    createdAtMs: 1_000,
    userId: 'acct-1',
  });

  it('is required per (user, client): a second client does not inherit the first one\'s approval', async () => {
    const { store } = memoryStore();
    const deps = { store };
    await recordConsent(deps, 'acct-1', 'client-A', 'diagram.read diagram.write');
    expect(await hasConsent(deps, 'acct-1', 'client-A', 'diagram.read')).toBe(true);
    expect(await hasConsent(deps, 'acct-1', 'client-B', 'diagram.read')).toBe(false);
    // and not for a different user of the same client
    expect(await hasConsent(deps, 'acct-2', 'client-A', 'diagram.read')).toBe(false);
  });

  it('does not cover a scope that was never granted', async () => {
    const { store } = memoryStore();
    const deps = { store };
    await recordConsent(deps, 'acct-1', 'client-A', 'diagram.read');
    expect(await hasConsent(deps, 'acct-1', 'client-A', 'diagram.read diagram.write')).toBe(false);
  });

  it('completing issues a code bound to the user and echoes the client state', async () => {
    const { store } = memoryStore();
    const res = await completeAuthorization({ store }, 'pending-1', pending('client-A'), 'acct-1');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('state')).toBe('client-state-1');
    // RFC 9207: the metadata advertises authorization_response_iss_parameter_supported,
    // and Claude Code rejects a response without iss ("Issuer mismatch").
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
    const code = location.searchParams.get('code')!;
    const record = await consumeCode(store, code);
    expect(record?.userId).toBe('acct-1');
    expect(record?.clientId).toBe('client-A');
  });

  it('denying redirects with access_denied and issues nothing', async () => {
    const { store, kv } = memoryStore();
    const res = await denyAuthorization({ store }, 'pending-1', pending('client-A'));
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
    expect([...kv.keys()].some((k) => k.includes('-code:'))).toBe(false);
  });
});

describe('token endpoint', () => {
  async function codeFor(store: GrantStoreLike, challenge: string) {
    const res = await completeAuthorization(
      { store },
      'pending-1',
      {
        clientId: 'client-A',
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        scope: 'diagram.read diagram.write',
        resource: resourceFor(ORIGIN),
        createdAtMs: 1_000,
      },
      'acct-1',
    );
    return new URL(res.headers.get('location')!).searchParams.get('code')!;
  }

  function tokenRequest(body: Record<string, string>) {
    return new Request(`${ORIGIN}/agent-link/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // Serialized, not the URLSearchParams object: under jsdom the Request
      // constructor rejects a URLSearchParams from another realm. The wire
      // format is a string anyway, so this is what a real client sends and
      // request.formData() parses it identically.
      body: new URLSearchParams(body).toString(),
    });
  }

  // Production always runs the token endpoint on the D1 ledger (token.ts), so
  // these tests do too. `advance` moves the clock past the ledger's retry window.
  function tokenEnv() {
    const { store } = memoryStore();
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(resolve(process.cwd(), 'functions/migrations/0032_agent_link_oauth_refresh_ledger.sql'), 'utf8'));
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
          for (const statement of statements) out.push(await statement.run());
          sqlite.exec('COMMIT');
          return out;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    const refreshLedger = createRefreshLedger(db as never, 'test-only-grant-secret', ORIGIN);
    let now = Date.now();
    const deps = (extra: Partial<TokenDeps> = {}): TokenDeps => ({ store, refreshLedger, nowMs: () => now, ...extra });
    const advance = (ms: number) => { now += ms; };
    // Is this access token still accepted by the headless endpoint? That is
    // where a ledger chain revocation shows up.
    const accepted = async (token: string) => (await authenticateHeadless(
      new Request(`${ORIGIN}/agent-link/mcp`, { headers: { authorization: `Bearer ${token}` } }), store, now, refreshLedger,
    )).ok;
    return { store, refreshLedger, deps, advance, accepted };
  }
  const RETRY_WINDOW_MS = 300_000;

  it('exchanges a code + verifier for an access and refresh token', async () => {
    const { store, deps } = tokenEnv();
    const challenge = await challengeFor(VERIFIER);
    const code = await codeFor(store, challenge);
    const res = await handleToken(
      tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A', redirect_uri: REDIRECT }),
      deps(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(body.token_type).toBe('Bearer');
    const record = await loadAccessToken(store, body.access_token, Date.now());
    expect(record?.userId).toBe('acct-1');
    expect(record?.resource).toBe(resourceFor(ORIGIN));
    expect(body.refresh_token).toBeTruthy();
  });

  it('rejects the wrong PKCE verifier', async () => {
    const { store, deps } = tokenEnv();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const res = await handleToken(
      tokenRequest({ grant_type: 'authorization_code', code, code_verifier: 'b'.repeat(64), client_id: 'client-A' }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('refuses to redeem a code twice', async () => {
    const { store, deps } = tokenEnv();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const first = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), deps());
    expect(first.status).toBe(200);
    const second = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), deps());
    expect(second.status).toBe(400);
  });

  it('refuses a code presented by a different client', async () => {
    const { store, deps } = tokenEnv();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const res = await handleToken(
      tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-B' }),
      deps(),
    );
    expect(res.status).toBe(400);
  });

  it('rotates the refresh token, killing the presented one', async () => {
    const { store, deps, advance } = tokenEnv();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const first = (await (await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), deps())).json()) as { refresh_token: string };

    const refreshed = await handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'client-A' }), deps());
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { refresh_token: string; access_token: string };
    expect(next.refresh_token).not.toBe(first.refresh_token);

    // Past the ledger's retry window a replay is reuse, not a retry.
    advance(RETRY_WINDOW_MS + 1000);
    const replay = await handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'client-A' }), deps());
    expect(replay.status).toBe(400);
  });

  describe('refresh chains (reuse detection)', () => {
    type Tokens = { access_token: string; refresh_token: string };
    type Env = ReturnType<typeof tokenEnv>;
    async function signIn(env: Env): Promise<Tokens> {
      const code = await codeFor(env.store, await challengeFor(VERIFIER));
      const res = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), env.deps());
      return (await res.json()) as Tokens;
    }
    const refresh = (env: Env, refresh_token: string, deps: Partial<TokenDeps> = {}, client_id = 'client-A') =>
      handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token, client_id }), env.deps(deps));

    it('revokes the whole chain when a used refresh token comes back, access tokens included', async () => {
      const env = tokenEnv();
      const revoked: unknown[] = [];
      const onChainRevoked = (e: unknown) => { revoked.push(e); };
      const t0 = await signIn(env);
      const t1 = (await (await refresh(env, t0.refresh_token, { onChainRevoked })).json()) as Tokens;
      expect(await env.accepted(t1.access_token)).toBe(true);

      env.advance(RETRY_WINDOW_MS + 1000);
      const replay = await refresh(env, t0.refresh_token, { onChainRevoked });
      expect(replay.status).toBe(400);
      expect(await replay.json()).toMatchObject({ error: 'invalid_grant', error_description: expect.stringContaining('revoked') });
      expect(revoked).toEqual([{ reason: 'refresh_reused', userId: 'acct-1', clientId: 'client-A' }]);

      // The newest refresh token, held by the legitimate client, is gone too.
      const current = await refresh(env, t1.refresh_token, { onChainRevoked });
      expect(current.status).toBe(400);
      expect((await current.json()).error_description).toContain('sign in again');
      expect(revoked).toHaveLength(1);
      // And so is every access token the chain issued.
      expect(await env.accepted(t0.access_token)).toBe(false);
      expect(await env.accepted(t1.access_token)).toBe(false);
    });

    it('revokes the chain when a refresh token arrives under another client', async () => {
      const env = tokenEnv();
      const revoked: unknown[] = [];
      const t0 = await signIn(env);
      const res = await refresh(env, t0.refresh_token, { onChainRevoked: (e) => { revoked.push(e); } }, 'client-B');
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_grant');
      expect(revoked).toEqual([{ reason: 'client_mismatch', userId: 'acct-1', clientId: 'client-A' }]);
      expect(await env.accepted(t0.access_token)).toBe(false);
    });

    it('keeps other sign-ins working when one chain is revoked', async () => {
      const env = tokenEnv();
      const a = await signIn(env);
      const b = await signIn(env);
      await refresh(env, a.refresh_token);
      env.advance(RETRY_WINDOW_MS + 1000);
      expect((await refresh(env, a.refresh_token)).status).toBe(400); // reuse: chain A revoked
      expect(await env.accepted(b.access_token)).toBe(true);
      expect((await refresh(env, b.refresh_token)).status).toBe(200);
    });

    it('starts a chain for a refresh token issued before chains existed', async () => {
      const env = tokenEnv();
      const legacy = await issueRefreshToken(env.store, { userId: 'acct-1', clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN) });
      const t1 = (await (await refresh(env, legacy)).json()) as Tokens;
      expect(await env.accepted(t1.access_token)).toBe(true);
      env.advance(RETRY_WINDOW_MS + 1000);
      expect((await refresh(env, legacy)).status).toBe(400);
      expect(await env.accepted(t1.access_token)).toBe(false);
      expect((await refresh(env, t1.refresh_token)).status).toBe(400);
    });

    it('still revokes when the analytics callback throws', async () => {
      const env = tokenEnv();
      const t0 = await signIn(env);
      await refresh(env, t0.refresh_token);
      env.advance(RETRY_WINDOW_MS + 1000);
      const replay = await refresh(env, t0.refresh_token, { onChainRevoked: () => { throw new Error('mixpanel down'); } });
      expect(replay.status).toBe(400);
      expect(await env.accepted(t0.access_token)).toBe(false);
    });
  });

  it('requires client_id, so the binding check cannot be skipped by omitting it', async () => {
    const { store, deps } = tokenEnv();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const res = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER }), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('requires client_id on a refresh too', async () => {
    const { store, deps } = tokenEnv();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const first = (await (
      await handleToken(
        tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }),
        deps(),
      )
    ).json()) as { refresh_token: string };
    const res = await handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token }), deps());
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported grant type', async () => {
    const { deps } = tokenEnv();
    const res = await handleToken(tokenRequest({ grant_type: 'password', username: 'x', password: 'y', client_id: 'client-A' }), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unsupported_grant_type');
  });
});

describe('discovery documents', () => {
  it('serves resource metadata naming us as the authorization server', async () => {
    const res = oauthDiscoveryResponse(`${ORIGIN}/.well-known/oauth-protected-resource`)!;
    expect(res).not.toBeNull();
    const doc = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(doc.resource).toBe(`${ORIGIN}/agent-link/mcp`);
    // never auth.atlassian.com — that would be the token passthrough the spec forbids
    expect(doc.authorization_servers).toEqual([ORIGIN]);
  });

  it('serves authorization server metadata with S256 and no client auth', async () => {
    const res = oauthDiscoveryResponse(`${ORIGIN}/.well-known/oauth-authorization-server`)!;
    const doc = (await res.json()) as ReturnType<typeof buildAuthServerMetadata>;
    expect(doc.issuer).toBe(ORIGIN);
    expect(doc.registration_endpoint).toBe(`${ORIGIN}/agent-link/oauth/register`);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  it('derives both documents from the request origin', async () => {
    const local = (await oauthDiscoveryResponse('http://localhost:8080/.well-known/oauth-authorization-server')!.json()) as { issuer: string };
    expect(local.issuer).toBe('http://localhost:8080');
    expect(buildResourceMetadata('http://localhost:8080').resource).toBe('http://localhost:8080/agent-link/mcp');
  });

  it('is null for anything else, so the middleware falls through', () => {
    expect(oauthDiscoveryResponse(`${ORIGIN}/agent-link/mcp`)).toBeNull();
  });
});
