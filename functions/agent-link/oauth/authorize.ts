// GET /agent-link/oauth/authorize — the authorization endpoint of OUR
// authorization server (ADR 0008), and the entry point of the headless flow.
//
// It has two callers, and both are legitimate:
//
//   - An MCP client, with client_id/redirect_uri/PKCE. The request is
//     validated and parked, and the browser goes to Atlassian; the parked id
//     rides along as the Atlassian `state`, so callback.ts can pick it up.
//   - A person, with no parameters at all — the "just connect my account"
//     path this branch shipped first. No client, no code, no consent screen:
//     it seals an Atlassian grant and says so. Keeping it costs one branch and
//     it is what makes the credential layer testable on its own.

import { handleAuthorize } from './atlassianLeg';
import { validateAuthorize } from './authServer';
import { loadGrantStore, type OAuthEnv } from './appConfig';

export const onRequestGet: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  const url = new URL(request.url);

  // No client_id means nobody is delegating to an agent; this is the bare
  // Atlassian connect flow.
  if (!url.searchParams.get('client_id')) {
    return handleAuthorize(request, { env, fetchImpl: (u, init) => fetch(u, init) });
  }

  const { store } = loadGrantStore(env);
  const result = await validateAuthorize(request, { store });
  if (!result.ok) return result.response;

  // The parked authorization's id becomes the Atlassian `state`: one value to
  // carry, and atlassianLeg.ts already binds `state` to the browser with an
  // HttpOnly cookie, so the MCP flow inherits that CSRF defence unchanged.
  return handleAuthorize(request, {
    env,
    fetchImpl: (u, init) => fetch(u, init),
    randomState: () => result.pendingId,
  });
};
