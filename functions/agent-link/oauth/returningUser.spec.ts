// The returning-user cookie and the /authorize routing it enables: a known
// user with a live grant skips Atlassian, and every other case falls back to
// the full trip. See docs/superpowers/specs/2026-09-26-agent-link-returning-user-design.md.

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  RETURNING_USER_COOKIE,
  forcesAtlassian,
  readReturningUser,
  returningUserCookie,
} from './returningUser';
import { onRequestGet as authorizeGet, routeReturningUser } from './authorize';
import { onRequestGet as callbackGet } from './callback';
import { onRequestGet as consentGet } from './consent';
import { CONSENT_COOKIE, recordConsent, validateAuthorize } from './authServer';
import { consumeCode, loadPending, saveClient, type GrantStoreLike } from './asStore';
import { STATE_COOKIE, ME_URL } from './atlassianLeg';
import { challengeFor } from './pkce';
import { loadGrant, saveGrant } from './tokenStore';
import type { FetchLike } from './atlassianClient';

const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const AUTHORIZE = `${ORIGIN}/agent-link/oauth/authorize`;
const REDIRECT = 'http://127.0.0.1:53682/callback';
const SECRET = 'grant-key';
const ACCOUNT = '712020:abc';
const NOW = 1_800_000_000_000;

function makeEnv() {
  const kv = new Map<string, string>();
  const store: GrantStoreLike = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  return {
    kv,
    store,
    env: {
      ATLASSIAN_OAUTH_CLIENT_ID: 'client-id',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'client-secret',
      ATLASSIAN_OAUTH_REDIRECT_URI: `${ORIGIN}/agent-link/oauth/callback`,
      OAUTH_GRANT_KV: store,
      OAUTH_GRANT_SECRET: SECRET,
    },
  };
}

const ctx = (request: Request, env: unknown) => ({ request, env }) as never;

/** The cookie pair as a browser would send it back: `name=value`. */
async function cookieHeader(accountId = ACCOUNT, secret = SECRET): Promise<string> {
  const set = await returningUserCookie(accountId, secret, new URL(AUTHORIZE));
  return set.split(';')[0];
}

async function seedClient(store: GrantStoreLike) {
  await saveClient(store, { clientId: 'client-A', redirectUris: [REDIRECT], clientName: 'Claude Code', createdAtMs: 1 });
}

async function seedGrant(store: GrantStoreLike, expiresAtMs = NOW + 3_600_000) {
  await saveGrant(store, SECRET, ACCOUNT, { accessToken: 'at-1', refreshToken: 'rt-1', accessTokenExpiresAtMs: expiresAtMs, scope: 's' }, NOW);
}

async function authorizeRequest(cookie?: string, extra: Record<string, string> = {}) {
  const url = new URL(AUTHORIZE);
  const params: Record<string, string> = {
    client_id: 'client-A',
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: await challengeFor('v'.repeat(64)),
    code_challenge_method: 'S256',
    state: 'client-state-1',
    ...extra,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, cookie ? { headers: { cookie } } : undefined);
}

/**
 * Each Set-Cookie on a response. jsdom's Headers has no getSetCookie() and
 * joins them with ", "; none of these cookies carries an Expires date (the
 * only attribute with a comma in it), so splitting before each `name=` is exact.
 */
function setCookies(res: Response): string[] {
  const joined = res.headers.get('set-cookie');
  return joined ? joined.split(/, (?=[A-Za-z_]+=)/) : [];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the returning-user cookie', () => {
  it('round-trips the account id it was signed for', async () => {
    expect(await readReturningUser(await cookieHeader(), SECRET)).toEqual({ status: 'ok', accountId: ACCOUNT });
  });

  it('is HttpOnly, Lax, Secure and scoped to the OAuth routes', async () => {
    const set = await returningUserCookie(ACCOUNT, SECRET, new URL(AUTHORIZE));
    expect(set).toContain(`${RETURNING_USER_COOKIE}=`);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).toContain('Secure');
    expect(set).toContain('Path=/agent-link/oauth;');
    // The account id is encoded, not stored raw next to the MAC.
    expect(set).not.toContain(ACCOUNT);
  });

  it('is absent rather than invalid when there is no cookie', async () => {
    expect(await readReturningUser(null, SECRET)).toEqual({ status: 'none' });
    expect(await readReturningUser('other=1', SECRET)).toEqual({ status: 'none' });
  });

  it('refuses a cookie signed with another secret', async () => {
    expect(await readReturningUser(await cookieHeader(ACCOUNT, 'other-key'), SECRET)).toEqual({ status: 'invalid' });
  });

  it('refuses a cookie whose account id was swapped under a valid MAC', async () => {
    const [, mac] = (await cookieHeader()).split('.');
    const forged = `${RETURNING_USER_COOKIE}=${btoa('victim').replace(/=+$/, '')}.${mac}`;
    expect(await readReturningUser(forged, SECRET)).toEqual({ status: 'invalid' });
  });

  it('refuses garbage', async () => {
    expect(await readReturningUser(`${RETURNING_USER_COOKIE}=nodot`, SECRET)).toEqual({ status: 'invalid' });
    expect(await readReturningUser(`${RETURNING_USER_COOKIE}=a.b.c`, SECRET)).toEqual({ status: 'invalid' });
    expect(await readReturningUser(`${RETURNING_USER_COOKIE}=%%%.$$$`, SECRET)).toEqual({ status: 'invalid' });
  });

  it('treats prompt=login and prompt=select_account as a request for Atlassian', () => {
    expect(forcesAtlassian(new URL(`${AUTHORIZE}?prompt=login`))).toBe(true);
    expect(forcesAtlassian(new URL(`${AUTHORIZE}?prompt=select_account`))).toBe(true);
    expect(forcesAtlassian(new URL(`${AUTHORIZE}?prompt=consent`))).toBe(false);
    expect(forcesAtlassian(new URL(AUTHORIZE))).toBe(false);
  });
});

describe('/authorize for a returning user', () => {
  it('goes to Atlassian when the browser carries no cookie', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store);
    vi.stubGlobal('fetch', vi.fn());

    const res = await authorizeGet(ctx(await authorizeRequest(), e.env));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).host).toBe('auth.atlassian.com');
  });

  it('skips Atlassian and shows our consent screen when the grant is live but this client is new', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store, Date.now() + 3_600_000);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await authorizeGet(ctx(await authorizeRequest(await cookieHeader()), e.env));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(`${ORIGIN}/agent-link/oauth/consent`);
    // No Atlassian call at all: the access token was still fresh.
    expect(fetchMock).not.toHaveBeenCalled();

    const pendingId = loc.searchParams.get('auth')!;
    const pending = await loadPending(e.store, pendingId);
    expect(pending?.userId).toBe(ACCOUNT);
    expect(pending?.recognised).toBe(true);

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${CONSENT_COOKIE}=${pendingId};`))).toBe(true);
    // The returning-user cookie is refreshed, so recognition slides.
    expect(cookies.some((c) => c.startsWith(`${RETURNING_USER_COOKIE}=`) && !c.includes('Max-Age=0'))).toBe(true);

    // The consent screen still names the agent, and offers the way back to
    // Atlassian for a different account or site.
    const page = await consentGet(ctx(new Request(loc, { headers: { cookie: `${CONSENT_COOKIE}=${pendingId}` } }), e.env));
    const html = await page.text();
    expect(html).toContain('Claude Code');
    const href = /href="([^"]+)"/.exec(html)![1].replace(/&amp;/g, '&');
    const back = new URL(href);
    expect(back.pathname).toBe('/agent-link/oauth/authorize');
    expect(back.searchParams.get('prompt')).toBe('login');
    expect(back.searchParams.get('client_id')).toBe('client-A');
    expect(back.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('client-state-1');
  });

  it('issues a code with no screen when this client was already approved', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store, Date.now() + 3_600_000);
    await recordConsent({ store: e.store }, ACCOUNT, 'client-A', 'diagram.read diagram.write');
    vi.stubGlobal('fetch', vi.fn());

    const res = await authorizeGet(ctx(await authorizeRequest(await cookieHeader()), e.env));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('client-state-1');
    const issued = await consumeCode(e.store, loc.searchParams.get('code')!);
    expect(issued?.userId).toBe(ACCOUNT);
    expect(issued?.clientId).toBe('client-A');
  });

  it('still asks for consent when the approval does not cover the requested scope', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store, Date.now() + 3_600_000);
    await recordConsent({ store: e.store }, ACCOUNT, 'client-A', 'diagram.read');
    vi.stubGlobal('fetch', vi.fn());

    const res = await authorizeGet(ctx(await authorizeRequest(await cookieHeader()), e.env));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/agent-link/oauth/consent');
  });

  it('goes to Atlassian and clears a forged cookie', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store, Date.now() + 3_600_000);
    vi.stubGlobal('fetch', vi.fn());

    const res = await authorizeGet(ctx(await authorizeRequest(await cookieHeader(ACCOUNT, 'attacker-key')), e.env));
    expect(new URL(res.headers.get('location')!).host).toBe('auth.atlassian.com');
    expect(setCookies(res).some((c) => c.startsWith(`${RETURNING_USER_COOKIE}=;`) && c.includes('Max-Age=0'))).toBe(true);
    // And the Atlassian state cookie is still set, so the trip can complete.
    expect(setCookies(res).some((c) => c.startsWith(`${STATE_COOKIE}=`))).toBe(true);
  });

  it('goes to Atlassian and clears the cookie when no grant is stored for that user', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    vi.stubGlobal('fetch', vi.fn());

    const res = await authorizeGet(ctx(await authorizeRequest(await cookieHeader()), e.env));
    expect(new URL(res.headers.get('location')!).host).toBe('auth.atlassian.com');
    expect(setCookies(res).some((c) => c.startsWith(`${RETURNING_USER_COOKIE}=;`))).toBe(true);
  });

  it('goes to Atlassian on prompt=login even with a live grant and an approval, and keeps the cookie', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store, Date.now() + 3_600_000);
    await recordConsent({ store: e.store }, ACCOUNT, 'client-A', 'diagram.read diagram.write');
    vi.stubGlobal('fetch', vi.fn());

    const res = await authorizeGet(ctx(await authorizeRequest(await cookieHeader(), { prompt: 'login' }), e.env));
    expect(new URL(res.headers.get('location')!).host).toBe('auth.atlassian.com');
    expect(setCookies(res).some((c) => c.startsWith(`${RETURNING_USER_COOKIE}=`))).toBe(false);
  });

  it('records where each request was routed', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    await seedGrant(e.store, Date.now() + 3_600_000);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authorizeGet(ctx(await authorizeRequest(await cookieHeader()), { ...e.env, MIXPANEL_TOKEN: 'mp' }));
    const imported = fetchMock.mock.calls
      .filter(([url]) => String(url) === 'https://api.mixpanel.com/import')
      .map(([, init]) => JSON.parse(String((init as RequestInit).body))[0]);
    expect(imported).toHaveLength(1);
    expect(imported[0].event).toBe('agent_link_oauth_authorize_routed');
    expect(imported[0].properties.oauth_route).toBe('consent');
    expect(imported[0].properties.user_account_id).toBe(ACCOUNT);
  });
});

describe('routeReturningUser when the access token has expired', () => {
  async function parked(e: ReturnType<typeof makeEnv>, cookie: string) {
    await seedClient(e.store);
    await seedGrant(e.store, NOW - 1);
    const request = await authorizeRequest(cookie);
    const result = await validateAuthorize(request, { store: e.store });
    if (!result.ok) throw new Error('authorize did not validate');
    return { request, result };
  }

  const refreshing = (response: () => Response): FetchLike => async (url) => {
    if (url === 'https://auth.atlassian.com/oauth/token') return response();
    return new Response('unexpected ' + url, { status: 500 });
  };

  it('refreshes and skips Atlassian when the refresh succeeds', async () => {
    const e = makeEnv();
    const { request, result } = await parked(e, await cookieHeader());
    const fetchImpl = refreshing(() => new Response(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 's' }), { status: 200 }));

    const routed = await routeReturningUser(request, { env: e.env, fetchImpl, nowMs: () => NOW }, result.pendingId, result.pending);
    expect(routed.route).toBe('consent');
    expect((await loadGrant(e.store, SECRET, ACCOUNT))?.refreshToken).toBe('rt-2');
  });

  it('falls back to Atlassian and clears the cookie when the refresh token is dead', async () => {
    const e = makeEnv();
    const { request, result } = await parked(e, await cookieHeader());
    const fetchImpl = refreshing(() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 403 }));

    const routed = await routeReturningUser(request, { env: e.env, fetchImpl, nowMs: () => NOW }, result.pendingId, result.pending);
    expect(routed).toMatchObject({ route: 'atlassian', reason: 'reauthorize_required', clearCookie: true });
  });

  it('falls back to Atlassian but keeps the cookie when Atlassian errors transiently', async () => {
    const e = makeEnv();
    const { request, result } = await parked(e, await cookieHeader());
    const fetchImpl = refreshing(() => new Response('busy', { status: 503 }));

    const routed = await routeReturningUser(request, { env: e.env, fetchImpl, nowMs: () => NOW }, result.pendingId, result.pending);
    expect(routed).toMatchObject({ route: 'atlassian', reason: 'refresh_failed', clearCookie: false });
  });
});

describe('/callback remembers the user', () => {
  function atlassian(): typeof fetch {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://auth.atlassian.com/oauth/token') {
        return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 's' });
      }
      if (url === ME_URL) return json({ account_id: ACCOUNT });
      if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
        return json([{ id: 'cloud-1', name: 'One', url: 'https://one.atlassian.net', scopes: [] }]);
      }
      return new Response('unexpected ' + url, { status: 500 });
    }) as typeof fetch;
  }

  const callback = (state: string) =>
    new Request(`${ORIGIN}/agent-link/oauth/callback?code=c-1&state=${state}`, { headers: { cookie: `${STATE_COOKIE}=${state}` } });

  it('sets the returning-user cookie alongside the consent cookie on an MCP authorization', async () => {
    const e = makeEnv();
    await seedClient(e.store);
    const result = await validateAuthorize(await authorizeRequest(), { store: e.store });
    if (!result.ok) throw new Error('authorize did not validate');
    vi.stubGlobal('fetch', atlassian());

    const res = await callbackGet(ctx(callback(result.pendingId), e.env));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/agent-link/oauth/consent');
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${CONSENT_COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=;`))).toBe(true);
    const remembered = cookies.find((c) => c.startsWith(`${RETURNING_USER_COOKIE}=`))!;
    expect(await readReturningUser(remembered.split(';')[0], SECRET)).toEqual({ status: 'ok', accountId: ACCOUNT });
    // Recognised only applies to the cookie path; this user came via Atlassian.
    expect((await loadPending(e.store, result.pendingId))?.recognised).toBeUndefined();
  });

  it('sets it on the bare connect flow too, so a seeded grant is reachable', async () => {
    const e = makeEnv();
    vi.stubGlobal('fetch', atlassian());

    const res = await callbackGet(ctx(callback('bare-state'), e.env));
    expect(res.status).toBe(200);
    expect(setCookies(res).some((c) => c.startsWith(`${RETURNING_USER_COOKIE}=`))).toBe(true);
  });
});
