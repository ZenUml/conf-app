import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import type { SpaceLicenseRecord } from './space-license';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
}

interface SpaceStatusResponse {
  isPaid: boolean;
  source?: 'user_license' | 'space_license';
}

/** Forge invokeRemote requires valid JSON + application/json for every status (incl. errors). */
function jsonResponse(
  status: number,
  body: SpaceStatusResponse & { error?: string; message?: string },
  cache: 'short' | 'none' = 'none'
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cache === 'short') {
    // 'private': the response varies by the caller's accountId (user-scoped
    // license), not just cloudId+spaceKey — a shared/CDN cache must not reuse
    // one user's response for another user on the same space.
    headers['Cache-Control'] = 'private, max-age=300';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonResponse(405, {
      isPaid: false,
      error: 'method_not_allowed',
      message: 'Method Not Allowed',
    });
  }

  try {
    const jwt = getAuthorizationHeader(request);

    if (!jwt) {
      return jsonResponse(401, {
        isPaid: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }

    const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return jsonResponse(500, {
        isPaid: false,
        error: 'server_configuration',
        message: 'ALLOWED_FORGE_APP_IDS not configured',
      });
    }

    const url = new URL(request.url);
    const payload = await validateContextToken(jwt, allowedForgeAppIds);
    const cloudId = payload.cloudId || payload.payload.context?.cloudId;
    // Derived from the Forge-validated token, never a client query param — a
    // query param would let any user claim another user's accountId.
    const accountId = payload?.payload?.principal;
    const spaceKey = url.searchParams.get('spaceKey') || undefined;

    if (!cloudId || !spaceKey) {
      console.log('space-status: missing cloudId or spaceKey', { cloudId, spaceKey });
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    // User-scoped extension (checked first): only when the token carries a
    // real accountId — never build/match a key on a missing one.
    if (accountId) {
      const userLicenseRaw = await env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}:${accountId}`);
      if (userLicenseRaw) {
        const userRecord = JSON.parse(userLicenseRaw) as SpaceLicenseRecord;
        const userIsActive = userRecord.status === 'active';
        const userIsExpired = new Date(userRecord.expiresAt) < new Date();
        if (userIsActive && !userIsExpired) {
          return jsonResponse(200, { isPaid: true, source: 'user_license' }, 'short');
        }
      }
    }

    const licenseRaw = await env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}`);

    if (!licenseRaw) {
      console.log('space-status: no license found for', `license:${cloudId}:${spaceKey}`);
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    const record = JSON.parse(licenseRaw) as SpaceLicenseRecord;

    const isActive = record.status === 'active';
    const isExpired = new Date(record.expiresAt) < new Date();
    const isPaid = isActive && !isExpired;

    console.log('space-status: license check', {
      key: `license:${cloudId}:${spaceKey}`,
      status: record.status,
      expiresAt: record.expiresAt,
      isActive,
      isExpired,
      isPaid,
    });

    if (isPaid) {
      return jsonResponse(
        200,
        { isPaid: true, source: 'space_license' },
        'short'
      );
    }

    return jsonResponse(200, { isPaid: false }, 'short');
  } catch (error) {
    console.error('Error checking space status:', error);
    captureError(error);
    return jsonResponse(500, {
      isPaid: false,
      error: 'internal_error',
      message: 'Internal Server Error',
    });
  }
};
