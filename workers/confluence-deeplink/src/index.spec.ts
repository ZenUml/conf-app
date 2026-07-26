import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "./index";

// Tickets are COMPACT signed tokens in the URL: base64url(payload).base64url(hmac[:16]).
// Payload {v,d,p,c,m,t} — d is the SUBDOMAIN, m is Unix SECONDS, the image KV
// key is DERIVED from the payload hash (no field). Tests mint real tokens with
// a test secret via the same algorithm the worker verifies.

const CLOUD_ID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const SECRET = "test-signing-secret-value";
const MINTED_MS = Date.parse("2026-07-26T10:00:00.000Z");
const MINTED_UNIX = Math.floor(MINTED_MS / 1000);
const SIG_BYTES = 16;
const IMGKEY_BYTES = 12;

const ENC = new TextEncoder();
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ENC.encode(msg)));
}
async function sha256(msg: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ENC.encode(msg)));
}
async function imgKeyFor(payloadB64: string): Promise<string> {
  return b64url((await sha256(payloadB64)).slice(0, IMGKEY_BYTES));
}
// Build a signed token; returns { token, imgKey } so image tests can seed KV.
async function mint(overrides: Record<string, unknown> = {}, secret = SECRET) {
  const payload = { v: 1, d: "example", p: "123456", c: "425987", m: MINTED_UNIX, t: "Order flow", ...overrides };
  const payloadB64 = b64url(ENC.encode(JSON.stringify(payload)));
  const sig = b64url((await hmac(secret, payloadB64)).slice(0, SIG_BYTES));
  return { token: `${payloadB64}.${sig}`, imgKey: await imgKeyFor(payloadB64) };
}

function makeKV() {
  const store = new Map<string, { value: string | ArrayBuffer; expiresAt?: number }>();
  const kv = {
    async put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number }) {
      store.set(key, { value, expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined });
    },
    async get(key: string, type?: string) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt !== undefined && Date.now() >= e.expiresAt) { store.delete(key); return null; }
      if (type === "arrayBuffer") return e.value;
      return e.value;
    },
  };
  return { kv: kv as any, store };
}
function env(seedImgKey?: string) {
  const { kv, store } = makeKV();
  if (seedImgKey) store.set(`img:${seedImgKey}`, { value: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer });
  return { DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET };
}

const get = (e: object, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://confluence.zenuml.com${path}`, init), e as any);

describe("confluence-deeplink worker (compact signed tokens)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(MINTED_MS)); });
  afterEach(() => vi.useRealTimers());

  describe("routing", () => {
    it("/ → 302 zenuml.com", async () => {
      const res = await get({}, "/");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^https:\/\/zenuml\.com\/?$/);
    });
    it("unknown → 404 noindex", async () => {
      const res = await get({}, "/nope");
      expect(res.status).toBe(404);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    });
    it("non-GET → 405; HEAD → 200", async () => {
      expect((await get({}, "/d/x", { method: "POST" })).status).toBe(405);
      expect((await get({}, "/d/x", { method: "HEAD" })).status).toBe(200);
    });
  });

  describe("instruction page (no usable ticket)", () => {
    it.each([
      ["bare path", `/d/${CLOUD_ID}/425987`],
      ["truncated", "/d/garbage"],
      ["/d root", "/d"],
      ["not-a-token", `/d/${CLOUD_ID}/425987?t=notsigned`],
    ])("%s → instruction page", async (_n, path) => {
      const res = await get(env(), path);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("missing secret degrades to instruction page", async () => {
      const { token } = await mint();
      const res = await get({ DEEPLINK_KV: makeKV().kv }, `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("tampered signature → instruction page", async () => {
      const { token } = await mint();
      const res = await get(env(), `/d/${CLOUD_ID}/425987?t=${token.slice(0, -3)}AAA`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("wrong secret → instruction page", async () => {
      const { token } = await mint({}, "attacker-secret");
      const res = await get(env(), `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });
  });

  describe("preview state (fresh, valid)", () => {
    it("title, og:image, subdomain→host button; fully unfurlable", async () => {
      const { token, imgKey } = await mint();
      const html = await (await get(env(imgKey), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).toContain("<h1>Order flow</h1>");
      expect(html).toContain(`og:image" content="https://confluence.zenuml.com/i/${token}"`);
      // d="example" → full host example.atlassian.net
      expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
      expect(html).toContain('twitter:card" content="summary_large_image"');
      const res = await get(env(imgKey), `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(res.headers.get("x-robots-tag")).toBeNull();
    });

    it("escapes a hostile title", async () => {
      const { token } = await mint({ t: `<img src=x onerror=alert(1)>` });
      const html = await (await get(env(), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });
  });

  describe("security gates", () => {
    it("valid token replayed on a DIFFERENT content path → instruction page", async () => {
      const { token } = await mint({ c: "425987" });
      const html = await (await get(env(), `/d/${CLOUD_ID}/999?t=${token}`)).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
    });
    it.each([
      ["subdomain with a dot (host injection)", { d: "evil.example" }],
      ["subdomain with slash", { d: "evil/x" }],
      ["non-numeric pageId", { p: "1 x" }],
    ])("structurally invalid payload (%s) → instruction page", async (_n, bad) => {
      const { token } = await mint(bad);
      const html = await (await get(env(), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
      expect(html).not.toContain("evil");
    });
  });

  describe("expiry boundary (570s window, seconds)", () => {
    it("569s fresh; 571s expired (button survives, noindex)", async () => {
      const { token, imgKey } = await mint();
      const e = env(imgKey);
      vi.setSystemTime(new Date(MINTED_MS + 569_000));
      expect(await (await get(e, `/d/${CLOUD_ID}/425987?t=${token}`)).text()).toContain("<h1>Order flow</h1>");
      vi.setSystemTime(new Date(MINTED_MS + 571_000));
      const res = await get(e, `/d/${CLOUD_ID}/425987?t=${token}`);
      const html = await res.text();
      expect(html).toContain("This preview has expired");
      expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    });
  });

  describe("image route /i/<token> (key derived from payload)", () => {
    it("serves the PNG for a valid fresh token", async () => {
      const { token, imgKey } = await mint();
      const res = await get(env(imgKey), `/i/${token}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect((await res.arrayBuffer()).byteLength).toBe(4);
    });
    it("404s when expired, tampered, or the derived key is unseeded", async () => {
      const { token, imgKey } = await mint();
      vi.setSystemTime(new Date(MINTED_MS + 601_000));
      expect((await get(env(imgKey), `/i/${token}`)).status).toBe(404); // expired
      vi.setSystemTime(new Date(MINTED_MS));
      expect((await get(env(imgKey), `/i/${token.slice(0, -3)}AAA`)).status).toBe(404); // tampered
      expect((await get(env(), `/i/${token}`)).status).toBe(404); // KV not seeded
    });
  });
});
