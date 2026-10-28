// Pins the exact Set-Cookie strings and Cookie-header parse results of the
// three Agent Link OAuth cookies (#987). Written against the pre-refactor
// code and kept green through the extraction: the header bytes must not move.

import { describe, it, expect } from 'vitest';
import { handleAuthorize, handleCallback } from './atlassianLeg';
import { consentCookie, readCookie } from './authServer';
import {
  RETURNING_USER_COOKIE,
  clearReturningUserCookie,
  readReturningUser,
  returningUserCookie,
} from './returningUser';
import type { GrantStore } from './tokenStore';
import { clearCookie, readCookie as readCookie2, setCookie } from './cookies';

const HTTPS = new URL('https://conf-stg-lite.zenuml.com/agent-link/oauth/x');
const HTTP = new URL('http://localhost:8080/agent-link/oauth/x');

function stateEnv(redirect: string) {
  const kv = new Map<string, string>();
  const store: GrantStore = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  return {
    ATLASSIAN_OAUTH_CLIENT_ID: 'client-id',
    ATLASSIAN_OAUTH_CLIENT_SECRET: 'client-secret',
    ATLASSIAN_OAUTH_REDIRECT_URI: redirect,
    OAUTH_GRANT_KV: store,
    OAUTH_GRANT_SECRET: 'grant-key',
  };
}
const noFetch = (async () => new Response('', { status: 500 })) as never;

describe('pinned Set-Cookie strings', () => {
  it('state cookie, set, https and http', () => {
    const https = handleAuthorize(new Request('https://conf-stg-lite.zenuml.com/agent-link/oauth/authorize'), {
      env: stateEnv('https://conf-stg-lite.zenuml.com/agent-link/oauth/callback'), fetchImpl: noFetch, randomState: () => 'st-1',
    });
    expect(https.headers.get('set-cookie')).toBe(
      'agent_link_oauth_state=st-1; Path=/agent-link/oauth; Max-Age=1800; HttpOnly; SameSite=Lax; Secure');
    const http = handleAuthorize(new Request('http://localhost:8080/agent-link/oauth/authorize'), {
      env: stateEnv('http://localhost:8080/agent-link/oauth/callback'), fetchImpl: noFetch, randomState: () => 'st-1',
    });
    expect(http.headers.get('set-cookie')).toBe(
      'agent_link_oauth_state=st-1; Path=/agent-link/oauth; Max-Age=1800; HttpOnly; SameSite=Lax');
  });

  it('state cookie, cleared by the callback, https and http', async () => {
    const deps = { env: stateEnv('https://conf-stg-lite.zenuml.com/agent-link/oauth/callback'), fetchImpl: noFetch };
    const https = await handleCallback(new Request('https://conf-stg-lite.zenuml.com/agent-link/oauth/callback?error=x'), deps);
    expect(https.response.headers.get('set-cookie')).toBe(
      'agent_link_oauth_state=; Path=/agent-link/oauth; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    const http = await handleCallback(new Request('http://localhost:8080/agent-link/oauth/callback?error=x'), deps);
    expect(http.response.headers.get('set-cookie')).toBe(
      'agent_link_oauth_state=; Path=/agent-link/oauth; Max-Age=0; HttpOnly; SameSite=Lax');
  });

  it('consent cookie, default TTL, explicit 0, https and http', () => {
    expect(consentCookie('p-1', HTTPS)).toBe(
      'agent_link_consent=p-1; Path=/agent-link/oauth/consent; Max-Age=600; HttpOnly; SameSite=Lax; Secure');
    expect(consentCookie('p-1', HTTP)).toBe(
      'agent_link_consent=p-1; Path=/agent-link/oauth/consent; Max-Age=600; HttpOnly; SameSite=Lax');
    expect(consentCookie('', HTTPS, 0)).toBe(
      'agent_link_consent=; Path=/agent-link/oauth/consent; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    expect(consentCookie('', HTTP, 0)).toBe(
      'agent_link_consent=; Path=/agent-link/oauth/consent; Max-Age=0; HttpOnly; SameSite=Lax');
  });

  it('returning-user cookie, set and cleared, https and http', async () => {
    const set = await returningUserCookie('712020:abc', 'grant-key', HTTPS);
    expect(set).toMatch(/^agent_link_user=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/agent-link\/oauth; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure$/);
    const setHttp = await returningUserCookie('712020:abc', 'grant-key', HTTP);
    expect(setHttp).toBe(set.replace(/; Secure$/, ''));
    expect(clearReturningUserCookie(HTTPS)).toBe(
      'agent_link_user=; Path=/agent-link/oauth; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    expect(clearReturningUserCookie(HTTP)).toBe(
      'agent_link_user=; Path=/agent-link/oauth; Max-Age=0; HttpOnly; SameSite=Lax');
  });
});

describe('pinned parse results', () => {
  it('readCookie: first match wins, first "=" splits, no decoding, trims leading space', () => {
    expect(readCookie(null, 'a')).toBeNull();
    expect(readCookie('', 'a')).toBeNull();
    expect(readCookie('b=1', 'a')).toBeNull();
    expect(readCookie('x=1; a=2; y=3', 'a')).toBe('2');
    expect(readCookie('a=b=c==', 'a')).toBe('b=c==');
    expect(readCookie('   a=2', 'a')).toBe('2');
    expect(readCookie('a=%41%20', 'a')).toBe('%41%20');
    expect(readCookie('a=; b=1', 'a')).toBe('');
    expect(readCookie('a=1; a=2', 'a')).toBe('1');
    expect(readCookie('xa=1; ab=2', 'a')).toBeNull();
  });

  it('readReturningUser: the LAST duplicate wins and an empty value is none', async () => {
    const good = (await returningUserCookie('712020:abc', 'grant-key', HTTPS)).split(';')[0].split('=').slice(1).join('=');
    const name = RETURNING_USER_COOKIE;
    const ok = { status: 'ok', accountId: '712020:abc' };
    expect(await readReturningUser(null, 'grant-key')).toEqual({ status: 'none' });
    expect(await readReturningUser('', 'grant-key')).toEqual({ status: 'none' });
    expect(await readReturningUser(`${name}=`, 'grant-key')).toEqual({ status: 'none' });
    expect(await readReturningUser(`other=1; ${name}=${good}`, 'grant-key')).toEqual(ok);
    expect(await readReturningUser(`   ${name}=${good}`, 'grant-key')).toEqual(ok);
    expect(await readReturningUser(`${name}=junk; ${name}=${good}`, 'grant-key')).toEqual(ok);
    expect(await readReturningUser(`${name}=${good}; ${name}=junk`, 'grant-key')).toEqual({ status: 'invalid' });
    expect(await readReturningUser(`${name}=${good}; ${name}=`, 'grant-key')).toEqual({ status: 'none' });
    expect(await readReturningUser(`${name}=a.b.c`, 'grant-key')).toEqual({ status: 'invalid' });
  });
});

describe('cookies.ts directly', () => {
  it('setCookie and clearCookie build Lax HttpOnly headers, Secure only on https', () => {
    expect(setCookie('n', 'v', { path: '/p', maxAge: 5, requestUrl: HTTPS })).toBe('n=v; Path=/p; Max-Age=5; HttpOnly; SameSite=Lax; Secure');
    expect(setCookie('n', 'v', { path: '/p', maxAge: 5, requestUrl: HTTP })).toBe('n=v; Path=/p; Max-Age=5; HttpOnly; SameSite=Lax');
    expect(clearCookie('n', { path: '/p', requestUrl: HTTPS })).toBe('n=; Path=/p; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    expect(clearCookie('n', { path: '/p', requestUrl: HTTP })).toBe('n=; Path=/p; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(setCookie('n', 'v', { path: '/p', maxAge: 5, requestUrl: HTTPS })).not.toContain('Strict');
  });

  it('readCookie honours the duplicate option', () => {
    expect(readCookie2('a=1; a=2', 'a')).toBe('1');
    expect(readCookie2('a=1; a=2', 'a', { duplicate: 'last' })).toBe('2');
    expect(readCookie2('a=1', 'a', { duplicate: 'last' })).toBe('1');
    expect(readCookie2('b=1', 'a', { duplicate: 'last' })).toBeNull();
    expect(readCookie2(null, 'a', { duplicate: 'last' })).toBeNull();
  });

  it('authServer re-exports the same readCookie', () => {
    expect(readCookie).toBe(readCookie2);
  });
});
