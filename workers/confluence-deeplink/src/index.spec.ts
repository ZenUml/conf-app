import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "./index";

// The worker's fetch handler is a pure function of (Request, Env) — no
// miniflare needed. TTL behavior is exercised with an in-memory KV that
// honors expirationTtl against vi.setSystemTime.

const CLOUD_ID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const TOKEN = "unitToken1234567890a";
const MINTED_AT = "2026-07-26T10:00:00.000Z";

function makeKV() {
  const store = new Map<string, { value: string | ArrayBuffer; expiresAt?: number }>();
  const kv = {
    async put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number }) {
      store.set(key, {
        value,
        expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
      });
    },
    async get(key: string, type?: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
        store.delete(key);
        return null;
      }
      if (type === "json") return JSON.parse(entry.value as string);
      if (type === "arrayBuffer") return entry.value;
      return entry.value;
    },
  };
  return { kv: kv as any, store };
}

function ticket(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    d: "example.atlassian.net",
    p: "123456",
    c: "425987",
    t: "Order flow",
    m: MINTED_AT,
    ...overrides,
  });
}

const get = (env: object, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://confluence.zenuml.com${path}`, init), env as any);

describe("confluence-deeplink worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MINTED_AT)); // = mint instant
  });
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

    it("non-GET methods are 405, HEAD is allowed", async () => {
      expect((await get({}, "/d/x", { method: "POST" })).status).toBe(405);
      expect((await get({}, "/d/x", { method: "HEAD" })).status).toBe(200);
    });
  });

  describe("instruction page (no usable ticket)", () => {
    it.each([
      ["bare strict path", `/d/${CLOUD_ID}/425987`],
      ["truncated path", "/d/garbage"],
      ["/d root", "/d"],
      ["token with bad format", `/d/${CLOUD_ID}/425987?t=short`],
      ["unknown token", `/d/${CLOUD_ID}/425987?t=doesNotExist12345678`],
    ])("%s → instruction page, cacheable", async (_name, path) => {
      const { kv } = makeKV();
      const res = await get({ DEEPLINK_KV: kv }, path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("This link becomes a diagram in Confluence");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("missing KV binding degrades every ticketed link to the instruction page (v1 behavior)", async () => {
      const res = await get({}, `/d/${CLOUD_ID}/425987?t=${TOKEN}`);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });

    it("malformed ticket JSON degrades to the instruction page, not a 1101", async () => {
      const { kv, store } = makeKV();
      store.set(`ticket:${TOKEN}`, { value: "not json {" });
      const res = await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("This link becomes a diagram in Confluence");
    });
  });

  describe("preview state (fresh ticket)", () => {
    it("serves title, absolute og:image, Confluence button; never cached", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket());
      const res = await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`);
      const html = await res.text();
      expect(html).toContain("<h1>Order flow</h1>");
      expect(html).toContain(`og:image" content="https://confluence.zenuml.com/i/${TOKEN}"`);
      expect(html).toContain(
        'href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"',
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      // The fresh preview is deliberately shared → fully unfurlable: NO noindex
      // (meta or header), summary_large_image so Slack renders the big image.
      expect(res.headers.get("x-robots-tag")).toBeNull();
      expect(html).not.toContain('name="robots"');
      expect(html).toContain('twitter:card" content="summary_large_image"');
    });

    it("emits og:image dimensions when the ticket carries w/h (helps Slack render inline)", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket({ w: 1012, h: 786 }));
      const html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).toContain('og:image:width" content="1012"');
      expect(html).toContain('og:image:height" content="786"');
    });

    it("expired page stays noindex (may carry a customer /d path, not deliberately shared)", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket({ m: "2026-01-01T00:00:00Z" }));
      const res = await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`);
      expect(await res.text()).toContain("This preview has expired");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    });

    it("escapes a hostile title (no raw HTML reaches the page)", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket({ t: `<img src=x onerror=alert(1)>` }));
      const html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });
  });

  describe("security gates on the ticket itself (KV contents are not trusted)", () => {
    it("ticket bound to a different contentId → instruction page", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket({ c: "999" }));
      const html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
    });

    it.each([
      ["non-atlassian host", { d: "evil.example.com" }],
      ["scheme smuggling", { d: "evil.com/#.atlassian.net" }],
      ["non-numeric pageId", { p: "1 onclick=x" }],
    ])("poisoned ticket (%s) → instruction page, no redirect target emitted", async (_n, bad) => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket(bad));
      const html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).toContain("This link becomes a diagram in Confluence");
      expect(html).not.toContain("evil");
    });
  });

  describe("expiry boundary (570s = 600s TTL − 30s safety margin)", () => {
    it("at 569s the preview still shows; at 571s it flips to expired", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket());

      vi.setSystemTime(new Date(Date.parse(MINTED_AT) + 569_000));
      let html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).toContain("<h1>Order flow</h1>");

      vi.setSystemTime(new Date(Date.parse(MINTED_AT) + 571_000));
      html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).toContain("This preview has expired");
      // The permanent click-through survives expiry.
      expect(html).toContain(
        'href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"',
      );
    });

    it("unparsable minted-at is treated as expired, not fresh", async () => {
      const { kv } = makeKV();
      await kv.put(`ticket:${TOKEN}`, ticket({ m: "not-a-date" }));
      const html = await (
        await get({ DEEPLINK_KV: kv }, `/d/${CLOUD_ID}/425987?t=${TOKEN}`)
      ).text();
      expect(html).toContain("This preview has expired");
    });
  });

  describe("image route /i/<token>", () => {
    it("serves PNG bytes with short public cache while the object lives", async () => {
      const { kv } = makeKV();
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
      await kv.put(`img:${TOKEN}`, bytes, { expirationTtl: 600 });
      const res = await get({ DEEPLINK_KV: kv }, `/i/${TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect((await res.arrayBuffer()).byteLength).toBe(4);
    });

    it("404s after physical KV expiry and for unknown tokens", async () => {
      const { kv } = makeKV();
      await kv.put(`img:${TOKEN}`, new Uint8Array([1]).buffer, { expirationTtl: 600 });
      vi.setSystemTime(new Date(Date.parse(MINTED_AT) + 601_000));
      expect((await get({ DEEPLINK_KV: kv }, `/i/${TOKEN}`)).status).toBe(404);
      expect((await get({ DEEPLINK_KV: kv }, `/i/neverExisted12345678`)).status).toBe(404);
    });
  });
});
