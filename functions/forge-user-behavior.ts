import { OkResponse, response } from "./OkResponse";
import { mixpanelTrack } from "./service/mixpanelService";
import { captureError } from "./utils/sentry";
import { getAuthorizationHeader } from "./utils/requestUtils";
import { validateContextToken } from "./utils/authenticate";
import { ForgeUserBehaviorEventBody, mapForgeUserBehaviorEvent } from "./service/forgeUserBehavior";
import { getForgeInstallationClientDomain } from "./utils/dbUtils";
import { D1Database } from "@cloudflare/workers-types";

interface Env {
  ALLOWED_FORGE_APP_IDS?: string;
  DB: D1Database;
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
    const clientDomain = await getForgeInstallationClientDomain(
      env.DB,
      forgeContext.payload?.app?.id,
      forgeContext.payload?.context?.cloudId,
    );
    const analyticsEvent = mapForgeUserBehaviorEvent(body, forgeContext, { clientDomain });

    if (!analyticsEvent) {
      return OkResponse({ ignored: true });
    }

    waitUntil(mixpanelTrack(analyticsEvent));
    return OkResponse();
  } catch (error) {
    console.error("Error in forge-user-behavior:", error);
    captureError(error);
    return response(500, "Internal Server Error");
  }
};
