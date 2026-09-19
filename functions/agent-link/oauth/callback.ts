// GET /agent-link/oauth/callback — the registered redirect_uri on the
// "ZenUML Agent Link" developer-console app. The path is fixed by that
// registration (appConfig.ts OAUTH_CALLBACK_PATH); renaming this file breaks
// every environment at once.
import { handleCallback } from './atlassianLeg';
import type { OAuthEnv } from './appConfig';
import { mixpanelTrack } from '../../service/mixpanelService';

interface Env extends OAuthEnv {
  MIXPANEL_TOKEN?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { response, outcome } = await handleCallback(request, { env, fetchImpl: (url, init) => fetch(url, init) });
  // Outcomes carry no tokens, so they are safe to log; without this a 502
  // from the callback is indistinguishable from any other.
  if (!outcome.ok) console.warn('agent-link oauth callback failed', outcome.reason, outcome.detail ?? '');
  // Design §10: agent_link_oauth_authorized fires when the user completes
  // consent, with site_count. A grant that stored but could not list its
  // sites still counts — the credential exists — with site_count unknown.
  if ((outcome.ok || outcome.reason === 'sites_failed') && env.MIXPANEL_TOKEN) {
    try {
      await mixpanelTrack(
        {
          event: 'agent_link_oauth_authorized',
          user_account_id: outcome.ok ? outcome.accountId : undefined,
          feature_area: 'agent_link',
          surface: 'backend',
          site_count: outcome.ok ? outcome.siteCount : undefined,
        },
        env.MIXPANEL_TOKEN,
      );
    } catch {
      // analytics must never fail the authorization
    }
  }
  return response;
};
