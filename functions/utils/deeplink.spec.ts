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
