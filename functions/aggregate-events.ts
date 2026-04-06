import { response } from "./OkResponse";
import { captureError } from "./utils/sentry";
import { aggregateDailyCounters, purgeOldEvents } from "./utils/dbUtils";
import { D1Database } from "@cloudflare/workers-types";

interface Env {
  DB: D1Database;
  CRON_SECRET?: string;
}

// Aggregate raw events into daily counters and purge old raw events.
// Trigger via cron or manual POST with CRON_SECRET header.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return response(405, "Method Not Allowed");
  }

  const secret = request.headers.get("x-cron-secret");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return response(401, "Unauthorized");
  }

  try {
    await aggregateDailyCounters(env.DB);
    await purgeOldEvents(env.DB, 60);

    return Response.json({ ok: true, message: "Aggregation and purge completed" });
  } catch (error) {
    console.error("Error in aggregate-events:", error);
    captureError(error);
    return response(500, "Internal Server Error");
  }
};
