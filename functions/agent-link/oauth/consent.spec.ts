// The consent hop's browser binding — the thing that stops the `auth` id in
// the URL from being a credential on its own.

import { describe, it, expect } from 'vitest';
import { onRequestGet, onRequestPost } from './consent';
import {
  CONSENT_COOKIE,
  consentCookie,
  consentCookieMatches,
  readCookie,
} from './authServer';
import { savePending, saveClient, type GrantStoreLike, type PendingAuthorization } from './asStore';
import { resourceFor } from './asMetadata';

const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const CONSENT = `${ORIGIN}/agent-link/oauth/consent`;
const REDIRECT = 'http://127.0.0.1:53682/callback';
const PENDING_ID = 'pending-abc';

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
      OAUTH_GRANT_KV: store,
      OAUTH_GRANT_SECRET: 'grant-key',
    },
  };
}

const pending: PendingAuthorization = {
  clientId: 'client-A',
  redirectUri: REDIRECT,
  state: 'client-state-1',
  codeChallenge: 'x'.repeat(43),
  scope: 'diagram.read diagram.write',
  resource: resourceFor(ORIGIN),
  createdAtMs: 1_000,
  userId: 'acct-1',
};

async function seed(env: ReturnType<typeof makeEnv>) {
  await savePending(env.store, PENDING_ID, pending);
  await saveClient(env.store, { clientId: 'client-A', redirectUris: [REDIRECT], clientName: 'Claude Code', createdAtMs: 1 });
}

/** The Pages Functions context shape these handlers actually read. */
const ctx = (request: Request, env: unknown) => ({ request, env }) as never;

function postForm(fields: Record<string, string>, cookie?: string) {
  return new Request(CONSENT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('the consent cookie', () => {
  it('is HttpOnly, Strict and scoped to the consent path', () => {
    const cookie = consentCookie(PENDING_ID, new URL(CONSENT));
    expect(cookie).toContain(`${CONSENT_COOKIE}=${PENDING_ID}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/agent-link/oauth/consent');
  });

  it('omits Secure on http so the localhost flow still works', () => {
    expect(consentCookie(PENDING_ID, new URL('http://localhost:8080/agent-link/oauth/consent'))).not.toContain('Secure');
  });

  it('matches only the exact parked id', () => {
    const request = new Request(CONSENT, { headers: { cookie: `${CONSENT_COOKIE}=${PENDING_ID}` } });
    expect(consentCookieMatches(request, PENDING_ID)).toBe(true);
    expect(consentCookieMatches(request, 'pending-other')).toBe(false);
    expect(consentCookieMatches(new Request(CONSENT), PENDING_ID)).toBe(false);
    // an empty id must never match an absent cookie
    expect(consentCookieMatches(new Request(CONSENT), '')).toBe(false);
  });
});

describe('consent screen', () => {
  it('renders for the browser that was sent here', async () => {
    const env = makeEnv();
    await seed(env);
    const res = await onRequestGet(
      ctx(new Request(`${CONSENT}?auth=${PENDING_ID}`, { headers: { cookie: `${CONSENT_COOKIE}=${PENDING_ID}` } }), env.env),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Claude Code');
  });

  it('refuses a browser that did not complete the Atlassian leg', async () => {
    const env = makeEnv();
    await seed(env);
    const res = await onRequestGet(ctx(new Request(`${CONSENT}?auth=${PENDING_ID}`), env.env));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('Claude Code');
  });

  it('completes and records consent when the cookie matches', async () => {
    const env = makeEnv();
    await seed(env);
    const res = await onRequestPost(
      ctx(postForm({ auth: PENDING_ID, decision: 'allow' }, `${CONSENT_COOKIE}=${PENDING_ID}`), env.env),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect([...env.kv.keys()].some((k) => k.includes('-consent:acct-1:client-A'))).toBe(true);
    // the cookie is spent
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refuses a stolen auth id: no cookie, no code, no consent recorded', async () => {
    const env = makeEnv();
    await seed(env);
    const res = await onRequestPost(ctx(postForm({ auth: PENDING_ID, decision: 'allow' }), env.env));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect([...env.kv.keys()].some((k) => k.includes('-consent:'))).toBe(false);
    expect([...env.kv.keys()].some((k) => k.includes('-code:'))).toBe(false);
  });

  it('refuses a cookie for a different authorization', async () => {
    const env = makeEnv();
    await seed(env);
    const res = await onRequestPost(
      ctx(postForm({ auth: PENDING_ID, decision: 'allow' }, `${CONSENT_COOKIE}=someone-elses-id`), env.env),
    );
    expect(res.status).toBe(400);
    expect([...env.kv.keys()].some((k) => k.includes('-code:'))).toBe(false);
  });

  it('carries a decline back to the client as access_denied', async () => {
    const env = makeEnv();
    await seed(env);
    const res = await onRequestPost(
      ctx(postForm({ auth: PENDING_ID, decision: 'deny' }, `${CONSENT_COOKIE}=${PENDING_ID}`), env.env),
    );
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    expect([...env.kv.keys()].some((k) => k.includes('-consent:'))).toBe(false);
  });
});

describe('readCookie', () => {
  it('reads one cookie out of a header carrying several', () => {
    expect(readCookie(`other=1; ${CONSENT_COOKIE}=${PENDING_ID}; third=3`, CONSENT_COOKIE)).toBe(PENDING_ID);
    expect(readCookie(null, CONSENT_COOKIE)).toBeNull();
    expect(readCookie('other=1', CONSENT_COOKIE)).toBeNull();
  });
});
