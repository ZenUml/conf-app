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
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
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
