import test from 'node:test';
import assert from 'node:assert/strict';
import { findBaseline, evaluateGate, fetchRuns, freshRegressionCoverage } from '../main-policy.mjs';
const sha = 'a'.repeat(40), older = 'b'.repeat(40), unrelated = 'c'.repeat(40);
const now = Date.parse('2026-10-08T12:00:00Z');
const run = (id, extra = {}) => ({ id, head_branch: 'main', head_sha: older, status: 'completed', conclusion: 'success', updated_at: new Date(now - 1000).toISOString(), html_url: `https://example.com/${id}`, ...extra });
const options = { sourceSha: sha, now, isAncestor: s => s === older, targetSha: () => older, executionEvidence: () => true };
test('baseline excludes current, failures, same SHA and unrelated commits', async () => {
  assert.deepEqual(await findBaseline([run(10), run(9), run(8, { conclusion: 'failure' }), run(7, { head_sha: sha }), run(6, { head_sha: unrelated }), run(5)], { sourceSha: sha, rootRunId: 9, isAncestor: s => s === older }), { 'base-sha': older, 'force-full': 'false' });
});
test('no ancestral baseline requires full validation', async () => {
  assert.equal((await findBaseline([run(1, { head_sha: unrelated })], { sourceSha: sha, isAncestor: () => false }))['force-full'], 'true');
});
test('pagination rejects short incomplete inventory and malformed responses', async () => {
  await assert.rejects(fetchRuns(() => ({ total_count: 2, workflow_runs: [run(1)] }), 'x', 'r'), /Incomplete/);
  await assert.rejects(fetchRuns(() => ({}), 'x', 'r'), /Invalid/);
});
test('pagination collects every page before using evidence', async () => {
  let count = 0;
  const runs = await fetchRuns(() => ++count === 1 ? { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, i) => run(i)) } : { total_count: 101, workflow_runs: [run(101)] }, 'x', 'r');
  assert.equal(runs.length, 101);
  assert.equal(count, 2);
});
test('latest completed failure blocks older success despite newer pending run', async () => {
  assert.equal((await evaluateGate([run(1), run(2, { conclusion: 'failure' }), run(3, { status: 'in_progress' })], options)).allowed, 'false');
});
test('fresh successful manual ancestor passes, unrelated target fails', async () => {
  assert.equal((await evaluateGate([run(1, { event: 'workflow_dispatch', head_sha: unrelated })], options)).allowed, 'true');
  assert.equal((await evaluateGate([run(1)], { ...options, targetSha: () => unrelated })).allowed, 'false');
});
test('stale, missing and failed lookup block', async () => {
  for (const [runs, extra] of [[[run(1, { updated_at: new Date(now - 37 * 3600000).toISOString() })], {}], [[], {}], [[run(1)], { lookupError: true }]]) assert.equal((await evaluateGate(runs, { ...options, ...extra })).allowed, 'false');
});
test('bypass requires manual root and reason', async () => {
  for (const extra of [{ rootEvent: 'push', bypassReason: 'urgent' }, { rootEvent: 'workflow_dispatch', bypassReason: ' ' }]) assert.equal((await evaluateGate([], { ...options, bypass: 'true', ...extra })).allowed, 'false');
  assert.equal((await evaluateGate([], { ...options, lookupError: true, bypass: 'true', rootEvent: 'workflow_dispatch', bypassReason: 'urgent' })).allowed, 'true');
});

test('completion chronology includes reruns of older run IDs', async () => {
  const recentFailure = run(9, { run_attempt: 2, conclusion: 'failure', updated_at: new Date(now - 100).toISOString() });
  assert.equal((await evaluateGate([run(10), recentFailure], options)).allowed, 'false');
  const recovered = { ...recentFailure, conclusion: 'success' };
  assert.equal((await evaluateGate([run(10, { conclusion: 'failure' }), recovered], options)).allowed, 'true');
});
test('fresh workflow metadata cannot replace fresh test coverage', async () => {
  assert.equal((await evaluateGate([run(1)], { ...options, executionEvidence: () => false })).allowed, 'false');
  const required = [];
  const job = name => ({ name, status: 'completed', conclusion: 'success', completed_at: new Date(now - 1000).toISOString(), run_attempt: 1 });
  for (const variant of ['Lite', 'Full', 'Diagramly', 'AsyncAPI']) {
    required.push(job(`${variant} / Deploy: app / deploy`), job(`${variant} / verify-version`));
    for (const suite of ['E2E full live regression', 'E2E full render regression']) for (const task of ['plan concrete tests', 'shard 1/1', 'aggregate concrete evidence']) required.push(job(`${variant} / ${suite} / ${task}`));
  }
  const current = run(1, { run_attempt: 1 });
  assert.equal(freshRegressionCoverage(current, required, older, now), true);
  assert.equal(freshRegressionCoverage(current, required.map((j, i) => i === 2 ? { ...j, completed_at: new Date(now - 37 * 3600000).toISOString() } : j), older, now), false);
  assert.equal(freshRegressionCoverage({ ...current, run_attempt: 2 }, required, older, now), false);
  assert.equal(freshRegressionCoverage(current, required.filter(j => !j.name.startsWith('AsyncAPI /')), older, now), false);
});
