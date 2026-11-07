import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRetentionPage } from './read-page.mjs';
import { TEST_ORIGIN_KEY } from './mark-page.mjs';
const response = body => ({ ok: () => true, json: async () => body });
function context({ labels = [], markers = [], next = null } = {}) {
  return { get: async url => response(url.includes('/properties?') ? { results: markers, _links: { next } } : url.includes('/labels?') ? { results: labels, _links: { next } } : { id: '123', status: 'current' }) };
}
const input = { domain: 'example.atlassian.net', pageId: '123', fixtureIds: new Set() };
test('reads marker and honors preserve label and fixture inventory', async () => {
  const marker = { key: TEST_ORIGIN_KEY, value: { schema: 1 } };
  const labeled = await readRetentionPage({ ...input, request: context({ labels: [{ name: 'e2e-preserve' }], markers: [marker] }) });
  assert.equal(labeled.preserve, true); assert.deepEqual(labeled.testOrigin, marker.value);
  const fixture = await readRetentionPage({ ...input, fixtureIds: new Set(['123']), request: context() });
  assert.equal(fixture.preserve, true);
  const plain = await readRetentionPage({ ...input, request: context() });
  assert.equal(plain.preserve, false);
});
test('rejects incomplete protection data', async () => {
  await assert.rejects(readRetentionPage({ ...input, request: context({ next: '/next' }) }), /incomplete/);
  await assert.rejects(readRetentionPage({ ...input, request: context({ labels: [{}] }) }), /malformed/);
});
