/** Enumerate the known bucket hierarchy without following links off-site. */
export async function enumerateBuckets({ request, domain, rootId, maxPages = 100000 }) {
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(domain) || !/^\d+$/.test(String(rootId)) || !Number.isInteger(maxPages) || maxPages < 1) throw new Error('Invalid enumeration arguments');
  const origin = `https://${domain}`;
  const base = `${origin}/wiki/api/v2`;
  const seenLinks = new Set();
  let totalPages = 0;
  async function children(id) {
    let url = `${base}/pages/${id}/children?limit=250`;
    const result = [];
    while (url) {
      if (seenLinks.has(url)) throw new Error('Repeated pagination link');
      seenLinks.add(url);
      const response = await request.get(url);
      if (!response.ok()) throw new Error(`Enumerate children: HTTP ${response.status()}`);
      const data = await response.json();
      if (!Array.isArray(data.results)) throw new Error('Invalid children response');
      for (const child of data.results) {
        if (!/^\d+$/.test(String(child.id))) throw new Error('Invalid child ID');
        result.push(child);
        if (++totalPages > maxPages) throw new Error('Enumeration limit exceeded');
      }
      const next = data._links?.next;
      if (!next) break;
      const normalized = next.startsWith('/api/v2/') ? `/wiki${next}` : next;
      const resolved = new URL(normalized, origin);
      if (resolved.origin !== origin || resolved.pathname !== `/wiki/api/v2/pages/${id}/children`) throw new Error('Invalid pagination link');
      url = resolved.href;
    }
    return result;
  }
  const yearPrefix = `E2E automated ${rootId} `;
  const years = (await children(rootId)).filter(p => p.status === 'current' && new RegExp(`^${yearPrefix}\\d{4}$`).test(p.title));
  const buckets = [];
  for (const year of years) {
    const yearPart = year.title.slice(-4);
    const months = (await children(year.id)).filter(p => p.status === 'current' && new RegExp(`^${yearPrefix}${yearPart}-(0[1-9]|1[0-2])$`).test(p.title));
    for (const month of months) {
      const pages = await children(month.id);
      buckets.push({ yearId: String(year.id), monthId: String(month.id), month: month.title.slice(-7), pages });
    }
  }
  return { buckets, totalPages };
}
