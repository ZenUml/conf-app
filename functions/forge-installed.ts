import { captureError } from "./utils/sentry";
import {OkResponse, response} from "./OkResponse";
import { upsertForgeInstallation } from "./utils/dbUtils";
import { ForgeAppRequestBody } from "./RequestBody";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";
import { normalizeForgeInstallAnalyticsEvent, recordAnalyticsEvent } from "./utils/analytics";

export const onRequest: PagesFunction = async ({ request, env, waitUntil }) => {
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
    try {
      await upsertForgeInstallation((env as any).DB, data);
    } catch (e) {
      // The install happened whether or not our row was written; still record it (#939).
      console.log(`forge-installed upsert failed: ${e}`);
      captureError(e);
    }
    recordAnalyticsEvent(
      { waitUntil }, env as any,
      normalizeForgeInstallAnalyticsEvent(data), data as unknown as Record<string, unknown>,
    );

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
