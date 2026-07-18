import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';

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

/** Forge invokeRemote requires valid JSON + application/json for every status. */
function jsonResponse(status: number, body: UserCohortsResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // 'private': the response varies by the caller's accountId (from the
      // token) — a shared/CDN cache must never reuse it across users. The
      // client additionally holds a 24h localStorage TTL.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonResponse(405, { cohorts: [], error: 'method_not_allowed' });
  }

  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return jsonResponse(401, { cohorts: [], error: 'unauthorized' });
    }
    if (!env.ALLOWED_FORGE_APP_IDS) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return jsonResponse(500, { cohorts: [], error: 'server_configuration' });
    }

    const payload = await validateContextToken(jwt, env.ALLOWED_FORGE_APP_IDS);
    // Derived from the Forge-validated token, never a query param — a query
    // param would let any user read another user's cohort membership.
    const accountId = payload?.payload?.principal;

    if (typeof accountId !== 'string' || !accountId) {
      return jsonResponse(200, { cohorts: [] });
    }
    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return jsonResponse(200, { cohorts: [], accountId });
    }

    const raw = await env.SPACE_LICENSE_KV.get(`cohort:user:${accountId}`);
    return jsonResponse(200, { cohorts: resolveCohorts(raw), accountId });
  } catch (error) {
    console.error('user-cohorts error:', error);
    captureError(error);
    return jsonResponse(500, { cohorts: [], error: 'internal_error' });
  }
};
