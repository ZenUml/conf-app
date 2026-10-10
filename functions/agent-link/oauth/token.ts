// POST /agent-link/oauth/token — our token endpoint. Exchanges an
// authorization code (with its PKCE verifier) or a refresh token for an MCP
// access token. All logic is in authServer.ts so it tests without a Worker.
import { handleToken } from './authServer';
import { loadGrantStore, type OAuthEnv } from './appConfig';
import { mixpanelTrack } from '../../service/mixpanelService';

interface Env extends OAuthEnv {
  MIXPANEL_TOKEN?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { store } = loadGrantStore(env);
  return handleToken(request, {
    store,
    // A revoked chain is the one sign that a refresh token may have been
    // copied; without the event it is invisible until a user complains.
    onChainRevoked: async ({ reason, userId }) => {
      if (!env.MIXPANEL_TOKEN) return;
      await mixpanelTrack(
        { event: 'agent_link_oauth_chain_revoked', user_account_id: userId, feature_area: 'agent_link', surface: 'backend', reason },
        env.MIXPANEL_TOKEN,
      );
    },
  });
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
