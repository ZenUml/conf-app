// Per-browser rate limit for the INLINE Magic writeback request.
//
// Inline Mermaid views are ~10k a day, so the inline viewer asks the backend
// for a staged refined layout at most once per diagram+source per browser per
// 24h. The key lives in the macro iframe's localStorage origin. Storage can be
// unavailable or throw (private mode, blocked site data); the caller then falls
// back to its per-iframe dedup only.

const KEY_PREFIX = 'zenuml.magicWriteback.v1:';
export const INLINE_MAGIC_WRITEBACK_TTL_MS = 24 * 60 * 60 * 1000;

// FNV-1a 32-bit: cheap, synchronous, and only used to tell sources apart in a
// storage key. Not a security boundary.
function sourceKey(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}${source.length.toString(36)}`;
}

export function inlineMagicWritebackKey(contentId: string, source: string): string {
  return `${KEY_PREFIX}${contentId}:${sourceKey(source)}`;
}

// Returns false when this browser already sent the inline request for this
// diagram+source within the TTL; otherwise records "sent now" and returns true.
export function claimInlineMagicWriteback(contentId: string, source: string, now = Date.now()): boolean {
  const key = inlineMagicWritebackKey(contentId, source);
  try {
    const sentAt = Number(localStorage.getItem(key));
    if (Number.isFinite(sentAt) && sentAt > 0 && now - sentAt >= 0 && now - sentAt < INLINE_MAGIC_WRITEBACK_TTL_MS) return false;
  } catch { /* Storage unavailable: per-iframe dedup only. */ }
  try {
    localStorage.setItem(key, String(now));
  } catch { /* Storage unavailable or full: per-iframe dedup only. */ }
  return true;
}
