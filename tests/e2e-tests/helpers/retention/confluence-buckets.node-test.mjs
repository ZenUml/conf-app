import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfluenceBuckets } from './confluence-buckets.mjs';
const response = (body, status = 200) => ({ ok: () => status < 400, status: () => status, json: async () => body });
test('creates buckets in the root space and under the correct parents', async () => {
  const pages = []; let next = 10;
  const request = {
    get: async url => url.endsWith('/pages/123') ? response({ id: '123', spaceId: '99', status: 'current' }) : response({ results: pages.filter(p => p.title === new URL(url).searchParams.get('title')) }),
    post: async (_url, { data }) => { const p = { ...data, id: String(next++) }; pages.push(p); return response(p); },
  };
  const result = await resolveConfluenceBuckets({ request, domain: 'example-stg.atlassian.net', rootId: '123', now: new Date('2026-10-01Z'), allowCreate: true });
  assert.equal(result.monthId, '11');
  assert.equal(pages[0].parentId, '123');
  assert.equal(pages[1].parentId, '10');
  assert.equal(pages[1].spaceId, '99');
});
test('fails closed on an incomplete title lookup', async () => {
  const request = { get: async url => url.endsWith('/pages/123') ? response({ id: '123', spaceId: '99', status: 'current' }) : response({ results: [], _links: { next: '/next' } }) };
  await assert.rejects(resolveConfluenceBuckets({ request, domain: 'example.atlassian.net', rootId: '123' }), /incomplete/);
});
test('rejects an invalid root before any request', async () => {
  await assert.rejects(resolveConfluenceBuckets({ request: {}, domain: 'example.atlassian.net', rootId: '../evil' }), /Invalid test root/);
});
