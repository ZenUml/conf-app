import { resolveBuckets } from './buckets.mjs';

/** Resolve staging buckets using the authenticated Playwright request context. */
export async function resolveConfluenceBuckets({ request, domain, rootId, now, wait, allowCreate = false }) {
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(domain)) throw new Error('Invalid Confluence domain');
  if (!/^\d+$/.test(String(rootId))) throw new Error('Invalid test root ID');
  const base = `https://${domain}/wiki/api/v2`;
  async function checked(response, operation) {
    if (!response.ok()) throw Object.assign(new Error(`${operation}: HTTP ${response.status()}`), { status: response.status() });
    return response.json();
  }
  const root = await checked(await request.get(`${base}/pages/${rootId}`), 'Read test root');
  if (String(root.id) !== String(rootId) || root.status !== 'current' || !/^\d+$/.test(String(root.spaceId))) {
    throw new Error('Test root is not a current page in a known space');
  }
  const findByTitle = async title => {
    const query = new URLSearchParams({ 'space-id': String(root.spaceId), title, status: 'current', limit: '10' });
    const result = await checked(await request.get(`${base}/pages?${query}`), 'Find bucket');
    if (!Array.isArray(result.results) || result._links?.next) throw new Error('Bucket lookup is incomplete');
    const matches = result.results.filter(p => p.title === title && String(p.spaceId) === String(root.spaceId));
    if (matches.length > 1) throw new Error('Multiple pages match the bucket title');
    return matches[0] ?? null;
  };
  const createPage = async ({ title, parentId }) => checked(await request.post(`${base}/pages`, {
    data: { spaceId: String(root.spaceId), status: 'current', title, parentId, body: { representation: 'storage', value: '<p>Automated E2E bucket.</p>' } },
  }), 'Create bucket');
  return resolveBuckets({ rootId, now, findByTitle, createPage, allowCreate, ...(wait ? { wait } : {}) });
}
