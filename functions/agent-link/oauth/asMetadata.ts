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

/** The issuer is the bare origin — no path, no trailing slash (RFC 8414 §2). */
export function issuerFor(requestUrl: string | URL): string {
  return new URL(requestUrl).origin;
}

export function resourceFor(requestUrl: string | URL): string {
  return `${issuerFor(requestUrl)}${MCP_PATH}`;
}

export function buildAuthServerMetadata(origin: string): AuthServerMetadata {
  return {
    issuer: origin,
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

export function buildResourceMetadata(origin: string): ProtectedResourceMetadata {
  return buildProtectedResourceMetadata({
    resource: `${origin}${MCP_PATH}`,
    // We are our own authorization server (ADR 0008 Decision 1), so the issuer
    // here is this same origin — never auth.atlassian.com, which would be the
    // token passthrough the MCP spec forbids.
    authorizationServers: [origin],
    scopesSupported: [...MCP_SCOPES],
  });
}
