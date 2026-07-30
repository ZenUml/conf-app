/**
 * Content stale-while-revalidate cache (per-browser, localStorage), keyed by a
 * complete viewer identity — NOT by source hash.
 *
 * The render cache (renderCacheStore) keys by hash(source), so it can only be read
 * AFTER the content is fetched — it never hides the dominant ~1337 ms content GET. This
 * store keys by the Forge cloud + macro customContentId, which are known BEFORE
 * any fetch, so the viewer can render from cache immediately and revalidate in
 * the background (SWR). That moves the content fetch off the critical path on a
 * revisit without treating an id from another cloud as the same document.
 *
 * Stores the serialized diagram doc + a content hash for cheap change-detection on
 * revalidate. Bounded + quota-safe like renderCacheStore: a miss / clear / overflow just
 * falls back to a normal fetch. The cached doc is the macro's OWN content (no XSS surface
 * beyond what the live fetch already returns) — but anything injected as SVG downstream is
 * still sanitized on read by the viewers.
 *
 * Confluence stays the system of record: this only changes WHEN the fetched doc is shown
 * (cached-first), never WHETHER it's fetched (always revalidated). A stale render is
 * corrected the moment the background fetch returns a different hash.
 */

const NS = 'zenuml:ccache:v2:';
const INDEX_KEY = NS + '__index__'; // LRU, oldest first
const MAX_ENTRIES = 32;
const MAX_DOC_BYTES = 256 * 1024; // graph mxfile can be large; over this, don't cache

/** cyrb53 — fast dependency-free hash, used to detect whether the doc changed. */
export function hashContent(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export interface CachedContent {
  /** Serialized diagram doc (JSON). Parsed by the caller. */
  doc: string;
  /** hashContent(doc) — for cheap change-detection against a background revalidate. */
  hash: string;
}

export type ViewerContentMacroKind =
  | 'sequence'
  | 'mermaid'
  | 'plantuml'
  | 'graph'
  | 'openapi'
  | 'embed';

export interface ViewerContentIdentity {
  cloudId: string;
  customContentId: string;
  macroKind: ViewerContentMacroKind;
}

const VIEWER_MACRO_KINDS = new Set<ViewerContentMacroKind>([
  'sequence',
  'mermaid',
  'plantuml',
  'graph',
  'openapi',
  'embed',
]);

function isCompleteIdentity(identity: ViewerContentIdentity | undefined): identity is ViewerContentIdentity {
  return !!identity
    && typeof identity.cloudId === 'string'
    && identity.cloudId.length > 0
    && typeof identity.customContentId === 'string'
    && identity.customContentId.length > 0
    && VIEWER_MACRO_KINDS.has(identity.macroKind);
}

function keyFor(identity: ViewerContentIdentity): string {
  return `${NS}${encodeURIComponent(identity.cloudId.toLowerCase())}:${encodeURIComponent(identity.macroKind)}:${encodeURIComponent(identity.customContentId)}`;
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

/**
 * Read the cached content for a macro. Returns undefined on miss / any storage error.
 * Touches LRU recency on a hit.
 */
export function getCachedContent(identity: ViewerContentIdentity | undefined): CachedContent | undefined {
  try {
    if (!isCompleteIdentity(identity)) return undefined;
    const key = keyFor(identity);
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.doc !== 'string' || typeof parsed.hash !== 'string') return undefined;
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    writeIndex(index);
    return { doc: parsed.doc, hash: parsed.hash };
  } catch {
    return undefined;
  }
}

/**
 * Store a macro's content (best-effort, bounded). `doc` is the serialized diagram.
 * Returns true if stored. Never throws; purges its namespace on quota error.
 */
export function putCachedContent(identity: ViewerContentIdentity | undefined, doc: string): boolean {
  if (!isCompleteIdentity(identity) || typeof doc !== 'string' || doc.length === 0 || doc.length > MAX_DOC_BYTES) {
    return false;
  }
  try {
    const key = keyFor(identity);
    const entry: CachedContent = { doc, hash: hashContent(doc) };
    localStorage.setItem(key, JSON.stringify(entry));
    const index = readIndex().filter((k) => k !== key);
    index.push(key);
    while (index.length > MAX_ENTRIES) {
      const evicted = index.shift();
      if (evicted) localStorage.removeItem(evicted);
    }
    writeIndex(index);
    return true;
  } catch {
    try {
      for (const k of readIndex()) localStorage.removeItem(k);
      localStorage.removeItem(INDEX_KEY);
    } catch {
      /* nothing we can do */
    }
    return false;
  }
}

/** Remove one corrupt/stale entry without disturbing the rest of the LRU. */
export function removeCachedContent(identity: ViewerContentIdentity | undefined): void {
  try {
    if (!isCompleteIdentity(identity)) return;
    const key = keyFor(identity);
    localStorage.removeItem(key);
    writeIndex(readIndex().filter((indexedKey) => indexedKey !== key));
  } catch {
    // Cache eviction is best effort; source-of-truth loading still proceeds.
  }
}

/** Test helper: clear the whole content cache. */
export function _resetForTesting(): void {
  try {
    for (const k of readIndex()) localStorage.removeItem(k);
    localStorage.removeItem(INDEX_KEY);
  } catch {
    /* ignore */
  }
}
