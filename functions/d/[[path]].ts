// functions/d/[[path]].ts
// Serves the /d/<cloudId>/<contentId> deeplink page — ported from
// workers/confluence-deeplink/src/index.ts lines 375-394 (the
// STRICT_DEEPLINK_RE branch + the loose /d instruction fallback). Does NOT
// port the Worker's `/` redirect or generic 404 — see the file-level note in
// this plan's Task 4 header.
//
// Catch-all route: functions/d/[[path]].ts matches /d, /d/x, /d/x/y, ... .
// The pathname is re-read from the full request URL (not reconstructed from
// `params.path`) so the regex logic below is a direct, auditable copy of the
// Worker's.
import type { Env } from "../utils/deeplink";
import { verifyToken, imageFresh } from "../utils/deeplink";
import {
  INSTRUCTION_PAGE,
  STATIC_PAGE_HEADERS,
  TICKETED_PAGE_HEADERS,
  PREVIEW_PAGE_HEADERS,
  previewPage,
  expiredPage,
} from "../utils/deeplinkPages";

const STRICT_DEEPLINK_RE = /^\/d\/([0-9a-fA-F-]{32,36})\/(\d+)\/?$/;
const SIGNED_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const onRequest: PagesFunction<Env, "path"> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const url = new URL(request.url);
  const { pathname } = url;

  const strict = STRICT_DEEPLINK_RE.exec(pathname);
  if (strict && env.DEEPLINK_SIGN_SECRET) {
    const token = url.searchParams.get("t");
    if (token && SIGNED_TOKEN_RE.test(token)) {
      const ticket = await verifyToken(token, env.DEEPLINK_SIGN_SECRET);
      // Bind the ticket to the path it was minted for.
      if (ticket && ticket.c === strict[2]) {
        return imageFresh(ticket)
          ? new Response(previewPage(url.origin, token, ticket), { status: 200, headers: PREVIEW_PAGE_HEADERS })
          : new Response(expiredPage(ticket), { status: 200, headers: TICKETED_PAGE_HEADERS });
      }
    }
  }

  // Loose on purpose: any /d/* without a usable ticket gets the instruction
  // page, so truncated or hand-mangled links still land somewhere helpful.
  return new Response(INSTRUCTION_PAGE, { status: 200, headers: STATIC_PAGE_HEADERS });
};
