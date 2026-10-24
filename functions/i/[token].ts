// functions/i/[token].ts
// Serves the /i/<token> preview PNG — ported from
// workers/confluence-deeplink/src/index.ts lines 353-373 (the imgMatch
// branch of the Worker's fetch()). The path segment IS the signed token;
// Cloudflare's [token] dynamic route captures it directly, so there is no
// need to re-parse it out of the full pathname the way the standalone Worker
// did with a regex over `pathname`.
import type { Env } from "../utils/deeplink";
import { verifyToken, imageFresh, imgKeyFor } from "../utils/deeplink";

// Same character-class + length bound as the Worker's imgMatch regex
// (`/^\/i\/([A-Za-z0-9_.-]{20,4096})$/`), applied to the captured segment only.
const TOKEN_RE = /^[A-Za-z0-9_.-]{20,4096}$/;

export const onRequest: PagesFunction<Env, "token"> = async ({ request, env, params }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const token = typeof params.token === "string" ? params.token : "";
  if (!TOKEN_RE.test(token) || !env.DEEPLINK_KV || !env.DEEPLINK_SIGN_SECRET) {
    return new Response("Not found", { status: 404 });
  }
  const ticket = await verifyToken(token, env.DEEPLINK_SIGN_SECRET);
  if (!ticket || !imageFresh(ticket)) return new Response("Not found", { status: 404 });
  const imgId = await imgKeyFor(token.split(".")[0]);
  const png = await env.DEEPLINK_KV.get(`img:${imgId}`, "arrayBuffer");
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, {
    status: 200,
    headers: {
      "content-type": "image/png",
      // Short cache so CDNs can't extend the capability much past expiry.
      "cache-control": "public, max-age=300",
    },
  });
};
