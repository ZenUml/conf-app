// Deeplink pages for ZenUML embed links (PR #360 + byline-activation spec §6).
//
// Contract: the URL shape served here MUST stay in sync with two other places —
//   - manifest.yml  zenuml-embed-macro autoConvert matcher: https://confluence.zenuml.com/d/*/*
//   - src/utils/embedDeeplink.ts  DEEPLINK_RE
// Inside Confluence the link never reaches this Worker: the editor's server-side
// autoConvert matcher intercepts the paste and turns it into an Embed macro.
// This Worker serves links that escape Confluence (Slack, email, address bar).
//
// Three states (ticketed-preview design, settled 2026-07-26):
//   fresh ticket (`?t=` < 10 min)  → preview page: the diagram PNG + Open in Confluence.
//                                    og:image serves the PNG, so a Slack unfurl card IS
//                                    the diagram; Slack's image proxy caches it, letting
//                                    the message keep displaying after our source expires.
//   live ticket, image expired     → "preview expired" page + the permanent
//                                    Open-in-Confluence button (target from the ticket —
//                                    NEVER resolved from a bare cloudId, which would make
//                                    this a public cloudId→hostname reverse-resolver).
//   no/unknown ticket              → static instruction page.
// Tickets are minted by functions/deeplink-ticket.ts (authorized Forge users only);
// img:<token> physically expires via KV expirationTtl — deletion IS the capability expiry.
//
// Privacy: /d/<cloudId>/<contentId> paths identify customer sites. Never log the
// request URL, never reflect path segments into the response, and keep Workers
// observability/logpush OFF for this worker (docs/policies/client-privacy.md).

export interface Env {
  DEEPLINK_KV?: KVNamespace;
}

interface Ticket {
  v: number;
  d: string; // site hostname (*.atlassian.net)
  p: string; // pageId
  c: string; // contentId
  t?: string; // diagram title
  m: string; // minted-at ISO timestamp
}

const IMG_TTL_SECONDS = 600;
// Treat the image as expired slightly early so the preview page never links a
// PNG that vanishes mid-render.
const IMG_SAFETY_MARGIN_SECONDS = 30;

const STRICT_DEEPLINK_RE = /^\/d\/([0-9a-fA-F-]{32,36})\/(\d+)\/?$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ATLASSIAN_HOST_RE = /^[a-z0-9][a-z0-9.-]*\.atlassian\.net$/i;

const STATIC_PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=3600",
  // Customer deeplink paths must not end up in search indexes.
  "x-robots-tag": "noindex",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
};

// Ticketed pages change state at the 10-minute mark — never cache them.
const TICKETED_PAGE_HEADERS: Record<string, string> = {
  ...STATIC_PAGE_HEADERS,
  "cache-control": "no-store",
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0C66E4"/><stop offset="1" stop-color="#964AC2"/></linearGradient></defs><rect width="16" height="16" rx="3" fill="url(#g)"/><path d="M4 5h8M4 8h5M4 11h7" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  );

const BASE_STYLE = /* css */ `
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
  .note {
    background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: 14px 16px; font-size: 0.9rem; color: var(--muted);
  }
  ol.steps { padding: 0; margin: 0 0 26px; list-style: none; counter-reset: step; }
  ol.steps li { counter-increment: step; position: relative; padding: 0 0 18px 44px; }
  ol.steps li::before {
    content: counter(step); position: absolute; left: 0; top: -2px;
    width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--card); border: 1px solid var(--line);
    font-size: 0.85rem; font-weight: 600; color: var(--accent);
  }
  ol.steps li:not(:last-child)::after {
    content: ""; position: absolute; left: 13.5px; top: 28px; bottom: 2px;
    width: 1px; background: var(--line);
  }
  .btn {
    display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
    font-weight: 600; padding: 10px 18px; border-radius: 6px; margin: 0 0 22px;
  }
  .btn:hover { filter: brightness(1.08); }
  footer { margin-top: 30px; font-size: 0.85rem; color: var(--muted); }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
`;

function shell(opts: { title: string; og: string; body: string; extraStyle?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
<meta property="og:site_name" content="ZenUML">
<meta property="og:type" content="website">
${opts.og}
<meta name="twitter:card" content="summary">
<link rel="icon" href="${FAVICON}">
<style>${BASE_STYLE}${opts.extraStyle ?? ""}</style>
</head>
<body>
<main>
${opts.body}
<footer>Powered by <a href="https://zenuml.com">ZenUML</a> — diagrams as code for Confluence.</footer>
</main>
</body>
</html>
`;
}

const INSTRUCTION_BODY = /* html */ `
  <span class="mark" role="img" aria-label="ZenUML"></span>
  <h1>This link becomes a diagram in Confluence</h1>
  <p class="sub">It points to a diagram stored in a Confluence site.</p>
  <ol class="steps">
    <li><b>Open a page</b> in the Confluence site the diagram belongs to, and start editing.</li>
    <li><b>Paste the link</b> anywhere in the page.</li>
    <li><b>Watch it convert</b> — the link turns into the live diagram automatically.</li>
  </ol>
  <p class="note">The diagram never leaves Confluence. This link carries no diagram
  content and grants no access — viewing it requires signing in to that Confluence
  site with permission to see it.</p>
`;

const INSTRUCTION_PAGE = shell({
  title: "ZenUML diagram link",
  og: `<meta property="og:title" content="ZenUML diagram link">
<meta property="og:description" content="Paste this link into a Confluence page and it turns into the diagram. The diagram stays in Confluence — the link itself carries no content and grants no access.">`,
  body: INSTRUCTION_BODY,
});

function confluenceUrl(ticket: Ticket): string {
  return `https://${ticket.d}/wiki/pages/viewpage.action?pageId=${ticket.p}`;
}

function previewPage(origin: string, token: string, ticket: Ticket): string {
  const title = ticket.t ? `${ticket.t} — ZenUML diagram` : "ZenUML diagram";
  const imgUrl = `${origin}/i/${token}`;
  return shell({
    title,
    og: `<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="Shared diagram preview — open the link to see the source in Confluence.">
<meta property="og:image" content="${esc(imgUrl)}">
<meta property="og:image:type" content="image/png">`,
    body: /* html */ `
  <span class="mark" role="img" aria-label="ZenUML"></span>
  <h1>${esc(ticket.t ?? "Shared diagram")}</h1>
  <p class="sub">A snapshot shared from Confluence.</p>
  <img class="preview" src="/i/${esc(token)}" alt="Diagram preview">
  <div><a class="btn" href="${esc(confluenceUrl(ticket))}">Open in Confluence</a></div>
  <p class="note">This preview is served for 10 minutes after the link is copied —
  links are for instant sharing. The link itself keeps working: it opens the source
  in Confluence, and pasted into a Confluence page it becomes the live diagram.</p>
`,
    extraStyle: `
  .preview {
    display: block; max-width: 100%; border: 1px solid var(--line);
    border-radius: 8px; background: #fff; margin: 0 0 18px;
  }
`,
  });
}

function expiredPage(ticket: Ticket): string {
  return shell({
    title: "Preview expired — ZenUML",
    og: `<meta property="og:title" content="ZenUML diagram link">
<meta property="og:description" content="This diagram preview has expired. Open the link to see the source in Confluence.">`,
    body: /* html */ `
  <span class="mark" role="img" aria-label="ZenUML"></span>
  <h1>This preview has expired</h1>
  <p class="sub">Diagram previews are served for 10 minutes after the link is copied.</p>
  <div><a class="btn" href="${esc(confluenceUrl(ticket))}">Open in Confluence</a></div>
  <p class="note">If you can't access that Confluence site, ask whoever shared this
  link to copy a fresh one — every copy carries a new preview. Pasted into a
  Confluence page, the link still becomes the live diagram.</p>
`,
  });
}

function imageFresh(ticket: Ticket): boolean {
  const minted = Date.parse(ticket.m);
  if (Number.isNaN(minted)) return false;
  return Date.now() - minted < (IMG_TTL_SECONDS - IMG_SAFETY_MARGIN_SECONDS) * 1000;
}

function isTicket(value: unknown): value is Ticket {
  const t = value as Ticket | null;
  return (
    !!t &&
    typeof t.d === "string" &&
    ATLASSIAN_HOST_RE.test(t.d) &&
    typeof t.p === "string" &&
    /^\d+$/.test(t.p) &&
    typeof t.c === "string" &&
    typeof t.m === "string"
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/") {
      return Response.redirect("https://zenuml.com", 302);
    }

    // Preview image bytes. 404 after KV physically expires the object.
    const imgMatch = /^\/i\/([A-Za-z0-9_-]{16,64})$/.exec(pathname);
    if (imgMatch && env.DEEPLINK_KV) {
      const png = await env.DEEPLINK_KV.get(`img:${imgMatch[1]}`, "arrayBuffer");
      if (!png) return new Response("Not found", { status: 404 });
      return new Response(png, {
        status: 200,
        headers: {
          "content-type": "image/png",
          // Short cache so CDNs can't extend the capability much past expiry.
          "cache-control": "public, max-age=300",
          "x-robots-tag": "noindex",
        },
      });
    }

    const strict = STRICT_DEEPLINK_RE.exec(pathname);
    if (strict && env.DEEPLINK_KV) {
      const token = url.searchParams.get("t");
      if (token && TOKEN_RE.test(token)) {
        // Malformed ticket JSON (get throws) or KV trouble must degrade to the
        // instruction page, never surface a 1101.
        let raw: unknown = null;
        try {
          raw = await env.DEEPLINK_KV.get(`ticket:${token}`, "json");
        } catch {
          raw = null;
        }
        // Bind the ticket to the path it was minted for.
        if (isTicket(raw) && raw.c === strict[2]) {
          const page = imageFresh(raw)
            ? previewPage(url.origin, token, raw)
            : expiredPage(raw);
          return new Response(page, { status: 200, headers: TICKETED_PAGE_HEADERS });
        }
      }
    }

    // Loose on purpose: any /d/* without a usable ticket gets the instruction
    // page, so truncated or hand-mangled links still land somewhere helpful.
    if (pathname === "/d" || pathname.startsWith("/d/")) {
      return new Response(INSTRUCTION_PAGE, { status: 200, headers: STATIC_PAGE_HEADERS });
    }

    return new Response(
      shell({
        title: "Not found — ZenUML",
        og: `<meta property="og:title" content="ZenUML">`,
        body: `<h1>Nothing here</h1><p class="sub">Looking for <a href="https://zenuml.com">zenuml.com</a>?</p>`,
      }),
      { status: 404, headers: STATIC_PAGE_HEADERS },
    );
  },
};
