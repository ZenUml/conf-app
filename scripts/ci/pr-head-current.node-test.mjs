import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prRunIsCurrent } from './pr-head-current.mjs';

const pull = (state, sha) => async () => ({ state, head: { sha } });

test('an open PR whose head is this commit is current', async () => {
  assert.equal(await prRunIsCurrent({ pr: '7', expectedSha: 'abc', fetchPull: pull('open', 'abc') }), true);
});

test('a newer push makes the run stale', async () => {
  assert.equal(await prRunIsCurrent({ pr: '7', expectedSha: 'abc', fetchPull: pull('open', 'def') }), false);
});

test('a closed or merged PR makes the run stale', async () => {
  assert.equal(await prRunIsCurrent({ pr: '7', expectedSha: 'abc', fetchPull: pull('closed', 'abc') }), false);
});

test('an API failure keeps validating, because skipping would lose coverage', async () => {
  const failing = async () => { throw new Error('GitHub API returned 502'); };
  const logged = [];
  assert.equal(await prRunIsCurrent({ pr: '7', expectedSha: 'abc', fetchPull: failing, log: message => logged.push(message) }), true);
  assert.match(logged.join(), /GitHub API returned 502/);
});

test('a run without a PR number is current', async () => {
  const unused = async () => { throw new Error('must not be called'); };
  assert.equal(await prRunIsCurrent({ pr: '', expectedSha: 'abc', fetchPull: unused }), true);
});
