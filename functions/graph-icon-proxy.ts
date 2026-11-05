import { OkResponse, response } from './OkResponse';
import type { ForgeRequestData } from './utils/authenticate';

/**
 * Icons from icons.diagrams.net, returned as data URLs.
 *
 * WHY. The Forge iframe CSP refuses icons.diagrams.net, and adding the host to
 * the manifest is a major app version (admin re-consent). The iframe CSP does
 * allow `data:` images, and `invokeRemote` is not subject to connect-src, so the
 * viewer asks this function for the bytes.
 *
 * AUTH. A valid Forge invocation token (checked by _middleware.ts) is all this
 * needs. It must NOT require the user token (`requireForgeUserToken`): guest and
 * anonymous viewers send none, and they view Graph macros too. Nothing here
 * reads the viewer's identity or touches Confluence.
 *
 * LIMITS. The numbers below are conservative choices of ours, not documented
 * platform limits.
 */
const ICON_HOST = 'icons.diagrams.net';
const ALLOWED_TYPES = new Set(['image/svg+xml', 'image/png']);
const MAX_URLS = 50;
const MAX_URL_LENGTH = 2048;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 128 * 1024;
const UPSTREAM_TIMEOUT_MS = 5000;

type Fetched = { ok: true; dataUrl: string; bytes: number } | { ok: false; code: string };

function validIconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== ICON_HOST) return null;
  if (url.username || url.password || url.port) return null;
  return url.href;
}

/** Reads at most `limit` bytes; null when the body is longer. */
async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.byteLength > limit ? null : all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function fetchIcon(href: string): Promise<Fetched> {
  let res: Response;
  try {
    // 'error': a redirect must not take this fetch to another host.
    res = await fetch(href, { redirect: 'error', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { Accept: 'image/svg+xml,image/png' } });
  } catch {
    return { ok: false, code: 'fetch_failed' };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, code: `http_${res.status}` };
  if (!res.ok) return { ok: false, code: `http_${res.status}` };
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) { await res.body?.cancel(); return { ok: false, code: 'bad_content_type' }; }
  try {
    const bytes = await readLimited(res, MAX_ICON_BYTES);
    if (!bytes) return { ok: false, code: 'too_large' };
    return { ok: true, dataUrl: `data:${type};base64,${toBase64(bytes)}`, bytes: bytes.byteLength };
  } catch {
    return { ok: false, code: 'fetch_failed' };
  }
}

export async function onRequest({ request, data }: { request: Request; data: ForgeRequestData }): Promise<Response> {
  if (request.method !== 'POST') return response(405, 'Method not allowed');
  const c = data?.forgeContext;
  if (!c?.cloudId || !c.forgeAppId) return response(401, 'Missing authenticated context');

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return response(413, 'Request too large');
  let urls: unknown;
  try { urls = JSON.parse(text)?.urls; } catch { return response(400, 'Invalid request'); }
  if (!Array.isArray(urls) || urls.length === 0) return response(400, 'Invalid request');
  if (urls.length > MAX_URLS) return response(413, 'Too many icons');

  // Validate everything before fetching anything: one bad URL rejects the batch.
  const hrefs = new Map<string, string>();
  for (const url of urls) {
    const href = validIconUrl(url);
    if (!href) return response(400, 'Invalid icon URL');
    hrefs.set(url as string, href);
  }

  const byHref = new Map<string, Fetched>();
  await Promise.all([...new Set(hrefs.values())].map(async (href) => { byHref.set(href, await fetchIcon(href)); }));
  const icons: Record<string, string> = {};
  const failed: Record<string, string> = {};
  let total = 0;
  for (const [key, href] of hrefs) {
    const result = byHref.get(href)!;
    if (!result.ok) { failed[key] = result.code; continue; }
    total += result.bytes;
    icons[key] = result.dataUrl;
  }
  if (total > MAX_BATCH_BYTES) return response(413, 'Icons too large');
  return OkResponse({ icons, failed });
}
