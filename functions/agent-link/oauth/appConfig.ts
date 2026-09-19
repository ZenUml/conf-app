// Where the Atlassian 3LO app's identity comes from at runtime.
//
// The app is registered in the Atlassian developer console (app id
// a7f2a21d-a28c-4155-af0f-df365b5b94ef, "ZenUML Agent Link", registered
// 2026-09-19) with the four REQUIRED_SCOPES and one callback per host it is
// served from. Everything the console holds that the code needs is read here,
// from Pages bindings, so no other module has to know which env var is which:
//
//   ATLASSIAN_OAUTH_CLIENT_ID      [vars]  — public; safe in wrangler-*.toml
//   ATLASSIAN_OAUTH_CLIENT_SECRET  secret  — `wrangler pages secret put`
//   OAUTH_GRANT_KV                 KV      — the encrypted grant store
//   OAUTH_GRANT_SECRET             secret  — AES key material for that store
//
// The redirect URI is derived from the request origin rather than configured,
// because the same code serves zenapi.zenuml.com, conf-stg-lite.zenuml.com and
// localhost:8080 and Atlassian rejects a redirect_uri that is not byte-for-byte
// one of the registered callbacks (atlassianClient.ts). Deriving it means a
// host is either registered in the console or fails at authorize time, never
// silently at exchange time with a mismatched value.

import type { AtlassianAppConfig } from './atlassianClient';
import type { GrantStore } from './tokenStore';

/** The path the registered callbacks share; the host is the request's. */
export const OAUTH_CALLBACK_PATH = '/agent-link/oauth/callback';

export interface OAuthEnv {
  ATLASSIAN_OAUTH_CLIENT_ID?: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET?: string;
  OAUTH_GRANT_KV?: GrantStore;
  OAUTH_GRANT_SECRET?: string;
}

export class OAuthConfigError extends Error {
  constructor(public readonly missing: string) {
    super(`agent-link OAuth is not configured: ${missing} is unset`);
    this.name = 'OAuthConfigError';
  }
}

/**
 * Build the callback URI for the host this request arrived on.
 *
 * Only the origin is used — path and query are dropped — so a callback
 * request and an authorize request from the same host produce the same value,
 * which is what the token exchange requires.
 */
export function redirectUriFor(requestUrl: string | URL): string {
  const origin = new URL(requestUrl).origin;
  return `${origin}${OAUTH_CALLBACK_PATH}`;
}

/** Throws OAuthConfigError naming the first missing binding, so a half-configured environment fails loudly. */
export function loadAppConfig(env: OAuthEnv, requestUrl: string | URL): AtlassianAppConfig {
  const clientId = env.ATLASSIAN_OAUTH_CLIENT_ID?.trim();
  if (!clientId) throw new OAuthConfigError('ATLASSIAN_OAUTH_CLIENT_ID');
  const clientSecret = env.ATLASSIAN_OAUTH_CLIENT_SECRET;
  if (!clientSecret) throw new OAuthConfigError('ATLASSIAN_OAUTH_CLIENT_SECRET');
  return { clientId, clientSecret, redirectUri: redirectUriFor(requestUrl) };
}

export interface GrantStoreConfig {
  store: GrantStore;
  secret: string;
}

export function loadGrantStore(env: OAuthEnv): GrantStoreConfig {
  if (!env.OAUTH_GRANT_KV) throw new OAuthConfigError('OAUTH_GRANT_KV');
  if (!env.OAUTH_GRANT_SECRET) throw new OAuthConfigError('OAUTH_GRANT_SECRET');
  return { store: env.OAUTH_GRANT_KV, secret: env.OAUTH_GRANT_SECRET };
}
