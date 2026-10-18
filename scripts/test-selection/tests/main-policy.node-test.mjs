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
test('pagination requests pages 2..N together and keeps page order', async () => {
  const pageRuns = { 1: Array.from({ length: 100 }, (_, i) => run(1000 + i)), 2: Array.from({ length: 100 }, (_, i) => run(2000 + i)), 3: Array.from({ length: 50 }, (_, i) => run(3000 + i)) };
  const events = [], gates = {};
  const respond = page => ({ total_count: 250, workflow_runs: pageRuns[page] });
  const api = async endpoint => {
    const page = Number(new URL(`https://x/${endpoint}`).searchParams.get('page'));
    events.push(`request ${page}`);
    if (page > 1) await new Promise(resolve => { gates[page] = resolve; });
    events.push(`response ${page}`);
    return respond(page);
  };
  const pending = fetchRuns(api, 'x', 'r');
  // Pages 2 and 3 resolve in reverse order to prove results are joined by page, not by arrival.
  for (let i = 0; i < 50 && Object.keys(gates).length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.slice(0, 3), ['request 1', 'response 1', 'request 2']);
  assert.ok(events.includes('request 3') && !events.some(e => e.startsWith('response') && e !== 'response 1'), `pages 2 and 3 must both be requested before either responds: ${events}`);
  gates[3](); gates[2]();
  const runs = await pending;
  assert.deepEqual(runs.map(r => r.id), [...pageRuns[1], ...pageRuns[2], ...pageRuns[3]].map(r => r.id));
});
// Mock api: each page reports its own total_count; pages after the first wait on a gate when `gated` is set.
const pagedApi = (pages, { gated = () => false } = {}) => {
  const log = [], gates = {};
  let outstanding = 0, peak = 0;
  const api = async endpoint => {
    const page = Number(new URL(`https://x/${endpoint}`).searchParams.get('page'));
    log.push(page);
    outstanding++; peak = Math.max(peak, outstanding);
    try {
      if (gated(page)) await new Promise(resolve => { gates[page] = resolve; });
      return typeof pages[page] === 'function' ? pages[page]() : pages[page];
    } finally { outstanding--; }
  };
  return { api, log, gates, peak: () => peak };
};
const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
const batch = (start, n) => Array.from({ length: n }, (_, i) => run(start + i));
test('pagination returns what the sequential loop returned when the inventory shrinks mid-fetch', async () => {
  const p = [null, batch(1000, 100), batch(2000, 100), batch(3000, 40)];
  const { api } = pagedApi({ 1: { total_count: 250, workflow_runs: p[1] }, 2: { total_count: 250, workflow_runs: p[2] }, 3: { total_count: 240, workflow_runs: p[3] } });
  const runs = await fetchRuns(api, 'x', 'r');
  assert.deepEqual(runs.map(r => r.id), [...p[1], ...p[2], ...p[3]].map(r => r.id));
  assert.equal(runs.length, 240);
});
test('pagination stops at the smallest total_count seen, even when a non-last page is short', async () => {
  const p = [null, batch(1000, 100), batch(2000, 80)];
  const { api } = pagedApi({ 1: { total_count: 300, workflow_runs: p[1] }, 2: { total_count: 180, workflow_runs: p[2] }, 3: { total_count: 180, workflow_runs: [] } });
  const runs = await fetchRuns(api, 'x', 'r');
  assert.deepEqual(runs.map(r => r.id), [...p[1], ...p[2]].map(r => r.id));
});
test('pagination never has more than 6 page requests outstanding', async () => {
  const pages = {};
  for (let n = 1; n <= 12; n++) pages[n] = { total_count: 1150, workflow_runs: batch(n * 1000, n === 12 ? 50 : 100) };
  const { api, gates, peak } = pagedApi(pages, { gated: page => page > 1 });
  const pending = fetchRuns(api, 'x', 'r');
  await ticks();
  assert.equal(Object.keys(gates).length, 6, 'six pages are in flight while the rest wait');
  // Release one at a time so the workers keep taking new pages; the cap must hold throughout.
  for (let page = 2; page <= 12; page++) {
    while (!gates[page]) await ticks(1);
    gates[page]();
    await ticks(2);
  }
  const runs = await pending;
  assert.ok(peak() <= 6, `peak outstanding requests was ${peak()}`);
  assert.deepEqual(runs.map(r => r.id), Object.values(pages).flatMap(r => r.workflow_runs).map(r => r.id));
});
test('pagination stops requesting pages after one page fails', async () => {
  const pages = { 1: { total_count: 1150, workflow_runs: batch(1000, 100) }, 2: {} };
  for (let n = 3; n <= 12; n++) pages[n] = { total_count: 1150, workflow_runs: batch(n * 1000, 100) };
  const { api, log, gates } = pagedApi(pages, { gated: page => page > 2 });
  // Page 2 fails at once; pages 3..7 are the other requests in flight.
  const pending = fetchRuns(api, 'x', 'r');
  await assert.rejects(pending, /Invalid/);
  const inFlight = log.length;
  await ticks();
  for (const release of Object.values(gates)) release();
  await ticks();
  assert.equal(log.length, inFlight, `no page may be requested after the rejection: ${log}`);
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

test('baseline follows successful completion order when an older main run is rerun', async () => {
  const olderCompletedLater = run(5, { head_sha: unrelated, run_attempt: 2, updated_at: new Date(now - 100).toISOString() });
  const baseline = await findBaseline([run(6), olderCompletedLater], { sourceSha: sha, rootRunId: 7, isAncestor: () => true });
  assert.equal(baseline['base-sha'], unrelated);
});
test('baseline lookup is bounded to a created window so the 1,000-result search cap is never reached', async () => {
  const policy = await import('../main-policy.mjs');
  assert.equal(policy.BASELINE_WINDOW_DAYS, 60);
  const endpoints = [];
  const api = async endpoint => {
    endpoints.push(endpoint);
    return { total_count: 150, workflow_runs: Number(new URL(`https://x/${endpoint}`).searchParams.get('page')) === 1 ? batch(1, 100) : batch(200, 50) };
  };
  await fetchRuns(api, 'build-test-deploy.yml', 'o/r', { now: Date.parse('2026-10-19T12:00:00Z') });
  assert.equal(endpoints.length, 2);
  for (const endpoint of endpoints) {
    // gh api passes the path verbatim, so ">=" must already be percent-encoded.
    assert.match(endpoint, /[?&]created=%3E%3D2026-08-20(&|$)/);
    assert.ok(!/created=>/.test(endpoint));
    assert.equal(new URL(`https://x/${endpoint}`).searchParams.get('created'), '>=2026-08-20');
    assert.equal(new URL(`https://x/${endpoint}`).searchParams.get('branch'), 'main');
  }
});
