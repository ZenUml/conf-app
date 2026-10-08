import { requestConfluenceJson } from '@/utils/byline/confluenceRequest';

/**
 * Who is looking at the macro, as far as the Magic writeback call cares.
 *
 * Forge sends no user token (`x-forge-oauth-user`) on `invokeRemote` for guest
 * (unlicensed) and anonymous viewers, so the writeback endpoint can only answer
 * them with an error. Asking first lets the viewer skip a call that cannot work.
 * Frontend bridge calls (`requestConfluence`) do work for guests, which is how
 * the lookup below reaches Confluence.
 *
 * `unknown` is a deliberate fail-open: if the lookup fails or the answer is not
 * in the expected shape, the caller proceeds as before and the backend's 403
 * `no_user_credential` stays the backstop.
 */
export type ViewerAccountKind = 'anonymous' | 'guest' | 'licensed' | 'unknown';

const KEY_PREFIX = 'zenuml.viewerKind.v1:';
export const VIEWER_ACCOUNT_KIND_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_USER_URL = '/wiki/rest/api/user/current';

function cacheKey(clientDomain: string, accountId: string): string {
  return `${KEY_PREFIX}${clientDomain}:${accountId}`;
}

// Only guest and licensed are ever stored, so a transient failure is retried on
// the next view instead of being remembered for a day.
function readCached(key: string, now: number): 'guest' | 'licensed' | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if ((entry?.kind !== 'guest' && entry?.kind !== 'licensed') || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
    const age = now - entry.at;
    return age >= 0 && age < VIEWER_ACCOUNT_KIND_TTL_MS ? entry.kind : null;
  } catch {
    return null; // Storage unavailable or corrupt: look the viewer up again.
  }
}

function writeCached(key: string, kind: 'guest' | 'licensed', now: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ kind, at: now }));
  } catch { /* Storage unavailable or full: the cache is an optimisation only. */ }
}

// The current user, read as the viewer. `requestConfluenceJson` hands back the
// bridge's Response, so check it before parsing.
async function fetchCurrentUserViaBridge(): Promise<unknown> {
  const response = await requestConfluenceJson(CURRENT_USER_URL, 'GET');
  if (!response?.ok) throw new Error(`HTTP ${response?.status}`);
  return response.json();
}

export async function viewerAccountKind(input: {
  accountId?: string;
  clientDomain: string;
  now?: number;
  fetchCurrentUser?: () => Promise<unknown>;
}): Promise<ViewerAccountKind> {
  const { accountId, clientDomain, now = Date.now(), fetchCurrentUser = fetchCurrentUserViaBridge } = input;
  // No account in the Forge context means nobody is signed in: no request, no cache.
  if (!accountId) return 'anonymous';
  const key = cacheKey(clientDomain, accountId);
  const cached = readCached(key, now);
  if (cached) return cached;
  try {
    const user = await fetchCurrentUser();
    if (!user || typeof user !== 'object' || Array.isArray(user)) return 'unknown';
    const { isGuest } = user as { isGuest?: unknown };
    if (typeof isGuest !== 'boolean') return 'unknown';
    const kind = isGuest ? 'guest' : 'licensed';
    writeCached(key, kind, now);
    return kind;
  } catch {
    return 'unknown';
  }
}
