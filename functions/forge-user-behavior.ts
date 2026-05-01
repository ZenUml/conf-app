import { OkResponse, response } from "./OkResponse";
import { mixpanelTrack, MIXPANEL_TOKEN_FORGE_USER_BEHAVIOUR } from "./service/mixpanelService";
import { captureError } from "./utils/sentry";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";
import { ForgeUserBehaviorEventBody, mapForgeUserBehaviorEvent } from "./service/forgeUserBehavior";
import { getAtlassianInstanceClientDomain, getForgeInstallationClientDomain, insertUserBehaviorEvent, upsertAtlassianInstance } from "./utils/dbUtils";
import { archiveAnalyticsEvent, insertAnalyticsEventFact, normalizeMappedAnalyticsEvent } from "./utils/analytics";
import { D1Database } from "@cloudflare/workers-types";

interface Env {
  ALLOWED_FORGE_APP_IDS?: string;
  DB: D1Database;
  EVENT_BUCKET?: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") {
    return response(405, "Method Not Allowed");
  }

  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return response(401, "Unauthorized: Missing or invalid Authorization header");
    }

    const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      console.error("ALLOWED_FORGE_APP_IDS environment variable is not set");
      return response(500, "Server configuration error: ALLOWED_FORGE_APP_IDS not configured");
    }

    const forgeContext = await validateContextToken(jwt, allowedForgeAppIds);
    const body = await request.json() as ForgeUserBehaviorEventBody;

    const cloudId = forgeContext.payload?.context?.cloudId;
    const siteUrl = forgeContext.payload?.context?.siteUrl;

    // Populate AtlassianInstance from siteUrl when available
    if (cloudId && siteUrl) {
      try {
        const domain = new URL(siteUrl).hostname;
        if (domain) {
          waitUntil(upsertAtlassianInstance(env.DB, cloudId, domain));
        }
      } catch (e) {
        console.log('Could not parse siteUrl for AtlassianInstance upsert:', e);
      }
    }

    const clientDomain = await getAtlassianInstanceClientDomain(env.DB, cloudId)
      || await getForgeInstallationClientDomain(env.DB, forgeContext.payload?.app?.id, cloudId);
    const analyticsEvent = mapForgeUserBehaviorEvent(body, forgeContext, { clientDomain });

    if (!analyticsEvent) {
      return OkResponse({ ignored: true });
    }

    // Store event in D1 for analysis
    waitUntil(insertUserBehaviorEvent(env.DB, analyticsEvent));
    waitUntil((async () => {
      const canonicalEvent = normalizeMappedAnalyticsEvent(analyticsEvent as unknown as Record<string, unknown>, 'forge');
      const r2Key = await archiveAnalyticsEvent(env.EVENT_BUCKET, canonicalEvent, analyticsEvent as unknown as Record<string, unknown>);
      await insertAnalyticsEventFact(env.DB, canonicalEvent, r2Key);
    })());

    // Comment out the actual Mixpanel tracking for now to avoid sending data which incur costs during testing. We can enable it once we're ready to track real events.
    // waitUntil(mixpanelTrack(analyticsEvent, MIXPANEL_TOKEN_FORGE_USER_BEHAVIOUR));
    return OkResponse();
  } catch (error) {
    console.error("Error in forge-user-behavior:", error);
    captureError(error);
    return response(500, "Internal Server Error");
  }
};
