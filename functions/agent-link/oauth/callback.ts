// GET /agent-link/oauth/callback — the registered redirect_uri on the
// "ZenUML Agent Link" developer-console app. The path is fixed by that
// registration (appConfig.ts OAUTH_CALLBACK_PATH); renaming this file breaks
// every environment at once.
//
// Two flows end here. Both first seal the Atlassian grant (atlassianLeg.ts);
// they differ in what happens next:
//
//   - A bare connect (no MCP client): render "Connected to Atlassian" and stop.
//   - An MCP authorization: the Atlassian `state` is the id of the parked
//     request, so pick it up and continue — our consent screen if this
//     (user, client) pair has not been approved before, otherwise straight to
//     the client's redirect_uri with our authorization code.
//
// The consent check happens HERE rather than at /authorize because this is the
// first moment we know who the user is (ADR 0008 Decision 3, and see
// authServer.ts). No code is ever issued before it passes.

import { handleCallback } from './atlassianLeg';
import { completeAuthorization, hasConsent, redirectToConsent } from './authServer';
import { loadPending } from './asStore';
import { returningUserCookie } from './returningUser';
import { loadGrantStore, type OAuthEnv } from './appConfig';
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

  if (!outcome.ok) return response;

  // Remember who this browser belongs to, so the next /authorize from it can
  // skip Atlassian while this grant is live (returningUser.ts). Set on every
  // successful callback, bare connect included: that flow exists to seed a
  // grant, and the cookie is what makes the seeded grant reachable.
  const url = new URL(request.url);
  const { store, secret } = loadGrantStore(env);
  const remember = await returningUserCookie(outcome.accountId, secret, url);

  const pendingId = url.searchParams.get('state');
  // Nothing parked under this state: the bare connect flow, or a request that
  // sat past the parking TTL. The grant is stored either way, so say so rather
  // than error — the user did nothing wrong.
  const pending = pendingId ? await loadPending(store, pendingId) : null;
  if (!pendingId || !pending) return withCookies(response, [remember]);

  // atlassianLeg's cleared state cookie rides along with ours on both exits.
  const cleared = response.headers.get('set-cookie');
  const cookies = [...(cleared ? [cleared] : []), remember];
  const deps = { store };
  if (await hasConsent(deps, outcome.accountId, pending.clientId, pending.scope)) {
    return withCookies(await completeAuthorization(deps, pendingId, pending, outcome.accountId), cookies);
  }
  return redirectToConsent(deps, url, pendingId, pending, outcome.accountId, { extraCookies: cookies });
};

/** Copy, because Response.redirect's headers are immutable in workerd. */
function withCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(response.body, { status: response.status, headers });
}
