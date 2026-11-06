// The two OAuth discovery documents, served from the root middleware.
//
// RFC 9728 (protected resource) and RFC 8414 (authorization server) are what
// an MCP client reads, in that order, after a 401 from the MCP endpoint: the
// first names the authorization server, the second names its endpoints. Both
// are public and unauthenticated — a client that cannot read them has no way
// to begin.
//
// They live in the middleware because the Pages router ignores dot-directories
// (functions/.well-known/* is never routed). Keeping the actual construction
// here rather than inline there keeps the middleware readable and lets this be
// unit-tested.
//
// ONE ORIGIN, TWO MCP SERVERS (#1038). /agent-link/mcp needs a sign-in;
// /mcp/render does not. RFC 9728 §3.1 puts a resource's metadata at the
// well-known prefix plus the resource's path, and MCP clients that probe
// before connecting look there first, then at the bare prefix. So:
//
//   /.well-known/oauth-protected-resource/agent-link/mcp  → the agent-link document
//   /.well-known/oauth-protected-resource/<anything else> → JSON 404, never the SPA
//   /.well-known/oauth-protected-resource                 → the agent-link document,
//                                                           unless rootResourceMetadata
//                                                           is 'off' (then JSON 404)
//
// The root document is what still sends a client probing /mcp/render into an
// OAuth flow it cannot finish: after the path-specific 404 it falls back to
// the root and reads "sign-in required". It also breaks RFC 9728 §3.3, which
// wants the document at the bare prefix to describe the origin itself. But
// clients that ignore the 401's resource_metadata and read only the root may
// still depend on it, so turning it off is a separate, flagged step
// (OAUTH_ROOT_RESOURCE_METADATA=off) to be tested on staging first.
//
// The authorization server's issuer is the bare origin, so its RFC 8414
// document correctly lives at the root. Path-suffixed requests under that
// prefix get the same JSON 404.

import { AS_METADATA_PATH, MCP_PATH, buildAuthServerMetadata, buildResourceMetadata, issuerFor } from './asMetadata';
import { PROTECTED_RESOURCE_METADATA_PATH } from './protectedResource';
import { json } from '../../OkResponse';

const HEADERS = {
  'content-type': 'application/json',
  // Short, not immutable: the endpoints are stable, but a wrong document
  // cached for a day at every client is a bad trade for one request.
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
};

/** Where the agent-link resource's own metadata document lives (RFC 9728 §3.1). */
export const AGENT_LINK_RESOURCE_METADATA_PATH = `${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;

export interface DiscoveryOptions {
  /**
   * Whether the bare `/.well-known/oauth-protected-resource` still serves the
   * agent-link document. Anything but `'off'` (including unset) keeps it.
   * Comes from the `OAUTH_ROOT_RESOURCE_METADATA` environment variable.
   */
  rootResourceMetadata?: string;
}

function notFound(): Response {
  return json(
    { error: 'not_found', error_description: 'No OAuth metadata at this path.' },
    { status: 404, headers: HEADERS },
  );
}

/**
 * The discovery response for `url`, or null if it is not a discovery request.
 *
 * Both documents are derived from the request's own origin, so the same code
 * serves zenapi.zenuml.com, conf-stg-lite.zenuml.com and localhost:8080
 * without configuration — and a client discovering us at one origin is never
 * handed another's endpoints.
 */
export function oauthDiscoveryResponse(url: string, opts: DiscoveryOptions = {}): Response | null {
  const { pathname } = new URL(url);
  const origin = issuerFor(url);

  if (pathname === AGENT_LINK_RESOURCE_METADATA_PATH) {
    return json(buildResourceMetadata(origin), { headers: HEADERS });
  }
  if (pathname === PROTECTED_RESOURCE_METADATA_PATH) {
    if (opts.rootResourceMetadata === 'off') return notFound();
    return json(buildResourceMetadata(origin), { headers: HEADERS });
  }
  if (pathname === AS_METADATA_PATH) {
    return json(buildAuthServerMetadata(origin), { headers: HEADERS });
  }
  if (
    pathname.startsWith(`${PROTECTED_RESOURCE_METADATA_PATH}/`) ||
    pathname.startsWith(`${AS_METADATA_PATH}/`)
  ) {
    return notFound();
  }
  return null;
}
