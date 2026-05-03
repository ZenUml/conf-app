import { captureError } from "./utils/sentry";
import {OkResponse, response} from "./OkResponse";
import { upsertForgeInstallation } from "./utils/dbUtils";
import { ForgeAppRequestBody } from "./RequestBody";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";
import {
  archiveAnalyticsEvent,
  insertAnalyticsEventFact,
  normalizeForgeInstallAnalyticsEvent,
} from "./utils/analytics";

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
    const analyticsEvent = normalizeForgeInstallAnalyticsEvent(data);
    const r2Key = await archiveAnalyticsEvent((env as any).EVENT_BUCKET, analyticsEvent, data as unknown as Record<string, unknown>);
    await insertAnalyticsEventFact((env as any).DB, analyticsEvent, r2Key);

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
