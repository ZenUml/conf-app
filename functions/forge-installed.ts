import { captureError } from "./utils/sentry";
import {OkResponse, response} from "./OkResponse";
import { upsertForgeInstallation } from "./utils/dbUtils";
import { ForgeAppRequestBody } from "./RequestBody";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";

export const onRequest: PagesFunction = async ({ request, env }) => {
  try {
    const authHeader = getAuthorizationHeader(request);
    if (!authHeader) {
      return response(401, 'Unauthorized: Missing Authorization header');
    }

    const allowedForgeAppIds = (env as any).ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return response(500, 'Server configuration error: ALLOWED_FORGE_APP_IDS not configured');
    }

    try {
      await validateContextToken(authHeader, allowedForgeAppIds);
    } catch (e) {
      console.log('forge-installed JWT validation failed:', e.message);
      return response(401, 'Unauthorized: JWT validation failed');
    }

    const data = await request.json() as ForgeAppRequestBody;
    console.log('forge-installed body:', data);
    await upsertForgeInstallation((env as any).DB, data);

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
