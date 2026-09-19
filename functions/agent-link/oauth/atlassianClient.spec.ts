import { describe, it, expect } from 'vitest';
import {
  REQUIRED_SCOPES,
  REFRESH_MARGIN_MS,
  buildAuthorizeUrl,
  exchangeCode,
  refreshGrant,
  isAccessTokenUsable,
  listAccessibleSites,
  apiBaseUrlFor,
  type AtlassianAppConfig,
  type FetchLike,
} from './atlassianClient';

const APP: AtlassianAppConfig = {
  clientId: 'client-123',
  clientSecret: 'secret-abc',
  redirectUri: 'https://zenapi.zenuml.com/agent-link/oauth/callback',
};

const NOW = 1_800_000_000_000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Records what was sent so the tests can assert on the wire, not just the result. */
function recordingFetch(reply: (url: string) => Response): {
  fetch: FetchLike;
  sent: Array<{ url: string; body: any; headers: any }>;
} {
  const sent: Array<{ url: string; body: any; headers: any }> = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers,
    });
    return reply(url);
  };
  return { fetch, sent };
}

describe('buildAuthorizeUrl', () => {
  it('sends every parameter Atlassian requires', () => {
    const url = new URL(buildAuthorizeUrl(APP, 'state-xyz'));
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('client_id')).toBe(APP.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(APP.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('asks for offline_access, without which the grant dies with the browser', () => {
    const url = new URL(buildAuthorizeUrl(APP, 's'));
    const scopes = (url.searchParams.get('scope') ?? '').split(' ');
    expect(scopes).toContain('offline_access');
    for (const needed of [
      'read:page:confluence',
      'write:page:confluence',
      'read:custom-content:confluence',
      'write:custom-content:confluence',
    ]) {
      expect(scopes).toContain(needed);
    }
  });

  it('never leaks the client secret into the browser-bound URL', () => {
    expect(buildAuthorizeUrl(APP, 's')).not.toContain(APP.clientSecret);
  });

  it('accepts a narrowed scope set', () => {
    const url = new URL(buildAuthorizeUrl(APP, 's', ['read:page:confluence']));
    expect(url.searchParams.get('scope')).toBe('read:page:confluence');
  });

  it('exposes the default scopes as a stable list', () => {
    expect(REQUIRED_SCOPES).toContain('offline_access');
  });
});

describe('exchangeCode', () => {
  it('posts the authorization_code grant and returns an absolute expiry', async () => {
    const { fetch, sent } = recordingFetch(() =>
      jsonResponse(200, {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'read:page:confluence offline_access',
      }),
    );
    const result = await exchangeCode(fetch, APP, 'code-1', NOW);

    expect(sent[0].url).toBe('https://auth.atlassian.com/oauth/token');
    expect(sent[0].body).toEqual({
      grant_type: 'authorization_code',
      client_id: APP.clientId,
      client_secret: APP.clientSecret,
      code: 'code-1',
      redirect_uri: APP.redirectUri,
    });
    expect(result).toEqual({
      ok: true,
      grant: {
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        accessTokenExpiresAtMs: NOW + 3600 * 1000,
        scope: 'read:page:confluence offline_access',
      },
    });
  });

  it('refuses a 200 that carries no refresh token', async () => {
    // The shape you get when offline_access was not granted. Storing the
    // access token alone yields a grant that is dead within the hour.
    const { fetch } = recordingFetch(() =>
      jsonResponse(200, { access_token: 'at-1', expires_in: 3600 }),
    );
    const result = await exchangeCode(fetch, APP, 'code-1', NOW);
    expect(result).toMatchObject({ ok: false, failure: 'bad_response' });
    expect(result.ok === false && result.detail).toMatch(/offline_access/);
  });

  it('distinguishes invalid_grant from every other failure', async () => {
    // Only invalid_grant is terminal for the user; treating a 503 as "log in
    // again" would be a bad day for everyone.
    const { fetch } = recordingFetch(() =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'code expired' }),
    );
    expect(await exchangeCode(fetch, APP, 'stale', NOW)).toMatchObject({
      ok: false,
      failure: 'invalid_grant',
      status: 400,
      detail: 'code expired',
    });
  });

  it('maps invalid_client separately, because that is our bug not theirs', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(401, { error: 'invalid_client' }));
    expect(await exchangeCode(fetch, APP, 'c', NOW)).toMatchObject({ ok: false, failure: 'invalid_client' });
  });

  it('reports a 5xx as retryable http_error, not as a dead grant', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(503, { error: 'service_unavailable' }));
    expect(await exchangeCode(fetch, APP, 'c', NOW)).toMatchObject({ ok: false, failure: 'http_error', status: 503 });
  });

  it('survives a non-JSON body', async () => {
    const fetch: FetchLike = async () => new Response('<html>502</html>', { status: 502 });
    expect(await exchangeCode(fetch, APP, 'c', NOW)).toMatchObject({ ok: false, failure: 'bad_response' });
  });

  it('reports a thrown fetch as network rather than letting it escape', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    expect(await exchangeCode(fetch, APP, 'c', NOW)).toMatchObject({ ok: false, failure: 'network' });
  });
});

describe('refreshGrant', () => {
  it('posts the refresh_token grant', async () => {
    const { fetch, sent } = recordingFetch(() =>
      jsonResponse(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 's' }),
    );
    await refreshGrant(fetch, APP, 'rt-1', NOW);
    expect(sent[0].body).toEqual({
      grant_type: 'refresh_token',
      client_id: APP.clientId,
      client_secret: APP.clientSecret,
      refresh_token: 'rt-1',
    });
  });

  it('returns the ROTATED refresh token, which the caller must persist', async () => {
    // Atlassian rotates on every use: the token passed in is already spent, so
    // dropping the new one on the floor kills the grant.
    const { fetch } = recordingFetch(() =>
      jsonResponse(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 's' }),
    );
    const result = await refreshGrant(fetch, APP, 'rt-1', NOW);
    expect(result.ok && result.grant.refreshToken).toBe('rt-2');
    expect(result.ok && result.grant.refreshToken).not.toBe('rt-1');
  });

  it('reports a refused refresh token as invalid_grant — the re-consent signal', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(403, { error: 'invalid_grant' }));
    expect(await refreshGrant(fetch, APP, 'expired', NOW)).toMatchObject({
      ok: false,
      failure: 'invalid_grant',
    });
  });
});

describe('isAccessTokenUsable', () => {
  const grant = {
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresAtMs: NOW + 10 * 60_000,
    scope: '',
  };

  it('is true well before expiry', () => {
    expect(isAccessTokenUsable(grant, NOW)).toBe(true);
  });

  it('is false once inside the refresh margin, before the token actually expires', () => {
    // A token that passes the check and then expires mid-flight returns a 401
    // indistinguishable from a permissions problem.
    const justInside = grant.accessTokenExpiresAtMs - REFRESH_MARGIN_MS + 1;
    expect(isAccessTokenUsable(grant, justInside)).toBe(false);
    const justOutside = grant.accessTokenExpiresAtMs - REFRESH_MARGIN_MS - 1;
    expect(isAccessTokenUsable(grant, justOutside)).toBe(true);
  });

  it('is false after expiry', () => {
    expect(isAccessTokenUsable(grant, grant.accessTokenExpiresAtMs + 1)).toBe(false);
  });
});

describe('listAccessibleSites', () => {
  it('returns the sites the grant reaches', async () => {
    const fetch: FetchLike = async () =>
      jsonResponse(200, [
        { id: 'cloud-1', name: 'Example', url: 'https://example.atlassian.net', scopes: ['read:page:confluence'] },
        { id: 'cloud-2', name: 'Other', url: 'https://other.atlassian.net', scopes: [] },
      ]);
    const result = await listAccessibleSites(fetch, 'at-1');
    expect(result.ok && result.sites.map((s) => s.cloudId)).toEqual(['cloud-1', 'cloud-2']);
  });

  it('sends the access token as a bearer', async () => {
    let seen: any;
    const fetch: FetchLike = async (_url, init) => {
      seen = init?.headers;
      return jsonResponse(200, []);
    };
    await listAccessibleSites(fetch, 'at-1');
    expect(seen.Authorization).toBe('Bearer at-1');
  });

  it('skips rows with no cloudId rather than inventing one', async () => {
    const fetch: FetchLike = async () => jsonResponse(200, [{ name: 'no id' }, { id: 'cloud-1' }]);
    const result = await listAccessibleSites(fetch, 'at-1');
    expect(result.ok && result.sites).toEqual([
      { cloudId: 'cloud-1', name: '', url: '', scopes: [] },
    ]);
  });

  it('reports a non-array or non-JSON body as a failure', async () => {
    const notArray: FetchLike = async () => jsonResponse(200, { results: [] });
    expect(await listAccessibleSites(notArray, 'at')).toMatchObject({ ok: false });
    const notJson: FetchLike = async () => new Response('nope', { status: 200 });
    expect(await listAccessibleSites(notJson, 'at')).toMatchObject({ ok: false });
  });

  it('reports a 403 with its status', async () => {
    const fetch: FetchLike = async () => jsonResponse(403, {});
    expect(await listAccessibleSites(fetch, 'at')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('apiBaseUrlFor', () => {
  it('routes through the api.atlassian.com gateway, not the tenant host', async () => {
    // A 3LO token is not accepted at <tenant>.atlassian.net; it is presented to
    // the gateway with the cloudId in the path.
    expect(apiBaseUrlFor('cloud-1')).toBe('https://api.atlassian.com/ex/confluence/cloud-1');
  });
});
