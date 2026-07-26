// Instruction page for ZenUML embed deeplinks (PR #360).
//
// Contract: the URL shape served here MUST stay in sync with two other places —
//   - manifest.yml  zenuml-embed-macro autoConvert matcher: https://confluence.zenuml.com/d/*/*
//   - src/utils/embedDeeplink.ts  DEEPLINK_RE
// Inside Confluence the link never reaches this Worker: the editor's server-side
// autoConvert matcher intercepts the paste and turns it into an Embed macro.
// This page exists ONLY for links that escape Confluence (Slack, email, address bar).
//
// Privacy: /d/<cloudId>/<contentId> paths identify customer sites. Never log the
// request URL, never reflect path segments into the response, and keep Workers
// observability/logpush OFF for this worker (docs/policies/client-privacy.md).

const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=3600",
  // Customer deeplink paths must not end up in search indexes.
  "x-robots-tag": "noindex",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
};

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0C66E4"/><stop offset="1" stop-color="#964AC2"/></linearGradient></defs><rect width="16" height="16" rx="3" fill="url(#g)"/><path d="M4 5h8M4 8h5M4 11h7" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  );

const INSTRUCTION_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ZenUML diagram link</title>
<meta property="og:site_name" content="ZenUML">
<meta property="og:type" content="website">
<meta property="og:title" content="ZenUML diagram link">
<meta property="og:description" content="Paste this link into a Confluence page and it turns into the diagram. The diagram stays in Confluence — the link itself carries no content and grants no access.">
<meta name="twitter:card" content="summary">
<link rel="icon" href="${FAVICON}">
<style>
  :root {
    --bg: #ffffff; --ink: #172b4d; --muted: #626f86; --line: #e4e6ea;
    --accent: #0c66e4; --accent2: #964ac2; --card: #f7f8fa;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1d2125; --ink: #dee4ea; --muted: #9fadbc; --line: #33393f; --card: #22272b; }
  }
  * { margin: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: grid; place-items: center; min-height: 100vh; padding: 24px;
  }
  main { max-width: 34rem; }
  .mark {
    display: inline-block; width: 40px; height: 40px; border-radius: 9px; margin-bottom: 20px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    position: relative;
  }
  .mark::after {
    content: ""; position: absolute; inset: 11px 9px;
    background:
      linear-gradient(#fff, #fff) 0 0 / 100% 3px,
      linear-gradient(#fff, #fff) 0 50% / 62% 3px,
      linear-gradient(#fff, #fff) 0 100% / 84% 3px;
    background-repeat: no-repeat; border-radius: 2px;
  }
  h1 { font-size: 1.55rem; line-height: 1.25; letter-spacing: -0.01em; text-wrap: balance; }
  .sub { color: var(--muted); margin: 10px 0 26px; }
  ol { padding: 0; margin: 0 0 26px; list-style: none; counter-reset: step; }
  ol li {
    counter-increment: step; position: relative; padding: 0 0 18px 44px;
  }
  ol li::before {
    content: counter(step); position: absolute; left: 0; top: -2px;
    width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--card); border: 1px solid var(--line);
    font-size: 0.85rem; font-weight: 600; color: var(--accent);
  }
  ol li:not(:last-child)::after {
    content: ""; position: absolute; left: 13.5px; top: 28px; bottom: 2px;
    width: 1px; background: var(--line);
  }
  ol b { font-weight: 600; }
  .note {
    background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: 14px 16px; font-size: 0.9rem; color: var(--muted);
  }
  footer { margin-top: 30px; font-size: 0.85rem; color: var(--muted); }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <span class="mark" role="img" aria-label="ZenUML"></span>
  <h1>This link becomes a diagram in Confluence</h1>
  <p class="sub">It points to a diagram stored in a Confluence site.</p>
  <ol>
    <li><b>Open a page</b> in the Confluence site the diagram belongs to, and start editing.</li>
    <li><b>Paste the link</b> anywhere in the page.</li>
    <li><b>Watch it convert</b> — the link turns into the live diagram automatically.</li>
  </ol>
  <p class="note">The diagram never leaves Confluence. This link carries no diagram
  content and grants no access — viewing it requires signing in to that Confluence
  site with permission to see it.</p>
  <footer>Powered by <a href="https://zenuml.com">ZenUML</a> — diagrams as code for Confluence.</footer>
</main>
</body>
</html>
`;

const NOT_FOUND_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found — ZenUML</title></head>
<body style="font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0;">
<p>Nothing here. Looking for <a href="https://zenuml.com">zenuml.com</a>?</p>
</body>
</html>
`;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const { pathname } = new URL(request.url);

    if (pathname === "/") {
      return Response.redirect("https://zenuml.com", 302);
    }

    // Loose on purpose: any /d/* gets the instruction page, so truncated or
    // hand-mangled links still land somewhere helpful. The strict shape lives
    // in the manifest matcher and embedDeeplink.ts, not here.
    if (pathname === "/d" || pathname.startsWith("/d/")) {
      return new Response(INSTRUCTION_PAGE, { status: 200, headers: PAGE_HEADERS });
    }

    return new Response(NOT_FOUND_PAGE, { status: 404, headers: PAGE_HEADERS });
  },
};
