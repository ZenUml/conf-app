import {captureError, captureUninstalledMessage} from "./utils/sentry";
import {OkResponse, response} from "./OkResponse";
import {postData} from "./utils/zaraz";
import {saveToBucket} from "./utils/R2Bucket";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";
import { normalizeUninstallAnalyticsEvent, recordAnalyticsEvent } from "./utils/analytics";

export const onRequest: PagesFunction = async ({ request, env, waitUntil }) => {
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
    // The canonical record first, and independent of Zaraz and the legacy
    // `<domain>/lifecycle/` copy, which used to run ahead of it inline (#939).
    recordAnalyticsEvent({ waitUntil }, env as any, normalizeUninstallAnalyticsEvent(body), body);
    waitUntil(postData(body.eventType || 'uninstalled', body.key, body.clientKey, domain).catch((e) => {
      console.log(`uninstalled Zaraz post failed: ${e}`);
      captureError(e);
    }));
    // @ts-ignore
    waitUntil(saveToBucket(env.EVENT_BUCKET, domain, body));
  } catch (e: unknown) {
    console.log(`Error: ${e}`);
    captureError(e)
  }
  return OkResponse(undefined);
};
