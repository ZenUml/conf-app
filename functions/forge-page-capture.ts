import { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { response } from "./OkResponse";

interface Env {
  EVENT_BUCKET?: R2Bucket;
  PAGE_CAPTURE_SECRET?: string;
  /** Comma-separated Atlassian subdomain prefixes to capture (e.g. "colesgroup,airwallex"). Empty = capture all. */
  PAGE_CAPTURE_ALLOWED_DOMAINS?: string;
  DB?: D1Database;
}

export interface PageCapturePayload {
  cloudId: string;
  contentId: string;
  contentTitle: string | null;
  contentType: string;
  versionNumber: number;
  versionWhen: string | null;
  versionBy: string | null;
  spaceKey: string | null;
  spaceName: string | null;
  capturedAt: string;
  body: { value: string; representation: string } | null;
}

export function buildPageSnapshotKey(
  cloudId: string,
  contentId: string,
  versionNumber: number,
): string {
  return `page-snapshots/${cloudId}/${contentId}/v${versionNumber}.json`;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return response(405, "Method Not Allowed");
  }

  const secret = env.PAGE_CAPTURE_SECRET;
  if (!secret) {
    console.error("forge-page-capture: PAGE_CAPTURE_SECRET not configured");
    return response(500, "Server configuration error");
  }

  const tokenHeader = request.headers.get("X-Page-Capture-Token");
  if (!tokenHeader || tokenHeader !== secret) {
    return response(401, "Unauthorized");
  }

  const bucket = env.EVENT_BUCKET;
  if (!bucket) {
    console.error("forge-page-capture: EVENT_BUCKET not configured");
    return response(500, "Server configuration error");
  }

  let payload: PageCapturePayload;
  try {
    payload = await request.json();
  } catch {
    return response(400, "Invalid JSON body");
  }

  const { contentId, versionNumber, cloudId } = payload;

  if (!contentId || !versionNumber) {
    return response(400, "Missing required fields: contentId, versionNumber");
  }

  if (!cloudId) {
    console.warn("forge-page-capture: no cloudId in payload, skipping");
    return response(400, "Missing required field: cloudId");
  }

  // Domain allowlist check: if PAGE_CAPTURE_ALLOWED_DOMAINS is configured, only
  // capture pages from those Atlassian subdomains (e.g. "colesgroup,airwallex").
  const allowedDomains = env.PAGE_CAPTURE_ALLOWED_DOMAINS
    ? env.PAGE_CAPTURE_ALLOWED_DOMAINS.split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  if (allowedDomains.length > 0) {
    const row = await env.DB?.prepare(
      "SELECT clientDomain FROM AtlassianInstance WHERE cloudId = ? LIMIT 1",
    ).bind(cloudId).first<{ clientDomain: string }>();

    const subdomain = row?.clientDomain ? row.clientDomain.split(".")[0] : null;
    if (!subdomain || !allowedDomains.includes(subdomain)) {
      console.log(`forge-page-capture: subdomain=${subdomain ?? "unknown"} not in allowlist, skipping`);
      return new Response(JSON.stringify({ stored: false, reason: "domain_not_allowed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const key = buildPageSnapshotKey(cloudId, contentId, versionNumber);
  console.log(`forge-page-capture: key=${key}`);

  // Deduplication: skip write if this version is already stored
  const existing = await bucket.head(key);
  if (existing) {
    console.log(`forge-page-capture: dedup hit for key=${key}`);
    return new Response(JSON.stringify({ stored: false, reason: "already_exists", key }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await bucket.put(
    key,
    JSON.stringify(payload),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        contentId,
        version: String(versionNumber),
        spaceKey: payload.spaceKey ?? "",
        capturedAt: payload.capturedAt,
      },
    },
  );

  console.log(`forge-page-capture: stored key=${key}`);
  return new Response(JSON.stringify({ stored: true, key }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
