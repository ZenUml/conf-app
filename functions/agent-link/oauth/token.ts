// POST /agent-link/oauth/token — our token endpoint. Exchanges an
// authorization code (with its PKCE verifier) or a refresh token for an MCP
// access token. All logic is in authServer.ts so it tests without a Worker.
import { handleToken } from './authServer';
import { loadGrantStore, type OAuthEnv } from './appConfig';
import { mixpanelTrack } from '../../service/mixpanelService';
import { createRefreshLedger } from './refreshLedger';
import { issuerFor } from './asMetadata';
import type { D1Database } from '@cloudflare/workers-types';
import { json } from '../../OkResponse';

interface Env extends OAuthEnv {
  MIXPANEL_TOKEN?: string;
  DB?: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  if (!env.DB || !env.OAUTH_GRANT_KV || !env.OAUTH_GRANT_SECRET) {
    try {
      if ((await request.clone().formData()).get('grant_type') === 'refresh_token' && env.MIXPANEL_TOKEN) {
        waitUntil(mixpanelTrack({ event: 'agent_link_oauth_token_refresh_completed',
          feature_area: 'agent_link', surface: 'backend', oauth_refresh_outcome: 'unavailable',
          reason: 'storage_unavailable', duration_ms: Date.now() - started, oauth_request_id: requestId,
        }, env.MIXPANEL_TOKEN, env).catch(() => undefined));
      }
    } catch { /* malformed body cannot contain a trustworthy grant type */ }
    return json({ error: 'temporarily_unavailable' }, {
      status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  const { store, secret } = loadGrantStore(env);
  return handleToken(request, {
    store,
    refreshLedger: createRefreshLedger(env.DB as never, secret, issuerFor(request.url)),
    onRefreshCompleted: ({ outcome, reason, userId, reuseAgeMs }) => {
      if (!env.MIXPANEL_TOKEN) return;
      waitUntil(mixpanelTrack({
        event: 'agent_link_oauth_token_refresh_completed', feature_area: 'agent_link', surface: 'backend',
        oauth_refresh_outcome: outcome, reason, user_account_id: userId,
        refresh_reuse_age_ms: reuseAgeMs, duration_ms: Date.now() - started, oauth_request_id: requestId,
      }, env.MIXPANEL_TOKEN, env).catch(() => undefined));
    },
    // A revoked chain is the one sign that a refresh token may have been
    // copied; without the event it is invisible until a user complains.
    onChainRevoked: async ({ reason, userId }) => {
      if (!env.MIXPANEL_TOKEN) return;
      await mixpanelTrack(
        { event: 'agent_link_oauth_chain_revoked', user_account_id: userId, feature_area: 'agent_link', surface: 'backend', reason },
        env.MIXPANEL_TOKEN,
        env,
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
