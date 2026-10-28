import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPage } from './candidates.mjs';
const options = { rootId: '123', cutoff: new Date('2026-10-01T00:00:00Z') };
const page = () => ({ id: '456', status: 'current', preserve: false, parentId: '789', createdAt: '2026-09-01T00:00:00Z', version: { number: 1 }, testOrigin: {
  schema: 1, kind: 'temporary-e2e', rootId: '123', pageId: '456',
  bucketId: '789', pageVersion: 1, createdAt: '2026-09-01T00:00:00Z', preserve: false,
} });
test('selects a verified old temporary page', () => assert.equal(classifyPage(page(), options), 'eligible'));
test('keeps fixtures, unknown pages and recent pages', () => {
  const a = page(); delete a.testOrigin;
  const b = page(); b.preserve = true;
  const c = page(); c.testOrigin.createdAt = c.createdAt = '2026-10-01T00:00:00Z';
  const d = page(); d.testOrigin.pageId = 'another';
  const e = page(); delete e.preserve;
  assert.equal(classifyPage(a, options), 'unverified-origin');
  assert.equal(classifyPage(b, options), 'preserved-or-unknown');
  assert.equal(classifyPage(c, options), 'recent');
  assert.equal(classifyPage(d, options), 'unverified-origin');
  assert.equal(classifyPage(e, options), 'preserved-or-unknown');
});
test('fails closed for malformed dates and missing status', () => {
  const a = page(); a.testOrigin.createdAt = a.createdAt = 'bad';
  const b = page(); delete b.status;
  assert.equal(classifyPage(a, options), 'invalid-date');
  assert.equal(classifyPage(b, options), 'not-current');
});
test('preserves pages that were edited or moved after marking', () => {
  const edited = page(); edited.version.number = 2;
  const moved = page(); moved.parentId = '987';
  assert.equal(classifyPage(edited, options), 'changed-or-unverified');
  assert.equal(classifyPage(moved, options), 'changed-or-unverified');
});
