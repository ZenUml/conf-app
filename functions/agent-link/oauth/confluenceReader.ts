// The seam between the OAuth grant and Phase 1's identity resolver.
//
// `resolveMacroIdentity` takes a `ConfluenceGet` — a path in, a
// {status, body} out — precisely so it could be written and live-verified
// before any OAuth existed (design §11 Phase 1). This is the production
// implementation of that interface: same resolver, different credential.
//
// Two things it does that a bare fetch would not:
//   - Routes through the api.atlassian.com gateway with the cloudId in the
//     path, because a 3LO token is not accepted at <tenant>.atlassian.net.
//   - Refreshes and re-persists the grant on demand, so a long-running agent
//     session does not start failing an hour in.

import { apiBaseUrlFor, type AtlassianAppConfig, type FetchLike } from './atlassianClient';
import { getAccessToken, type GrantStore } from './tokenStore';
import type { ConfluenceGet } from '../macroIdentity';

export interface ReaderContext {
  store: GrantStore;
  secret: string;
  app: AtlassianAppConfig;
  fetchImpl: FetchLike;
  userId: string;
  cloudId: string;
}

/**
 * Status codes used when the failure happened before any request went out.
 *
 * 401 for "no grant / must re-authorize" and 503 for "could not refresh right
 * now" are chosen so callers can treat them exactly as they would the same
 * codes from Confluence itself. The resolver already distinguishes a 404
 * ("not this variant") from other non-2xx ("probe_failed"), and both of these
 * land correctly in the second bucket.
 */
const NO_CREDENTIAL_STATUS = 401;
const REFRESH_FAILED_STATUS = 503;

/**
 * A `ConfluenceGet` bound to one user's grant and one site.
 *
 * Paths are passed through as given (`/wiki/api/v2/...`), so the resolver's
 * URLs need no rewriting — only the base changes.
 */
export function confluenceReaderFor(ctx: ReaderContext): ConfluenceGet {
  const base = apiBaseUrlFor(ctx.cloudId);

  return async (path: string) => {
    const token = await getAccessToken(
      ctx.store,
      ctx.secret,
      ctx.app,
      ctx.fetchImpl,
      ctx.userId,
    );
    if (!token.ok) {
      return {
        status: token.reason === 'refresh_failed' ? REFRESH_FAILED_STATUS : NO_CREDENTIAL_STATUS,
        body: { error: token.reason, detail: token.detail },
      };
    }

    let res: Response;
    try {
      res = await ctx.fetchImpl(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
      });
    } catch (e) {
      // A thrown fetch must look like a failed probe, not an empty site —
      // the same distinction macroIdentity.ts draws between 'probe_failed'
      // and 'no_macro_on_site'.
      return {
        status: REFRESH_FAILED_STATUS,
        body: { error: 'network', detail: e instanceof Error ? e.message : String(e) },
      };
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON is normal for some error pages; the status still carries the
      // information the resolver branches on.
    }
    return { status: res.status, body };
  };
}
