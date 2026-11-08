import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuckets } from './buckets.mjs';

test('a serialized provisioner creates one year and month bucket', async () => {
  const pages = new Map();
  let next = 1;
  const findByTitle = async title => pages.get(title);
  const createPage = async ({ title, parentId }) => {
    if (pages.has(title)) throw Object.assign(new Error('conflict'), { status: 409 });
    const page = { id: String(next++), title, parentId };
    pages.set(title, page);
    return page;
  };
  const options = { rootId: '123', now: new Date('2026-10-28T00:00:00Z'), findByTitle, createPage, allowCreate: true };
  const a = await resolveBuckets(options); const b = await resolveBuckets(options);
  assert.deepEqual(a, b);
  assert.equal(pages.size, 2);
  assert.equal(pages.get('E2E automated 123 2026-10').parentId, a.yearId);
});

test('rejects a title collision under an unexpected parent', async () => {
  await assert.rejects(resolveBuckets({
    rootId: '123', now: new Date('2026-10-01Z'),
    findByTitle: async title => ({ id: '5', title, parentId: '999' }),
    createPage: async () => { throw new Error('unexpected create'); },
  }), /unexpected identity or parent/);
});

test('does not swallow unrelated create failures', async () => {
  await assert.rejects(resolveBuckets({
    rootId: '123', allowCreate: true, findByTitle: async () => null,
    createPage: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); },
  }), /forbidden/);
});

test('a racing 400 response is accepted only when a matching page appears', async () => {
  let lookup = 0;
  await assert.rejects(resolveBuckets({
    rootId: '123', now: new Date('2026-10-01Z'), allowCreate: true,
    findByTitle: async () => { lookup++; return null; },
    createPage: async () => { throw Object.assign(new Error('bad request'), { status: 400 }); },
    wait: async () => {},
  }), /bad request/);
  assert.equal(lookup, 5);
});
test('test workers never create a missing bucket', async () => {
  let creates = 0;
  await assert.rejects(resolveBuckets({ rootId: '123', findByTitle: async () => null, createPage: async () => { creates++; } }), /serialized provisioning/);
  assert.equal(creates, 0);
});
