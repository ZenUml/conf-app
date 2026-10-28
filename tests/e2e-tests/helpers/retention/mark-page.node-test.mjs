import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markTemporaryPage, TEST_ORIGIN_KEY } from './mark-page.mjs';
const reply = (body, status = 200) => ({ ok: () => status < 400, status: () => status, json: async () => body });
test('marks only a current page in its expected bucket', async () => {
  let posted;
  const request = { get: async () => reply({ id: '1', parentId: '2', status: 'current', createdAt: '2026-10-28T00:00:00Z', version: { number: 1 } }), post: async (_url, data) => { posted = data.data; return reply({}); } };
  await markTemporaryPage({ request, domain: 'example.atlassian.net', pageId: '1', bucketId: '2', rootId: '3' });
  assert.equal(posted.key, TEST_ORIGIN_KEY);
  assert.equal(posted.value.rootId, '3');
  assert.equal(posted.value.pageId, '1');
});
test('refuses to mark a page under another parent', async () => {
  let wrote = false;
  const request = { get: async () => reply({ id: '1', parentId: '9', status: 'current', createdAt: '2026-10-28T00:00:00Z' }), post: async () => { wrote = true; } };
  await assert.rejects(markTemporaryPage({ request, domain: 'example.atlassian.net', pageId: '1', bucketId: '2', rootId: '3' }), /not verified/);
  assert.equal(wrote, false);
});
