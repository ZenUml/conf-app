import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./utils/sentry", () => ({ captureError: vi.fn() }));

import { onRequest as mint } from "./deeplink-ticket";
import worker from "../workers/confluence-deeplink/src/index";

// CONTRACT TEST: the mint endpoint (Pages backend) and the deeplink Worker
// never import each other — their only interface is the SIGNED TOKEN format
// (base64url(payload).base64url(hmac)) plus the `img:<id>` KV key. Both sides
// must share the same HMAC secret and payload shape. This runs a real mint,
// then serves the minted URL through the real Worker fetch handler on the SAME
// KV + secret. If either side drifts (signing, payload fields, key prefix, TTL),
// this is the test that goes red.

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CLOUD_ID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const MINT_INSTANT = "2026-07-26T10:00:00.000Z";

const SECRET = "contract-test-secret";
function sharedKV() {
  const store = new Map<string, { value: string | ArrayBuffer; expiresAt?: number }>();
  return {
    async put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number }) {
      store.set(key, {
        value,
        expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
      });
    },
    async get(key: string, type?: string) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt !== undefined && Date.now() >= e.expiresAt) {
        store.delete(key);
        return null;
      }
      if (type === "json") return JSON.parse(e.value as string);
      if (type === "arrayBuffer") return e.value;
      return e.value;
    },
  } as any;
}

const dbReturning = (clientDomain: string) =>
  ({
    prepare: () => ({ bind: () => ({ first: async () => ({ clientDomain }) }) }),
  }) as any;

describe("mint → worker contract over shared KV", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MINT_INSTANT));
  });
  afterEach(() => vi.useRealTimers());

  async function mintTicket(kv: any) {
    const res = await mint({
      request: new Request("https://backend.example/deeplink-ticket", {
        method: "POST",
        body: JSON.stringify({
          contentId: "425987",
          pageId: "123456",
          title: "Order flow",
          pngBase64: TINY_PNG_B64,
        }),
      }),
      env: { DB: dbReturning("example.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
      data: { forgeContext: { cloudId: CLOUD_ID } } as any,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { token: string; url: string };
  }

  it("a freshly minted URL renders the preview page with image and click-through", async () => {
    const kv = sharedKV();
    const { url } = await mintTicket(kv);

    const page = await worker.fetch(new Request(url), { DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET } as any);
    const html = await page.text();
    expect(html).toContain("<h1>Order flow</h1>");
    expect(html).toContain(
      'href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"',
    );

    const imgUrl = /og:image" content="([^"]+)"/.exec(html)![1];
    const img = await worker.fetch(new Request(imgUrl), { DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET } as any);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    // The served bytes are the minted PNG, not a placeholder.
    const bytes = new Uint8Array(await img.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("11 minutes later: image physically gone, page shows expired + permanent button", async () => {
    const kv = sharedKV();
    const { url, token } = await mintTicket(kv);

    vi.setSystemTime(new Date(Date.parse(MINT_INSTANT) + 11 * 60_000));

    const img = await worker.fetch(
      new Request(`https://confluence.zenuml.com/i/${token}`),
      { DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET } as any,
    );
    expect(img.status).toBe(404);

    const html = await (await worker.fetch(new Request(url), { DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET } as any)).text();
    expect(html).toContain("This preview has expired");
    expect(html).toContain(
      'href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"',
    );
  });

  it("minted URL keeps the autoconvert-compatible path shape (#360 contract)", async () => {
    const kv = sharedKV();
    const { url } = await mintTicket(kv);
    // Must match src/utils/embedDeeplink.ts DEEPLINK_RE (which tolerates ?query)
    // and the manifest matcher https://confluence.zenuml.com/d/*/* — pasting a
    // TICKETED link into Confluence still converts.
    expect(url).toMatch(
      /^https:\/\/confluence\.zenuml\.com\/d\/[0-9a-fA-F-]{32,36}\/\d+\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });
});
