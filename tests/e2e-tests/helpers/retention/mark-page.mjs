export const TEST_ORIGIN_KEY = 'zenuml-e2e-origin-v1';

/** Mark only a freshly published page whose verified parent is our bucket. */
export async function markTemporaryPage({ request, domain, pageId, rootId, bucketId }) {
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(domain) || ![pageId, rootId, bucketId].every(id => /^\d+$/.test(String(id)))) {
    throw new Error('Invalid page identity');
  }
  const base = `https://${domain}/wiki/api/v2/pages/${pageId}`;
  const response = await request.get(base);
  if (!response.ok()) throw new Error(`Cannot verify test page: HTTP ${response.status()}`);
  const page = await response.json();
  if (String(page.id) !== String(pageId) || page.status !== 'current' || String(page.parentId) !== String(bucketId) || !Number.isFinite(Date.parse(page.createdAt)) || !Number.isInteger(page.version?.number) || page.version.number < 1) {
    throw new Error('Published page identity, parent, status or creation date is not verified');
  }
  const value = { schema: 1, kind: 'temporary-e2e', rootId: String(rootId), pageId: String(pageId), bucketId: String(bucketId), createdAt: page.createdAt, pageVersion: page.version.number, preserve: false };
  const written = await request.post(`${base}/properties`, { data: { key: TEST_ORIGIN_KEY, value } });
  if (!written.ok()) throw new Error(`Cannot mark test page: HTTP ${written.status()}`);
  return value;
}
