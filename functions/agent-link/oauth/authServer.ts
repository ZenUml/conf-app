// Our OAuth 2.1 authorization server: registration, authorization, consent and
// token issuance for MCP clients (ADR 0008).
//
// THE SHAPE OF THE FLOW. There are two authorizations stacked on each other,
// and keeping them distinct is the whole point of this file:
//
//   MCP client -> [our AS] -> Atlassian
//
//   1. POST /register            the agent registers itself (DCR), gets a client_id
//   2. GET  /authorize           we validate it, park the request, send the
//                                browser to Atlassian's consent
//   3. GET  /callback            Atlassian returns; atlassianLeg.ts seals the
//                                grant, then `resumeAuthorization` picks the
//                                parked request back up
//   4. GET/POST /consent         OUR consent screen: "<agent> wants to edit
//                                your diagrams as you". Per (user, client).
//   5. -> client redirect_uri    with OUR authorization code
//   6. POST /token               code + PKCE verifier -> OUR access token
//
// The MCP client never sees an Atlassian token and Atlassian never sees ours.
// That separation is not a nicety: the MCP spec's "MUST NOT pass through the
// token it received" and "MUST only accept tokens specifically intended for
// themselves" are both violated the moment the two are allowed to touch.
//
// WHY THE USER IS ONLY KNOWN AT STEP 3. We have no session of our own before
// Atlassian tells us who consented (/me, atlassianLeg.ts). So the consent
// check cannot happen at /authorize — there is no user yet to check. It
// happens on the way back, before any code is issued, which is the point that
// actually matters: an unconsented (user, client) pair never receives a code,
// even when a live Atlassian grant for that user already exists.

import {
  CONSENT_PATH,
  DEFAULT_MCP_SCOPE,
  MCP_SCOPES,
  resourceFor,
} from './asMetadata';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  bumpRegisterCount,
  consumeCode,
  consumeRefreshToken,
  deletePending,
  issueAccessToken,
  issueCode,
  issueRefreshToken,
  loadClient,
  loadConsent,
  loadPending,
  randomToken,
  REGISTER_LIMIT,
  REGISTER_WINDOW_SECONDS,
  saveClient,
  saveConsent,
  savePending,
  type GrantStoreLike,
  type PendingAuthorization,
  type RegisteredClient,
} from './asStore';
import { canonicalizeResource } from './protectedResource';
import { isValidChallenge, verifyPkce } from './pkce';

export interface AsDeps {
  store: GrantStoreLike;
  nowMs?: () => number;
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function oauthError(status: number, error: string, description?: string): Response {
  return json(status, description ? { error, error_description: description } : { error });
}

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export function htmlPage(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#172b4d}
h1{font-size:1.4rem}code{background:#f4f5f7;padding:.1em .3em;border-radius:3px}
button{font:inherit;padding:.5rem 1rem;border-radius:3px;border:0;cursor:pointer}
.primary{background:#0052cc;color:#fff}.secondary{background:#f4f5f7;color:#172b4d;margin-left:.5rem}
ul{padding-left:1.2rem}</style>
<h1>${escapeHtml(title)}</h1>${body}`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

// ------------------------------------------------------- dynamic registration

/**
 * POST /agent-link/oauth/register — RFC 7591 Dynamic Client Registration.
 *
 * Open registration, no software statement, no client secret: the MCP spec
 * expects a client the user just installed to be able to register itself, and
 * a public client cannot keep a secret anyway. What stops that being a hole is
 * everything downstream — PKCE, exact redirect_uri matching, and above all our
 * per-(user, client) consent screen, without which a registration is an
 * identity and nothing more.
 */
export async function handleRegister(request: Request, deps: AsDeps): Promise<Response> {
  // Open registration with no ceiling is an unauthenticated write into the
  // namespace that also holds every user's encrypted Atlassian grant, one
  // durable record per call. The cap is per source per hour and generous
  // enough that no real client notices it.
  const source = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const count = await bumpRegisterCount(deps.store, source, (deps.nowMs ?? Date.now)());
  if (count > REGISTER_LIMIT) {
    return new Response(
      JSON.stringify({ error: 'too_many_requests', error_description: 'too many registrations; try again later' }),
      { status: 429, headers: { ...JSON_HEADERS, 'retry-after': String(REGISTER_WINDOW_SECONDS) } },
    );
  }

  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return oauthError(400, 'invalid_client_metadata', 'body must be JSON');
  }

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const redirectUris: string[] = [];
  for (const raw of uris) {
    if (typeof raw !== 'string') continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return oauthError(400, 'invalid_redirect_uri', `not a valid URI: ${raw.slice(0, 80)}`);
    }
    // A loopback http:// redirect is what every CLI agent uses and RFC 8252
    // blesses; anything else on the public internet must be https, or a code
    // could be intercepted in transit.
    const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return oauthError(400, 'invalid_redirect_uri', 'redirect_uri must be https, or http on loopback');
    }
    if (url.hash) return oauthError(400, 'invalid_redirect_uri', 'redirect_uri must not contain a fragment');
    redirectUris.push(url.toString());
  }
  if (redirectUris.length === 0) {
    return oauthError(400, 'invalid_redirect_uri', 'at least one redirect_uri is required');
  }

  const now = (deps.nowMs ?? Date.now)();
  const client: RegisteredClient = {
    clientId: randomToken(16),
    redirectUris,
    clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : undefined,
    createdAtMs: now,
  };
  await saveClient(deps.store, client);

  return json(201, {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(now / 1000),
    redirect_uris: client.redirectUris,
    client_name: client.clientName,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: DEFAULT_MCP_SCOPE,
  });
}

// ------------------------------------------------------------- authorization

export type AuthorizeResult =
  | { ok: true; pendingId: string; pending: PendingAuthorization }
  | { ok: false; response: Response };

function requestedScope(raw: string | null): string | null {
  if (!raw) return DEFAULT_MCP_SCOPE;
  const asked = raw.split(/\s+/).filter(Boolean);
  return asked.every((s) => (MCP_SCOPES as readonly string[]).includes(s)) ? asked.join(' ') : null;
}

/**
 * Validate an /authorize request and park it.
 *
 * Errors split in two, exactly as RFC 6749 §4.1.2.1 requires: anything wrong
 * with `client_id` or `redirect_uri` is rendered here, because redirecting to
 * an unvalidated URI is how an open redirector is built. Everything else is
 * reported to the client at its (now validated) redirect_uri.
 */
export async function validateAuthorize(request: Request, deps: AsDeps): Promise<AuthorizeResult> {
  const url = new URL(request.url);
  const q = url.searchParams;
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';

  const client = clientId ? await loadClient(deps.store, clientId) : null;
  if (!client) {
    return {
      ok: false,
      response: htmlPage(400, 'This app is not registered', '<p>The agent that sent you here is not registered with ZenUML, or its registration has expired. Ask it to register again.</p>'),
    };
  }
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      response: htmlPage(400, 'This link cannot be used', '<p>The address the agent asked us to return to is not one it registered. Nothing was shared.</p>'),
    };
  }

  const state = q.get('state') ?? undefined;
  const fail = (error: string, description: string): AuthorizeResult => {
    const target = new URL(redirectUri);
    target.searchParams.set('error', error);
    target.searchParams.set('error_description', description);
    if (state) target.searchParams.set('state', state);
    return { ok: false, response: Response.redirect(target.toString(), 302) };
  };

  if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'only response_type=code is supported');
  if (q.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256');
  const codeChallenge = q.get('code_challenge') ?? '';
  if (!isValidChallenge(codeChallenge)) return fail('invalid_request', 'code_challenge is missing or malformed');

  const scope = requestedScope(q.get('scope'));
  if (!scope) return fail('invalid_scope', `supported scopes are ${DEFAULT_MCP_SCOPE}`);

  // RFC 8707. The MCP spec requires clients to say which resource the token is
  // for; binding it here is what makes the audience check at the MCP endpoint
  // mean something. A client that omits it gets this server's own resource
  // rather than a rejection, since one server serves one resource.
  const ours = resourceFor(url);
  const rawResource = q.get('resource');
  let resource = ours;
  if (rawResource) {
    try {
      resource = canonicalizeResource(rawResource);
    } catch {
      return fail('invalid_target', 'resource is not a valid URI');
    }
    if (resource !== ours) return fail('invalid_target', `this server only issues tokens for ${ours}`);
  }

  const now = (deps.nowMs ?? Date.now)();
  const pending: PendingAuthorization = {
    clientId: client.clientId,
    redirectUri,
    state,
    codeChallenge,
    scope,
    resource,
    createdAtMs: now,
  };
  const pendingId = randomToken();
  await savePending(deps.store, pendingId, pending);
  return { ok: true, pendingId, pending };
}

// ------------------------------------------------------------------ consent

/** Where /callback sends the browser once Atlassian has named the user. */
export function consentUrl(origin: string, pendingId: string): string {
  const url = new URL(CONSENT_PATH, origin);
  url.searchParams.set('auth', pendingId);
  return url.toString();
}

export const CONSENT_COOKIE = 'agent_link_consent';
/** The consent screen is one hop away; it does not need the parking window. */
export const CONSENT_COOKIE_TTL_SECONDS = 10 * 60;

/**
 * Bind the pending authorization to THIS browser for the consent hop.
 *
 * Without it the `auth` id in the consent URL is a bearer credential on its
 * own: anyone who obtains it — from the address bar, history, a Referer, or a
 * log — can POST decision=allow and complete an authorization the user never
 * approved. The Atlassian state cookie cannot serve here because the callback
 * clears it, by design, before redirecting.
 */
export function consentCookie(pendingId: string, requestUrl: URL, maxAge = CONSENT_COOKIE_TTL_SECONDS): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
  // Strict, not Lax: every legitimate request to /consent is same-site (our
  // redirect, then our own form POST), so nothing needs the cookie on a
  // cross-site navigation — and Strict is what makes a cross-site POST fail.
  return `${CONSENT_COOKIE}=${pendingId}; Path=${CONSENT_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/** Does this request carry the consent cookie for `pendingId`? */
export function consentCookieMatches(request: Request, pendingId: string): boolean {
  const cookie = readCookie(request.headers.get('cookie'), CONSENT_COOKIE);
  return !!cookie && !!pendingId && cookie === pendingId;
}

export function renderConsent(
  client: RegisteredClient,
  pendingId: string,
  scope: string,
  siteUrls: string[],
): Response {
  const name = client.clientName?.trim() || 'An application';
  const sites = siteUrls.length
    ? `<p>It will act on your behalf on:</p><ul>${siteUrls.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul>`
    : '';
  const writes = scope.includes('diagram.write');
  return htmlPage(
    200,
    'Allow this app to use your diagrams?',
    `<p><strong>${escapeHtml(name)}</strong> is asking to ${writes ? 'read and update' : 'read'} ZenUML diagrams in Confluence <em>as you</em>.</p>
${sites}
<p>It can do this while you are away, until you disconnect it. It cannot do anything in Confluence that you could not do yourself.</p>
<form method="POST" action="${escapeHtml(CONSENT_PATH)}">
  <input type="hidden" name="auth" value="${escapeHtml(pendingId)}">
  <button class="primary" name="decision" value="allow" type="submit">Allow</button>
  <button class="secondary" name="decision" value="deny" type="submit">Cancel</button>
</form>`,
  );
}

/**
 * Finish an authorization: record consent if given, then hand the client its code.
 *
 * `userId` comes from the Atlassian /me call, never from the request — the
 * same rule the grant store keys on.
 */
export async function completeAuthorization(
  deps: AsDeps,
  pendingId: string,
  pending: PendingAuthorization,
  userId: string,
): Promise<Response> {
  const now = (deps.nowMs ?? Date.now)();
  await deletePending(deps.store, pendingId);
  const code = await issueCode(deps.store, {
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    scope: pending.scope,
    resource: pending.resource,
    userId,
    createdAtMs: now,
  });
  const target = new URL(pending.redirectUri);
  target.searchParams.set('code', code);
  if (pending.state) target.searchParams.set('state', pending.state);
  return Response.redirect(target.toString(), 302);
}

export async function denyAuthorization(
  deps: AsDeps,
  pendingId: string,
  pending: PendingAuthorization,
): Promise<Response> {
  await deletePending(deps.store, pendingId);
  const target = new URL(pending.redirectUri);
  target.searchParams.set('error', 'access_denied');
  target.searchParams.set('error_description', 'the user declined');
  if (pending.state) target.searchParams.set('state', pending.state);
  return Response.redirect(target.toString(), 302);
}

/** Has this user already allowed this client, for at least this much? */
export async function hasConsent(
  deps: AsDeps,
  userId: string,
  clientId: string,
  scope: string,
): Promise<boolean> {
  const record = await loadConsent(deps.store, userId, clientId);
  if (!record) return false;
  const granted = new Set(record.scope.split(/\s+/).filter(Boolean));
  return scope.split(/\s+/).filter(Boolean).every((s) => granted.has(s));
}

export async function recordConsent(
  deps: AsDeps,
  userId: string,
  clientId: string,
  scope: string,
): Promise<void> {
  await saveConsent(deps.store, {
    userId,
    clientId,
    scope,
    grantedAtMs: (deps.nowMs ?? Date.now)(),
  });
}

// -------------------------------------------------------------------- token

interface TokenBody {
  grant_type?: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  client_id?: string;
  refresh_token?: string;
  resource?: string;
}

async function readForm(request: Request): Promise<TokenBody> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      return (await request.json()) as TokenBody;
    } catch {
      return {};
    }
  }
  const form = await request.formData();
  const out: TokenBody = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') (out as Record<string, string>)[k] = v;
  return out;
}

/**
 * POST /agent-link/oauth/token.
 *
 * Public clients, so there is no client authentication to check — the
 * credentials that matter are the single-use code and the PKCE verifier. The
 * `client_id` presented here must still match the one the code was issued to,
 * or one registered client could redeem another's code.
 */
export async function handleToken(request: Request, deps: AsDeps): Promise<Response> {
  const body = await readForm(request);
  const now = (deps.nowMs ?? Date.now)();

  if (body.grant_type === 'authorization_code') {
    if (!body.code) return oauthError(400, 'invalid_request', 'code is required');
    if (!body.code_verifier) return oauthError(400, 'invalid_request', 'code_verifier is required');

    // Required, not optional: RFC 6749 §3.2.1 obliges a public client to
    // identify itself here, and treating it as optional meant a client that
    // simply omitted it skipped the binding check below entirely.
    if (!body.client_id) return oauthError(400, 'invalid_request', 'client_id is required');

    const record = await consumeCode(deps.store, body.code);
    if (!record) return oauthError(400, 'invalid_grant', 'the code is unknown, used, or expired');
    if (body.client_id !== record.clientId) {
      return oauthError(400, 'invalid_grant', 'the code was issued to a different client');
    }
    if (body.redirect_uri && body.redirect_uri !== record.redirectUri) {
      return oauthError(400, 'invalid_grant', 'redirect_uri does not match the authorization request');
    }
    if (!(await verifyPkce(body.code_verifier, record.codeChallenge))) {
      return oauthError(400, 'invalid_grant', 'code_verifier does not match the code_challenge');
    }

    const { token, expiresInSeconds } = await issueAccessToken(
      deps.store,
      { userId: record.userId, clientId: record.clientId, scope: record.scope, resource: record.resource },
      now,
    );
    const refresh = await issueRefreshToken(deps.store, {
      userId: record.userId,
      clientId: record.clientId,
      scope: record.scope,
      resource: record.resource,
    });
    return json(200, {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresInSeconds,
      refresh_token: refresh,
      scope: record.scope,
    });
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) return oauthError(400, 'invalid_request', 'refresh_token is required');
    if (!body.client_id) return oauthError(400, 'invalid_request', 'client_id is required');

    const record = await consumeRefreshToken(deps.store, body.refresh_token);
    if (!record) return oauthError(400, 'invalid_grant', 'the refresh token is unknown, used, or expired');
    if (body.client_id !== record.clientId) {
      return oauthError(400, 'invalid_grant', 'the refresh token was issued to a different client');
    }

    // The upstream Atlassian grant is NOT refreshed here. It has its own
    // lifecycle in tokenStore.getAccessToken, driven by actual Confluence
    // calls; tying the two together would refresh Atlassian on a schedule set
    // by an idle agent.
    const { token, expiresInSeconds } = await issueAccessToken(
      deps.store,
      { userId: record.userId, clientId: record.clientId, scope: record.scope, resource: record.resource },
      now,
    );
    const refresh = await issueRefreshToken(deps.store, record);
    return json(200, {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresInSeconds,
      refresh_token: refresh,
      scope: record.scope,
    });
  }

  return oauthError(400, 'unsupported_grant_type', 'supported: authorization_code, refresh_token');
}

export { ACCESS_TOKEN_TTL_SECONDS, loadPending };
