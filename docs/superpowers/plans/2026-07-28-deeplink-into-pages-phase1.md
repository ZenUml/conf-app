# Deeplink → per-variant Pages (Phase 1: lite + diagramly on conf-lite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the standalone `confluence-deeplink` Worker's `/d/` (page) and `/i/` (image) serving into the Lite/Diagramly Cloudflare Pages backend (`conf-stg-lite` → `conf-lite`), alongside the already-written `functions/deeplink-ticket.ts` mint, so Lite and Diagramly serve their own embed deeplinks from one deploy unit with no standalone-Worker dependency.

**Architecture:** Two new file-based Pages routes — `functions/i/[token].ts` (PNG serving) and `functions/d/[[path]].ts` (page serving) — join the existing `functions/deeplink-ticket.ts` mint. All three share one `functions/utils/deeplink.ts` module (HMAC signing + ticket verify/mint) and one `functions/utils/deeplinkPages.ts` module (HTML renderers), so the crypto can never drift out of byte-compatibility across mint and serve. Diagramly has no Pages project of its own, so it rides `conf-lite`'s deployment for free; Full (`conf-full.zenuml.com`) is Phase 2 and untouched here.

**Tech Stack:** Cloudflare Pages Functions (Workers runtime), vitest, Forge manifest (yq), TypeScript.

## Global Constraints

- Privacy: never log `/d` or `/i` request URLs verbatim — redact to the path prefix (`docs/policies/client-privacy.md`).
- Signing must stay byte-compatible between the mint and the serving functions — one shared `functions/utils/deeplink.ts`, no duplicated crypto.
- `/d` and `/i` are public (no auth); `/deeplink-ticket` is authenticated (Forge FIT via `functions/utils/authenticate.ts`).
- Cloud-resource changes (KV namespace create, `wrangler pages secret put`, custom domains) need explicit user approval before running — do not run unprompted.
- Staging and production deploys happen via CI/CD only — no local `wrangler pages deploy` to `conf-stg-lite` / `conf-lite`.

---

## Prerequisite: bring the mint into this branch

`functions/deeplink-ticket.ts` (+ `functions/deeplink-ticket.spec.ts`, `functions/deeplink-ticket.contract.spec.ts`) live on branch `feat/confluence-deeplink-page` (#399), NOT on this branch (off origin/main). Task 1 refactors the mint, so it must be present first.

- [x] Copy the three files from #399 into this branch:
```bash
git show origin/feat/confluence-deeplink-page:functions/deeplink-ticket.ts > functions/deeplink-ticket.ts
git show origin/feat/confluence-deeplink-page:functions/deeplink-ticket.spec.ts > functions/deeplink-ticket.spec.ts
git show origin/feat/confluence-deeplink-page:functions/deeplink-ticket.contract.spec.ts > functions/deeplink-ticket.contract.spec.ts
```
- [ ] Run `npx vitest run functions/deeplink-ticket.spec.ts functions/deeplink-ticket.contract.spec.ts` — expect PASS (baseline before Task 1's refactor).
- [x] Commit: `git add functions/deeplink-ticket*.ts && git commit -m "chore(deeplink): bring mint endpoint into the pages-migration branch from #399"`

### Task 1: Shared signing/ticket module — `functions/utils/deeplink.ts`
**Files:**
- Create: `functions/utils/deeplink.ts`
- Create: `functions/utils/deeplink.spec.ts`
- Modify: `functions/deeplink-ticket.ts` (remove duplicated crypto, import the shared module)
- Test (unchanged, must keep passing): `functions/deeplink-ticket.spec.ts`

**Interfaces:**
- Produces: `Env` (`{ DEEPLINK_KV?: KVNamespace; DEEPLINK_SIGN_SECRET?: string }`), `Ticket` (`{ v: number; d: string; p: string; c: string; m: number; t?: string; u?: number }`), `IMG_TTL_SECONDS = 600`, `IMG_SAFETY_MARGIN_SECONDS = 30`, `SIG_BYTES = 16`, `IMGKEY_BYTES = 12`, `b64urlEncode(bytes: Uint8Array): string`, `b64urlDecode(s: string): Uint8Array`, `hmac(secret: string, msg: string): Promise<Uint8Array>`, `sha256(msg: string): Promise<Uint8Array>`, `imgKeyFor(payloadB64: string): Promise<string>`, `timingSafeEqual(a: string, b: string): boolean`, `isTicket(value: unknown): value is Ticket`, `verifyToken(token: string, secret: string): Promise<Ticket | undefined>`, `signTicket(payload: object, secret: string): Promise<string>`, `imageFresh(ticket: Ticket): boolean`.
- Consumes: nothing (pure Web Crypto + string helpers, ported verbatim from `workers/confluence-deeplink/src/index.ts` lines 40-101 and 105-117 and 318-338, plus `signTicket` moved from `functions/deeplink-ticket.ts` lines 69-73 of the pre-refactor file).
- Note: `Ticket.u` is new (not in the Worker). It is set only by the mint (Task 7) when the calling Forge app is Lite, and consumed only by `previewPage()` (Task 2) to gate the Lite upgrade CTA. It does not affect signing or verification — `isTicket()` never required it, so it round-trips as an ordinary optional JSON field.

- [x] **Step 1: Write the failing test**
```ts
// functions/utils/deeplink.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  signTicket, verifyToken, imgKeyFor, imageFresh,
  IMG_TTL_SECONDS, IMG_SAFETY_MARGIN_SECONDS, type Ticket,
} from "./deeplink";

const SECRET = "test-signing-secret-value";
const MINTED_MS = Date.parse("2026-07-28T10:00:00.000Z");
const MINTED_UNIX = Math.floor(MINTED_MS / 1000);
const payload = { v: 1, d: "example", p: "123456", c: "425987", m: MINTED_UNIX, t: "Order flow" };

describe("functions/utils/deeplink (shared signing/ticket helpers)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(MINTED_MS)); });
  afterEach(() => vi.useRealTimers());

  it("signTicket -> verifyToken round-trips the exact payload", async () => {
    const token = await signTicket(payload, SECRET);
    const ticket = await verifyToken(token, SECRET);
    expect(ticket).toEqual(payload);
  });

  it("matches an independently computed HMAC (byte-compat with the retired Worker + the mint)", async () => {
    const token = await signTicket(payload, SECRET);
    const [payloadB64, sig] = token.split(".");
    const nodeCrypto = await import("node:crypto");
    const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const expectedSig = b64url(nodeCrypto.createHmac("sha256", SECRET).update(payloadB64).digest().subarray(0, 16));
    expect(sig).toBe(expectedSig);
  });

  it("imgKeyFor derives the same 12-byte sha256-prefix key independently computed via node:crypto", async () => {
    const token = await signTicket(payload, SECRET);
    const payloadB64 = token.split(".")[0];
    const key = await imgKeyFor(payloadB64);
    const nodeCrypto = await import("node:crypto");
    const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const expected = b64url(nodeCrypto.createHash("sha256").update(payloadB64).digest().subarray(0, 12));
    expect(key).toBe(expected);
  });

  it("rejects a tampered signature and a wrong secret", async () => {
    const token = await signTicket(payload, SECRET);
    expect(await verifyToken(token.slice(0, -3) + "AAA", SECRET)).toBeUndefined();
    expect(await verifyToken(token, "attacker-secret")).toBeUndefined();
  });

  it("rejects structurally invalid payloads (host-injection subdomain, non-numeric ids)", async () => {
    const bad1 = await signTicket({ ...payload, d: "evil.example" }, SECRET);
    expect(await verifyToken(bad1, SECRET)).toBeUndefined();
    const bad2 = await signTicket({ ...payload, p: "1 x" }, SECRET);
    expect(await verifyToken(bad2, SECRET)).toBeUndefined();
  });

  it("imageFresh: fresh at 569s, expired at 571s past mint (570s safety-margined window)", () => {
    const ticket: Ticket = payload;
    vi.setSystemTime(new Date(MINTED_MS + 569_000));
    expect(imageFresh(ticket)).toBe(true);
    vi.setSystemTime(new Date(MINTED_MS + 571_000));
    expect(imageFresh(ticket)).toBe(false);
    expect(IMG_TTL_SECONDS - IMG_SAFETY_MARGIN_SECONDS).toBe(570);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run functions/utils/deeplink.spec.ts` — expect a resolution error: `Cannot find module './deeplink'` (the module does not exist yet).

- [x] **Step 3: Implement**

  Create `functions/utils/deeplink.ts`:
  ```ts
  // Shared signing + ticket helpers for the embed deeplink feature. Used by
  // BOTH the mint endpoint (deeplink-ticket.ts) and the serving functions
  // (functions/i/, functions/d/). MUST stay byte-compatible with the retired
  // standalone Worker (workers/confluence-deeplink/src/index.ts) — same
  // algorithm, same constants.
  //
  // Ported verbatim from workers/confluence-deeplink/src/index.ts lines
  // 40-101 (Ticket interface, b64url helpers, hmac/sha256, imgKeyFor,
  // timingSafeEqual), 105-117 (verifyToken), 318-338 (imageFresh, isTicket,
  // SUBDOMAIN_RE), plus `signTicket` moved from functions/deeplink-ticket.ts.

  export interface Env {
    DEEPLINK_KV?: KVNamespace;
    DEEPLINK_SIGN_SECRET?: string;
  }

  export interface Ticket {
    v: number; // format version
    d: string; // site SUBDOMAIN (full host = `${d}.atlassian.net`)
    p: string; // pageId
    c: string; // contentId (bound to the URL path)
    m: number; // minted-at, Unix seconds — expiry source
    t?: string; // diagram title
    /** Present (=1) only when minted by the Lite Forge app — gates the Lite
     *  upgrade CTA on the /d/ preview page (see deeplinkPages.ts). Omitted
     *  for every other variant (diagramly, full). */
    u?: number;
  }

  export const IMG_TTL_SECONDS = 600;
  export const IMG_SAFETY_MARGIN_SECONDS = 30;
  export const SIG_BYTES = 16;
  export const IMGKEY_BYTES = 12;

  const ENC = new TextEncoder();

  export function b64urlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  export function b64urlDecode(s: string): Uint8Array {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  export async function hmac(secret: string, msg: string): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
      "raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, ENC.encode(msg)));
  }

  export async function sha256(msg: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", ENC.encode(msg)));
  }

  export async function imgKeyFor(payloadB64: string): Promise<string> {
    return b64urlEncode((await sha256(payloadB64)).slice(0, IMGKEY_BYTES));
  }

  export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]*$/i;

  export function isTicket(value: unknown): value is Ticket {
    const t = value as Ticket | null;
    return (
      !!t &&
      typeof t.d === "string" &&
      SUBDOMAIN_RE.test(t.d) &&
      typeof t.p === "string" &&
      /^\d+$/.test(t.p) &&
      typeof t.c === "string" &&
      /^\d+$/.test(t.c) &&
      typeof t.m === "number" &&
      Number.isFinite(t.m)
    );
  }

  export async function verifyToken(token: string, secret: string): Promise<Ticket | undefined> {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return undefined;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = b64urlEncode((await hmac(secret, payloadB64)).slice(0, SIG_BYTES));
    if (!timingSafeEqual(sig, expected)) return undefined;
    try {
      const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
      if (isTicket(payload)) return payload;
    } catch { /* fall through */ }
    return undefined;
  }

  // token = base64url(payloadJSON) "." base64url(hmac[:16])
  export async function signTicket(payload: object, secret: string): Promise<string> {
    const payloadB64 = b64urlEncode(ENC.encode(JSON.stringify(payload)));
    const sig = b64urlEncode((await hmac(secret, payloadB64)).slice(0, SIG_BYTES));
    return `${payloadB64}.${sig}`;
  }

  export function imageFresh(ticket: Ticket): boolean {
    // m is Unix seconds; compare in seconds.
    return Date.now() / 1000 - ticket.m < IMG_TTL_SECONDS - IMG_SAFETY_MARGIN_SECONDS;
  }
  ```

  Then refactor `functions/deeplink-ticket.ts` to import from it instead of duplicating. Replace the file's signing block (current lines 42-73: `SIGN_ENC`, `b64url`, `hmac`, `sha256`, `imgKeyFor`, `signTicket`) and the `Env`/`IMG_TTL_SECONDS`/`SIG_BYTES`/`IMGKEY_BYTES` declarations with:
  ```ts
  import { OkResponse, response } from "./OkResponse";
  import { captureError } from "./utils/sentry";
  import type { ForgeRequestData } from "./utils/authenticate";
  import { signTicket, imgKeyFor, IMG_TTL_SECONDS } from "./utils/deeplink";
  import type { Env as DeeplinkEnv } from "./utils/deeplink";

  export { IMG_TTL_SECONDS };

  // ... [keep the existing file-header comment block unchanged] ...
  // Signing helpers now live in functions/utils/deeplink.ts, shared with the
  // serving functions (functions/i/, functions/d/) so both sides can never
  // drift out of byte-compatibility.

  export interface Env extends DeeplinkEnv {
    DB: D1Database;
  }

  const MAX_PNG_BYTES = 2 * 1024 * 1024;
  const MAX_TITLE_CHARS = 300;
  const DIGITS_RE = /^\d+$/;
  const ATLASSIAN_HOST_RE = /^[a-z0-9][a-z0-9.-]*\.atlassian\.net$/i;

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
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    );
  }
  ```
  Keep `onRequest` body exactly as-is (it already calls `signTicket(payload, secret)` and `imgKeyFor(...)` — those calls now resolve to the imported functions, no change needed at the call sites in this task). Do **not** change the hardcoded `url: \`https://confluence.zenuml.com/...\`` line yet — that is Task 7.

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run functions/utils/deeplink.spec.ts functions/deeplink-ticket.spec.ts` — both files pass; `deeplink-ticket.spec.ts` is unchanged and must still pass unmodified (confirms the refactor introduced no behavior change).

- [x] **Step 5: Commit**
  `git add functions/utils/deeplink.ts functions/utils/deeplink.spec.ts functions/deeplink-ticket.ts`
  `git commit -m "refactor(deeplink): extract shared signing/ticket helpers into functions/utils/deeplink.ts"`

---

### Task 2: Page renderers — `functions/utils/deeplinkPages.ts` + Lite upgrade CTA
**Files:**
- Create: `functions/utils/deeplinkPages.ts` (verbatim port of `workers/confluence-deeplink/src/index.ts` lines 119-142, 144-145, 147-151, 153-208, 210-242, 244-256, 258-263, 265-267, 269-299, 301-316)
- Create: `functions/utils/deeplinkPages.spec.ts`

**Interfaces:**
- Produces: `STATIC_PAGE_HEADERS`, `TICKETED_PAGE_HEADERS`, `PREVIEW_PAGE_HEADERS` (all `Record<string, string>`), `INSTRUCTION_PAGE: string`, `confluenceUrl(ticket: Ticket): string`, `previewPage(origin: string, token: string, ticket: Ticket): string`, `expiredPage(ticket: Ticket): string`.
- Consumes: `Ticket` type from `./deeplink` (Task 1).
- Design note on the CTA: gating is on `ticket.u === 1`, **not** on request host. Diagramly rides the same `conf-lite.zenuml.com` backend as Lite, so a host-based check would incorrectly show the Lite upsell to Diagramly users. `ticket.u` is set at mint time (Task 7) from the Forge app identity of the *caller*, which is the only reliable signal — the serving side has no other way to know which product minted a given ticket.

- [x] **Step 1: Write the failing test**
```ts
// functions/utils/deeplinkPages.spec.ts
import { describe, it, expect } from "vitest";
import { previewPage, expiredPage, INSTRUCTION_PAGE, confluenceUrl } from "./deeplinkPages";
import type { Ticket } from "./deeplink";

const ticket: Ticket = { v: 1, d: "example", p: "123456", c: "425987", m: 1, t: "Order flow" };

describe("deeplinkPages", () => {
  it("previewPage renders no CTA for a non-Lite ticket (u absent)", () => {
    const html = previewPage("https://conf-lite.zenuml.com", "tok.sig", ticket);
    expect(html).not.toContain("See what the Full plan unlocks");
    expect(html).toContain("<h1>Order flow</h1>");
    expect(html).toContain('og:image" content="https://conf-lite.zenuml.com/i/tok.sig"');
  });

  it("previewPage renders the upgrade CTA only when ticket.u === 1 (Lite-minted)", () => {
    const liteTicket: Ticket = { ...ticket, u: 1 };
    const html = previewPage("https://conf-lite.zenuml.com", "tok.sig", liteTicket);
    expect(html).toContain("See what the Full plan unlocks");
    expect(html).toContain('href="https://zenuml.com/pricing"');
  });

  it("escapes a hostile title", () => {
    const hostile: Ticket = { ...ticket, t: "<img src=x onerror=alert(1)>" };
    const html = previewPage("https://conf-lite.zenuml.com", "tok.sig", hostile);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("expiredPage keeps the permanent Open-in-Confluence button, derived from the ticket only", () => {
    const html = expiredPage(ticket);
    expect(html).toContain("This preview has expired");
    expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
  });

  it("confluenceUrl derives host from the ticket subdomain, never a bare cloudId", () => {
    expect(confluenceUrl(ticket)).toBe("https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456");
  });

  it("INSTRUCTION_PAGE is a static precomputed string with no ticket data", () => {
    expect(INSTRUCTION_PAGE).toContain("This link becomes a diagram in Confluence");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run functions/utils/deeplinkPages.spec.ts` — expect `Cannot find module './deeplinkPages'`.

- [x] **Step 3: Implement**

  Create `functions/utils/deeplinkPages.ts`:
  ```ts
  // Deeplink page renderers — copied verbatim from
  // workers/confluence-deeplink/src/index.ts (lines 119-316), plus a
  // Lite-only upgrade CTA added to previewPage() (growth item — design spec
  // "the real upgrade lever is a deliberate CTA on the Lite /d/ preview page").
  //
  // Privacy: /d/<cloudId>/<contentId> paths identify customer sites. Never log
  // the request URL, never reflect path segments into the response
  // (docs/policies/client-privacy.md).
  import type { Ticket } from "./deeplink";

  // Lines 119-127.
  export const STATIC_PAGE_HEADERS: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=3600",
    "x-robots-tag": "noindex",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  };

  // Lines 131-134.
  export const TICKETED_PAGE_HEADERS: Record<string, string> = {
    ...STATIC_PAGE_HEADERS,
    "cache-control": "no-store",
  };

  // Lines 138-142.
  export const PREVIEW_PAGE_HEADERS: Record<string, string> = (() => {
    const h = { ...TICKETED_PAGE_HEADERS };
    delete h["x-robots-tag"];
    return h;
  })();

  // Lines 144-145.
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  // Lines 147-151.
  const FAVICON =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0C66E4"/><stop offset="1" stop-color="#964AC2"/></linearGradient></defs><rect width="16" height="16" rx="3" fill="url(#g)"/><path d="M4 5h8M4 8h5M4 11h7" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    );

  // Lines 153-208.
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

  // Lines 210-242.
  function shell(opts: { title: string; og: string; body: string; extraStyle?: string; noindex?: boolean; largeImage?: boolean }): string {
    const noindex = opts.noindex !== false;
    const twitterCard = opts.largeImage ? "summary_large_image" : "summary";
    return `<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${noindex ? '<meta name="robots" content="noindex">' : ''}
  <title>${esc(opts.title)}</title>
  <meta property="og:site_name" content="ZenUML">
  <meta property="og:type" content="website">
  ${opts.og}
  <meta name="twitter:card" content="${twitterCard}">
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

  // Lines 244-256.
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

  // Lines 258-263.
  export const INSTRUCTION_PAGE = shell({
    title: "ZenUML diagram link",
    og: `<meta property="og:title" content="ZenUML diagram link">
  <meta property="og:description" content="Paste this link into a Confluence page and it turns into the diagram. The diagram stays in Confluence — the link itself carries no content and grants no access.">`,
    body: INSTRUCTION_BODY,
  });

  // Lines 265-267.
  export function confluenceUrl(ticket: Ticket): string {
    return `https://${ticket.d}.atlassian.net/wiki/pages/viewpage.action?pageId=${ticket.p}`;
  }

  // Lines 269-299, PLUS the Lite upgrade CTA (gated on ticket.u === 1 — see
  // the file-level design note above).
  export function previewPage(origin: string, token: string, ticket: Ticket): string {
    const title = ticket.t ? `${ticket.t} — ZenUML diagram` : "ZenUML diagram";
    const imgUrl = `${origin}/i/${token}`;
    const upgradeCta = ticket.u === 1
      ? `<p class="cta">You're viewing a Free-plan diagram. <a href="https://zenuml.com/pricing">See what the Full plan unlocks →</a></p>`
      : "";
    return shell({
      title,
      noindex: false,
      largeImage: true,
      og: `<meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="Shared diagram preview — open the link to see the source in Confluence.">
  <meta property="og:image" content="${esc(imgUrl)}">
  <meta property="og:image:secure_url" content="${esc(imgUrl)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:alt" content="${esc(ticket.t || "ZenUML diagram")}">`,
      body: /* html */ `
    <span class="mark" role="img" aria-label="ZenUML"></span>
    <h1>${esc(ticket.t ?? "Shared diagram")}</h1>
    <p class="sub">A snapshot shared from Confluence.</p>
    <img class="preview" src="/i/${esc(token)}" alt="Diagram preview">
    <div><a class="btn" href="${esc(confluenceUrl(ticket))}">Open in Confluence</a></div>
    ${upgradeCta}
    <p class="note">This preview is served for 10 minutes after the link is copied —
    links are for instant sharing. The link itself keeps working: it opens the source
    in Confluence, and pasted into a Confluence page it becomes the live diagram.</p>
  `,
      extraStyle: `
    .preview {
      display: block; max-width: 100%; border: 1px solid var(--line);
      border-radius: 8px; background: #fff; margin: 0 0 18px;
    }
    .cta {
      background: var(--card); border: 1px solid var(--line); border-radius: 8px;
      padding: 10px 14px; font-size: 0.9rem; margin: 0 0 18px;
    }
    .cta a { color: var(--accent); font-weight: 600; text-decoration: none; }
    .cta a:hover { text-decoration: underline; }
  `,
    });
  }

  // Lines 301-316.
  export function expiredPage(ticket: Ticket): string {
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
  ```

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run functions/utils/deeplinkPages.spec.ts`

- [x] **Step 5: Commit**
  `git add functions/utils/deeplinkPages.ts functions/utils/deeplinkPages.spec.ts`
  `git commit -m "feat(deeplink): port page renderers to functions/utils/deeplinkPages.ts, add Lite upgrade CTA"`

---

### Task 3: Image serving — `functions/i/[token].ts`
**Files:**
- Create: `functions/i/[token].ts`
- Create: `functions/i/token-route.spec.ts` (test file is NOT bracket-named — vitest/fast-glob's default test-discovery glob treats `[`/`]` as character-class syntax, so a literal `[token].spec.ts` filename risks not being discovered. The route file itself must keep Cloudflare's required bracket name; only the spec file uses a plain name and imports the route module by its literal bracket path, which is a normal static import, not a glob.)

**Interfaces:**
- Consumes: `Env`, `verifyToken`, `imageFresh`, `imgKeyFor` from `../utils/deeplink` (Task 1).
- Produces: `onRequest: PagesFunction<Env, "token">`.

- [x] **Step 1: Write the failing test**
```ts
// functions/i/token-route.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequest } from "./[token]";
import { signTicket, imgKeyFor } from "../utils/deeplink";

const SECRET = "test-signing-secret-value";
const MINTED_MS = Date.parse("2026-07-28T10:00:00.000Z");
const MINTED_UNIX = Math.floor(MINTED_MS / 1000);

async function mint(overrides: Record<string, unknown> = {}) {
  const payload = { v: 1, d: "example", p: "123456", c: "425987", m: MINTED_UNIX, t: "Order flow", ...overrides };
  const token = await signTicket(payload, SECRET);
  const imgKey = await imgKeyFor(token.split(".")[0]);
  return { token, imgKey };
}

function makeKV(seedImgKey?: string) {
  const store = new Map<string, ArrayBuffer>();
  if (seedImgKey) store.set(`img:${seedImgKey}`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
  return { async get(key: string) { return store.get(key) ?? null; } } as unknown as KVNamespace;
}

const call = (env: Record<string, unknown>, token: string, method = "GET") =>
  onRequest({
    request: new Request(`https://conf-lite.zenuml.com/i/${token}`, { method }),
    env,
    params: { token },
  } as any);

describe("functions/i/[token] (image serving)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(MINTED_MS)); });
  afterEach(() => vi.useRealTimers());

  it("serves the PNG for a valid fresh token", async () => {
    const { token, imgKey } = await mint();
    const res = await call({ DEEPLINK_KV: makeKV(imgKey), DEEPLINK_SIGN_SECRET: SECRET }, token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("404s when expired, tampered, or the derived key is unseeded", async () => {
    const { token, imgKey } = await mint();
    vi.setSystemTime(new Date(MINTED_MS + 601_000));
    expect((await call({ DEEPLINK_KV: makeKV(imgKey), DEEPLINK_SIGN_SECRET: SECRET }, token)).status).toBe(404);
    vi.setSystemTime(new Date(MINTED_MS));
    expect((await call({ DEEPLINK_KV: makeKV(imgKey), DEEPLINK_SIGN_SECRET: SECRET }, token.slice(0, -3) + "AAA")).status).toBe(404);
    expect((await call({ DEEPLINK_KV: makeKV(), DEEPLINK_SIGN_SECRET: SECRET }, token)).status).toBe(404);
  });

  it("404s when KV or secret is unbound (feature off)", async () => {
    const { token } = await mint();
    expect((await call({}, token)).status).toBe(404);
  });

  it("non-GET/HEAD -> 405", async () => {
    const { token } = await mint();
    const res = await call({ DEEPLINK_KV: makeKV(), DEEPLINK_SIGN_SECRET: SECRET }, token, "POST");
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run functions/i/token-route.spec.ts` — expect `Cannot find module './[token]'`.

- [x] **Step 3: Implement**
```ts
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
```

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run functions/i/token-route.spec.ts`

- [x] **Step 5: Commit**
  `git add functions/i/`
  `git commit -m "feat(deeplink): serve /i/<token> preview PNG as a Pages Function"`

---

### Task 4: Page serving — `functions/d/[[path]].ts`
**Files:**
- Create: `functions/d/[[path]].ts`
- Create: `functions/d/path-route.spec.ts` (plain name for the same fast-glob reason as Task 3)

**Interfaces:**
- Consumes: `Env`, `verifyToken`, `imageFresh` from `../utils/deeplink`; `INSTRUCTION_PAGE`, `STATIC_PAGE_HEADERS`, `TICKETED_PAGE_HEADERS`, `PREVIEW_PAGE_HEADERS`, `previewPage`, `expiredPage` from `../utils/deeplinkPages`.
- Produces: `onRequest: PagesFunction<Env, "path">`.
- Deliberately does **not** port the Worker's `/` → 302 redirect (Worker lines 349-351) or its generic 404 fallback (Worker lines 397-404) — those are whole-domain-ownership concerns; `conf-lite.zenuml.com` already owns `/` via the existing SPA. This function only ever receives `/d` and `/d/*` requests (Cloudflare's `[[path]]` catch-all + the `public/_routes.json` allowlist added in Task 5), so there is no other path space to default-404 on.

- [x] **Step 1: Write the failing test**
```ts
// functions/d/path-route.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequest } from "./[[path]]";
import { signTicket } from "../utils/deeplink";

const CLOUD_ID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const SECRET = "test-signing-secret-value";
const MINTED_MS = Date.parse("2026-07-28T10:00:00.000Z");
const MINTED_UNIX = Math.floor(MINTED_MS / 1000);

async function mint(overrides: Record<string, unknown> = {}, secret = SECRET) {
  const payload = { v: 1, d: "example", p: "123456", c: "425987", m: MINTED_UNIX, t: "Order flow", ...overrides };
  return signTicket(payload, secret);
}

const get = (env: Record<string, unknown>, path: string, init?: RequestInit) =>
  onRequest({ request: new Request(`https://conf-lite.zenuml.com${path}`, init), env } as any);

describe("functions/d/[[path]] (page serving)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(MINTED_MS)); });
  afterEach(() => vi.useRealTimers());

  it("non-GET -> 405; HEAD -> 200", async () => {
    expect((await get({}, "/d/x", { method: "POST" })).status).toBe(405);
    expect((await get({ DEEPLINK_SIGN_SECRET: SECRET }, "/d/x", { method: "HEAD" })).status).toBe(200);
  });

  describe("instruction page (no usable ticket)", () => {
    it.each([
      ["bare path", `/d/${CLOUD_ID}/425987`],
      ["truncated", "/d/garbage"],
      ["/d root", "/d"],
      ["not-a-token", `/d/${CLOUD_ID}/425987?t=notsigned`],
    ])("%s -> instruction page", async (_n, path) => {
      const res = await get({ DEEPLINK_SIGN_SECRET: SECRET }, path);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("missing secret degrades to instruction page", async () => {
      const token = await mint();
      const res = await get({}, `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("tampered signature -> instruction page", async () => {
      const token = await mint();
      const res = await get({ DEEPLINK_SIGN_SECRET: SECRET }, `/d/${CLOUD_ID}/425987?t=${token.slice(0, -3)}AAA`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("wrong secret -> instruction page", async () => {
      const token = await mint({}, "attacker-secret");
      const res = await get({ DEEPLINK_SIGN_SECRET: SECRET }, `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });
  });

  describe("preview state (fresh, valid)", () => {
    it("title, og:image, subdomain->host button; fully unfurlable", async () => {
      const token = await mint();
      const res = await get({ DEEPLINK_SIGN_SECRET: SECRET }, `/d/${CLOUD_ID}/425987?t=${token}`);
      const html = await res.text();
      expect(html).toContain("<h1>Order flow</h1>");
      expect(html).toContain(`og:image" content="https://conf-lite.zenuml.com/i/${token}"`);
      expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
      expect(res.headers.get("x-robots-tag")).toBeNull();
    });
  });

  describe("security gates", () => {
    it("valid token replayed on a DIFFERENT content path -> instruction page", async () => {
      const token = await mint({ c: "425987" });
      const html = await (await get({ DEEPLINK_SIGN_SECRET: SECRET }, `/d/${CLOUD_ID}/999?t=${token}`)).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
    });
    it.each([
      ["subdomain with a dot (host injection)", { d: "evil.example" }],
      ["subdomain with slash", { d: "evil/x" }],
      ["non-numeric pageId", { p: "1 x" }],
    ])("structurally invalid payload (%s) -> instruction page", async (_n, bad) => {
      const token = await mint(bad);
      const html = await (await get({ DEEPLINK_SIGN_SECRET: SECRET }, `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
      expect(html).not.toContain("evil");
    });
  });

  describe("expiry boundary (570s window, seconds)", () => {
    it("569s fresh; 571s expired (button survives, noindex)", async () => {
      const token = await mint();
      const env = { DEEPLINK_SIGN_SECRET: SECRET };
      vi.setSystemTime(new Date(MINTED_MS + 569_000));
      expect(await (await get(env, `/d/${CLOUD_ID}/425987?t=${token}`)).text()).toContain("<h1>Order flow</h1>");
      vi.setSystemTime(new Date(MINTED_MS + 571_000));
      const res = await get(env, `/d/${CLOUD_ID}/425987?t=${token}`);
      const html = await res.text();
      expect(html).toContain("This preview has expired");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run functions/d/path-route.spec.ts` — expect `Cannot find module './[[path]]'`.

- [x] **Step 3: Implement**
```ts
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
```

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run functions/d/path-route.spec.ts`

- [x] **Step 5: Commit**
  `git add functions/d/`
  `git commit -m "feat(deeplink): serve /d/<cloudId>/<contentId> page as a Pages Function"`

---

### Task 5: Route allowlist + middleware auth/privacy
**Files:**
- Modify: `public/_routes.json`
- Modify: `functions/_middleware.ts`
- Create: `public/_routes.spec.ts`
- Create: `functions/_middleware.spec.ts`

**Interfaces:**
- Produces (new, exported from `functions/_middleware.ts`): `AUTHENTICATED_PATHS: string[]`, `redactedRequestUrlForLogging(url: string): string`.

- [x] **Step 1: Write the failing test**
```ts
// public/_routes.spec.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const routesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "_routes.json");
const routes = JSON.parse(readFileSync(routesPath, "utf-8"));

describe("public/_routes.json (Pages route allowlist)", () => {
  it("includes the new deeplink serving + mint paths", () => {
    expect(routes.include).toEqual(expect.arrayContaining(["/d/*", "/i/*", "/deeplink-ticket"]));
  });
});
```
```ts
// functions/_middleware.spec.ts
import { describe, it, expect } from "vitest";
import { AUTHENTICATED_PATHS, redactedRequestUrlForLogging } from "./_middleware";

describe("_middleware", () => {
  it("adds /deeplink-ticket to AUTHENTICATED_PATHS; /d and /i stay public", () => {
    expect(AUTHENTICATED_PATHS).toContain("/deeplink-ticket");
    expect(AUTHENTICATED_PATHS.some((p) => p === "/d" || p === "/i")).toBe(false);
  });

  it("redacts /d and /i request URLs before logging (client-privacy policy)", () => {
    expect(redactedRequestUrlForLogging("https://conf-lite.zenuml.com/d/bc8bb5b3-09d2-4932-b68c-9b56fab8e34a/425987?t=abc.def"))
      .toBe("https://conf-lite.zenuml.com/d [redacted]");
    expect(redactedRequestUrlForLogging("https://conf-lite.zenuml.com/i/abc.def"))
      .toBe("https://conf-lite.zenuml.com/i [redacted]");
  });

  it("logs other paths verbatim (unchanged behavior)", () => {
    const url = "https://conf-lite.zenuml.com/diagramly/chat";
    expect(redactedRequestUrlForLogging(url)).toBe(url);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run public/_routes.spec.ts functions/_middleware.spec.ts` — `_routes.spec.ts` fails on the `arrayContaining` assertion (paths not yet present); `_middleware.spec.ts` fails with `does not provide an export named 'AUTHENTICATED_PATHS'` (not yet exported) and `'redactedRequestUrlForLogging'` (does not exist).

- [x] **Step 3: Implement**

  `public/_routes.json` — add to the `include` array (after `"/agent-link/*"`):
  ```json
    "/agent-link/*",
    "/d/*",
    "/i/*",
    "/deeplink-ticket"
  ```

  `functions/_middleware.ts` — full new contents:
  ```ts
  import {ServerErrorResponse} from "./ServerErrorResponse";
  import authenticate from "./utils/authenticate";
  import type { ForgeRequestData } from "./utils/authenticate";
  import * as Sentry from "@sentry/cloudflare";

  interface Env {
    SENTRY_DSN?: string;
  }

  export const AUTHENTICATED_PATHS = [
    '/diagramly',
    '/metrics-cache',
    '/forge-custom-content',
    '/forge-upload-attachment',
    '/deeplink-ticket',
  ];

  // Customer deeplink paths (/d/<cloudId>/<contentId>, /i/<token>) identify a
  // tenant + diagram and must never be logged verbatim
  // (docs/policies/client-privacy.md). Redact to just the path prefix.
  const UNLOGGED_PATH_PREFIXES = ['/d', '/i'];

  export function redactedRequestUrlForLogging(url: string): string {
    const { pathname, origin } = new URL(url);
    const hit = UNLOGGED_PATH_PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`));
    return hit ? `${origin}${hit} [redacted]` : url;
  }

  // Create a middleware function that handles authentication
  const authMiddleware: PagesFunction<Env, string, ForgeRequestData> = async ({
    next,
    request,
    env,
    data,
  }) => {
    try {
      console.log('Function request url:', redactedRequestUrlForLogging(request.url));

      if (AUTHENTICATED_PATHS.some(path => new URL(request.url).pathname.startsWith(path))) {
        const response = await authenticate({request, env, data});
        if(response.status !== 200) {
          return response;
        }
      }

      return await next();
    } catch (e) {
      // Log the error to console first as a fallback
      console.error('Authentication middleware error:', e);

      // Don't try to use Sentry directly here - the Sentry middleware will capture this error
      return ServerErrorResponse();
    }
  };

  // Make sure Sentry is the first middleware so it can capture errors from subsequent middleware
  const sentryMiddleware = Sentry.sentryPagesPlugin<Env, string, ForgeRequestData>((context) => ({
    dsn: context.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  }));

  export const onRequest = [
    sentryMiddleware,
    authMiddleware
  ];
  ```

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run public/_routes.spec.ts functions/_middleware.spec.ts`

- [x] **Step 5: Commit**
  `git add public/_routes.json functions/_middleware.ts public/_routes.spec.ts functions/_middleware.spec.ts`
  `git commit -m "feat(deeplink): allowlist /d /i /deeplink-ticket; gate mint on auth; redact deeplink paths from logs"`

---

### Task 6: Multi-host embed-macro parser — `src/utils/embedDeeplink.ts`
**Files:**
- Modify: `src/utils/embedDeeplink.ts`
- Modify: `src/utils/embedDeeplink.spec.ts`

**Interfaces:**
- Unchanged signature: `parseEmbedDeeplink(url: string): EmbedDeeplink | undefined`. Only `DEEPLINK_RE` changes.
- Consumer (unchanged, no edit needed): `src/forge-embed-viewer.ts` calls `parseEmbedDeeplink(context.extension.autoConvertLink)`.
- Design note: staging hosts (`conf-stg-lite.zenuml.com`) are deliberately **not** accepted. The Forge manifest `autoConvert` matcher is a single literal string, not environment-templated (see Task 8) — every install, staging or production, ships the same production-host matcher. A pasted deeplink therefore always carries the production host, even on a staging site.

- [x] **Step 1: Write the failing test**
```ts
// src/utils/embedDeeplink.spec.ts
import { describe, it, expect } from 'vitest';
import { parseEmbedDeeplink } from './embedDeeplink';

const CLOUD = '494a0c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('parseEmbedDeeplink', () => {
  it.each([
    ['legacy Worker host', 'confluence.zenuml.com'],
    ['lite/diagramly host', 'conf-lite.zenuml.com'],
    ['full host', 'conf-full.zenuml.com'],
  ])('parses a canonical deeplink on the %s', (_label, host) => {
    expect(parseEmbedDeeplink(`https://${host}/d/${CLOUD}/123456789`))
      .toEqual({ cloudId: CLOUD, contentId: '123456789' });
  });

  it('tolerates trailing slash, query and fragment', () => {
    expect(parseEmbedDeeplink(`https://conf-lite.zenuml.com/d/${CLOUD}/42/?utm=x#top`))
      .toEqual({ cloudId: CLOUD, contentId: '42' });
  });

  it('rejects http, foreign hosts (incl. staging hosts), and malformed paths', () => {
    expect(parseEmbedDeeplink(`http://conf-lite.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink(`https://evil.example.com/d/${CLOUD}/42`)).toBeUndefined();
    // Staging hosts are NOT accepted — see the file-level design note.
    expect(parseEmbedDeeplink(`https://conf-stg-lite.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink('https://conf-lite.zenuml.com/d/42')).toBeUndefined();
    expect(parseEmbedDeeplink(`https://conf-lite.zenuml.com/d/${CLOUD}/not-numeric`)).toBeUndefined();
    expect(parseEmbedDeeplink('')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run src/utils/embedDeeplink.spec.ts` — the new `it.each` cases for `conf-lite.zenuml.com` / `conf-full.zenuml.com` fail (regex still single-host); the `conf-stg-lite.zenuml.com` rejection case passes coincidentally (already rejected) but is now asserted deliberately rather than by accident.

- [x] **Step 3: Implement**
```ts
// src/utils/embedDeeplink.ts
// Deeplink shape is locked by the autoConvert matcher in manifest.yml. Each
// variant's matcher points at its own backend host — multi-host since the
// #382 Phase 1 migration: lite + diagramly ride conf-lite.zenuml.com, full
// rides conf-full.zenuml.com. confluence.zenuml.com is the retired
// standalone-Worker host, still accepted during the Phase 1->3 transition
// (see docs/superpowers/specs/2026-07-28-deeplink-serving-pages-migration-design.md).
// cloudId = site UUID; contentId = numeric Confluence custom-content id.
export interface EmbedDeeplink {
  cloudId: string;
  contentId: string;
}

const DEEPLINK_RE =
  /^https:\/\/(?:confluence|conf-lite|conf-full)\.zenuml\.com\/d\/([0-9a-fA-F-]{32,36})\/(\d+)\/?(?:[?#].*)?$/;

export function parseEmbedDeeplink(url: string): EmbedDeeplink | undefined {
  const m = DEEPLINK_RE.exec((url || '').trim());
  return m ? { cloudId: m[1].toLowerCase(), contentId: m[2] } : undefined;
}
```

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run src/utils/embedDeeplink.spec.ts`

- [x] **Step 5: Commit**
  `git add src/utils/embedDeeplink.ts src/utils/embedDeeplink.spec.ts`
  `git commit -m "feat(deeplink): accept conf-lite/conf-full hosts in the embed-macro deeplink parser"`

---

### Task 7: Mint — per-variant origin + Lite CTA flag
**Files:**
- Modify: `functions/deeplink-ticket.ts`
- Modify: `functions/deeplink-ticket.spec.ts`

**Interfaces:**
- Behavior change only (signature unchanged): the JSON response's `url` field is now built from `new URL(request.url).origin` instead of a hardcoded host. The minted payload gains `u: 1` when `data.forgeContext?.forgeAppId === LITE_FORGE_APP_ID`.
- `LITE_FORGE_APP_ID = "8ad26115-211f-4216-971b-0540f606303d"` — the Lite app's Forge `APP_ID`, taken from `scripts/forge-wizard.mjs` (`APPS.lite.appId`); already a public, non-secret value checked into this repo.

- [x] **Step 1: Write the failing test**

  Update the existing assertion in `functions/deeplink-ticket.spec.ts` (the `"mints a SIGNED token..."` test) — change:
  ```ts
  expect(out.url).toBe(`https://confluence.zenuml.com/d/cloud-1/425987?t=${out.token}`);
  ```
  to:
  ```ts
  expect(out.url).toBe(`https://backend.example/d/cloud-1/425987?t=${out.token}`);
  ```
  (`makeRequest()` in this spec builds requests against `https://backend.example/deeplink-ticket`, so the origin-derived URL must now use that host, not the old hardcoded one.)

  Then add two new tests:
  ```ts
  it("builds the returned url from the request's own origin (per-variant backend host)", async () => {
    const { kv } = makeKV();
    const res = await onRequest({
      request: new Request("https://conf-stg-lite.zenuml.com/deeplink-ticket", {
        method: "POST",
        body: JSON.stringify(validBody),
      }),
      env: { DB: makeDB("example.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
      data: forgeData,
    });
    const out = (await res.json()) as any;
    expect(out.url).toBe(`https://conf-stg-lite.zenuml.com/d/cloud-1/425987?t=${out.token}`);
  });

  it("sets ticket.u=1 when minted via the Lite Forge app; omits it for other apps", async () => {
    const { kv } = makeKV();
    const liteData = { forgeContext: { cloudId: "cloud-1", forgeAppId: "8ad26115-211f-4216-971b-0540f606303d" } } as any;
    const diagramlyData = { forgeContext: { cloudId: "cloud-1", forgeAppId: "01ede8b1-4e88-451a-b9ef-89eeef93afaf" } } as any;
    const env = { DB: makeDB("example.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET };
    const decode = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

    const liteRes = await onRequest({ request: makeRequest(validBody), env, data: liteData });
    const liteOut = (await liteRes.json()) as any;
    expect(decode(liteOut.token).u).toBe(1);

    const diaRes = await onRequest({ request: makeRequest(validBody), env, data: diagramlyData });
    const diaOut = (await diaRes.json()) as any;
    expect(decode(diaOut.token).u).toBeUndefined();
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run functions/deeplink-ticket.spec.ts` — the modified assertion fails (still returns `confluence.zenuml.com`); the two new tests fail (`url` mismatch; `u` always `undefined`).

- [x] **Step 3: Implement**

  In `functions/deeplink-ticket.ts`, add the constant (near the top, with the other constants):
  ```ts
  // Forge APP_ID of the Lite variant (scripts/forge-wizard.mjs APPS.lite.appId).
  // Not a secret — used only to tag a minted ticket as Lite-origin so the /d/
  // preview page can show the upgrade CTA (see functions/utils/deeplinkPages.ts).
  const LITE_FORGE_APP_ID = "8ad26115-211f-4216-971b-0540f606303d";
  ```
  Change the payload construction:
  ```ts
  const payload = {
    v: 1,
    d: subdomain,
    p: pageId,
    c: contentId,
    m: Math.floor(Date.now() / 1000),
    ...(title ? { t: title } : {}),
    ...(data.forgeContext?.forgeAppId === LITE_FORGE_APP_ID ? { u: 1 } : {}),
  };
  ```
  Change the response's `url`:
  ```ts
  return OkResponse({
    token,
    url: `${new URL(request.url).origin}/d/${cloudId}/${contentId}?t=${token}`,
    imageTtlSeconds: IMG_TTL_SECONDS,
  });
  ```

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run functions/deeplink-ticket.spec.ts`

- [x] **Step 5: Commit**
  `git add functions/deeplink-ticket.ts functions/deeplink-ticket.spec.ts`
  `git commit -m "feat(deeplink): mint url from request origin (per-variant host); tag Lite tickets for the upgrade CTA"`

---

### Task 8: Manifest matcher — default to conf-lite; full overrides to conf-full
**Files:**
- Modify: `manifest.yml`
- Modify: `scripts/forge-wizard.mjs`
- Create: `manifest.spec.ts` (repo root, next to `manifest.yml`)

**Interfaces:**
- `getManifestEditYqArgs(appKey): { expr: string }[]` (existing, from `scripts/forge-wizard.mjs`) — asserted against, not changed in signature.
- Resolved design-spec open item: diagramly does **not** ship `zenuml-embed-macro` at all — `APPS.diagramly.manifestEdits` already contains `del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))`. So diagramly needs **no** matcher edit (there is no macro left to carry one); it still *rides* `conf-lite.zenuml.com` for minting/serving (Tasks 1-7), it just can't autoConvert a pasted link into its own macro. This is pre-existing behavior, not a regression from this migration (confirmed by `tests/e2e-tests/config/apps.ts`'s `diagramly@*` profiles already excluding `'embed'` from `macros`).

- [x] **Step 1: Write the failing test**
```ts
// manifest.spec.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { getManifestEditYqArgs } from "./scripts/forge-wizard.mjs";

describe("manifest.yml embed deeplink autoConvert matcher", () => {
  it("default (lite/diagramly-inherited) matcher points at conf-lite.zenuml.com", () => {
    const manifest: any = yaml.load(readFileSync("./manifest.yml", "utf-8"));
    const embedMacro = manifest.modules.macro.find((m: any) => m.key.includes("zenuml-embed-macro"));
    expect(embedMacro.autoConvert.matchers[0].pattern).toBe("https://conf-lite.zenuml.com/d/*/*");
  });

  it("full variant's manifestEdits override the matcher to conf-full.zenuml.com", () => {
    const exprs = getManifestEditYqArgs("full").map((e) => e.expr);
    expect(exprs.some((e) => e.includes("conf-full.zenuml.com/d/*/*"))).toBe(true);
  });

  it("lite ships no matcher-override edit (it inherits the default); diagramly strips the macro entirely", () => {
    const liteExprs = getManifestEditYqArgs("lite").map((e) => e.expr);
    const diagramlyExprs = getManifestEditYqArgs("diagramly").map((e) => e.expr);
    expect(liteExprs.some((e) => e.includes("conf-lite.zenuml.com") || e.includes("autoConvert"))).toBe(false);
    expect(diagramlyExprs.some((e) => e.includes("zenuml-embed-macro"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  `npx vitest run manifest.spec.ts` — first test fails (current pattern is `https://confluence.zenuml.com/d/*/*`); second test fails (full has no such edit yet).

- [x] **Step 3: Implement**

  In `manifest.yml`, change (this is the only occurrence of this string in the file):
  ```yaml
          - pattern: https://confluence.zenuml.com/d/*/*
  ```
  to:
  ```yaml
          - pattern: https://conf-lite.zenuml.com/d/*/*
  ```

  In `scripts/forge-wizard.mjs`, append to `APPS.full.manifestEdits` (after the `"Remove Lite remote-storage declaration from Full"` entry):
  ```js
      {
        description: 'Point embed deeplink autoConvert matcher at conf-full.zenuml.com',
        yqEvalExpr:
          '(.modules.macro[] | select(.key | test("zenuml-embed-macro")) | .autoConvert.matchers[0].pattern) = "https://conf-full.zenuml.com/d/*/*"',
      },
  ```
  (Verified locally against a scratch copy of `manifest.yml` with `yq eval '<expr>' -i <file>` — `yq (mikefarah) v4.52.5` — the `select(.key | test(...))` form is required because the manifest key is the literal string `zenuml-embed-macro${LITE_KEY_SUFFIX}` before Forge's own env-var substitution; an exact `select(.key == "zenuml-embed-macro")` does not match.)

- [x] **Step 4: Run test to verify it passes**
  `npx vitest run manifest.spec.ts`
  Also dry-run the new yq expression against the real file without `-i` to double check no other manifest edit ordering issue: `yq eval '(.modules.macro[] | select(.key | test("zenuml-embed-macro")) | .autoConvert.matchers[0].pattern) = "https://conf-full.zenuml.com/d/*/*"' manifest.yml | grep -A2 "zenuml-embed-macro\${LITE_KEY_SUFFIX}"`.

- [x] **Step 5: Commit**
  `git add manifest.yml scripts/forge-wizard.mjs manifest.spec.ts`
  `git commit -m "feat(deeplink): point default autoConvert matcher at conf-lite; full overrides to conf-full"`

---

### Task 9: Bindings + secret (approval-gated — cloud changes)
**Files:**
- Modify: `wrangler-stg.toml`, `wrangler-prod.toml`, `wrangler-dev.toml`

**Interfaces:**
- New binding: `DEEPLINK_KV` (KV namespace), consumed by `functions/i/[token].ts`, `functions/d/[[path]].ts`, `functions/deeplink-ticket.ts` via their shared `Env.DEEPLINK_KV`.
- New secret: `DEEPLINK_SIGN_SECRET`, consumed the same way via `Env.DEEPLINK_SIGN_SECRET`.
- Because mint and serve are now ONE Pages project per environment (not a separate Worker + Pages pair), each project needs exactly **one** `DEEPLINK_SIGN_SECRET` value — it no longer has to be coordinated across two different deploy units. This is a genuine simplification the migration buys for free.

- [ ] **Step 1: Write the failing check**
  Locally: `pnpm wrangler:serve` (wrangler pages dev against the built `dist/`), then:
  ```bash
  curl -si -X POST http://127.0.0.1:8788/deeplink-ticket -d '{}'
  ```
  Expected failure today: `503 Deeplink preview is not configured in this environment` (no `DEEPLINK_KV` bound in `wrangler-dev.toml` yet).

- [ ] **Step 2: Run check to verify it fails**
  Confirm the 503 above before making any binding changes, so the later pass/fail comparison is meaningful.

- [ ] **Step 3: Implement (each command below needs explicit user approval — do NOT run unprompted; these create/modify real Cloudflare resources)**

  Create two KV namespaces (staging and prod stay isolated so live tickets never cross environments):
  ```bash
  npx wrangler kv namespace create DEEPLINK_KV_STG
  npx wrangler kv namespace create DEEPLINK_KV_PROD
  ```
  Each prints an `id = "..."` — paste the STG id into `wrangler-stg.toml` and `wrangler-dev.toml`, and the PROD id into `wrangler-prod.toml`.

  In `wrangler-stg.toml`, insert after the `SPACE_LICENSE_KV` block (after line 49):
  ```toml
  # Embed deeplink preview images (functions/i/, functions/d/,
  # functions/deeplink-ticket.ts). TTL'd PNG blobs only — no ticket data is
  # stored (tickets are signed tokens carried in the URL, not KV rows).
  [[env.production.kv_namespaces]]
  binding = "DEEPLINK_KV"
  id = "<id from: npx wrangler kv namespace create DEEPLINK_KV_STG>"
  ```

  In `wrangler-prod.toml`, insert after its `SPACE_LICENSE_KV` block (after line 47):
  ```toml
  [[env.production.kv_namespaces]]
  binding = "DEEPLINK_KV"
  id = "<id from: npx wrangler kv namespace create DEEPLINK_KV_PROD>"
  ```

  In `wrangler-dev.toml`, following the `SPACE_LICENSE_KV` local-dev precedent (same id used for both the root-level dev binding and the `env.production` block), insert after its `[[env.production.kv_namespaces]] binding = "SPACE_LICENSE_KV"` block:
  ```toml
  [[env.production.kv_namespaces]]
  binding = "DEEPLINK_KV"
  id = "<same id as wrangler-stg.toml's DEEPLINK_KV>"
  ```
  and after its root-level `[[kv_namespaces]] binding = "SPACE_LICENSE_KV"` block:
  ```toml
  [[kv_namespaces]]
  binding = "DEEPLINK_KV"
  id = "<same id as wrangler-stg.toml's DEEPLINK_KV>"
  ```

  Set the signing secret (generate locally, pipe directly so it never touches shell history):
  ```bash
  openssl rand -base64 32 | tr -d '\n' | npx wrangler pages secret put DEEPLINK_SIGN_SECRET --project-name=conf-stg-lite
  openssl rand -base64 32 | tr -d '\n' | npx wrangler pages secret put DEEPLINK_SIGN_SECRET --project-name=conf-lite
  ```
  (The staging and prod values do not need to match each other — each project only ever verifies tickets it minted itself.)

- [ ] **Step 4: Run check to verify it passes**
  Re-run `pnpm wrangler:serve` locally (picks up the edited `wrangler-dev.toml` via `pnpm wrangler:link`) and repeat the Step 1 curl — with a placeholder body it should now fail differently (400/401, not 503), confirming the KV binding resolved. Full pass/fail confirmation of the actual mint flow happens on staging in Task 10.

- [ ] **Step 5: Commit**
  `git add wrangler-stg.toml wrangler-prod.toml wrangler-dev.toml`
  `git commit -m "chore(deeplink): bind DEEPLINK_KV; document DEEPLINK_SIGN_SECRET setup"`
  (The `wrangler kv namespace create` / `wrangler pages secret put` commands themselves are live ops, not committed — only the resulting `id` values checked into the three `wrangler-*.toml` files are.)

---

### Task 10: Staging validation on conf-stg-lite
**Files:**
- Modify (if not already merged from PR #404 / branch `test/embed-deeplink-autoconvert`): `tests/e2e-tests/config/test-config.ts`, `tests/e2e-tests/helpers/embedDeeplink.ts`, `tests/e2e-tests/tests/insert/embed-deeplink-autoconvert.spec.ts`

**Precondition:** the autoConvert E2E spec (`embed-deeplink-autoconvert.spec.ts` + its `helpers/embedDeeplink.ts`) exists only on branch `test/embed-deeplink-autoconvert` (PR #404) as of this plan's writing — it is not yet in this worktree. If PR #404 has merged to `main` by the time this task runs, only the host-genericization edit below is needed; if not, merge/rebase it in first.

- [ ] **Step 1: Write the failing check**
  Genericize the E2E sample's host instead of hard-coding `confluence.zenuml.com`. In `tests/e2e-tests/config/test-config.ts`, add:
  ```ts
  function deeplinkHostForProductType(productType: ProductType): string {
    if (productType === 'full') return 'conf-full.zenuml.com';
    if (productType === 'lite' || productType === 'diagramly') return 'conf-lite.zenuml.com';
    return ''; // asyncapi ships no deeplink matcher
  }
  ```
  add `deeplinkHost: string;` to the `TestConfig` interface, and `deeplinkHost: deeplinkHostForProductType(profile.productType),` to the exported `testConfig` object.

  In `tests/e2e-tests/helpers/embedDeeplink.ts`, change:
  ```ts
  export function embedDeeplinkUrl(cloudId: string, contentId: string): string {
    return `https://confluence.zenuml.com/d/${cloudId}/${contentId}`;
  }
  ```
  to:
  ```ts
  export function embedDeeplinkUrl(host: string, cloudId: string, contentId: string): string {
    return `https://${host}/d/${cloudId}/${contentId}`;
  }
  ```

  In `tests/e2e-tests/tests/insert/embed-deeplink-autoconvert.spec.ts`, change:
  ```ts
  const SAMPLE = embedDeeplinkUrl('c78e721e-957f-402c-9b70-1df2227c2739', '170721444');
  ```
  to:
  ```ts
  const SAMPLE = embedDeeplinkUrl(testConfig.deeplinkHost, 'c78e721e-957f-402c-9b70-1df2227c2739', '170721444');
  ```
  This is a source edit, not a new automated assertion — the "check" that must currently fail is `npx playwright test --list tests/insert/embed-deeplink-autoconvert.spec.ts` erroring with "embedDeeplinkUrl expects 3 arguments, got 2" before the call site is updated.

- [ ] **Step 2: Run check to verify it fails**
  `cd tests/e2e-tests && npx playwright test --list tests/insert/embed-deeplink-autoconvert.spec.ts` before editing the call site — TypeScript arity error as described above.

- [ ] **Step 3: Implement**
  Apply the three edits from Step 1. Then, with Task 9's approval-gated bindings live on `conf-stg-lite`:
  ```bash
  # 1. Instruction page (no ticket) — deterministic, no dependencies.
  curl -si "https://conf-stg-lite.zenuml.com/d/bc8bb5b3-09d2-4932-b68c-9b56fab8e34a/999999999" | head -20
  # Expect: 200, "This link becomes a diagram in Confluence".

  # 2. Mint + serve the fresh-preview and expired states locally, against the
  #    real staging KV/secret (no live Forge JWT needed — this exercises the
  #    SAME signTicket/imgKeyFor the mint uses, not a parallel implementation).
  DEEPLINK_SIGN_SECRET="<the value set in Task 9 for conf-stg-lite>" npx tsx -e '
    import("./functions/utils/deeplink.ts").then(async ({ signTicket, imgKeyFor }) => {
      const secret = process.env.DEEPLINK_SIGN_SECRET;
      const now = Math.floor(Date.now() / 1000);
      const fresh = { v: 1, d: "lite-stg", p: "1", c: "999999999", m: now, t: "Staging validation" };
      const expired = { ...fresh, m: now - 600 };
      for (const [label, payload] of [["fresh", fresh], ["expired", expired]]) {
        const token = await signTicket(payload, secret);
        const imgKey = await imgKeyFor(token.split(".")[0]);
        console.log(label, "TOKEN=" + token, "IMG_KEY=" + imgKey);
      }
    });
  '
  # 3. Seed the fresh ticket's PNG into the REAL staging KV namespace.
  printf '\x89PNG\r\n\x1a\n' > /tmp/deeplink-test.png
  npx wrangler kv key put --binding=DEEPLINK_KV "img:<fresh IMG_KEY>" --path=/tmp/deeplink-test.png --remote --config wrangler-stg.toml --env production

  # 4. Fresh preview state.
  curl -si "https://conf-stg-lite.zenuml.com/d/bc8bb5b3-09d2-4932-b68c-9b56fab8e34a/999999999?t=<fresh TOKEN>" | head -30
  # Expect: 200, "<h1>Staging validation</h1>", og:image pointing at /i/<fresh TOKEN>, no x-robots-tag header.

  # 5. /i/ image route.
  curl -si "https://conf-stg-lite.zenuml.com/i/<fresh TOKEN>" -o /tmp/preview-out.png -w "%{http_code} %{content_type}\n"
  file /tmp/preview-out.png   # expect: PNG image data

  # 6. Expired state (no need to wait 570s — minted already 600s in the past).
  curl -si "https://conf-stg-lite.zenuml.com/d/bc8bb5b3-09d2-4932-b68c-9b56fab8e34a/999999999?t=<expired TOKEN>" | head -20
  # Expect: 200, "This preview has expired", x-robots-tag: noindex.

  # 7. Bracket-routing sanity check (this repo has no prior [param]/[[catch]]
  #    functions — confirm Cloudflare Pages actually dispatched to our
  #    functions rather than falling back to the SPA). If steps 1/4/6 above
  #    returned generic index.html (200 text/html with no ZenUML markup)
  #    instead of the expected body text, routing did not wire up — check
  #    public/_routes.json deployed correctly and the [[path]]/[token]
  #    filenames survived the build (some bundlers mangle bracket filenames).

  # 8. Mint endpoint deploy + auth-gate check (no live Forge JWT available in
  #    this environment, so this confirms deployment + auth wiring only, not
  #    a full end-to-end mint — that requires the frontend "Share" UI from
  #    byline-activation spec §6, which is out of scope for this backend
  #    migration plan).
  curl -si -X POST https://conf-stg-lite.zenuml.com/deeplink-ticket -d '{}' | head -5
  # Expect: 401 Unauthorized (missing Authorization header) — confirms
  # /deeplink-ticket is deployed AND gated by AUTHENTICATED_PATHS, without a
  # real Forge token.

  # 9. autoConvert E2E, now expecting conf-lite.zenuml.com as the sample host.
  cd tests/e2e-tests && APP=zenuml-lite@stg pnpm test:insert -- embed-deeplink-autoconvert
  ```

- [ ] **Step 4: Run check to verify it passes**
  Confirm every curl above matches its expected status/body, and the Playwright run reports both tests in `embed-deeplink-autoconvert.spec.ts` green (the paste->embed-macro conversion, and the type+space negative control).

- [ ] **Step 5: Commit**
  `git add tests/e2e-tests/config/test-config.ts tests/e2e-tests/helpers/embedDeeplink.ts tests/e2e-tests/tests/insert/embed-deeplink-autoconvert.spec.ts`
  `git commit -m "test(deeplink): read the autoConvert E2E's expected host from the active profile"`

  No further deploy action here — staging is already live from Task 9's bindings plus the CI/CD pipeline picking up Tasks 1-8's merged commits. Cutting `conf-lite` (production) repeats Task 9's prod commands (already included there) and is otherwise just "merge to main, let CI/CD deploy" per this repo's standing release process — no separate task needed.

## Next phases (out of scope here)

- **Phase 2 (full):** repeat Tasks 3-5 verification, Task 9 (bindings), and Task 10 (validation) against `conf-stg-full` / `conf-full` — the code from Tasks 1-8 already supports Full (multi-host regex, full-variant matcher edit) without further changes.
- **Phase 3 (retire the Worker):** once lite, diagramly, and full all serve from Pages, un-deploy `workers/confluence-deeplink` and drop the `confluence.zenuml.com` DNS record. Keep the Worker's code in-repo for history. Re-scope or close #399.
