import { enumerateBuckets } from './enumerate.mjs';
import { readRetentionPage } from './read-page.mjs';
import { archiveCandidates } from './archive.mjs';

/** A bounded pass over one test root. Archive actions are opt-in. */
export async function runRetention({ request, domain, rootId, fixtureIds, retentionDays = 60, now = new Date(), execute = false, maxActions = 20, wait, onResult = () => {} }) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || !Number.isInteger(maxActions) || maxActions < 1 || maxActions > 100 || !Number.isFinite(now.getTime())) throw new Error('Invalid retention policy');
  const cutoff = new Date(now.getTime() - retentionDays * 86400000);
  const scan = await enumerateBuckets({ request, domain, rootId });
  const buckets = scan.buckets.map(b => ({ id: b.monthId, month: b.month, count: b.pages.length }));
  const bucketPageTotal = buckets.reduce((sum, b) => sum + b.count, 0);
  const base = `https://${domain}/wiki`;
  const readPage = id => readRetentionPage({ request, domain, pageId: id, fixtureIds });
  const results = [];
  let attempted = 0;
  for (const bucket of scan.buckets) {
    for (const summary of bucket.pages) {
      let page;
      try {
        page = await readPage(summary.id);
      } catch (error) {
        const item = { id: String(summary.id), status: 'failed', reason: String(error.message) };
        results.push(item); onResult(item);
        return { cutoff: cutoff.toISOString(), buckets, bucketPageTotal, results, stopped: true };
      }
      // Reject a moved page even if its own marker has been altered to match.
      if (String(page.parentId) !== bucket.monthId || String(page.testOrigin?.bucketId) !== bucket.monthId) {
        const item = { id: String(summary.id), status: 'skipped', reason: 'not-in-enumerated-bucket' };
        results.push(item); onResult(item); continue;
      }
      if (attempted >= maxActions) {
        const item = { id: String(summary.id), status: 'skipped', reason: 'action-limit' };
        results.push(item); onResult(item); continue;
      }
      const archivePage = async id => {
        const response = await request.post(`${base}/rest/api/content/archive`, { data: { pages: [{ id: String(id) }] } });
        if (!response.ok()) {
          const retryAfter = Number(response.headers?.()['retry-after']);
          throw Object.assign(new Error(`Archive request: HTTP ${response.status()}`), { status: response.status(), retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined });
        }
        if (response.status() !== 202) throw new Error(`Unexpected archive response: HTTP ${response.status()}`);
      };
      const result = await archiveCandidates({ pages: [page], policy: { rootId, cutoff }, dryRun: !execute, readPage, archivePage, ...(wait ? { wait } : {}), onResult: item => { results.push(item); onResult(item); } });
      if (result.results.some(item => item.status === 'archived' || item.status === 'selected')) attempted++;
      if (result.stopped) return { cutoff: cutoff.toISOString(), buckets, bucketPageTotal, results, stopped: true };
    }
  }
  return { cutoff: cutoff.toISOString(), buckets, bucketPageTotal, results, stopped: false };
}
