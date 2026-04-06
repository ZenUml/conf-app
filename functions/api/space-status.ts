import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';

interface Env {
  ALLOWED_FORGE_APP_IDS?: string;
  FORGE_CONTEXT?: any;
}

interface SpaceStatusResponse {
  isPaid: boolean;
  accountType?: string;
  source?: 'forge_context';
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

    const payload = await validateContextToken(jwt, allowedForgeAppIds);

    const accountType = payload?.payload?.context?.accountType;
    const isPaid = accountType === 'licensed';

    const spaceStatus: SpaceStatusResponse = {
      isPaid,
      accountType,
      source: 'forge_context'
    };

    console.log('Forge space status check:', spaceStatus);

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
