// POST /agent-link/oauth/token — our token endpoint. Exchanges an
// authorization code (with its PKCE verifier) or a refresh token for an MCP
// access token. All logic is in authServer.ts so it tests without a Worker.
import { handleToken } from './authServer';
import { loadGrantStore, type OAuthEnv } from './appConfig';

export const onRequestPost: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  const { store } = loadGrantStore(env);
  return handleToken(request, { store });
};

/** CORS preflight: MCP clients in a browser context send one before the POST. */
export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
