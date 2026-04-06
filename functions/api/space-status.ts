import { OkResponse, response } from '../OkResponse';
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return response(405, 'Method Not Allowed');
  }

  try {
    const jwt = getAuthorizationHeader(request);

    if (!jwt) {
      return response(401, 'Unauthorized: Missing or invalid Authorization header');
    }

    const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return response(500, 'Server configuration error: ALLOWED_FORGE_APP_IDS not configured');
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

    return new Response(JSON.stringify(spaceStatus), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300'
      }
    });
  } catch (error) {
    console.error('Error checking space status:', error);
    captureError(error);
    return response(500, 'Internal Server Error');
  }
};
