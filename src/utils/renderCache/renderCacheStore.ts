/**
 * Back-catalog view-time render cache (per-browser, localStorage).
 *
 * Lever D's save-time SVG cache only covers macros SAVED after it shipped. For the
 * back-catalog — existing diagrams never re-saved — this caches the rendered SVG in
 * localStorage keyed by a hash of the diagram SOURCE, so REVISITING a page skips the
 * renderer entirely (for graph that is ~6s of DrawIO → an instant inject). Per-browser
 * and best-effort: a cache miss / clear just live-renders. A cross-user shared cache
 * (content property) is the planned next step; this needs no backend or permissions.
 *
 * Bounded so it can never blow the ~5MB localStorage quota: oversized SVGs are not
 * cached, and the newest MAX_ENTRIES are kept (LRU; oldest evicted first). All access
 * is wrapped — localStorage can throw (quota, privacy mode, disabled) and rendering
 * must never depend on it.
 */

const NS = 'zenuml:rcache:';
const INDEX_KEY = NS + '__index__'; // JSON array of cache keys, oldest first (LRU)
const MAX_ENTRIES = 24;
const MAX_SVG_BYTES = 200 * 1024;

/** cyrb53 — fast, dependency-free, well-distributed 53-bit string hash. */
function hashSource(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function keyFor(source: string): string {
  return NS + hashSource(source);
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(index: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Whether a string is a usable SVG (cheap shape check; sanitize-on-read still applies). */
export function isCacheableSvg(svg: string | undefined | null): svg is string {
  return typeof svg === 'string' && svg.length > 0 && svg.length <= MAX_SVG_BYTES && /<svg[\s>]/i.test(svg);
}

/** The reason a put was skipped (for analytics), or null when it was stored. */
export type RenderCacheSkip = 'oversized' | 'unsupported' | 'no_write';

/**
 * Read a cached SVG for `source`. Returns undefined on miss / any storage error.
 * Touches the entry's LRU recency on a hit.
 */
export function getCachedSvg(source: string): string | undefined {
  try {
    if (!source) return undefined;
    const key = keyFor(source);
    const svg = localStorage.getItem(key);
    if (svg == null) return undefined;
    // Promote to most-recent so it survives eviction.
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    writeIndex(index);
    return svg;
  } catch {
    return undefined;
  }
}

/**
 * Store `svg` for `source` (best-effort, bounded). Returns null on success or the skip
 * reason. Never throws. On a quota error it drops the whole cache and gives up — a
 * render cache must never wedge the page.
 */
export function putCachedSvg(source: string, svg: string | undefined | null): RenderCacheSkip | null {
  if (!source) return 'unsupported';
  if (typeof svg !== 'string' || svg.length === 0 || !/<svg[\s>]/i.test(svg)) return 'unsupported';
  if (svg.length > MAX_SVG_BYTES) return 'oversized';
  try {
    const key = keyFor(source);
    localStorage.setItem(key, svg);
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    while (index.length > MAX_ENTRIES) {
      const evicted = index.shift();
      if (evicted) localStorage.removeItem(evicted);
    }
    writeIndex(index);
    return null;
  } catch {
    // Quota / disabled storage: purge our namespace and bail so we don't keep failing.
    try {
      for (const k of readIndex()) localStorage.removeItem(k);
      localStorage.removeItem(INDEX_KEY);
    } catch {
      /* nothing we can do */
    }
    return 'no_write';
  }
}

/** Test helper: clear the whole render cache. */
export function _resetForTesting(): void {
  try {
    for (const k of readIndex()) localStorage.removeItem(k);
    localStorage.removeItem(INDEX_KEY);
  } catch {
    /* ignore */
  }
}
