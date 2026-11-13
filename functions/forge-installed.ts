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
import { buildAppInstalledEvent } from "./service/appInstalledAnalytics";
import { mixpanelImportServiceEvents } from "./service/mixpanelService";

/**
 * Send app_installed (#1102) off the response path. Best-effort: a Mixpanel
 * failure is logged and never affects the D1 write or the trigger's 200.
 */
function emitAppInstalled(
  env: Record<string, unknown>,
  data: ForgeAppRequestBody,
  site: { cloudId: string | null; clientDomain: string | null },
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  const token = env.MIXPANEL_TOKEN;
  if (typeof token !== 'string' || !token) return;
  const event = buildAppInstalledEvent(data, { ...site, now: Date.now() });
  if (!event) return;
  waitUntil(
    mixpanelImportServiceEvents([event], token, { runtime: env }).catch((error) => {
      console.warn('[forge-installed] app_installed delivery failed', {
        reason: error instanceof Error ? error.name : 'unknown_error',
      });
    }),
  );
}

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
    const site = await upsertForgeInstallation((env as any).DB, data);
    emitAppInstalled(env as Record<string, unknown>, data, site, waitUntil);
    const analyticsEvent = normalizeForgeInstallAnalyticsEvent(data);
    const r2Key = await archiveAnalyticsEvent((env as any).EVENT_BUCKET, analyticsEvent, data as unknown as Record<string, unknown>);
    await insertAnalyticsEventFact((env as any).DB, analyticsEvent, r2Key);

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
