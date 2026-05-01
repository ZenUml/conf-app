import {captureError, captureUninstalledMessage} from "./utils/sentry";
import {OkResponse, response} from "./OkResponse";
import {postData} from "./utils/zaraz";
import {saveToBucket} from "./utils/R2Bucket";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";
import {
  archiveAnalyticsEvent,
  insertAnalyticsEventFact,
  normalizeUninstallAnalyticsEvent,
} from "./utils/analytics";

export const onRequest: PagesFunction = async ({ request, env }) => {
  try {
    const authHeader = getAuthorizationHeader(request);
    const allowedForgeAppIds = (env as any).ALLOWED_FORGE_APP_IDS;
    if (authHeader && allowedForgeAppIds) {
      try {
        await validateContextToken(authHeader, allowedForgeAppIds);
      } catch (e) {
        console.log('uninstalled JWT validation failed:', e.message);
        return response(401, 'Unauthorized: JWT validation failed');
      }
    } else {
      console.warn('uninstalled: missing Authorization header or ALLOWED_FORGE_APP_IDS — proceeding without auth (Connect migration bridge)');
    }

    const body = await request.json() as Record<string, any>;
    captureUninstalledMessage(body.key, body.clientKey, body.baseUrl);

    const domain = body.baseUrl ? new URL(body.baseUrl).hostname : 'unknown';
    await postData(body.eventType || 'uninstalled', body.key, body.clientKey, domain);
    // @ts-ignore
    await saveToBucket(env.EVENT_BUCKET, domain, body);
    const analyticsEvent = normalizeUninstallAnalyticsEvent(body);
    const r2Key = await archiveAnalyticsEvent((env as any).EVENT_BUCKET, analyticsEvent, body);
    await insertAnalyticsEventFact((env as any).DB, analyticsEvent, r2Key);
  } catch (e: unknown) {
    console.log(`Error: ${e}`);
    captureError(e)
  }
  return OkResponse(undefined);
};
