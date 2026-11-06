/**
 * Per-site cooldown after Confluence rate-limits the PNG attachment write.
 *
 * Every macro view runs a backfill that starts with a GET of its attachment.
 * On a site with many macros those GETs trip Confluence's rate limit: in
 * production on 2026-10-22/23, 429s (an HTML "HTTP Status 429 – Too Many
 * Requests" page on `GET /wiki/api/v2/pages/{id}/attachments`) were every
 * non-JSON `attachment_upload_failed`, and 94 of 112 came from one site. Each
 * further view while the limit holds only adds to the request count, so after
 * a 429 the backfill stands down for a while instead of retrying on the next
 * view.
 *
 * Site-scoped (cloudId), not page- or macro-scoped: the limit is Confluence's,
 * per user and site, so every macro iframe on that site should back off. The
 * iframes share an origin, so the deadline lives in localStorage; when storage
 * is blocked it falls back to this iframe's memory. It only defers a backfill
 * that the next view after the deadline performs anyway.
 */

const COOLDOWN_KEY_PREFIX = 'zenuml:attachment:rate-limited-until:';
/** Used when the 429 carries no usable Retry-After header. */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
/** Upper bound, so a bad Retry-After value cannot stop backfills for long. */
export const MAX_COOLDOWN_MS = 60 * 60 * 1000;
/** Lower bound: a `Retry-After: 0` would not reduce any traffic. */
export const MIN_COOLDOWN_MS = 30 * 1000;

export type KvStore = Pick<Storage, 'getItem' | 'setItem'>;

const memoryDeadlines = new Map<string, number>();

function safeStore(store?: KvStore): KvStore | null {
  try {
    return store ?? window.localStorage;
  } catch {
    return null; // storage blocked (third-party storage settings, non-browser test env)
  }
}

/**
 * Milliseconds until the Retry-After header allows another request: either
 * delta-seconds (`120`) or an HTTP date. Undefined when absent or unparseable.
 */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export interface CooldownStart {
  cooldownMs: number;
  source: 'header' | 'default';
  /** The header's value in seconds, before clamping. Only when `source` is 'header'. */
  retryAfterS?: number;
}

/**
 * Start (or extend) the cooldown for `siteKey` after a 429. Never throws: the
 * caller is already inside the upload's error path.
 */
export function startRateLimitCooldown(
  siteKey: string,
  retryAfterHeader?: string | null,
  now = Date.now(),
  store?: KvStore,
): CooldownStart {
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now);
  const cooldownMs = fromHeader === undefined
    ? DEFAULT_COOLDOWN_MS
    : Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, fromHeader));
  const deadline = now + cooldownMs;
  // Another iframe may already have set a later deadline; keep the later one.
  const until = Math.max(deadline, readDeadline(siteKey, store));
  memoryDeadlines.set(siteKey, until);
  const s = safeStore(store);
  if (s) {
    try {
      s.setItem(COOLDOWN_KEY_PREFIX + siteKey, String(until));
    } catch {
      // quota/blocked: the in-memory deadline still covers this iframe
    }
  }
  return fromHeader === undefined
    ? { cooldownMs, source: 'default' }
    : { cooldownMs, source: 'header', retryAfterS: Math.round(fromHeader / 1000) };
}

/** Milliseconds left in `siteKey`'s cooldown; 0 when none is running. */
export function rateLimitCooldownRemainingMs(siteKey: string, now = Date.now(), store?: KvStore): number {
  // Capped: a deadline written by a skewed clock must not hold for longer.
  return Math.min(MAX_COOLDOWN_MS, Math.max(0, readDeadline(siteKey, store) - now));
}

function readDeadline(siteKey: string, store?: KvStore): number {
  let stored = 0;
  const s = safeStore(store);
  if (s) {
    try {
      const value = Number(s.getItem(COOLDOWN_KEY_PREFIX + siteKey));
      if (Number.isFinite(value)) stored = value;
    } catch {
      // fall back to memory
    }
  }
  return Math.max(stored, memoryDeadlines.get(siteKey) ?? 0);
}

export function _resetForTesting(): void {
  memoryDeadlines.clear();
}
