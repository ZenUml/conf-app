import { getAuthorizationHeader } from '../utils/requestUtils';
import { decode } from '../utils/atlassian';
import { getInstallationData } from '../utils/installationUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';

interface Env {
  confluence_plugin_installations: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
  FORGE_CONTEXT?: any;
}

interface SpaceStatusResponse {
  isPaid: boolean;
  licenseStatus?: string;
  accountType?: string;
  appKey?: string;
  source?: 'lic_param' | 'api_call' | 'forge_context';
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
    // Check if this is a Forge request
    const isForge = request.headers.get('x-forge-oauth-user');
    const jwt = getAuthorizationHeader(request);

    if (!jwt) {
      return jsonResponse(401, {
        isPaid: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }

    let spaceStatus: SpaceStatusResponse;

    if (isForge) {
      // Handle Forge requests
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

      // Check accountType from Forge context
      // According to Atlassian docs, 'licensed' means the app is paid for this instance
      const accountType = payload?.payload?.context?.accountType;
      const isPaid = accountType === 'licensed';

      spaceStatus = {
        isPaid,
        accountType,
        source: 'forge_context'
      };

      console.log('Forge space status check:', spaceStatus);
    } else {
      // Handle Connect requests
      const installationData = await getInstallationData(env, request);
      decode(jwt, (installationData as any).sharedSecret);

      // Get the 'lic' parameter from the request URL
      const url = new URL(request.url);
      const licParam = url.searchParams.get('lic');

      // According to Atlassian documentation:
      // 'active' means the license is valid and paid for this instance
      // 'evaluation' means it's in trial period
      // other values indicate invalid or expired licenses
      const isPaid = licParam === 'active';

      spaceStatus = {
        isPaid,
        licenseStatus: licParam || 'unknown',
        appKey: (installationData as any)?.key,
        source: 'lic_param'
      };

      console.log('Connect space status check:', spaceStatus);

      // Optional: Make API call to get more detailed license info
      // This requires making a request to /rest/atlassian-connect/1/addons/{app-key}
      // from the Confluence instance, which would need additional implementation
    }

    return jsonResponse(200, spaceStatus, 'short');
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