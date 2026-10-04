import { describe, it, expect } from 'vitest';
import { handleAuthorize, handleCallback, STATE_COOKIE, ME_URL } from './atlassianLeg';
import { loadGrant, type GrantStore } from './tokenStore';
import type { FetchLike } from './atlassianClient';

const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const CALLBACK = `${ORIGIN}/agent-link/oauth/callback`;

function makeEnv() {
  const kv = new Map<string, string>();
  const store: GrantStore = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  return {
    env: {
      ATLASSIAN_OAUTH_CLIENT_ID: 'client-id',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'client-secret',
      ATLASSIAN_OAUTH_REDIRECT_URI: 'https://conf-stg-lite.zenuml.com/agent-link/oauth/callback',
      OAUTH_GRANT_KV: store,
      OAUTH_GRANT_SECRET: 'grant-key',
    },
    store,
    kv,
  };
}

/** A fetch that answers Atlassian's three endpoints the way production does. */
function atlassianFetch(overrides: Partial<Record<'token' | 'me' | 'sites', () => Response>> = {}): { fetchImpl: FetchLike; calls: Array<{ url: string; body?: string }> } {
  const calls: Array<{ url: string; body?: string }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url === 'https://auth.atlassian.com/oauth/token') {
      return (overrides.token ?? (() => json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'read:page:confluence offline_access' })))();
    }
    if (url === ME_URL) return (overrides.me ?? (() => json(200, { account_id: '712020:abc', email: 'x@example.com' })))();
    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return (overrides.sites ?? (() => json(200, [{ id: 'cloud-1', name: 'One', url: 'https://one.atlassian.net', scopes: [] }, { id: 'cloud-2', name: 'Two', url: 'https://two.atlassian.net', scopes: [] }])))();
    }
    return new Response('unexpected ' + url, { status: 500 });
  };
  return { fetchImpl, calls };
}

describe('handleAuthorize', () => {
  it('redirects to Atlassian with the registered callback for this host and binds state to a cookie', () => {
    const { env } = makeEnv();
    const res = handleAuthorize(new Request(`${ORIGIN}/agent-link/oauth/authorize`), { env, fetchImpl: atlassianFetch().fetchImpl, randomState: () => 'st-123' });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(loc.searchParams.get('client_id')).toBe('client-id');
    expect(loc.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(loc.searchParams.get('state')).toBe('st-123');
    expect(loc.searchParams.get('scope')).toContain('offline_access');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(new RegExp(`^${STATE_COOKIE}=st-123;`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  it('refuses a mismatched host instead of redirecting to a dead end', () => {
    // The whole point of pinning: a request on an unregistered host stops HERE,
    // with an explanation, rather than 302-ing the user to Atlassian's error page.
    const { env } = makeEnv();
    const res = handleAuthorize(
      new Request('http://127.0.0.1:8080/agent-link/oauth/authorize'),
      { env, fetchImpl: atlassianFetch().fetchImpl },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('says 503 rather than 400 when the redirect URI is not configured at all', () => {
    const { env } = makeEnv();
    delete (env as { ATLASSIAN_OAUTH_REDIRECT_URI?: string }).ATLASSIAN_OAUTH_REDIRECT_URI;
    const res = handleAuthorize(
      new Request('https://conf-stg-lite.zenuml.com/agent-link/oauth/authorize'),
      { env, fetchImpl: atlassianFetch().fetchImpl },
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('location')).toBeNull();
  });

  it('omits Secure on the localhost callback so the cookie survives http://', () => {
    // The pinned callback has to be the localhost one here: with staging pinned,
    // a localhost request is now a host mismatch and never reaches Atlassian.
    const { env } = makeEnv();
    env.ATLASSIAN_OAUTH_REDIRECT_URI = 'http://localhost:8080/agent-link/oauth/callback';
    const res = handleAuthorize(new Request('http://localhost:8080/agent-link/oauth/authorize'), { env, fetchImpl: atlassianFetch().fetchImpl });
    expect(res.headers.get('set-cookie')).not.toContain('Secure');
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('http://localhost:8080/agent-link/oauth/callback');
  });
});

describe('handleCallback', () => {
  const withState = (qs: string, cookieState = 'st-123') =>
    new Request(`${CALLBACK}?${qs}`, { headers: { cookie: `${STATE_COOKIE}=${cookieState}` } });

  it('exchanges the code, keys the grant by the /me account id, and reports the sites', async () => {
    const { env, store } = makeEnv();
    const { fetchImpl, calls } = atlassianFetch();
    const { response, outcome } = await handleCallback(withState('code=c-1&state=st-123'), { env, fetchImpl, nowMs: () => 1_000 });
    expect(outcome).toEqual({ ok: true, accountId: '712020:abc', siteCount: 2 });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('one.atlassian.net');
    // the exchange sent the same redirect_uri the authorize step used
    const token = calls.find((c) => c.url.endsWith('/oauth/token'))!;
    expect(token.body).toContain(`"redirect_uri":"${CALLBACK}"`);
    // and the grant is really in the store, under the account id
    const grant = await loadGrant(store, 'grant-key', '712020:abc');
    expect(grant?.refreshToken).toBe('rt-1');
    // the state cookie is cleared
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refuses when the state does not match the cookie, storing nothing', async () => {
    const { env, kv } = makeEnv();
    const { fetchImpl, calls } = atlassianFetch();
    const { response, outcome } = await handleCallback(withState('code=c-1&state=st-OTHER'), { env, fetchImpl });
    expect(outcome).toEqual({ ok: false, reason: 'state_mismatch', detail: undefined });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(kv.size).toBe(0);
  });

  it('refuses when there is no state cookie at all (a link opened in another browser)', async () => {
    const { env } = makeEnv();
    const { fetchImpl, calls } = atlassianFetch();
    const { outcome } = await handleCallback(new Request(`${CALLBACK}?code=c-1&state=st-123`), { env, fetchImpl });
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a declined consent without calling Atlassian', async () => {
    const { env } = makeEnv();
    const { fetchImpl, calls } = atlassianFetch();
    const { response, outcome } = await handleCallback(withState('error=access_denied&state=st-123'), { env, fetchImpl });
    expect(outcome).toEqual({ ok: false, reason: 'atlassian_denied', detail: 'access_denied' });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('reports a failed exchange and stores nothing', async () => {
    const { env, kv } = makeEnv();
    const { fetchImpl } = atlassianFetch({ token: () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) });
    const { response, outcome } = await handleCallback(withState('code=stale&state=st-123'), { env, fetchImpl });
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe('exchange_failed');
    expect(response.status).toBe(502);
    expect(kv.size).toBe(0);
  });

  it('does not file a grant it cannot attribute to an account', async () => {
    const { env, kv } = makeEnv();
    const { fetchImpl } = atlassianFetch({ me: () => new Response('nope', { status: 401 }) });
    const { outcome } = await handleCallback(withState('code=c-1&state=st-123'), { env, fetchImpl });
    expect((outcome as { reason: string }).reason).toBe('me_failed');
    expect(kv.size).toBe(0);
  });

  it('keeps a stored grant when only the site listing fails', async () => {
    const { env, store } = makeEnv();
    const { fetchImpl } = atlassianFetch({ sites: () => new Response('down', { status: 503 }) });
    const { response, outcome } = await handleCallback(withState('code=c-1&state=st-123'), { env, fetchImpl });
    expect((outcome as { reason: string }).reason).toBe('sites_failed');
    expect(response.status).toBe(200);
    expect((await loadGrant(store, 'grant-key', '712020:abc'))?.refreshToken).toBe('rt-1');
  });
});
