import { describe, it, expect } from 'vitest';
import {
  completeAuthorization,
  denyAuthorization,
  handleRegister,
  handleToken,
  hasConsent,
  recordConsent,
  validateAuthorize,
} from './authServer';
import {
  consumeCode,
  loadAccessToken,
  loadClient,
  loadPending,
  type GrantStoreLike,
  type PendingAuthorization,
} from './asStore';
import { challengeFor } from './pkce';
import { REGISTER_LIMIT } from './asStore';
import { buildAuthServerMetadata, buildResourceMetadata, resourceFor } from './asMetadata';
import { oauthDiscoveryResponse } from './discovery';

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
    const code = location.searchParams.get('code')!;
    const record = await consumeCode(store, code);
    expect(record?.userId).toBe('acct-1');
    expect(record?.clientId).toBe('client-A');
  });

  it('denying redirects with access_denied and issues nothing', async () => {
    const { store, kv } = memoryStore();
    const res = await denyAuthorization({ store }, 'pending-1', pending('client-A'));
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
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

  it('exchanges a code + verifier for an access and refresh token', async () => {
    const { store } = memoryStore();
    const challenge = await challengeFor(VERIFIER);
    const code = await codeFor(store, challenge);
    const res = await handleToken(
      tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A', redirect_uri: REDIRECT }),
      { store },
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
    const { store } = memoryStore();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const res = await handleToken(
      tokenRequest({ grant_type: 'authorization_code', code, code_verifier: 'b'.repeat(64), client_id: 'client-A' }),
      { store },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('refuses to redeem a code twice', async () => {
    const { store } = memoryStore();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const first = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), { store });
    expect(first.status).toBe(200);
    const second = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), { store });
    expect(second.status).toBe(400);
  });

  it('refuses a code presented by a different client', async () => {
    const { store } = memoryStore();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const res = await handleToken(
      tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-B' }),
      { store },
    );
    expect(res.status).toBe(400);
  });

  it('rotates the refresh token, killing the presented one', async () => {
    const { store } = memoryStore();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const first = (await (await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }), { store })).json()) as { refresh_token: string };

    const refreshed = await handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'client-A' }), { store });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { refresh_token: string; access_token: string };
    expect(next.refresh_token).not.toBe(first.refresh_token);

    const replay = await handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'client-A' }), { store });
    expect(replay.status).toBe(400);
  });

  it('requires client_id, so the binding check cannot be skipped by omitting it', async () => {
    const { store } = memoryStore();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const res = await handleToken(tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER }), { store });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('requires client_id on a refresh too', async () => {
    const { store } = memoryStore();
    const code = await codeFor(store, await challengeFor(VERIFIER));
    const first = (await (
      await handleToken(
        tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: 'client-A' }),
        { store },
      )
    ).json()) as { refresh_token: string };
    const res = await handleToken(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token }), { store });
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported grant type', async () => {
    const { store } = memoryStore();
    const res = await handleToken(tokenRequest({ grant_type: 'password', username: 'x', password: 'y', client_id: 'client-A' }), { store });
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
