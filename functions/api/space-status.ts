import { getAuthorizationHeader } from '../utils/requestUtils';
import { decode } from '../utils/atlassian';
import { getInstallationData } from '../utils/installationUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import type { SpaceLicenseRecord } from './space-license';

interface Env {
  confluence_plugin_installations: KVNamespace;
  SPACE_LICENSE_KV: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
  FORGE_CONTEXT?: any;
}

interface SpaceStatusResponse {
  isPaid: boolean;
  source?: 'space_license';
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
    headers['Cache-Control'] = 'max-age=300';
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
    const isForge = request.headers.get('x-forge-oauth-user');
    const jwt = getAuthorizationHeader(request);

    if (!jwt) {
      return jsonResponse(401, {
        isPaid: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }

    let cloudId: string | undefined;
    let spaceKey: string | undefined;

    const url = new URL(request.url);

    if (isForge) {
      // Forge: validate JWT and extract cloudId from token, spaceKey from query param
      const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
      if (!allowedForgeAppIds) {
        console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
        return jsonResponse(500, {
          isPaid: false,
          error: 'server_configuration',
          message: 'ALLOWED_FORGE_APP_IDS not configured',
        });
      }

      const payload = await validateContextToken(jwt, allowedForgeAppIds);
      cloudId = payload?.payload?.context?.cloudId;
      spaceKey = url.searchParams.get('spaceKey') || undefined;
    } else {
      // Connect: validate JWT, extract clientKey (=cloudId) from JWT, spaceKey from query param
      const installationData = await getInstallationData(env, request);
      decode(jwt, (installationData as any).sharedSecret);

      // In Connect mode, clientKey from JWT iss is the cloud identifier
      // Frontend can also pass cloudId explicitly as a query param
      cloudId = url.searchParams.get('cloudId') || (installationData as any)?.clientKey || undefined;
      spaceKey = url.searchParams.get('spaceKey') || undefined;
    }

    if (!cloudId || !spaceKey) {
      console.log('space-status: missing cloudId or spaceKey', { cloudId, spaceKey });
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    // KV-only license check — no fallback to Atlassian lic param or Forge accountType
    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    const key = `license:${cloudId}:${spaceKey}`;
    const raw = await env.SPACE_LICENSE_KV.get(key);

    if (!raw) {
      console.log('space-status: no license found for', key);
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    const record = JSON.parse(raw) as SpaceLicenseRecord;

    // Check active status and expiry
    const isActive = record.status === 'active';
    const isExpired = new Date(record.expiresAt) < new Date();
    const isPaid = isActive && !isExpired;

    console.log('space-status: license check', {
      key,
      status: record.status,
      expiresAt: record.expiresAt,
      isActive,
      isExpired,
      isPaid,
    });

    if (isPaid) {
      return jsonResponse(200, { isPaid: true, source: 'space_license' }, 'short');
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
