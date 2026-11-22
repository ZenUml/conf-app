import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveringRun } from './pr-run-covered.mjs';

const HEAD = 'a'.repeat(40);
const run = (id, over = {}) => ({ id, event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: HEAD, ...over });
const jobs = (selectStartedAt = '2026-11-22T00:05:44Z', over = {}) => [
  { name: 'Select E2E for this PR', conclusion: 'success', started_at: selectStartedAt },
  { name: 'Deploy: Lite / deploy', conclusion: 'success', started_at: '2026-11-22T00:06:10Z' },
  { name: 'E2E validation', conclusion: 'success', started_at: '2026-11-22T00:09:37Z', ...over },
  { name: 'Pipeline outcome', conclusion: 'success', started_at: '2026-11-22T00:13:06Z' },
];
const decision = (at, id = 1) => ({ id, body: '<!-- pr-test-decision:v2 -->\n```json\n{}\n```', created_at: at, updated_at: at });
const world = (over = {}) => ({
  runId: 300, attempt: '1', event: 'pull_request', headSha: HEAD, pr: '7',
  listRuns: async () => [run(100)],
  listJobs: async () => jobs(),
  listComments: async () => [decision('2026-11-21T23:58:00Z')],
  log: () => {},
  ...over,
});

test('an earlier run that passed E2E for this head under the current decision covers this run', async () => {
  assert.equal(await coveringRun(world()), 100);
});

test('this run never covers itself, and a later run does not cover an earlier one', async () => {
  assert.equal(await coveringRun(world({ listRuns: async () => [run(300), run(400)] })), null);
});

test('only a finished, successful pull_request run of the same head counts', async () => {
  for (const other of [run(100, { conclusion: 'failure' }), run(100, { status: 'in_progress', conclusion: null }),
    run(100, { head_sha: 'b'.repeat(40) }), run(100, { event: 'workflow_dispatch' })]) {
    assert.equal(await coveringRun(world({ listRuns: async () => [other] })), null);
  }
});

test('a green run that did not execute E2E does not cover', async () => {
  for (const list of [
    jobs(undefined, { conclusion: 'skipped' }),
    jobs().filter(job => job.name !== 'E2E validation'),
    jobs().map(job => job.name === 'Pipeline outcome' ? { ...job, conclusion: 'skipped' } : job),
    jobs().map(job => job.name === 'Select E2E for this PR' ? { ...job, started_at: null } : job),
  ]) assert.equal(await coveringRun(world({ listJobs: async () => list })), null);
});

test('a decision published or edited after the earlier run read it needs a fresh run', async () => {
  const later = '2026-11-22T00:05:45Z';
  assert.equal(await coveringRun(world({ listComments: async () => [decision('2026-11-21T23:58:00Z'), decision(later, 2)] })), null);
  const edited = { ...decision('2026-11-21T23:58:00Z'), updated_at: later };
  assert.equal(await coveringRun(world({ listComments: async () => [edited] })), null);
  // Equal timestamps are ambiguous, so they do not cover.
  assert.equal(await coveringRun(world({ listComments: async () => [decision('2026-11-22T00:05:44Z')] })), null);
});

test('comments that are not decision records do not matter', async () => {
  const chat = { id: 9, body: 'LGTM', created_at: '2026-11-22T01:00:00Z', updated_at: '2026-11-22T01:00:00Z' };
  assert.equal(await coveringRun(world({ listComments: async () => [decision('2026-11-21T23:58:00Z'), chat] })), 100);
});

test('no decision record at all cannot cover', async () => {
  assert.equal(await coveringRun(world({ listComments: async () => [] })), null);
});

test('a manual dispatch or a re-run attempt always runs', async () => {
  const unused = async () => { throw new Error('must not be called'); };
  for (const over of [{ event: 'workflow_dispatch' }, { attempt: '2' }, { pr: '' }, { headSha: 'nope' }]) {
    assert.equal(await coveringRun(world({ ...over, listRuns: unused, listJobs: unused, listComments: unused })), null);
  }
});

test('any lookup failure runs the validation, because skipping would lose coverage', async () => {
  const failing = async () => { throw new Error('GitHub API returned 502'); };
  for (const key of ['listRuns', 'listJobs', 'listComments']) {
    const logged = [];
    assert.equal(await coveringRun(world({ [key]: failing, log: message => logged.push(message) })), null);
    assert.match(logged.join(), /502/);
  }
});

test('the newest covering run is reported', async () => {
  assert.equal(await coveringRun(world({ listRuns: async () => [run(100), run(200)] })), 200);
});
