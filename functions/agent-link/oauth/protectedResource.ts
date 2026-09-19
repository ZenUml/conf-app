// RFC 9728 Protected Resource Metadata, and the 401 challenge that points at
// it — the two things the MCP spec says a protected MCP server MUST implement.
//
// From the MCP authorization spec (2025-06-18):
//   "MCP servers MUST implement OAuth 2.0 Protected Resource Metadata
//    (RFC9728) ... The Protected Resource Metadata document returned by the
//    MCP server MUST include the `authorization_servers` field containing at
//    least one authorization server."
//   "MCP servers MUST use the HTTP header `WWW-Authenticate` when returning a
//    401 Unauthorized to indicate the location of the resource server metadata
//    URL."
//
// WHAT THIS IS NOT. The MCP server is a RESOURCE server; it does not issue
// tokens. `authorization_servers` names whoever does. Critically it cannot
// simply name Atlassian: the same spec forbids accepting a token that was not
// issued for us ("MCP servers MUST only accept tokens specifically intended
// for themselves") and forbids forwarding it onward ("The MCP server MUST NOT
// pass through the token it received from the MCP client"). So the value here
// is OUR authorization server, and the Atlassian grant that atlassianClient.ts
// manages is a separate credential this server holds as an OAuth client.
// See the design doc §5 and the Phase 3 note about which AS we run.

/** Where the metadata document lives, per RFC 9728. */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

export interface ProtectedResourceConfig {
  /**
   * The canonical URI of this MCP server, which is also the `resource` value
   * clients must send (RFC 8707). The MCP spec is explicit that this has a
   * scheme, no fragment, and SHOULD have no trailing slash — e.g.
   * `https://zenapi.zenuml.com/agent-link/mcp`.
   */
  resource: string;
  /** Issuer URL(s) of the authorization server(s) that mint tokens for `resource`. */
  authorizationServers: string[];
  /** Advertised scopes. Ours, not Atlassian's — the upstream grant is invisible to the client. */
  scopesSupported?: string[];
  documentationUrl?: string;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported?: string[];
  resource_documentation?: string;
}

/**
 * Normalize a canonical resource URI.
 *
 * Lowercases scheme and host (which the spec says are canonically lowercase
 * but that servers SHOULD accept in any case "for robustness"), strips any
 * fragment (invalid in a canonical URI), and drops a bare trailing slash so
 * `https://host/` and `https://host` do not read as two different resources to
 * an audience check.
 */
export function canonicalizeResource(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  url.username = '';
  url.password = '';
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}${path}${url.search}`;
}

export function buildProtectedResourceMetadata(
  config: ProtectedResourceConfig,
): ProtectedResourceMetadata {
  const doc: ProtectedResourceMetadata = {
    resource: canonicalizeResource(config.resource),
    authorization_servers: config.authorizationServers,
    // RFC 6750 allows three; the MCP spec permits only the header
    // ("Access tokens MUST NOT be included in the URI query string"), so this
    // advertises exactly one.
    bearer_methods_supported: ['header'],
  };
  if (config.scopesSupported?.length) doc.scopes_supported = config.scopesSupported;
  if (config.documentationUrl) doc.resource_documentation = config.documentationUrl;
  return doc;
}

/**
 * The `WWW-Authenticate` value for a 401, per RFC 9728 §5.1.
 *
 * `resource_metadata` is the load-bearing parameter: it is how a client that
 * has never seen this server finds its way to the metadata document and from
 * there to the authorization server. Without it the client has a 401 and
 * nowhere to go.
 */
export function buildWwwAuthenticate(
  metadataUrl: string,
  opts: { error?: string; errorDescription?: string } = {},
): string {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`];
  if (opts.error) parts.push(`error="${opts.error}"`);
  if (opts.errorDescription) {
    // Keep the description free of the quote/backslash characters that would
    // break the header's quoted-string grammar.
    parts.push(`error_description="${opts.errorDescription.replace(/["\\]/g, '')}"`);
  }
  return parts.join(', ');
}

/** `<origin>/.well-known/oauth-protected-resource` for a given server origin. */
export function metadataUrlFor(origin: string): string {
  return new URL(PROTECTED_RESOURCE_METADATA_PATH, origin).toString();
}

/**
 * Does this token's audience name us?
 *
 * The MCP spec requires the check in both directions — accept only tokens
 * "issued specifically for them as the intended audience", reject everything
 * else with a 401 — because a server that skips it will happily accept a token
 * minted for some other service and, worse, may forward it.
 *
 * `aud` may be a string or an array; both are valid in RFC 9068.
 */
export function audienceMatches(aud: unknown, resource: string): boolean {
  const expected = canonicalizeResource(resource);
  const values = Array.isArray(aud) ? aud : [aud];
  return values.some((value) => {
    if (typeof value !== 'string') return false;
    try {
      return canonicalizeResource(value) === expected;
    } catch {
      return false;
    }
  });
}
