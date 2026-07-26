import { describe, it, expect, vi } from "vitest";

vi.mock("./utils/sentry", () => ({
  captureError: vi.fn(),
}));

import { onRequest, IMG_TTL_SECONDS } from "./deeplink-ticket";

// 1x1 transparent PNG.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type KvPut = { key: string; opts?: { expirationTtl?: number } };

function makeKV() {
  const puts: KvPut[] = [];
  return {
    puts,
    kv: {
      put: vi.fn(async (key: string, _value: unknown, opts?: { expirationTtl?: number }) => {
        puts.push({ key, opts });
      }),
    } as any,
  };
}

function makeDB(clientDomain: string | null) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: async () => (clientDomain ? { clientDomain } : null),
      })),
    })),
  } as any;
}

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://backend.example/deeplink-ticket", {
    method,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const forgeData = { forgeContext: { cloudId: "cloud-1" } } as any;

const validBody = {
  contentId: "425987",
  pageId: "123456",
  title: "Order flow",
  pngBase64: TINY_PNG_B64,
};

describe("deeplink-ticket", () => {
  it("rejects non-POST", async () => {
    const { kv } = makeKV();
    const res = await onRequest({
      request: makeRequest(undefined, "GET"),
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv },
      data: forgeData,
    });
    expect(res.status).toBe(405);
  });

  it("returns 503 when the KV namespace is not bound (feature off)", async () => {
    const res = await onRequest({
      request: makeRequest(validBody),
      env: { DB: makeDB("x.atlassian.net") } as any,
      data: forgeData,
    });
    expect(res.status).toBe(503);
  });

  it("rejects non-numeric ids and non-PNG payloads", async () => {
    const { kv } = makeKV();
    const env = { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv };
    const badId = await onRequest({
      request: makeRequest({ ...validBody, contentId: "abc" }),
      env,
      data: forgeData,
    });
    expect(badId.status).toBe(400);
    const badPng = await onRequest({
      request: makeRequest({ ...validBody, pngBase64: btoa("not a png") }),
      env,
      data: forgeData,
    });
    expect(badPng.status).toBe(400);
  });

  it("refuses to mint when no *.atlassian.net hostname is resolvable (anti-open-redirect)", async () => {
    const { kv } = makeKV();
    const res = await onRequest({
      request: makeRequest({ ...validBody, siteHostname: "evil.example.com" }),
      env: { DB: makeDB(null), DEEPLINK_KV: kv },
      data: forgeData,
    });
    expect(res.status).toBe(409);
  });

  it("rejects a PNG over the 2MB cap with 413", async () => {
    const { kv } = makeKV();
    // Valid magic followed by >2MB of padding, base64-encoded.
    const big = new Uint8Array(2 * 1024 * 1024 + 16);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    let bin = "";
    for (let i = 0; i < big.length; i += 0x8000) {
      bin += String.fromCharCode(...big.subarray(i, i + 0x8000));
    }
    const res = await onRequest({
      request: makeRequest({ ...validBody, pngBase64: btoa(bin) }),
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv },
      data: forgeData,
    });
    expect(res.status).toBe(413);
  });

  it("truncates an oversized title instead of rejecting", async () => {
    const { kv, puts } = makeKV();
    const res = await onRequest({
      request: makeRequest({ ...validBody, title: "x".repeat(1000) }),
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    const ticket = puts.find((p) => p.key === `ticket:${out.token}`);
    expect(ticket).toBeDefined();
  });

  it("returns 500 (not an unhandled throw) when the KV write fails", async () => {
    const kv = {
      put: vi.fn(async () => {
        throw new Error("kv down");
      }),
    } as any;
    const res = await onRequest({
      request: makeRequest(validBody),
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv },
      data: forgeData,
    });
    expect(res.status).toBe(500);
  });

  it("mints: img gets the TTL, ticket does not, url carries the token", async () => {
    const { kv, puts } = makeKV();
    const res = await onRequest({
      request: makeRequest(validBody),
      env: { DB: makeDB("example.atlassian.net"), DEEPLINK_KV: kv },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out.imageTtlSeconds).toBe(IMG_TTL_SECONDS);
    expect(out.url).toBe(
      `https://confluence.zenuml.com/d/cloud-1/425987?t=${out.token}`,
    );

    const img = puts.find((p) => p.key === `img:${out.token}`);
    const ticket = puts.find((p) => p.key === `ticket:${out.token}`);
    expect(img?.opts?.expirationTtl).toBe(IMG_TTL_SECONDS);
    expect(ticket?.opts?.expirationTtl).toBeUndefined();
  });
});
