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
//   ATLASSIAN_OAUTH_REDIRECT_URI   [vars]  — public; must be byte-for-byte one
//                                             of the console's callbacks
//
// THE REDIRECT URI IS PINNED, NOT DERIVED. It used to be built from the request
// origin, on the reasoning that an unregistered host would then "fail at
// authorize time". Driving the flow with a real MCP client on 2026-09-26
// disproved that: reached on 127.0.0.1:8080 the authorize endpoint returned a
// perfectly happy 302 to Atlassian carrying
// redirect_uri=http://127.0.0.1:8080/agent-link/oauth/callback, which is NOT a
// registered callback (localhost:8080 is). The rejection then happens on
// Atlassian's error page, after the user has left our app, with nothing in our
// logs to explain it — the exact silent failure deriving was supposed to avoid.
//
// Two reasons to pin instead. Atlassian requires an exact match against a small,
// known, per-environment set, which is the definition of configuration; and the
// request's host comes from a header we do not control, so deriving let an
// inbound Host decide what we send Atlassian (unexploitable only because
// Atlassian rejects unregistered values, which is not a property to rely on).
//
// `requestUrl` is still passed in, now as a guard: when the host a request
// arrived on cannot produce the configured callback, we refuse here with a
// message naming both, instead of bouncing the user to a dead end.

import type { AtlassianAppConfig } from './atlassianClient';
import type { GrantStore } from './tokenStore';

/** The path every registered callback shares. Fixed by the console registration. */
export const OAUTH_CALLBACK_PATH = '/agent-link/oauth/callback';

export interface OAuthEnv {
  ATLASSIAN_OAUTH_CLIENT_ID?: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET?: string;
  /** Exactly one of the console's registered callbacks, for THIS environment. */
  ATLASSIAN_OAUTH_REDIRECT_URI?: string;
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
 * This request arrived on a host that cannot use the configured callback.
 *
 * Separate from OAuthConfigError because nothing is missing — the environment
 * is configured, and this particular request simply came in somewhere the
 * console does not know about (`127.0.0.1` where `localhost` is registered, a
 * preview deployment URL, a proxy rewriting Host). Sending it onward would
 * strand the user on Atlassian's error page, so it stops here.
 */
export class OAuthRedirectHostMismatchError extends Error {
  constructor(
    public readonly requestOrigin: string,
    public readonly configuredOrigin: string,
  ) {
    super(
      `agent-link OAuth: this request arrived on ${requestOrigin}, but the configured ` +
        `callback is on ${configuredOrigin}. Reach the server on ${configuredOrigin}, or ` +
        `register ${requestOrigin}${OAUTH_CALLBACK_PATH} and point ` +
        `ATLASSIAN_OAUTH_REDIRECT_URI at it.`,
    );
    this.name = 'OAuthRedirectHostMismatchError';
  }
}

/**
 * The callback URI the host of `requestUrl` would imply.
 *
 * No longer the source of truth — see the header. Kept because the mismatch
 * guard needs it to say what this host WOULD have produced, which is the
 * sentence that tells a developer what to fix.
 */
export function redirectUriFor(requestUrl: string | URL): string {
  const origin = new URL(requestUrl).origin;
  return `${origin}${OAUTH_CALLBACK_PATH}`;
}

/**
 * Throws OAuthConfigError naming the first missing binding, so a
 * half-configured environment fails loudly; throws
 * OAuthRedirectHostMismatchError when this request's host cannot use the
 * configured callback.
 *
 * `requestUrl` is optional so the token exchange — which has no inbound host
 * worth checking, only a code to redeem — can ask for the config without
 * re-running the guard.
 */
export function loadAppConfig(env: OAuthEnv, requestUrl?: string | URL): AtlassianAppConfig {
  const clientId = env.ATLASSIAN_OAUTH_CLIENT_ID?.trim();
  if (!clientId) throw new OAuthConfigError('ATLASSIAN_OAUTH_CLIENT_ID');
  const clientSecret = env.ATLASSIAN_OAUTH_CLIENT_SECRET;
  if (!clientSecret) throw new OAuthConfigError('ATLASSIAN_OAUTH_CLIENT_SECRET');

  const redirectUri = env.ATLASSIAN_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) throw new OAuthConfigError('ATLASSIAN_OAUTH_REDIRECT_URI');

  if (requestUrl !== undefined) {
    const configuredOrigin = new URL(redirectUri).origin;
    const requestOrigin = new URL(requestUrl).origin;
    if (requestOrigin !== configuredOrigin) {
      throw new OAuthRedirectHostMismatchError(requestOrigin, configuredOrigin);
    }
  }

  return { clientId, clientSecret, redirectUri };
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
