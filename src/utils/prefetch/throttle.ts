/**
 * Throttle + best-effort lock for the idle renderer prefetch.
 *
 * The browser HTTP cache is shared across all our iframes on a Confluence
 * site (same CDN origin, same top-level-site cache partition), and every
 * Forge deploy moves the bundle to a new `<bundle-hash>` path — so the right
 * cadence is exactly once per deploy per browser profile. We key on
 * VITE_APP_COMMIT (baked into every build) rather than parsing the CDN URL:
 * a new deploy is a new commit, and each variant (lite/full/diagramly) has
 * its own origin + localStorage anyway.
 *
 * localStorage on the CDN origin is shared between the page-banner iframe and
 * macro iframes. Keys are namespaced `zenuml:prefetch:*` and never touch the
 * paywall/CSAT keys (same single-writer discipline as utils/paywall).
 *
 * The lock is best-effort only — localStorage has no atomic compare-and-set,
 * so two iframes racing can both proceed. That is harmless: the browser
 * dedupes identical in-flight requests and the done-key bounds repetition.
 */

const DONE_KEY_PREFIX = 'zenuml:prefetch:done:';
const LOCK_KEY = 'zenuml:prefetch:lock';
const LOCK_STALE_MS = 60_000;

export type KvStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStore(store?: KvStore): KvStore | null {
  try {
    return store ?? window.localStorage;
  } catch {
    return null; // storage blocked (e.g. third-party cookie settings)
  }
}

export function getBuildKey(): string {
  return import.meta.env.VITE_APP_COMMIT || 'unknown';
}

export function isPrefetchDone(buildKey: string, store?: KvStore): boolean {
  const s = safeStore(store);
  if (!s) return true; // can't track → don't prefetch
  try {
    return s.getItem(DONE_KEY_PREFIX + buildKey) !== null;
  } catch {
    return true;
  }
}

export function markPrefetchDone(buildKey: string, store?: KvStore): void {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.setItem(DONE_KEY_PREFIX + buildKey, new Date().toISOString());
  } catch {
    // quota/blocked — next load may retry; bounded by the lock + guards
  }
}

export function tryClaimLock(now: number, store?: KvStore): boolean {
  const s = safeStore(store);
  if (!s) return false;
  try {
    const existing = s.getItem(LOCK_KEY);
    if (existing !== null) {
      const ts = Number(existing);
      if (Number.isFinite(ts) && now - ts < LOCK_STALE_MS) return false;
    }
    s.setItem(LOCK_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(store?: KvStore): void {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.removeItem(LOCK_KEY);
  } catch {
    // stale lock self-expires after LOCK_STALE_MS
  }
}
