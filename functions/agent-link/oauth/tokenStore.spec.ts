import { describe, it, expect } from 'vitest';
import {
  saveGrant,
  loadGrant,
  deleteGrant,
  getAccessToken,
  grantKey,
  GRANT_TTL_SECONDS,
  type GrantStore,
} from './tokenStore';
import type { AtlassianAppConfig, AtlassianGrant, FetchLike } from './atlassianClient';

const SECRET = 'a-high-entropy-worker-secret';
const NOW = 1_800_000_000_000;
const APP: AtlassianAppConfig = {
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'https://example.com/cb',
};

function grant(over: Partial<AtlassianGrant> = {}): AtlassianGrant {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAtMs: NOW + 3600_000,
    scope: 'read:page:confluence offline_access',
    ...over,
  };
}

function memoryStore(): GrantStore & { data: Map<string, string>; ttls: number[] } {
  const data = new Map<string, string>();
  const ttls: number[] = [];
  return {
    data,
    ttls,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value, options) {
      if (options?.expirationTtl) ttls.push(options.expirationTtl);
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('saveGrant / loadGrant', () => {
  it('round-trips a grant', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    expect(await loadGrant(store, SECRET, 'user-1')).toEqual(grant());
  });

  it('never writes the refresh token in plaintext', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant({ refreshToken: 'SUPER-SECRET-RT' }), NOW);
    const raw = store.data.get(grantKey('user-1'))!;
    expect(raw).not.toContain('SUPER-SECRET-RT');
  });

  it('uses a fresh IV per write, so identical grants do not produce identical ciphertext', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const first = store.data.get(grantKey('user-1'))!;
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const second = store.data.get(grantKey('user-1'))!;
    expect(first).not.toBe(second);
    expect(await loadGrant(store, SECRET, 'user-1')).toEqual(grant());
  });

  it('writes with a TTL that outlasts Atlassian 90-day inactivity window', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    expect(store.ttls[0]).toBe(GRANT_TTL_SECONDS);
    expect(GRANT_TTL_SECONDS).toBeGreaterThan(90 * 24 * 60 * 60);
  });

  it('keys grants per user', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant({ refreshToken: 'rt-a' }), NOW);
    await saveGrant(store, SECRET, 'user-2', grant({ refreshToken: 'rt-b' }), NOW);
    expect((await loadGrant(store, SECRET, 'user-1'))?.refreshToken).toBe('rt-a');
    expect((await loadGrant(store, SECRET, 'user-2'))?.refreshToken).toBe('rt-b');
  });

  it('returns null rather than throwing under the wrong secret', async () => {
    // A rotated Worker secret makes every stored grant undecryptable. That must
    // read as "authorize again", not as a 500 on every headless call.
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    expect(await loadGrant(store, 'a-different-secret', 'user-1')).toBeNull();
  });

  it('returns null on tampered ciphertext', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const stored = JSON.parse(store.data.get(grantKey('user-1'))!);
    stored.rt = btoa('tampered-value-of-the-same-ish-length');
    store.data.set(grantKey('user-1'), JSON.stringify(stored));
    expect(await loadGrant(store, SECRET, 'user-1')).toBeNull();
  });

  it('returns null for missing, corrupt, or unversioned records', async () => {
    const store = memoryStore();
    expect(await loadGrant(store, SECRET, 'nobody')).toBeNull();
    store.data.set(grantKey('u'), '{not json');
    expect(await loadGrant(store, SECRET, 'u')).toBeNull();
    store.data.set(grantKey('u'), JSON.stringify({ v: 2, rt: 'x', iv: 'y' }));
    expect(await loadGrant(store, SECRET, 'u')).toBeNull();
  });

  it('deleteGrant removes it', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    await deleteGrant(store, 'user-1');
    expect(await loadGrant(store, SECRET, 'user-1')).toBeNull();
  });
});

describe('getAccessToken', () => {
  const neverCalled: FetchLike = async () => {
    throw new Error('should not have refreshed');
  };

  it('returns the stored token while it is still usable', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    expect(await getAccessToken(store, SECRET, APP, neverCalled, 'user-1', NOW)).toEqual({
      ok: true,
      accessToken: 'at-1',
      refreshed: false,
    });
  });

  it('reports no_grant when the user has never authorized', async () => {
    const store = memoryStore();
    expect(await getAccessToken(store, SECRET, APP, neverCalled, 'user-1', NOW)).toEqual({
      ok: false,
      reason: 'no_grant',
    });
  });

  it('refreshes an expired token and persists the rotation', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const later = NOW + 3600_000 + 1;
    const fetchImpl: FetchLike = async () =>
      jsonResponse(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 's' });

    const result = await getAccessToken(store, SECRET, APP, fetchImpl, 'user-1', later);
    expect(result).toEqual({ ok: true, accessToken: 'at-2', refreshed: true });

    // The rotated refresh token must be what is now stored — the old one is
    // already spent at Atlassian.
    const reloaded = await loadGrant(store, SECRET, 'user-1');
    expect(reloaded?.refreshToken).toBe('rt-2');
    expect(reloaded?.accessToken).toBe('at-2');
  });

  it('persists the rotated grant BEFORE handing the caller a token', async () => {
    // Atlassian invalidates the old refresh token the moment it answers, so a
    // crash after returning but before saving would lose the authorization.
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    let storedWhenReturned: string | null = null;
    const originalPut = store.put.bind(store);
    store.put = async (k, v, o) => {
      await originalPut(k, v, o);
      storedWhenReturned = v;
    };
    const fetchImpl: FetchLike = async () =>
      jsonResponse(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 's' });

    await getAccessToken(store, SECRET, APP, fetchImpl, 'user-1', NOW + 3600_001);
    expect(storedWhenReturned).not.toBeNull();
  });

  it('refreshes inside the margin, before the token has actually expired', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    let refreshed = false;
    const fetchImpl: FetchLike = async () => {
      refreshed = true;
      return jsonResponse(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 's' });
    };
    // 30s before expiry: still valid, but inside REFRESH_MARGIN_MS.
    await getAccessToken(store, SECRET, APP, fetchImpl, 'user-1', NOW + 3600_000 - 30_000);
    expect(refreshed).toBe(true);
  });

  it('drops the grant and asks for re-consent when the refresh token is refused', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const fetchImpl: FetchLike = async () => jsonResponse(403, { error: 'invalid_grant' });

    const result = await getAccessToken(store, SECRET, APP, fetchImpl, 'user-1', NOW + 3600_001);
    expect(result).toMatchObject({ ok: false, reason: 'reauthorize_required' });
    // Dropped, so the next call says no_grant instead of retrying a dead token forever.
    expect(await loadGrant(store, SECRET, 'user-1')).toBeNull();
  });

  it('keeps the grant when the refresh merely failed transiently', async () => {
    // A 503 is not the user's problem to fix, and deleting here would turn an
    // Atlassian blip into a forced re-authorization for everyone.
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const fetchImpl: FetchLike = async () => jsonResponse(503, { error: 'service_unavailable' });

    const result = await getAccessToken(store, SECRET, APP, fetchImpl, 'user-1', NOW + 3600_001);
    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(await loadGrant(store, SECRET, 'user-1')).not.toBeNull();
  });

  it('treats a network error as transient, not as a dead grant', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'user-1', grant(), NOW);
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await getAccessToken(store, SECRET, APP, fetchImpl, 'user-1', NOW + 3600_001)).toMatchObject({
      ok: false,
      reason: 'refresh_failed',
    });
    expect(await loadGrant(store, SECRET, 'user-1')).not.toBeNull();
  });
});
