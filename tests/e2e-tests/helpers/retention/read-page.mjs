import { TEST_ORIGIN_KEY } from './mark-page.mjs';

/** Read the page and its explicit protection state. Any incomplete response
 * fails closed rather than treating an unavailable protection as absent. */
export async function readRetentionPage({ request, domain, pageId, fixtureIds }) {
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(domain) || !/^\d+$/.test(String(pageId)) || !(fixtureIds instanceof Set)) throw new Error('Invalid retention read arguments');
  const base = `https://${domain}/wiki/api/v2/pages/${pageId}`;
  async function read(url, operation) {
    const response = await request.get(url);
    if (!response.ok()) throw new Error(`${operation}: HTTP ${response.status()}`);
    return response.json();
  }
  const page = await read(base, 'Read page');
  if (String(page.id) !== String(pageId)) throw new Error('Page identity mismatch');
  const props = await read(`${base}/properties?key=${encodeURIComponent(TEST_ORIGIN_KEY)}&limit=10`, 'Read origin property');
  const labels = await read(`${base}/labels?limit=250`, 'Read page labels');
  if (!Array.isArray(props.results) || props._links?.next || !Array.isArray(labels.results) || labels._links?.next) {
    throw new Error('Page protection information is incomplete');
  }
  const markers = props.results.filter(p => p.key === TEST_ORIGIN_KEY);
  if (markers.length > 1) throw new Error('Page has multiple origin markers');
  if (labels.results.some(label => typeof label.name !== 'string')) throw new Error('Page labels are malformed');
  const preserve = fixtureIds.has(String(pageId)) || labels.results.some(label => label.name === 'e2e-preserve');
  return { ...page, testOrigin: markers[0]?.value, preserve };
}
