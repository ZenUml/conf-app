// RFC 8414 Authorization Server Metadata — the document that tells an MCP
// client where our authorization server's endpoints are, and RFC 9728's
// companion resource document (built in protectedResource.ts).
//
// ADR 0008 Decision 2: we run the minimum authorization server the MCP spec
// forces. This file is the map of it. Every path here is served by a Pages
// Function of the same name under functions/agent-link/oauth/, except the two
// .well-known documents, which the root middleware serves because the Pages
// router ignores dot-directories (verified 2026-09-25: a probe function under
// functions/.well-known/ never received a request, the SPA did).
//
// Both documents are per-origin: the same code serves zenapi.zenuml.com,
// conf-stg-lite.zenuml.com and localhost:8080, and a client that discovered us
// at one origin must not be handed another's endpoints.

import { buildProtectedResourceMetadata, type ProtectedResourceMetadata } from './protectedResource';

/** RFC 8414 §3: the document lives at this path, relative to the issuer. */
export const AS_METADATA_PATH = '/.well-known/oauth-authorization-server';

/**
 * The path of the path-based issuer, `<origin>/agent-link` (#1038).
 *
 * The bare-origin issuer put the authorization server's RFC 8414 document at
 * the origin's root, where any MCP client probing the sign-in-free /mcp or
 * /mcp/render on the same origin found it and started an OAuth flow it
 * could not finish (Codex: "OAuth provider rejected discovered scopes"). With
 * the issuer at a path, RFC 8414 §3.1 puts its document at
 * /.well-known/oauth-authorization-server/agent-link, which only a client
 * told about this issuer (by agent-link's protected-resource document) reads.
 */
export const ISSUER_PATH = '/agent-link';

/** Where the path-based issuer's RFC 8414 document lives (§3.1: well-known prefix, then the issuer's path). */
export const AGENT_LINK_AS_METADATA_PATH = `${AS_METADATA_PATH}${ISSUER_PATH}`;

export const AUTHORIZE_PATH = '/agent-link/oauth/authorize';
export const TOKEN_PATH = '/agent-link/oauth/token';
export const REGISTER_PATH = '/agent-link/oauth/register';
export const CONSENT_PATH = '/agent-link/oauth/consent';

/**
 * The MCP endpoint, which is the protected resource.
 *
 * The headless path shares `/agent-link/mcp` with the live relay (design §11
 * Phase 5: "mode selection in the MCP endpoint"), so there is one resource
 * URI, one audience, and one thing a client has to configure.
 */
export const MCP_PATH = '/agent-link/mcp';

/**
 * Our scopes, not Atlassian's.
 *
 * The MCP client never sees `read:page:confluence` — it asks for what this
 * server offers, and this server decides what that costs upstream. Keeping the
 * vocabularies separate is what lets the Atlassian scope list change without
 * every registered client's stored grant becoming wrong.
 */
export const MCP_SCOPES = ['diagram.read', 'diagram.write'] as const;
export const DEFAULT_MCP_SCOPE = MCP_SCOPES.join(' ');

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  /** RFC 8707: we require `resource` on authorize and token, so we advertise it. */
  authorization_response_iss_parameter_supported: boolean;
  service_documentation?: string;
}

/** The request's origin: the base of every endpoint URL, and of the resource URI. */
export function originFor(requestUrl: string | URL): string {
  return new URL(requestUrl).origin;
}

/**
 * The issuer identifier (RFC 8414 §2: https, no query, no trailing slash).
 *
 * The bare origin until `pathIssuer` is on, then `<origin>/agent-link`. The
 * two must never be mixed within one flow: the `iss` an authorization
 * response carries (RFC 9207) has to equal the `issuer` of the document the
 * client discovered, so the switch moves the metadata documents and `iss`
 * together (`OAUTH_ROOT_AS_METADATA=off`, see discovery.ts).
 *
 * NOT the refresh ledger's namespace: that stays the bare origin
 * (originFor), so existing refresh tokens keep working across the switch.
 */
export function issuerFor(requestUrl: string | URL, pathIssuer = false): string {
  const origin = originFor(requestUrl);
  return pathIssuer ? `${origin}${ISSUER_PATH}` : origin;
}

/** Whether the path-based issuer is on: the same flag that retires the root RFC 8414 document. */
export function pathIssuerEnabled(env: { OAUTH_ROOT_AS_METADATA?: string } | undefined): boolean {
  return env?.OAUTH_ROOT_AS_METADATA === 'off';
}

export function resourceFor(requestUrl: string | URL): string {
  return `${originFor(requestUrl)}${MCP_PATH}`;
}

/**
 * RFC 8414 metadata for `issuer`. The endpoints stay at their URLs on
 * `origin` whichever issuer is in use: they are absolute, and a client
 * reads them from this document rather than deriving them from the issuer.
 */
export function buildAuthServerMetadata(origin: string, issuer: string = origin): AuthServerMetadata {
  return {
    issuer,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // S256 only. `plain` is in the RFC and is worthless against the attack
    // PKCE exists for, and OAuth 2.1 drops it; advertising it would invite a
    // client to use it.
    code_challenge_methods_supported: ['S256'],
    // Public clients only (ADR 0008: "no client secrets"). A dynamically
    // registered CLI agent cannot keep one, so pretending otherwise would buy
    // nothing but a secret in a config file.
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
}

export function buildResourceMetadata(origin: string, issuer: string = origin): ProtectedResourceMetadata {
  return buildProtectedResourceMetadata({
    resource: `${origin}${MCP_PATH}`,
    // We are our own authorization server (ADR 0008 Decision 1), so the issuer
    // here is on this same origin — never auth.atlassian.com, which would be
    // the token passthrough the MCP spec forbids.
    authorizationServers: [issuer],
    scopesSupported: [...MCP_SCOPES],
  });
}
