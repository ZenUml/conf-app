import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchBody, findChild, closeChild, verifyParent } from './wait-for-e2e.mjs';

test('dispatch serializes regex without changing its escapes', () => {
  const env = { GITHUB_REF_NAME: 'main', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: 'abc', GREP: '(?:^|\\s)@smoke' };
  const body = JSON.parse(JSON.stringify(dispatchBody(env)));
  assert.equal(body.inputs.grep, env.GREP);
  assert.equal(body.inputs['source-sha'], 'abc');
  assert.equal(body.inputs['parent-attempt'], '2');
});

test('waits for exact attempt and SHA instead of a stale run', () => {
  const title = 'lite · parent 12 · attempt 2 · source abc';
  const runs = [{ id: 1, display_title: 'lite · parent 12 · attempt 1 · source abc' }, { id: 2, display_title: 'lite · parent 12 · attempt 2 · source other' }, { id: 3, display_title: title, head_sha: 'advanced-main' }];
  assert.equal(findChild(runs, title).id, 3);
  assert.equal(findChild(runs, title + 'missing'), undefined);
});

test('PR dispatch uses branch ref and only the PR child inputs', () => {
  const body = dispatchBody({ CHILD_KIND: 'pr', DISPATCH_REF: 'feature', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: 'merge-sha', MODE: 'selected' });
  assert.equal(body.ref, 'feature');
  assert.equal(body.inputs.mode, 'selected');
  assert.equal(body.inputs['source-sha'], 'merge-sha');
  assert.equal('suite' in body.inputs, false);
});

test('cleanup waits for child termination after requesting cancellation', async () => {
  const calls = [];
  let polls = 0;
  const api = (path) => {
    calls.push(path);
    if (path.includes('/runs?')) return { workflow_runs: [{ id: 5, display_title: 'target', status: 'in_progress' }, { id: 6, display_title: 'other', status: 'in_progress' }] };
    if (path.endsWith('/cancel')) return null;
    return { id: 5, status: ++polls === 2 ? 'completed' : 'in_progress' };
  };
  await closeChild(api, 'target', 'lite.yml', async () => {});
  assert.equal(polls, 2);
  assert.ok(calls.includes('actions/runs/5/cancel'));
  assert.ok(!calls.includes('actions/runs/6/cancel'));
});

test('cleanup fails if child is still active at the deadline', async () => {
  const api = path => path.includes('/runs?') ? { workflow_runs: [{ id: 5, display_title: 'target', status: 'in_progress' }] } : null;
  await assert.rejects(closeChild(api, 'target', 'lite.yml', async () => {}, 0), /has not stopped/);
});

test('cleanup discovers a dispatched child after delayed run visibility', async () => {
  let discoveries = 0;
  let cancelled = false;
  const api = path => {
    if (path.includes('/runs?')) return { workflow_runs: ++discoveries === 1 ? [] : [{ id: 5, display_title: 'target', status: 'in_progress' }] };
    if (path.endsWith('/cancel')) { cancelled = true; return null; }
    return { id: 5, status: 'completed' };
  };
  await closeChild(api, 'target', 'lite.yml', async () => {}, undefined, true);
  assert.equal(discoveries, 2);
  assert.equal(cancelled, true);
});

test('successful dispatch cannot silently disappear from cleanup', async () => {
  await assert.rejects(closeChild(() => ({ workflow_runs: [] }), 'target', 'lite.yml', async () => {}, 0, true), /Dispatched child not found/);
});

test('child accepts only an active staging parent in the matching attempt', () => {
  const parent = { status: 'in_progress', run_attempt: 2, path: '.github/workflows/pr-validation.yml' };
  verifyParent(parent, '2');
  for (const invalid of [{ ...parent, status: 'completed' }, { ...parent, run_attempt: 1 }, { ...parent, path: '.github/workflows/release.yml' }]) {
    assert.throws(() => verifyParent(invalid, '2'), /active staging parent/);
  }
});
