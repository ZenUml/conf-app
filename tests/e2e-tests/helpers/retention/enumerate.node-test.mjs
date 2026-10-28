import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateBuckets } from './enumerate.mjs';
const ok = data => ({ ok: () => true, json: async () => data });
test('only descends matching year and month buckets', async () => {
  const pages = { '1': [{ id: '2', status: 'current', title: 'E2E automated 1 2026' }, { id: '9', status: 'current', title: 'Manual' }], '2': [{ id: '3', status: 'current', title: 'E2E automated 1 2026-10' }], '3': [{ id: '4', status: 'current', title: 'Test' }] };
  const seen = [];
  const request = { get: async url => { const id = url.match(/pages\/(\d+)\/children/)[1]; seen.push(id); return ok({ results: pages[id] }); } };
  const result = await enumerateBuckets({ request, domain: 'example.atlassian.net', rootId: '1' });
  assert.deepEqual(seen, ['1', '2', '3']); assert.equal(result.buckets[0].pages[0].id, '4');
});
test('rejects pagination links that leave the site', async () => {
  const request = { get: async () => ok({ results: [], _links: { next: 'https://attacker.example/x' } }) };
  await assert.rejects(enumerateBuckets({ request, domain: 'example.atlassian.net', rootId: '1' }), /Invalid pagination/);
});
test('bounds enumeration', async () => {
  const request = { get: async () => ok({ results: [{ id: '2' }, { id: '3' }] }) };
  await assert.rejects(enumerateBuckets({ request, domain: 'example.atlassian.net', rootId: '1', maxPages: 1 }), /limit exceeded/);
});
test('rejects a same-site pagination link for a different parent', async () => {
  const request = { get: async () => ok({ results: [], _links: { next: '/wiki/api/v2/pages/99/children?cursor=1' } }) };
  await assert.rejects(enumerateBuckets({ request, domain: 'example.atlassian.net', rootId: '1' }), /Invalid pagination/);
});
