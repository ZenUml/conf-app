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
