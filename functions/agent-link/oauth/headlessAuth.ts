// Bearer-token authentication for the headless mode of the MCP endpoint, and
// the RFC 9728 challenge that a failure has to carry.
//
// The MCP spec is specific about both halves:
//
//   "MCP servers MUST only accept tokens specifically intended for themselves"
//   "MCP servers MUST use the HTTP header WWW-Authenticate when returning a
//    401 Unauthorized to indicate the location of the resource server metadata
//    URL."
//
// So a token is accepted only if we issued it (it is in our store) AND its
// recorded audience is this server's resource URI. The second check is not
// redundant: a token minted for a different ZenUML origin — staging's, say —
// is one of ours and still must not work here, because the client asked for a
// token for somewhere else.
//
// The challenge matters as much as the rejection. Without `resource_metadata`
// a client that has never seen this server has a 401 and no way to discover
// how to authenticate; with it, the first unauthenticated call bootstraps the
// whole flow.

import { loadAccessToken, type GrantStoreLike, type McpTokenRecord } from './asStore';
import { resourceFor } from './asMetadata';
import { audienceMatches, buildWwwAuthenticate, metadataUrlFor } from './protectedResource';

export type HeadlessAuthFailure = 'missing' | 'invalid' | 'expired' | 'wrong_audience';

export type HeadlessAuthResult =
  | { ok: true; token: McpTokenRecord }
  | { ok: false; reason: HeadlessAuthFailure };

/** The bearer token, if the request carries one. Header only — the MCP spec forbids the query string. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Is this one of our MCP tokens, issued for this resource?
 *
 * 'expired' is not distinguished from 'invalid' on purpose: our tokens are
 * opaque handles and an expired one is deleted by KV, so the two are the same
 * observation. The distinction exists in the type because the relay path makes
 * it and the endpoint reports both the same way.
 */
export async function authenticateHeadless(
  request: Request,
  store: GrantStoreLike,
  nowMs: number = Date.now(),
): Promise<HeadlessAuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, reason: 'missing' };

  const record = await loadAccessToken(store, token, nowMs);
  if (!record) return { ok: false, reason: 'invalid' };

  if (!audienceMatches(record.resource, resourceFor(request.url))) {
    return { ok: false, reason: 'wrong_audience' };
  }
  return { ok: true, token: record };
}

/**
 * The `WWW-Authenticate` header for a 401 from the MCP endpoint.
 *
 * `error` follows RFC 6750: `invalid_token` for a token we rejected, and no
 * error at all when none was presented — "you need a token" is not an error
 * about a token.
 */
export function challengeFor(requestUrl: string, reason: HeadlessAuthFailure): string {
  const metadataUrl = metadataUrlFor(new URL(requestUrl).origin);
  if (reason === 'missing') return buildWwwAuthenticate(metadataUrl);
  return buildWwwAuthenticate(metadataUrl, {
    error: 'invalid_token',
    errorDescription:
      reason === 'wrong_audience'
        ? 'the token was issued for a different resource'
        : 'the token is unknown or has expired',
  });
}

/** Does this grant carry the scope a tool needs? */
export function hasScope(record: McpTokenRecord, required: string): boolean {
  return record.scope.split(/\s+/).filter(Boolean).includes(required);
}
