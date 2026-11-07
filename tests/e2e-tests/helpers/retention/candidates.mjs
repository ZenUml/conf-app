/** Select only pages with an explicit automation marker. A title or parent
 * alone is never sufficient proof that a page is disposable. */
export function classifyPage(page, { rootId, cutoff }) {
  if (!page?.id || page.status !== 'current') return 'not-current';
  const marker = page.testOrigin;
  if (!marker || marker.schema !== 1 || marker.kind !== 'temporary-e2e' ||
      String(marker.rootId) !== String(rootId) || String(marker.pageId) !== String(page.id)) return 'unverified-origin';
  if (marker.preserve !== false || page.preserve !== false) return 'preserved-or-unknown';
  if (!/^\d+$/.test(String(marker.bucketId)) || String(page.parentId) !== String(marker.bucketId) ||
      !Number.isInteger(marker.pageVersion) || marker.pageVersion < 1 || page.version?.number !== marker.pageVersion ||
      page.createdAt !== marker.createdAt) return 'changed-or-unverified';
  const created = Date.parse(marker.createdAt);
  const threshold = cutoff instanceof Date ? cutoff.getTime() : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(threshold)) return 'invalid-date';
  if (created >= threshold) return 'recent';
  return 'eligible';
}
