import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "./index";

// The worker's fetch handler is a pure function of (Request, Env). Tickets are
// SIGNED tokens carried in the URL (no ticket: KV) — tests mint real signed
// tokens with a test secret via the same HMAC the worker verifies. Only the
// PNG lives in KV (img:<i>), so an in-memory KV covers the image path.

const CLOUD_ID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const SECRET = "test-signing-secret-value";
const MINTED_AT = "2026-07-26T10:00:00.000Z";
const IMG_ID = "imgunit12345678";

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
// Build a signed token from a payload, using the real signing algorithm.
async function signToken(overrides: Record<string, unknown> = {}, secret = SECRET): Promise<string> {
  const payload = { d: "example.atlassian.net", p: "123456", c: "425987", m: MINTED_AT, i: IMG_ID, t: "Order flow", ...overrides };
  const payloadB64 = b64url(ENC.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, payloadB64));
  return `${payloadB64}.${sig}`;
}

function makeKV() {
  const store = new Map<string, { value: string | ArrayBuffer; expiresAt?: number }>();
  const kv = {
    async put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number }) {
      store.set(key, { value, expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined });
    },
    async get(key: string, type?: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) { store.delete(key); return null; }
      if (type === "arrayBuffer") return entry.value;
      return entry.value;
    },
  };
  return { kv: kv as any, store };
}

// env with the signing secret and a KV pre-seeded with the image bytes.
function makeEnv() {
  const { kv, store } = makeKV();
  store.set(`img:${IMG_ID}`, { value: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer });
  return { DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET, store };
}

const get = (env: object, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://confluence.zenuml.com${path}`, init), env as any);

describe("confluence-deeplink worker (signed tokens)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(MINTED_AT)); });
  afterEach(() => vi.useRealTimers());

  describe("routing", () => {
    it("/ redirects to zenuml.com", async () => {
      const res = await get({}, "/");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^https:\/\/zenuml\.com\/?$/);
    });
    it("unknown paths get the HTML 404, noindexed", async () => {
      const res = await get({}, "/nope");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    });
    it("non-GET is 405, HEAD allowed", async () => {
      expect((await get({}, "/d/x", { method: "POST" })).status).toBe(405);
      expect((await get({}, "/d/x", { method: "HEAD" })).status).toBe(200);
    });
  });

  describe("instruction page (no usable ticket)", () => {
    it.each([
      ["bare strict path (no token)", `/d/${CLOUD_ID}/425987`],
      ["truncated path", "/d/garbage"],
      ["/d root", "/d"],
      ["not-a-signed-token", `/d/${CLOUD_ID}/425987?t=notsigned`],
    ])("%s → instruction page, cacheable", async (_n, path) => {
      const res = await get(makeEnv(), path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("missing signing secret degrades every ticketed link to the instruction page", async () => {
      const token = await signToken();
      const res = await get({ DEEPLINK_KV: makeKV().kv }, `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("TAMPERED token (bad signature) → instruction page, never a crash", async () => {
      const token = await signToken();
      const tampered = token.slice(0, -3) + "AAA"; // corrupt the signature
      const res = await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${tampered}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("token signed with the WRONG secret → instruction page", async () => {
      const token = await signToken({}, "attacker-secret");
      const res = await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${token}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });
  });

  describe("preview state (fresh, validly-signed ticket)", () => {
    it("serves title, absolute og:image, Confluence button; fully unfurlable", async () => {
      const token = await signToken();
      const res = await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${token}`);
      const html = await res.text();
      expect(html).toContain("<h1>Order flow</h1>");
      expect(html).toContain(`og:image" content="https://confluence.zenuml.com/i/${token}"`);
      expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBeNull();
      expect(html).not.toContain('name="robots"');
      expect(html).toContain('twitter:card" content="summary_large_image"');
    });

    it("emits og:image dimensions when the payload carries w/h", async () => {
      const token = await signToken({ w: 1012, h: 786 });
      const html = await (await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).toContain('og:image:width" content="1012"');
      expect(html).toContain('og:image:height" content="786"');
    });

    it("escapes a hostile title", async () => {
      const token = await signToken({ t: `<img src=x onerror=alert(1)>` });
      const html = await (await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });
  });

  describe("security gates on the signed payload", () => {
    it("valid token replayed on a DIFFERENT content path → instruction page", async () => {
      const token = await signToken({ c: "425987" });
      const html = await (await get(makeEnv(), `/d/${CLOUD_ID}/999?t=${token}`)).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
    });
    it.each([
      ["non-atlassian host", { d: "evil.example.com" }],
      ["scheme smuggling host", { d: "evil.com/#.atlassian.net" }],
      ["non-numeric pageId", { p: "1 onclick=x" }],
    ])("signed but structurally invalid payload (%s) → instruction page", async (_n, bad) => {
      const token = await signToken(bad);
      const html = await (await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
      expect(html).not.toContain("evil");
    });
  });

  describe("expiry boundary (570s = 600 TTL − 30 margin)", () => {
    it("569s fresh → preview; 571s → expired page (button survives, noindex)", async () => {
      const token = await signToken();
      const env = makeEnv();
      vi.setSystemTime(new Date(Date.parse(MINTED_AT) + 569_000));
      expect(await (await get(env, `/d/${CLOUD_ID}/425987?t=${token}`)).text()).toContain("<h1>Order flow</h1>");
      vi.setSystemTime(new Date(Date.parse(MINTED_AT) + 571_000));
      const res = await get(env, `/d/${CLOUD_ID}/425987?t=${token}`);
      const html = await res.text();
      expect(html).toContain("This preview has expired");
      expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    });
    it("unparsable minted-at is treated as expired", async () => {
      const token = await signToken({ m: "not-a-date" });
      const html = await (await get(makeEnv(), `/d/${CLOUD_ID}/425987?t=${token}`)).text();
      expect(html).toContain("This preview has expired");
    });
  });

  describe("image route /i/<token>", () => {
    it("serves the PNG for a valid fresh token", async () => {
      const token = await signToken();
      const res = await get(makeEnv(), `/i/${token}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect((await res.arrayBuffer()).byteLength).toBe(4);
    });
    it("404s for an expired token, a tampered token, and a missing KV image", async () => {
      const token = await signToken();
      const env = makeEnv();
      vi.setSystemTime(new Date(Date.parse(MINTED_AT) + 601_000));
      expect((await get(env, `/i/${token}`)).status).toBe(404); // expired
      vi.setSystemTime(new Date(MINTED_AT));
      expect((await get(env, `/i/${token.slice(0, -3)}AAA`)).status).toBe(404); // tampered
      const orphan = await signToken({ i: "no-such-image" });
      expect((await get(env, `/i/${orphan}`)).status).toBe(404); // KV miss
    });
  });
});
