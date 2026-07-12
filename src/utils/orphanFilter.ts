/**
 * Drop custom-content records whose parent page is NOT in `livePageIds` — i.e.
 * orphans whose parent page was deleted. Confluence custom content is parented
 * to a page; when that page is permanently deleted the content is orphaned. It
 * lingers in the eventually-consistent SEARCH index (so the embed picker still
 * lists and previews it), but the viewer loads via GET-by-id, which 404s — so
 * offering an orphan in the picker yields a silently-broken embed.
 *
 * Records with no pageId (space/blog-post container) are KEPT: page-deletion
 * orphaning doesn't apply to them, and they'd need a different liveness check.
 */
export function keepLiveParentPageContent<T extends { pageId?: string | null }>(
  items: T[],
  livePageIds: Set<string>,
): T[] {
  return items.filter((item) => !item.pageId || livePageIds.has(String(item.pageId)));
}
