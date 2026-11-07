import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveCandidates } from './archive.mjs';
const policy = { rootId: '12', cutoff: new Date('2026-10-01Z') };
const page = id => ({ id, status: 'current', preserve: false, parentId: '34', createdAt: '2026-09-01Z', version: { number: 1 }, testOrigin: { schema: 1, kind: 'temporary-e2e', rootId: '12', pageId: id, bucketId: '34', pageVersion: 1, createdAt: '2026-09-01Z', preserve: false } });
test('dry run reports selection without side effects', async () => {
  const result = await archiveCandidates({ pages: [page('1')], policy, readPage: () => { throw Error('read'); }, archivePage: () => { throw Error('archive'); } });
  assert.deepEqual(result.results, [{ id: '1', status: 'selected' }]);
});
test('rechecks and verifies archival', async () => {
  let status = 'current';
  const result = await archiveCandidates({ pages: [page('1')], policy, dryRun: false, readPage: async () => ({ ...page('1'), status }), archivePage: async () => { status = 'archived'; }, wait: async () => {} });
  assert.deepEqual(result.results, [{ id: '1', status: 'archived' }]);
});
test('stops after failed readback and does not touch subsequent pages', async () => {
  const calls = [];
  const result = await archiveCandidates({ pages: [page('1'), page('2')], policy, dryRun: false, readPage: async id => page(id), archivePage: async id => calls.push(id), wait: async () => {} });
  assert.equal(result.stopped, true);
  assert.equal(result.results[0].status, 'failed');
  assert.deepEqual(calls, ['1']);
});
test('retries a definite rate limit and waits for asynchronous archival', async () => {
  let attempts = 0; let reads = 0; const delays = [];
  const result = await archiveCandidates({ pages: [page('1')], policy, dryRun: false,
    readPage: async () => ({ ...page('1'), status: ++reads >= 3 ? 'archived' : 'current' }),
    archivePage: async () => { if (++attempts === 1) throw Object.assign(Error('rate limited'), { status: 429, retryAfterMs: 2500 }); },
    wait: async ms => delays.push(ms),
  });
  assert.equal(result.results[0].status, 'archived');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2500, 1000, 1000]);
});
test('does not retry an ambiguous archive failure', async () => {
  let attempts = 0;
  const result = await archiveCandidates({ pages: [page('1')], policy, dryRun: false,
    readPage: async () => page('1'), archivePage: async () => { attempts++; throw Error('connection lost'); }, wait: async () => {},
  });
  assert.equal(result.stopped, true);
  assert.equal(attempts, 1);
});
test('preserves a page protected after enumeration', async () => {
  const changed = { ...page('1'), preserve: true };
  const result = await archiveCandidates({ pages: [page('1')], policy, dryRun: false, readPage: async () => changed, archivePage: () => { throw Error('must not archive'); } });
  assert.equal(result.results[0].reason, 'changed-before-archive');
});
