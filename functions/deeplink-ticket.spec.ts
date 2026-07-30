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

const SECRET = "test-secret";
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
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
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
    const env = { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET };
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
      env: { DB: makeDB(null), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
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
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
      data: forgeData,
    });
    expect(res.status).toBe(413);
  });

  it("truncates an oversized title instead of rejecting", async () => {
    const { kv, puts } = makeKV();
    const res = await onRequest({
      request: makeRequest({ ...validBody, title: "x".repeat(1000) }),
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    expect(puts.some((p) => p.key.startsWith("img:"))).toBe(true);
  });

  it("returns 503 when the signing secret is not configured", async () => {
    const { kv } = makeKV();
    const res = await onRequest({
      request: makeRequest(validBody),
      env: { DB: makeDB("example.atlassian.net"), DEEPLINK_KV: kv } as any,
      data: forgeData,
    });
    expect(res.status).toBe(503);
  });

  it("returns 500 (not an unhandled throw) when the KV write fails", async () => {
    const kv = {
      put: vi.fn(async () => {
        throw new Error("kv down");
      }),
    } as any;
    const res = await onRequest({
      request: makeRequest(validBody),
      env: { DB: makeDB("x.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
      data: forgeData,
    });
    expect(res.status).toBe(500);
  });

  it("mints a SIGNED token: only the PNG is in KV (TTL), no ticket row, url carries the token", async () => {
    const { kv, puts } = makeKV();
    const res = await onRequest({
      request: makeRequest({ ...validBody, width: 1012, height: 786 }),
      env: { DB: makeDB("example.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out.imageTtlSeconds).toBe(IMG_TTL_SECONDS);
    // Token is base64url(payload).base64url(sig).
    expect(out.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(out.url).toBe(`https://backend.example/d/cloud-1/425987?t=${out.token}`);

    // Exactly one KV write — the image — with the TTL; NO ticket: key.
    const imgWrites = puts.filter((p) => p.key.startsWith("img:"));
    expect(imgWrites).toHaveLength(1);
    expect(imgWrites[0].opts?.expirationTtl).toBe(IMG_TTL_SECONDS);
    expect(puts.some((p) => p.key.startsWith("ticket:"))).toBe(false);

    // Compact payload: subdomain-only d, Unix-seconds m, contentId, NO imgId /
    // dims field (the image KV key is derived from the payload hash).
    const payloadB64 = out.token.split(".")[0];
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    expect(payload.c).toBe("425987");
    expect(payload.d).toBe("example"); // subdomain only (host = example.atlassian.net)
    expect(typeof payload.m).toBe("number"); // Unix seconds
    expect(payload.i).toBeUndefined();
    expect(payload.w).toBeUndefined();

    // The image is stored under the DERIVED key (sha256(payloadB64)[:12]), not
    // in the payload — so the mint and worker must agree on the derivation.
    const crypto = await import("node:crypto");
    const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const derived = b64url(crypto.createHash("sha256").update(payloadB64).digest().subarray(0, 12));
    expect(imgWrites[0].key).toBe(`img:${derived}`);

    // Signature is a truncated (16-byte → 22-char) HMAC.
    expect(out.token.split(".")[1].length).toBe(22);
  });

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

  it("does not encode product-tier markers in tickets", async () => {
    const { kv } = makeKV();
    const liteData = { forgeContext: { cloudId: "cloud-1", forgeAppId: "8ad26115-211f-4216-971b-0540f606303d" } } as any;
    const diagramlyData = { forgeContext: { cloudId: "cloud-1", forgeAppId: "01ede8b1-4e88-451a-b9ef-89eeef93afaf" } } as any;
    const env = { DB: makeDB("example.atlassian.net"), DEEPLINK_KV: kv, DEEPLINK_SIGN_SECRET: SECRET };
    const decode = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

    const liteRes = await onRequest({ request: makeRequest(validBody), env, data: liteData });
    const liteOut = (await liteRes.json()) as any;
    expect(decode(liteOut.token).u).toBeUndefined();

    const diaRes = await onRequest({ request: makeRequest(validBody), env, data: diagramlyData });
    const diaOut = (await diaRes.json()) as any;
    expect(decode(diaOut.token).u).toBeUndefined();
  });
});
