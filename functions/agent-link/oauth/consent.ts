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
// that user; nothing here is taken from the request except the parked id and
// the button the user pressed.

import {
  completeAuthorization,
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

export const onRequestGet: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  const { store } = loadGrantStore(env);
  const pendingId = new URL(request.url).searchParams.get('auth') ?? '';
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
  const pending = pendingId ? await loadPending(store, pendingId) : null;
  if (!pending?.userId) return EXPIRED();

  const deps = { store };
  if (form.get('decision') !== 'allow') return denyAuthorization(deps, pendingId, pending);

  await recordConsent(deps, pending.userId, pending.clientId, pending.scope);
  return completeAuthorization(deps, pendingId, pending, pending.userId);
};
