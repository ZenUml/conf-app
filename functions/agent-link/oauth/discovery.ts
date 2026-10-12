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

import { AS_METADATA_PATH, buildAuthServerMetadata, buildResourceMetadata, issuerFor } from './asMetadata';
import { PROTECTED_RESOURCE_METADATA_PATH } from './protectedResource';

const HEADERS = {
  'content-type': 'application/json',
  // Short, not immutable: the endpoints are stable, but a wrong document
  // cached for a day at every client is a bad trade for one request.
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
};

/**
 * The discovery response for `url`, or null if it is not a discovery request.
 *
 * Both documents are derived from the request's own origin, so the same code
 * serves zenapi.zenuml.com, conf-stg-lite.zenuml.com and localhost:8080
 * without configuration — and a client discovering us at one origin is never
 * handed another's endpoints.
 */
export function oauthDiscoveryResponse(url: string): Response | null {
  const { pathname } = new URL(url);
  const origin = issuerFor(url);

  if (pathname === PROTECTED_RESOURCE_METADATA_PATH) {
    return new Response(JSON.stringify(buildResourceMetadata(origin)), { headers: HEADERS });
  }
  if (pathname === AS_METADATA_PATH) {
    return new Response(JSON.stringify(buildAuthServerMetadata(origin)), { headers: HEADERS });
  }
  return null;
}
