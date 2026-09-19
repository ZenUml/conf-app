// The Atlassian OAuth 2.0 (3LO) client — how the headless writer gets a
// Confluence credential that outlives an open page.
//
// See docs/superpowers/specs/2026-09-19-headless-diagram-mcp-design.md §5.
//
// WHERE THIS SITS. There are TWO tokens in the headless flow and conflating
// them is the vulnerability the MCP spec spends most of its security section
// on. The MCP client holds a token WE issued, for US. This module deals with
// the other one: the token Atlassian issued to us, as an OAuth client, for
// Confluence. The MCP spec's rule is blunt — "The MCP server MUST NOT pass
// through the token it received from the MCP client" (2025-06-18 §Access
// Token Privilege Restriction) — so nothing here ever sees an MCP token, and
// nothing upstream ever sees an Atlassian one.
//
// Endpoints and parameters below are from Atlassian's own OAuth 2.0 (3LO)
// apps reference (developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/),
// read 2026-09-19. Where the docs are silent, this file says so rather than
// assuming.

/** Atlassian's authorization endpoint. */
const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
/** Atlassian's token endpoint, for both the code exchange and refreshes. */
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
/** Which Atlassian sites this grant can reach. */
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

/**
 * The four granular scopes the headless writer needs, plus offline_access.
 *
 * All four are 3LO-available — verified 2026-09-19 against Atlassian's
 * "Scopes for OAuth 2.0 (3LO) and Forge apps" reference, which lists them in
 * the granular-scopes table for "apps using OAuth 2.0 authorization code
 * grants (3LO) for authorization and Forge apps" with none marked Forge-only.
 *
 * `offline_access` is what makes the grant outlive the browser: without it
 * Atlassian returns no refresh token, and "works with the page closed" would
 * last exactly one access-token lifetime.
 */
export const REQUIRED_SCOPES = [
  'read:page:confluence',
  'write:page:confluence',
  'read:custom-content:confluence',
  'write:custom-content:confluence',
  'offline_access',
] as const;

export interface AtlassianAppConfig {
  clientId: string;
  clientSecret: string;
  /** Must exactly match a redirect URI registered on the app; Atlassian rejects near-misses. */
  redirectUri: string;
}

/** What we keep after a successful exchange or refresh. */
export interface AtlassianGrant {
  accessToken: string;
  /**
   * Rotating: Atlassian issues a NEW refresh token on every use and the old
   * one stops working, so persisting the new value is not optional — drop it
   * and the grant is dead on the next call. The inactivity window is 90 days,
   * reset by each rotation.
   */
  refreshToken: string;
  /** Absolute epoch ms, computed from the response's relative `expires_in`. */
  accessTokenExpiresAtMs: number;
  /** Space-separated scope string as granted, which may differ from what we asked for. */
  scope: string;
}

export type GrantFailure =
  | 'invalid_grant'
  | 'invalid_client'
  | 'network'
  | 'bad_response'
  | 'http_error';

export type GrantResult =
  | { ok: true; grant: AtlassianGrant }
  | { ok: false; failure: GrantFailure; status?: number; detail?: string };

/** Injected so tests need no network and the Worker needs no global. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Build the URL to send the user's browser to for consent.
 *
 * `state` is the caller's to generate and to verify on the way back — this
 * function will not invent one, because a state it generated and immediately
 * forgot would be decoration rather than CSRF protection.
 *
 * `prompt=consent` is what Atlassian's reference specifies, and it is also
 * what makes re-authorization re-show the screen rather than silently reusing
 * an older grant with narrower scopes.
 */
export function buildAuthorizeUrl(
  app: AtlassianAppConfig,
  state: string,
  scopes: readonly string[] = REQUIRED_SCOPES,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('redirect_uri', app.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

interface TokenResponseBody {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/**
 * Turn a token-endpoint response into a grant, or into a reason it is not one.
 *
 * `invalid_grant` is separated from every other failure because it is the only
 * one that is terminal for the user: a refused refresh token means the grant is
 * dead and they must consent again. Everything else is worth a retry, and
 * treating a 503 as "please log in again" would be a bad day for both of us.
 */
async function readTokenResponse(res: Response, nowMs: number): Promise<GrantResult> {
  let body: TokenResponseBody;
  try {
    body = (await res.json()) as TokenResponseBody;
  } catch {
    return { ok: false, failure: 'bad_response', status: res.status, detail: 'response was not JSON' };
  }

  if (!res.ok) {
    const error = typeof body.error === 'string' ? body.error : undefined;
    const failure: GrantFailure =
      error === 'invalid_grant' ? 'invalid_grant' : error === 'invalid_client' ? 'invalid_client' : 'http_error';
    return {
      ok: false,
      failure,
      status: res.status,
      // error_description can carry Atlassian's own prose; it is diagnostic,
      // never shown to a user as-is and never logged next to a token.
      detail: typeof body.error_description === 'string' ? body.error_description : error,
    };
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : NaN;

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
    // A 200 with no refresh_token is the specific shape you get when
    // offline_access was not granted. Storing the access token alone would
    // produce a grant that works now and is dead within the hour, which is
    // worse than failing here.
    return {
      ok: false,
      failure: 'bad_response',
      status: res.status,
      detail: !refreshToken
        ? 'no refresh_token in response — was offline_access granted?'
        : 'missing access_token or expires_in',
    };
  }

  return {
    ok: true,
    grant: {
      accessToken,
      refreshToken,
      accessTokenExpiresAtMs: nowMs + expiresIn * 1000,
      scope: typeof body.scope === 'string' ? body.scope : '',
    },
  };
}

async function postToken(
  fetchImpl: FetchLike,
  payload: Record<string, string>,
  nowMs: number,
): Promise<GrantResult> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, failure: 'network', detail: e instanceof Error ? e.message : String(e) };
  }
  return readTokenResponse(res, nowMs);
}

/** Exchange the authorization code from the callback for a grant. */
export function exchangeCode(
  fetchImpl: FetchLike,
  app: AtlassianAppConfig,
  code: string,
  nowMs: number = Date.now(),
): Promise<GrantResult> {
  return postToken(
    fetchImpl,
    {
      grant_type: 'authorization_code',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: app.redirectUri,
    },
    nowMs,
  );
}

/**
 * Trade a rotating refresh token for a fresh grant.
 *
 * The returned grant carries a NEW refresh token. The caller must persist it
 * before using the access token for anything, because the one passed in here
 * is already spent.
 */
export function refreshGrant(
  fetchImpl: FetchLike,
  app: AtlassianAppConfig,
  refreshToken: string,
  nowMs: number = Date.now(),
): Promise<GrantResult> {
  return postToken(
    fetchImpl,
    {
      grant_type: 'refresh_token',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: refreshToken,
    },
    nowMs,
  );
}

/**
 * Refresh this many ms before the access token actually expires.
 *
 * A token that passes an expiry check and then expires mid-flight produces a
 * 401 from Confluence that looks identical to a permissions problem. The
 * margin makes that race not worth reasoning about.
 */
export const REFRESH_MARGIN_MS = 60_000;

export function isAccessTokenUsable(grant: AtlassianGrant, nowMs: number = Date.now()): boolean {
  return grant.accessTokenExpiresAtMs - REFRESH_MARGIN_MS > nowMs;
}

export interface AccessibleSite {
  cloudId: string;
  name: string;
  url: string;
  scopes: string[];
}

/**
 * Which Atlassian sites this grant reaches.
 *
 * This is what replaces "the page you have open" as the way a headless agent
 * knows where it may write — and it is the user's own reachability, not ours.
 */
export async function listAccessibleSites(
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<{ ok: true; sites: AccessibleSite[] } | { ok: false; status?: number; detail: string }> {
  let res: Response;
  try {
    res = await fetchImpl(ACCESSIBLE_RESOURCES_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, status: res.status, detail: `accessible-resources returned ${res.status}` };

  let rows: unknown;
  try {
    rows = await res.json();
  } catch {
    return { ok: false, status: res.status, detail: 'accessible-resources response was not JSON' };
  }
  if (!Array.isArray(rows)) return { ok: false, status: res.status, detail: 'accessible-resources was not an array' };

  const sites: AccessibleSite[] = [];
  for (const row of rows) {
    const r = row as { id?: unknown; name?: unknown; url?: unknown; scopes?: unknown };
    if (typeof r?.id !== 'string') continue;
    sites.push({
      cloudId: r.id,
      name: typeof r.name === 'string' ? r.name : '',
      url: typeof r.url === 'string' ? r.url : '',
      scopes: Array.isArray(r.scopes) ? r.scopes.filter((x): x is string => typeof x === 'string') : [],
    });
  }
  return { ok: true, sites };
}

/**
 * The base URL for Confluence REST calls made with a 3LO token.
 *
 * NOT the tenant's own `*.atlassian.net` host: a 3LO token is presented to the
 * api.atlassian.com gateway with the cloudId in the path. Everything Phase 1's
 * resolver does against a site goes through here.
 */
export function apiBaseUrlFor(cloudId: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}`;
}
