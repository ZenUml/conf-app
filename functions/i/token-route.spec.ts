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
