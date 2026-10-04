// GET/POST /agent-link/oauth/consent — our own consent screen.
//
// ADR 0008 Decision 3: this is the security boundary, not a formality. One
// static Atlassian client id (ours) fronts every dynamically registered MCP
// client, so without a per-(user, client) approval the second agent a user
// registers would silently inherit the Atlassian grant the first one obtained
// — an agent they never approved, writing to Confluence as them.
//
// It is reached only from callback.ts, after Atlassian has named the user and
// the grant is sealed. The parked authorization carries both the client and
// that user; nothing here is taken from the request except the parked id, the
// cookie that binds it to this browser, and the button the user pressed.
//
// THE COOKIE IS LOAD-BEARING. The `auth` id appears in the URL — it has to,
// so the form can name it — and a URL leaks: address bar, history, logs. The
// HttpOnly SameSite=Strict cookie set by the callback is what makes the id
// insufficient on its own, so a stolen id cannot complete an authorization and
// a cross-site POST cannot either.

import {
  completeAuthorization,
  consentCookie,
  consentCookieMatches,
  denyAuthorization,
  htmlPage,
  recordConsent,
  renderConsent,
} from './authServer';
import { loadClient, loadPending } from './asStore';
import { loadGrantStore, type OAuthEnv } from './appConfig';

const EXPIRED = () =>
  htmlPage(
    400,
    'This request has expired',
    '<p>Too much time passed, or the link was opened twice. Nothing was shared. Start again from your agent.</p>',
  );

/** Same page for "not your browser" as for "expired": a probe learns nothing from it. */
const NOT_THIS_BROWSER = EXPIRED;

export const onRequestGet: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  const { store } = loadGrantStore(env);
  const pendingId = new URL(request.url).searchParams.get('auth') ?? '';
  if (!consentCookieMatches(request, pendingId)) return NOT_THIS_BROWSER();

  const pending = pendingId ? await loadPending(store, pendingId) : null;
  if (!pending?.userId) return EXPIRED();

  const client = await loadClient(store, pending.clientId);
  if (!client) return EXPIRED();

  // The site list is informational; the screen is still correct without it, so
  // a failure to fetch it must not block a consent the user came here to give.
  return renderConsent(client, pendingId, pending.scope, []);
};

export const onRequestPost: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  const { store } = loadGrantStore(env);
  const form = await request.formData();
  const pendingId = String(form.get('auth') ?? '');
  if (!consentCookieMatches(request, pendingId)) return NOT_THIS_BROWSER();

  const pending = pendingId ? await loadPending(store, pendingId) : null;
  if (!pending?.userId) return EXPIRED();

  const deps = { store };
  // Whatever the decision, the cookie has done its job — clear it so the id
  // cannot be replayed even from this browser.
  const clear = consentCookie('', new URL(request.url), 0);
  const withClearedCookie = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.append('set-cookie', clear);
    return new Response(response.body, { status: response.status, headers });
  };

  if (form.get('decision') !== 'allow') {
    return withClearedCookie(await denyAuthorization(deps, pendingId, pending));
  }

  await recordConsent(deps, pending.userId, pending.clientId, pending.scope);
  return withClearedCookie(await completeAuthorization(deps, pendingId, pending, pending.userId));
};
