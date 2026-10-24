import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import { json } from '../OkResponse';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
}

export interface UserCohortsResponse {
  cohorts: string[];
  accountId?: string;
  error?: string;
}

/**
 * KV record contract (written by scripts/cohorts/build-kv-bulk.mjs):
 *   cohort:user:<accountId> -> {"cohorts": ["vs-copier", ...]}
 * Keys live in SPACE_LICENSE_KV under the `cohort:` prefix — license keys use
 * the `license:` prefix, so the two datasets cannot collide.
 */
export function resolveCohorts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { cohorts?: unknown };
    if (!Array.isArray(parsed.cohorts)) return [];
    return parsed.cohorts.filter((c): c is string => typeof c === 'string');
  } catch {
    return [];
  }
}

// 'private': the response varies by the caller's accountId (from the token) -
// a shared/CDN cache must never reuse it across users. The client additionally
// holds a 24h localStorage TTL. Every status, errors included, carries it.
const PRIVATE_CACHE = { 'Cache-Control': 'private, max-age=3600' };

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return json({ cohorts: [], error: 'method_not_allowed' }, { status: 405, headers: PRIVATE_CACHE });
  }

  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return json({ cohorts: [], error: 'unauthorized' }, { status: 401, headers: PRIVATE_CACHE });
    }
    if (!env.ALLOWED_FORGE_APP_IDS) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return json({ cohorts: [], error: 'server_configuration' }, { status: 500, headers: PRIVATE_CACHE });
    }

    const payload = await validateContextToken(jwt, env.ALLOWED_FORGE_APP_IDS);
    // Derived from the Forge-validated token, never a query param — a query
    // param would let any user read another user's cohort membership.
    const accountId = payload?.payload?.principal;

    if (typeof accountId !== 'string' || !accountId) {
      return json({ cohorts: [] }, { status: 200, headers: PRIVATE_CACHE });
    }
    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return json({ cohorts: [], accountId }, { status: 200, headers: PRIVATE_CACHE });
    }

    const raw = await env.SPACE_LICENSE_KV.get(`cohort:user:${accountId}`);
    return json({ cohorts: resolveCohorts(raw), accountId }, { status: 200, headers: PRIVATE_CACHE });
  } catch (error) {
    console.error('user-cohorts error:', error);
    captureError(error);
    return json({ cohorts: [], error: 'internal_error' }, { status: 500, headers: PRIVATE_CACHE });
  }
};
