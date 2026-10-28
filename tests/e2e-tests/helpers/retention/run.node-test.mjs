import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRetention } from './run.mjs';
import { TEST_ORIGIN_KEY } from './mark-page.mjs';
const response = (body, status = 200) => ({ ok: () => status < 400, status: () => status, headers: () => ({}), json: async () => body });
function makeRequest() {
  let posts = 0;
  const marker = { schema: 1, kind: 'temporary-e2e', rootId: '1', bucketId: '3', pageId: '4', pageVersion: 1, createdAt: '2026-01-01T00:00:00Z', preserve: false };
  const children = { '1': [{ id: '2', status: 'current', title: 'E2E automated 1 2026' }], '2': [{ id: '3', status: 'current', title: 'E2E automated 1 2026-01' }], '3': [{ id: '4', status: 'current' }] };
  return { get posts() { return posts; }, get: async url => {
    if (url.includes('/children?')) return response({ results: children[url.match(/pages\/(\d+)\/children/)[1]] });
    if (url.includes('/properties?')) return response({ results: [{ key: TEST_ORIGIN_KEY, value: marker }] });
    if (url.includes('/labels?')) return response({ results: [] });
    return response({ id: '4', status: posts ? 'archived' : 'current', parentId: '3', createdAt: marker.createdAt, version: { number: 1 } });
  }, post: async () => { posts++; return response({}, 202); } };
}
const args = { domain: 'example.atlassian.net', rootId: '1', fixtureIds: new Set(), now: new Date('2026-10-28T00:00:00Z'), wait: async () => {} };
test('dry run reports a verified candidate without archiving', async () => {
  const request = makeRequest(); const result = await runRetention({ ...args, request });
  assert.equal(request.posts, 0); assert.equal(result.results[0].status, 'selected'); assert.equal(result.buckets[0].count, 1); assert.equal(result.bucketPageTotal, 1);
});
test('execution archives and verifies the selected page', async () => {
  const request = makeRequest(); const result = await runRetention({ ...args, request, execute: true });
  assert.equal(request.posts, 1); assert.equal(result.results[0].status, 'archived'); assert.equal(result.stopped, false);
});
test('committed fixtures are not archived', async () => {
  const request = makeRequest(); const result = await runRetention({ ...args, request, fixtureIds: new Set(['4']), execute: true });
  assert.equal(request.posts, 0); assert.equal(result.results[0].reason, 'preserved-or-unknown');
});
