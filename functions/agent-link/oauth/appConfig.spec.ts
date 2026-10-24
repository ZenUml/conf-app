import { describe, it, expect } from 'vitest';
import {
  OAUTH_CALLBACK_PATH,
  OAuthConfigError,
  OAuthRedirectHostMismatchError,
  loadAppConfig,
  loadGrantStore,
  redirectUriFor,
} from './appConfig';

const env = {
  ATLASSIAN_OAUTH_CLIENT_ID: 'f1Q7H7v2bf0ax9ThXvL8n3aewQENg6hp',
  ATLASSIAN_OAUTH_CLIENT_SECRET: 'not-a-real-secret',
  ATLASSIAN_OAUTH_REDIRECT_URI: 'https://zenapi.zenuml.com/agent-link/oauth/callback',
  OAUTH_GRANT_KV: new Map() as unknown as import('./tokenStore').GrantStore,
  OAUTH_GRANT_SECRET: 'not-a-real-key',
};

describe('redirectUriFor', () => {
  // These three are exactly what is registered on the developer-console app;
  // a fourth host would need registering there before it could work.
  it.each([
    ['https://zenapi.zenuml.com/agent-link/mcp', 'https://zenapi.zenuml.com/agent-link/oauth/callback'],
    ['https://conf-stg-lite.zenuml.com/agent-link/oauth/authorize?x=1', 'https://conf-stg-lite.zenuml.com/agent-link/oauth/callback'],
    ['http://localhost:8080/', 'http://localhost:8080/agent-link/oauth/callback'],
  ])('derives the registered callback for %s', (request, expected) => {
    expect(redirectUriFor(request)).toBe(expected);
  });

  it('ignores the path and query, so authorize and callback requests agree', () => {
    const a = redirectUriFor('https://zenapi.zenuml.com/agent-link/oauth/authorize?state=abc');
    const b = redirectUriFor(`https://zenapi.zenuml.com${OAUTH_CALLBACK_PATH}?code=xyz&state=abc`);
    expect(a).toBe(b);
  });
});

describe('loadAppConfig — the pinned redirect URI', () => {
  // Regression for the bug a real MCP client surfaced on 2026-09-26: with the
  // redirect URI derived from the request host, reaching the server on
  // 127.0.0.1 produced a 302 to Atlassian carrying an UNREGISTERED callback,
  // and the user learned about it on Atlassian's error page.
  it('uses the configured value, not the host the request arrived on', () => {
    const config = loadAppConfig(env);
    expect(config.redirectUri).toBe('https://zenapi.zenuml.com/agent-link/oauth/callback');
  });

  it('refuses a request whose host cannot produce the configured callback', () => {
    expect(() => loadAppConfig(env, 'http://127.0.0.1:8080/agent-link/oauth/authorize'))
      .toThrow(OAuthRedirectHostMismatchError);
  });

  it('names both origins and the fix in the refusal', () => {
    // The message is what a developer sees; it has to say what to change.
    try {
      loadAppConfig(env, 'http://127.0.0.1:8080/agent-link/oauth/authorize');
      throw new Error('should have refused');
    } catch (e) {
      const err = e as OAuthRedirectHostMismatchError;
      expect(err).toBeInstanceOf(OAuthRedirectHostMismatchError);
      expect(err.requestOrigin).toBe('http://127.0.0.1:8080');
      expect(err.configuredOrigin).toBe('https://zenapi.zenuml.com');
      expect(err.message).toContain('ATLASSIAN_OAUTH_REDIRECT_URI');
    }
  });

  it('accepts a matching host regardless of path or query', () => {
    for (const url of [
      'https://zenapi.zenuml.com/agent-link/oauth/authorize',
      'https://zenapi.zenuml.com/agent-link/oauth/callback?code=xyz&state=abc',
      'https://zenapi.zenuml.com/',
    ]) {
      expect(loadAppConfig(env, url).redirectUri).toBe('https://zenapi.zenuml.com/agent-link/oauth/callback');
    }
  });

  it('treats 127.0.0.1 and localhost as the different hosts Atlassian considers them', () => {
    // Atlassian matches byte-for-byte, so these are not interchangeable and the
    // guard must not "helpfully" normalize one into the other.
    const localEnv = { ...env, ATLASSIAN_OAUTH_REDIRECT_URI: 'http://localhost:8080/agent-link/oauth/callback' };
    expect(loadAppConfig(localEnv, 'http://localhost:8080/x').redirectUri)
      .toBe('http://localhost:8080/agent-link/oauth/callback');
    expect(() => loadAppConfig(localEnv, 'http://127.0.0.1:8080/x')).toThrow(OAuthRedirectHostMismatchError);
  });

  it('skips the guard when no request URL is given', () => {
    // The token exchange has a code to redeem and no inbound host worth checking.
    expect(() => loadAppConfig(env)).not.toThrow();
  });

  it('demands the var rather than falling back to derivation', () => {
    expect(() => loadAppConfig({ ...env, ATLASSIAN_OAUTH_REDIRECT_URI: undefined }, 'https://zenapi.zenuml.com/'))
      .toThrow(new OAuthConfigError('ATLASSIAN_OAUTH_REDIRECT_URI'));
    expect(() => loadAppConfig({ ...env, ATLASSIAN_OAUTH_REDIRECT_URI: '  ' }, 'https://zenapi.zenuml.com/'))
      .toThrow(new OAuthConfigError('ATLASSIAN_OAUTH_REDIRECT_URI'));
  });
});

describe('loadAppConfig', () => {
  it('assembles the client config with the request-derived redirect', () => {
    expect(loadAppConfig(env, 'https://zenapi.zenuml.com/x')).toEqual({
      clientId: 'f1Q7H7v2bf0ax9ThXvL8n3aewQENg6hp',
      clientSecret: 'not-a-real-secret',
      redirectUri: 'https://zenapi.zenuml.com/agent-link/oauth/callback',
    });
  });

  it('names the missing client id', () => {
    expect(() => loadAppConfig({ ...env, ATLASSIAN_OAUTH_CLIENT_ID: '' }, 'https://zenapi.zenuml.com/'))
      .toThrow(new OAuthConfigError('ATLASSIAN_OAUTH_CLIENT_ID'));
  });

  it('names the missing secret rather than sending an empty one to Atlassian', () => {
    expect(() => loadAppConfig({ ...env, ATLASSIAN_OAUTH_CLIENT_SECRET: undefined }, 'https://zenapi.zenuml.com/'))
      .toThrow(new OAuthConfigError('ATLASSIAN_OAUTH_CLIENT_SECRET'));
  });
});

describe('loadGrantStore', () => {
  it('returns the KV binding and key material together', () => {
    const { store, secret } = loadGrantStore(env);
    expect(store).toBe(env.OAUTH_GRANT_KV);
    expect(secret).toBe('not-a-real-key');
  });

  it.each(['OAUTH_GRANT_KV', 'OAUTH_GRANT_SECRET'] as const)('names a missing %s', (key) => {
    expect(() => loadGrantStore({ ...env, [key]: undefined })).toThrow(new OAuthConfigError(key));
  });
});
