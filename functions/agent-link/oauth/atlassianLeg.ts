// The Atlassian leg of the headless OAuth flow: our /authorize hands the
// browser to auth.atlassian.com, our /callback takes the code back, swaps it
// for a grant, and seals that grant into KV under the consenting user's
// Atlassian account id.
//
// This is deliberately only the upstream half. ADR 0008 puts our own
// authorization server (DCR, PKCE, MCP tokens, the per-client consent
// screen) in front of it later; the seam is `onGrantStored`, which today just
// renders a "done" page and will then complete the MCP client's authorization
// instead. Landing this half first is what lets the registered app, the
// callback URIs and the grant store be verified against real Atlassian with
// the least new code.
//
// Two things a reader should not have to rediscover:
//
//   - `state` is the CSRF defence. It is random, bound to the browser by a
//     short-lived HttpOnly cookie, and the callback refuses unless the query
//     and the cookie agree. Without it an attacker could complete *their*
//     authorization in *the victim's* browser and have the victim's future
//     agent calls write to the attacker's Confluence.
//   - The grant is keyed by the Atlassian account id from /me, not by anything
//     the caller supplied, so a grant can never be filed under someone else's
//     name.

import { loadAppConfig, loadGrantStore, type OAuthEnv } from './appConfig';
import {
  buildAuthorizeUrl,
  exchangeCode,
  listAccessibleSites,
  type FetchLike,
} from './atlassianClient';
import { saveGrant } from './tokenStore';

export const STATE_COOKIE = 'agent_link_oauth_state';
/**
 * Long enough to read a consent screen, short enough that a stale cookie is
 * not a standing hazard.
 *
 * Was 10 minutes, which real use kept tripping: Atlassian's screen makes the
 * user pick a site, and anyone who tabbed away mid-decision came back to "This
 * link cannot be used" (observed twice on 2026-09-25). Thirty minutes is still
 * inside Atlassian's own consent context lifetime, and the cookie is unchanged
 * otherwise — HttpOnly, single-use, cleared on every outcome.
 */
export const STATE_TTL_SECONDS = 30 * 60;
export const ME_URL = 'https://api.atlassian.com/me';

export interface LegDeps {
  env: OAuthEnv;
  fetchImpl: FetchLike;
  nowMs?: () => number;
  /** Test seam; production uses crypto.randomUUID. */
  randomState?: () => string;
}

function stateCookie(value: string, requestUrl: URL, maxAge: number): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
  // Lax, not Strict: the callback is a top-level navigation *from* Atlassian,
  // which Strict would strip the cookie from.
  return `${STATE_COOKIE}=${value}; Path=/agent-link/oauth; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function html(status: number, title: string, body: string, extraHeaders: Record<string, string> = {}): Response {
  const page = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#172b4d}code{background:#f4f5f7;padding:.1em .3em;border-radius:3px}</style>
<h1>${title}</h1>${body}`;
  return new Response(page, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

/** GET /agent-link/oauth/authorize — mint state, set the cookie, redirect to Atlassian. */
export function handleAuthorize(request: Request, deps: LegDeps): Response {
  const url = new URL(request.url);
  const app = loadAppConfig(deps.env, url);
  const state = (deps.randomState ?? (() => crypto.randomUUID()))();
  return new Response(null, {
    status: 302,
    headers: {
      location: buildAuthorizeUrl(app, state),
      'set-cookie': stateCookie(state, url, STATE_TTL_SECONDS),
      'cache-control': 'no-store',
    },
  });
}

export type CallbackOutcome =
  | { ok: true; accountId: string; siteCount: number }
  | { ok: false; reason: 'atlassian_denied' | 'state_mismatch' | 'missing_code' | 'exchange_failed' | 'me_failed' | 'sites_failed'; detail?: string };

/**
 * GET /agent-link/oauth/callback — the return from Atlassian.
 *
 * Returns the outcome alongside the response so the route can emit analytics
 * without parsing its own HTML. Every failure clears the state cookie: a
 * failed attempt must not leave a usable state behind for a retry that skips
 * /authorize.
 */
export async function handleCallback(
  request: Request,
  deps: LegDeps,
): Promise<{ response: Response; outcome: CallbackOutcome }> {
  const url = new URL(request.url);
  const clear = { 'set-cookie': stateCookie('', url, 0) };
  const fail = (reason: Exclude<CallbackOutcome, { ok: true }>['reason'], status: number, title: string, body: string, detail?: string) => ({
    response: html(status, title, body, clear),
    outcome: { ok: false as const, reason, detail },
  });

  // Atlassian reports a declined consent as ?error=access_denied.
  const error = url.searchParams.get('error');
  if (error) {
    return fail('atlassian_denied', 400, 'Authorization was not completed',
      `<p>Atlassian reported <code>${error}</code>. Nothing was stored. You can start again from your agent.</p>`, error);
  }

  const state = url.searchParams.get('state');
  const expected = readCookie(request.headers.get('cookie'), STATE_COOKIE);
  if (!state || !expected || state !== expected) {
    return fail('state_mismatch', 400, 'This link cannot be used',
      '<p>The sign-in did not start in this browser, or it took longer than ten minutes. Nothing was stored. Start again from your agent.</p>');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return fail('missing_code', 400, 'Authorization was not completed',
      '<p>Atlassian returned without an authorization code. Nothing was stored.</p>');
  }

  const app = loadAppConfig(deps.env, url);
  const { store, secret } = loadGrantStore(deps.env);
  const now = deps.nowMs ?? Date.now;
  // Detached on purpose: calling `deps.fetchImpl(...)` would invoke the
  // runtime's fetch with `this = deps`, which workerd rejects as an illegal
  // invocation. Learned live 2026-09-19 — the exchange worked and /me threw.
  const fetchImpl = deps.fetchImpl;

  const exchanged = await exchangeCode(fetchImpl, app, code, now());
  if (!exchanged.ok) {
    return fail('exchange_failed', 502, 'Authorization could not be completed',
      '<p>Atlassian did not accept the authorization code. Nothing was stored. Start again from your agent.</p>',
      `${exchanged.failure}${exchanged.status ? ` ${exchanged.status}` : ''}`);
  }
  const { grant } = exchanged;

  // Who consented. /me (read:me, in REQUIRED_SCOPES) is the only thing we
  // trust to name the user — never a query parameter, never a header.
  let accountId: string | null = null;
  let meDetail = '';
  try {
    const me = await fetchImpl(ME_URL, { headers: { authorization: `Bearer ${grant.accessToken}`, accept: 'application/json' } });
    // Keep a token-free trace of what /me said; it is the only clue when this fails.
    const text = await me.text();
    meDetail = `/me ${me.status}: ${text.slice(0, 200)}`;
    if (me.ok) {
      const body = JSON.parse(text) as { account_id?: unknown };
      if (typeof body.account_id === 'string' && body.account_id) accountId = body.account_id;
    }
  } catch (e) {
    meDetail = meDetail || `/me threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!accountId) {
    return fail('me_failed', 502, 'Authorization could not be completed',
      '<p>Atlassian accepted the authorization but did not identify the account. Nothing was stored. Start again from your agent.</p>',
      meDetail);
  }

  await saveGrant(store, secret, accountId, grant, now());

  const sites = await listAccessibleSites(fetchImpl, grant.accessToken);
  if (!sites.ok) {
    // The grant is stored and valid; only the site listing failed. Report it
    // rather than pretend, but do not throw away a good grant.
    return {
      response: html(200, 'Connected to Atlassian', `<p>Your agent can now act on your behalf. (Listing your sites failed: <code>${sites.detail}</code>; it will be retried when the agent first needs them.)</p>`, clear),
      outcome: { ok: false, reason: 'sites_failed', detail: sites.detail },
    };
  }

  const list = sites.sites.map((s) => `<li><code>${s.url}</code></li>`).join('');
  return {
    response: html(200, 'Connected to Atlassian',
      `<p>Your agent can now read and update ZenUML diagrams as you on ${sites.sites.length} site${sites.sites.length === 1 ? '' : 's'}:</p><ul>${list}</ul><p>You can close this tab.</p>`, clear),
    outcome: { ok: true, accountId, siteCount: sites.sites.length },
  };
}
