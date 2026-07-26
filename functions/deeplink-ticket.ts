import { OkResponse, response } from "./OkResponse";
import { captureError } from "./utils/sentry";
import type { ForgeRequestData } from "./utils/authenticate";

// Mints a shareable-preview ticket for an embed deeplink (byline-activation
// spec §6, "Ticketed preview"). The caller is an authenticated Forge frontend
// invocation — the minter is looking at the diagram with read permission, so
// uploading its current PNG render here is an authorized, deliberate share.
//
//   img:<token>     PNG bytes, expirationTtl = IMG_TTL_SECONDS — PHYSICAL
//                   deletion is the capability expiry (10 minutes: links are
//                   for instant sharing; Slack's unfurl crawler fetches within
//                   seconds and Slack's image proxy carries the display after
//                   our source disappears).
//   ticket:<token>  {v,d,p,c,t,m} — site domain + pageId etc., no TTL: the
//                   "Open in Confluence" click-through is permanent. The
//                   redirect target comes ONLY from deliberately minted
//                   tickets, never resolved from a bare cloudId (that would
//                   make the deeplink Worker a public cloudId→hostname
//                   reverse-resolver).

export interface Env {
  DB: D1Database;
  DEEPLINK_KV?: KVNamespace;
}

export const IMG_TTL_SECONDS = 600;
const MAX_PNG_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_CHARS = 300;
const DIGITS_RE = /^\d+$/;
const ATLASSIAN_HOST_RE = /^[a-z0-9][a-z0-9.-]*\.atlassian\.net$/i;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64(b64: string): Uint8Array | undefined {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: Env;
  data: ForgeRequestData;
}) => {
  if (request.method !== "POST") {
    return response(405, "Method not allowed");
  }
  const kv = env.DEEPLINK_KV;
  if (!kv) {
    // Namespace not yet bound in this environment — feature off, not an error.
    return response(503, "Deeplink preview is not configured in this environment");
  }
  const cloudId = data.forgeContext?.cloudId;
  if (!cloudId) {
    return response(401, "Missing cloudId in Forge context");
  }

  let body: {
    contentId?: unknown;
    pageId?: unknown;
    title?: unknown;
    pngBase64?: unknown;
    siteHostname?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return response(400, "Invalid JSON body");
  }

  const contentId = typeof body.contentId === "string" ? body.contentId : "";
  const pageId = typeof body.pageId === "string" ? body.pageId : "";
  if (!DIGITS_RE.test(contentId) || !DIGITS_RE.test(pageId)) {
    return response(400, "contentId and pageId must be numeric strings");
  }
  const title =
    typeof body.title === "string" ? body.title.slice(0, MAX_TITLE_CHARS) : undefined;

  const png =
    typeof body.pngBase64 === "string" ? decodeBase64(body.pngBase64) : undefined;
  if (!png || !isPng(png)) {
    return response(400, "pngBase64 must be a base64-encoded PNG");
  }
  if (png.length > MAX_PNG_BYTES) {
    return response(413, `PNG exceeds ${MAX_PNG_BYTES} bytes`);
  }

  // Site hostname: prefer D1 (AtlassianInstance is upserted from the verified
  // token's siteUrl on every authenticated frontend call), fall back to the
  // caller-supplied value. Either way it must be *.atlassian.net — the ticket
  // is a redirect target, so this is the anti-open-redirect gate.
  let domain: string | undefined;
  try {
    const row = await env.DB.prepare(
      "SELECT clientDomain FROM AtlassianInstance WHERE cloudId = ?1",
    )
      .bind(cloudId)
      .first<{ clientDomain: string }>();
    domain = row?.clientDomain ?? undefined;
  } catch (e) {
    console.warn("AtlassianInstance lookup failed:", e);
  }
  if (!domain && typeof body.siteHostname === "string") {
    domain = body.siteHostname;
  }
  if (!domain || !ATLASSIAN_HOST_RE.test(domain)) {
    return response(409, "Site hostname unknown for this cloudId; cannot mint a ticket");
  }

  const token = randomToken();
  try {
    await kv.put(`img:${token}`, png.buffer as ArrayBuffer, {
      expirationTtl: IMG_TTL_SECONDS,
    });
    await kv.put(
      `ticket:${token}`,
      JSON.stringify({
        v: 1,
        d: domain.toLowerCase(),
        p: pageId,
        c: contentId,
        ...(title ? { t: title } : {}),
        m: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error("deeplink-ticket KV write failed:", error);
    captureError(error);
    return response(500, "Failed to store the preview");
  }

  return OkResponse({
    token,
    url: `https://confluence.zenuml.com/d/${cloudId}/${contentId}?t=${token}`,
    imageTtlSeconds: IMG_TTL_SECONDS,
  });
};
