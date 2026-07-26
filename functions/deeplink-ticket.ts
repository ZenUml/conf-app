import { OkResponse, response } from "./OkResponse";
import { captureError } from "./utils/sentry";
import type { ForgeRequestData } from "./utils/authenticate";

// Mints a shareable-preview ticket for an embed deeplink (byline-activation
// spec §6, "Ticketed preview"). The caller is an authenticated Forge frontend
// invocation — the minter is looking at the diagram with read permission, so
// uploading its current PNG render here is an authorized, deliberate share.
//
// SIGNED-TOKEN design: the metadata (domain, pageId, contentId, mint-time,
// dims, title) rides INSIDE the URL as an HMAC-signed token —
// `?t=base64url(payload).base64url(hmac)` — not stored server-side. So the
// expiry (mint-time `m`) is in the token and can't be extended server-side, the
// payload is tamper-proof (Worker rejects a bad signature), and there is NO
// `ticket:` KV to write/read/clean up. The ONLY KV write is the PNG:
//   img:<i>  PNG bytes, expirationTtl = IMG_TTL_SECONDS — physical 10-min
//            backstop; `i` is a random id embedded in the signed payload.
// Requires DEEPLINK_SIGN_SECRET (SAME value as the confluence-deeplink Worker).
// Set it on every Pages project serving this endpoint (conf-lite/full,
// conf-stg-lite/full) via `wrangler pages secret put DEEPLINK_SIGN_SECRET`, or
// the mint 503s. The redirect domain comes ONLY from the DB lookup on the FIT
// cloudId, never a bare-cloudId reverse-resolve.

export interface Env {
  DB: D1Database;
  DEEPLINK_KV?: KVNamespace;
  // HMAC secret shared with the confluence-deeplink Worker. Same value both
  // places or the Worker rejects every token.
  DEEPLINK_SIGN_SECRET?: string;
}

export const IMG_TTL_SECONDS = 600;
const MAX_PNG_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_CHARS = 300;
const DIGITS_RE = /^\d+$/;
const ATLASSIAN_HOST_RE = /^[a-z0-9][a-z0-9.-]*\.atlassian\.net$/i;

// URL-safe id for the KV image object (also embedded in the signed payload).
function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

// --- Signing (MUST stay byte-compatible with workers/confluence-deeplink) ---
const SIGN_ENC = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", SIGN_ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, SIGN_ENC.encode(msg)));
}

// token = base64url(payloadJSON) "." base64url(hmac(payloadJSON))
async function signTicket(payload: object, secret: string): Promise<string> {
  const payloadB64 = b64url(SIGN_ENC.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, payloadB64));
  return `${payloadB64}.${sig}`;
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
    width?: number;
    height?: number;
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

  const secret = env.DEEPLINK_SIGN_SECRET;
  if (!secret) {
    return response(503, "Deeplink signing is not configured in this environment");
  }

  // Only the PNG lives in KV now (keyed by a random id, physical 10-min expiry
  // as the backstop). Everything else — including the mint-time that drives
  // expiry — rides inside the signed token, so there is no ticket row to store,
  // read, or clean up, and the expiry cannot be extended server-side.
  const imgId = randomId();
  const w = typeof body.width === "number" && body.width > 0 ? Math.round(body.width) : undefined;
  const h = typeof body.height === "number" && body.height > 0 ? Math.round(body.height) : undefined;
  const payload = {
    d: domain.toLowerCase(),
    p: pageId,
    c: contentId,
    m: new Date().toISOString(),
    i: imgId,
    ...(title ? { t: title } : {}),
    ...(w && h ? { w, h } : {}),
  };

  let token: string;
  try {
    await kv.put(`img:${imgId}`, png.buffer as ArrayBuffer, { expirationTtl: IMG_TTL_SECONDS });
    token = await signTicket(payload, secret);
  } catch (error) {
    console.error("deeplink-ticket mint failed:", error);
    captureError(error);
    return response(500, "Failed to store the preview");
  }

  return OkResponse({
    token,
    url: `https://confluence.zenuml.com/d/${cloudId}/${contentId}?t=${token}`,
    imageTtlSeconds: IMG_TTL_SECONDS,
  });
};
