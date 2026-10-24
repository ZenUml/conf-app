/**
 * Viewer-backfill snapshot-write denial memo (#387).
 *
 * `viewer_backfill` (SnapshotAttachment.ts's maybeBackfillSnapshot) writes the
 * diagram-source snapshot from the read/viewer surface via the
 * app-authenticated `/forge-upload-attachment` backend. On some pages that
 * app-authenticated write is itself denied (403/401) — verified in production,
 * see issue #387's second comment: this is a content-level permission denial
 * on the APP's write, not the viewing user's read permission, so there is no
 * client-side signal (`canUserEdit()` is a stub, always `true`) to predict it
 * up front. Without a memo, every view of a permanently-denied page re-attempts
 * the write and re-403s forever — that repeat-attempt flood, not a one-time
 * cost, is what made `viewer_backfill` 76%+ of `snapshot_create_failed`
 * (rising toward 85%/day as the writable backlog drains and denied pages
 * dominate the remaining traffic).
 *
 * This is a NEGATIVE MEMO, not a permission predictor: it never blocks the
 * FIRST attempt on a page (that's how writable pages get covered at all), it
 * only stops REPEAT attempts on a page already known-denied, and it expires
 * (7d) so a permission change (the restriction is lifted) self-heals instead
 * of being stuck skipped forever.
 *
 * Deliberately page-scoped, not macro-scoped: the denial is a property of the
 * app's write access to the PAGE (content-level restriction), not of any one
 * macro on it — see doUpload in functions/forge-upload-attachment.ts, which
 * writes to `/rest/api/content/{pageId}/child/attachment` keyed only on
 * pageId.
 *
 * Only the `no_write_permission` (401/403) skip reason is memoed. A 404
 * (`page_not_published`) must NEVER be memoed — that condition is the
 * new-page recovery case and is EXPECTED to flip to success on the very next
 * view once the page is published; memoing it would defeat the feature.
 */

const DENIED_KEY_PREFIX = 'zenuml:snapshot:denied:';
const DENIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — long enough to stop the flood, short enough to self-heal

export type KvStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStore(store?: KvStore): KvStore | null {
  try {
    return store ?? window.localStorage;
  } catch {
    return null; // storage blocked (e.g. third-party cookie settings, non-browser test env)
  }
}

/**
 * True when this pageId's app-authenticated snapshot write is known-denied
 * within the last `DENIAL_TTL_MS`. Fails open (`false`) on any storage error
 * or when no memo exists — matching the module's negative-memo-only contract:
 * we never predict a denial, we only remember a confirmed one.
 */
export function isSnapshotWriteDenied(pageId: string, store?: KvStore): boolean {
  const s = safeStore(store);
  if (!s) return false;
  try {
    const raw = s.getItem(DENIED_KEY_PREFIX + pageId);
    if (raw === null) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DENIAL_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Record that this pageId's app-authenticated snapshot write was just denied
 * (401/403). Best-effort: a storage failure here must never surface — the
 * caller is already inside the never-throws backfill error path.
 */
export function markSnapshotWriteDenied(pageId: string, store?: KvStore): void {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.setItem(DENIED_KEY_PREFIX + pageId, String(Date.now()));
  } catch {
    // quota/blocked — worst case the next view re-attempts and re-memos
  }
}
