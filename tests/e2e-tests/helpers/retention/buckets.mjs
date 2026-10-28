/** Resolve the UTC year/month hierarchy for temporary E2E pages.
 * The caller supplies a title lookup across the space and a create operation.
 * Confluence titles are unique within a space; scope names to the root ID.
 */
export async function resolveBuckets({ rootId, now = new Date(), findByTitle, createPage, allowCreate = false, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!/^\d+$/.test(String(rootId))) throw new Error('A numeric test root ID is required');
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid bucket date');
  const year = String(now.getUTCFullYear());
  const month = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prefix = `E2E automated ${rootId}`;

  async function resolve(title, parentId) {
    let page = await findByTitle(title);
    if (!page) {
      if (!allowCreate) throw new Error(`Bucket ${title} is missing; run the serialized provisioning job`);
      try {
        page = await createPage({ title, parentId: String(parentId) });
      } catch (error) {
        // A concurrent creator may have won the unique-title race. Never hide
        // a different error or accept a page whose parent does not match.
        if (error?.status !== 400 && error?.status !== 409) throw error;
        for (let attempt = 0; attempt < 4 && !page; attempt++) {
          if (attempt) await wait(250 * attempt);
          page = await findByTitle(title);
        }
        if (!page) throw error;
      }
    }
    if (!page?.id || String(page.parentId) !== String(parentId) || page.title !== title) {
      throw new Error(`Bucket ${title} has an unexpected identity or parent`);
    }
    return String(page.id);
  }

  const yearId = await resolve(`${prefix} ${year}`, String(rootId));
  const monthId = await resolve(`${prefix} ${month}`, yearId);
  return { year, month, yearId, monthId };
}
