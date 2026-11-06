// Per-address rate limit for the public, sign-in-free POST /mcp/render.
//
// WHY D1. The obvious tools do not fit a Pages Function:
//   - Cloudflare's Rate Limiting binding is documented for Workers only; the
//     Pages bindings list omits it.
//   - KV reads are cached at each edge, so a per-minute counter read back
//     within the minute undercounts. (bumpRegisterCount in oauth/asStore.ts
//     accepts that for an hourly registration cap; a per-minute cap cannot.)
//   - The AgentLinkSession Durable Object worker is not bound in production.
// D1 has one primary, so `INSERT … ON CONFLICT … RETURNING` is an atomic
// increment that every edge agrees on, at the cost of one round trip (≈100 ms
// near the primary, ≈480 ms from far edges).
//
// FAILS OPEN. A missing binding, a missing table (the migration not yet
// applied) or a D1 error lets the call through and says so ('unavailable'),
// because a render touches nothing of the user's and refusing it for our own
// fault helps nobody.
//
// PRIVACY. The bucket is an HMAC of the address under OAUTH_GRANT_SECRET when
// that is bound (a plain hash of an IPv4 address is reversible by trying all
// four billion), and rows older than the window are deleted as calls arrive.
// IPv6 is folded to its /64, the block one subscriber is usually given, so a
// caller cannot dodge the limit by rotating within it.

/** Render calls one address may make per window. Generous for an agent at work, useless for a loop. */
export const RENDER_LIMIT = 30;
export const RENDER_WINDOW_SECONDS = 60;
/** How often a call also sweeps expired rows: cleanup is housekeeping, not per-request work. */
const SWEEP_PROBABILITY = 0.02;

export interface RateDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export interface RateEnv {
  DB?: RateDb;
  OAUTH_GRANT_SECRET?: string;
}

export type RateDecision =
  | { allowed: true; count: number }
  | { allowed: true; unavailable: true }
  | { allowed: false; count: number; retryAfterSeconds: number };

const ENC = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The part of an address that identifies one caller: IPv4 as is, IPv6 as its
 * first four groups (the /64). Exported for tests.
 */
export function addressKey(ip: string): string {
  const addr = ip.trim().toLowerCase();
  if (!addr.includes(':')) return addr;
  const [head, tail = ''] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = addr.includes('::') && tail ? tail.split(':') : [];
  const groups = addr.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

async function bucketFor(ip: string, secret: string | undefined): Promise<string> {
  const data = ENC.encode(`mcp-render:${addressKey(ip)}`);
  if (secret) {
    const key = await crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, data)).slice(0, 32);
  }
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 32);
}

/**
 * Count this call against its address and decide.
 *
 * `ip` is CF-Connecting-IP. Without one (local dev) there is nobody to count,
 * so the call is let through as 'unavailable'.
 */
export async function checkRenderRate(
  env: RateEnv,
  ip: string | null,
  nowMs: number,
  random: () => number = Math.random,
): Promise<RateDecision> {
  if (!env.DB || !ip) return { allowed: true, unavailable: true };
  const windowMs = RENDER_WINDOW_SECONDS * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  try {
    const bucket = await bucketFor(ip, env.OAUTH_GRANT_SECRET);
    const row = await env.DB.prepare(
      `INSERT INTO McpRenderRate (bucket, windowStart, count) VALUES (?, ?, 1)
       ON CONFLICT(bucket, windowStart) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
      .bind(bucket, windowStart)
      .first<{ count: number }>();
    if (random() < SWEEP_PROBABILITY) {
      // Best effort: a failed sweep is retried by a later call.
      await env.DB.prepare('DELETE FROM McpRenderRate WHERE windowStart < ?').bind(windowStart).run().catch(() => undefined);
    }
    const count = typeof row?.count === 'number' ? row.count : NaN;
    if (!Number.isFinite(count)) return { allowed: true, unavailable: true };
    if (count > RENDER_LIMIT) {
      return { allowed: false, count, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000)) };
    }
    return { allowed: true, count };
  } catch {
    return { allowed: true, unavailable: true };
  }
}
