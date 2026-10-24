// GET /agent-link/oauth/authorize — the authorization endpoint of OUR
// authorization server (ADR 0008), and the entry point of the headless flow.
//
// It has two callers, and both are legitimate:
//
//   - An MCP client, with client_id/redirect_uri/PKCE. The request is
//     validated and parked, and then routed one of three ways:
//       * a returning user (signed cookie, returningUser.ts) whose grant is
//         still live and who already approved this client: a code, now;
//       * the same, but this client is new to them: our consent screen,
//         with no trip to Atlassian;
//       * anyone else: Atlassian, with the parked id riding along as the
//         Atlassian `state` so callback.ts can pick it up.
//   - A person, with no parameters at all — the "just connect my account"
//     path this branch shipped first. No client, no code, no consent screen:
//     it seals an Atlassian grant and says so. Keeping it costs one branch and
//     it is what makes the credential layer testable on its own. It always
//     goes to Atlassian; there is no client to consent to.

import { handleAuthorize } from './atlassianLeg';
import { completeAuthorization, hasConsent, redirectToConsent, validateAuthorize } from './authServer';
import { loadAppConfig, loadGrantStore, type OAuthEnv } from './appConfig';
import { getAccessToken } from './tokenStore';
import {
  clearReturningUserCookie,
  forcesAtlassian,
  readReturningUser,
  returningUserCookie,
} from './returningUser';
import { mixpanelTrack } from '../../service/mixpanelService';
import type { FetchLike } from './atlassianClient';
import type { PendingAuthorization } from './asStore';

interface Env extends OAuthEnv {
  MIXPANEL_TOKEN?: string;
}

/** Mirrors AgentLinkOAuthAtlassianReason in src/utils/analytics/catalog.ts. */
type AtlassianReason =
  | 'no_cookie'
  | 'invalid_cookie'
  | 'no_grant'
  | 'reauthorize_required'
  | 'refresh_failed'
  | 'forced';

type Route =
  | { route: 'atlassian'; reason: AtlassianReason; clearCookie?: boolean }
  | { route: 'consent' | 'issued'; accountId: string; response: Response };

export interface ReturningUserDeps {
  env: OAuthEnv;
  fetchImpl: FetchLike;
  nowMs?: () => number;
}

/**
 * Can this parked MCP authorization skip Atlassian? Exported for tests.
 *
 * Every "no" falls back to the Atlassian path rather than failing: a missing
 * or forged cookie, an unknown account, a dead grant, or Atlassian refusing a
 * refresh all mean the same thing to the user — sign in as you would have
 * anyway. Only the dead-grant cases clear the cookie; a transient refresh
 * failure leaves it for next time.
 */
export async function routeReturningUser(
  request: Request,
  deps: ReturningUserDeps,
  pendingId: string,
  pending: PendingAuthorization,
): Promise<Route> {
  const url = new URL(request.url);
  if (forcesAtlassian(url)) return { route: 'atlassian', reason: 'forced' };

  const { store, secret } = loadGrantStore(deps.env);
  const who = await readReturningUser(request.headers.get('cookie'), secret);
  if (who.status === 'none') return { route: 'atlassian', reason: 'no_cookie' };
  if (who.status === 'invalid') return { route: 'atlassian', reason: 'invalid_cookie', clearCookie: true };

  // "Live" means it yields an access token now, refreshing if it must. That is
  // the same test every headless call applies, so a grant that passes here is
  // one the agent can actually use — not merely one that is stored.
  const app = loadAppConfig(deps.env, url);
  const now = (deps.nowMs ?? Date.now)();
  const token = await getAccessToken(store, secret, app, deps.fetchImpl, who.accountId, now);
  if (!token.ok) {
    return {
      route: 'atlassian',
      reason: token.reason,
      clearCookie: token.reason !== 'refresh_failed',
    };
  }

  // Slide the cookie's expiry: a user who keeps coming back stays recognised
  // for as long as their grant does.
  const remember = await returningUserCookie(who.accountId, secret, url);
  const asDeps = { store, nowMs: deps.nowMs };
  if (await hasConsent(asDeps, who.accountId, pending.clientId, pending.scope)) {
    const issued = await completeAuthorization(asDeps, pendingId, pending, who.accountId);
    const headers = new Headers(issued.headers);
    headers.append('set-cookie', remember);
    return {
      route: 'issued',
      accountId: who.accountId,
      response: new Response(null, { status: issued.status, headers }),
    };
  }
  return {
    route: 'consent',
    accountId: who.accountId,
    response: await redirectToConsent(asDeps, url, pendingId, pending, who.accountId, {
      recognised: true,
      extraCookies: [remember],
    }),
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const fetchImpl: FetchLike = (u, init) => fetch(u, init);

  // No client_id means nobody is delegating to an agent; this is the bare
  // Atlassian connect flow.
  if (!url.searchParams.get('client_id')) {
    return handleAuthorize(request, { env, fetchImpl });
  }

  const { store } = loadGrantStore(env);
  const result = await validateAuthorize(request, { store });
  if (!result.ok) return result.response;

  // The parked authorization's id becomes the Atlassian `state`: one value to
  // carry, and atlassianLeg.ts already binds `state` to the browser with an
  // HttpOnly cookie, so the MCP flow inherits that CSRF defence unchanged.
  const toAtlassian = () => handleAuthorize(request, { env, fetchImpl, randomState: () => result.pendingId });

  let routed: Route;
  try {
    // Config is checked here rather than trusted: a misconfigured environment
    // must reach handleAuthorize, which explains itself, not throw a 500.
    loadAppConfig(env, url);
    routed = await routeReturningUser(request, { env, fetchImpl }, result.pendingId, result.pending);
  } catch (e) {
    // Recognising a returning user is an optimisation; failing at it must
    // cost the user the Atlassian screen, never the authorization.
    console.warn('agent-link authorize: returning-user check failed', e instanceof Error ? e.message : String(e));
    return toAtlassian();
  }

  if (env.MIXPANEL_TOKEN) {
    try {
      await mixpanelTrack(
        {
          event: 'agent_link_oauth_authorize_routed',
          user_account_id: routed.route === 'atlassian' ? undefined : routed.accountId,
          feature_area: 'agent_link',
          surface: 'backend',
          oauth_route: routed.route,
          reason: routed.route === 'atlassian' ? routed.reason : undefined,
        },
        env.MIXPANEL_TOKEN,
      );
    } catch {
      // analytics must never fail the authorization
    }
  }

  if (routed.route !== 'atlassian') return routed.response;

  const response = toAtlassian();
  if (!routed.clearCookie) return response;
  const headers = new Headers(response.headers);
  headers.append('set-cookie', clearReturningUserCookie(url));
  return new Response(response.body, { status: response.status, headers });
};
