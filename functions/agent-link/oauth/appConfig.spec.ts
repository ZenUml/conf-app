import { describe, it, expect } from 'vitest';
import {
  OAUTH_CALLBACK_PATH,
  OAuthConfigError,
  loadAppConfig,
  loadGrantStore,
  redirectUriFor,
} from './appConfig';

const env = {
  ATLASSIAN_OAUTH_CLIENT_ID: 'f1Q7H7v2bf0ax9ThXvL8n3aewQENg6hp',
  ATLASSIAN_OAUTH_CLIENT_SECRET: 'not-a-real-secret',
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
