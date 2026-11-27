import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, dispatchBody, findChild, closeChild, discoverChild, discoveryWindowMs, verifyParent, verifyParentWithRetry, verifyChildRun } from './wait-for-e2e.mjs';
import { largeRunListing, withFakeGh } from './fake-gh.mjs';

test('dispatch serializes regex without changing its escapes', () => {
  const env = { CHILD_KIND: 'pr', MODE: 'selected', GITHUB_REF_NAME: 'main', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: 'abc', GREP: '(?:^|\\s)@smoke' };
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

test('PR dispatch forwards dedicated-slot overrides only when set', () => {
  const base = { CHILD_KIND: 'pr', DISPATCH_REF: 'main', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1', SOURCE_SHA: 'abc', MODE: 'selected', PR_NUMBER: '7', DECISION_ID: 'd1' };
  const unset = dispatchBody(base);
  for (const key of ['app', 'auth-artifact', 'backend-url']) assert.equal(key in unset.inputs, false);
  assert.deepEqual(dispatchBody({ ...base, CHILD_APP: '', CHILD_AUTH_ARTIFACT: '', CHILD_BACKEND_URL: '' }), unset, 'empty overrides leave the body byte-identical');
  const slot = dispatchBody({ ...base, CHILD_APP: 'zenuml-lite@dev', CHILD_AUTH_ARTIFACT: 'auth-state-pre-lite-dev', CHILD_BACKEND_URL: 'https://conf-stg-lite-pr.zenuml.com' });
  assert.equal(slot.inputs.app, 'zenuml-lite@dev');
  assert.equal(slot.inputs['auth-artifact'], 'auth-state-pre-lite-dev');
  assert.equal(slot.inputs['backend-url'], 'https://conf-stg-lite-pr.zenuml.com');
});

test('only the PR child is dispatched', () => {
  // The main phases and their staging E2E lanes are called workflows of the root.
  for (const kind of [undefined, '', 'staging', 'phase']) {
    assert.throws(() => dispatchBody({ CHILD_KIND: kind, GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: 'abc' }), /Unknown child kind/);
  }
});

test('the staging run is never a dispatching parent', () => {
  const parent = { status: 'in_progress', run_attempt: 1, path: '.github/workflows/main-staging-validation.yml', display_title: 'Staging validation · parent 12 · attempt 2 · source abc' };
  const jobs = [{ name: 'Validate: Lite', status: 'in_progress' }];
  const provenance = { sourceSha: 'abc', rootId: '12', rootAttempt: '2', root: { status: 'in_progress', run_attempt: 2, path: '.github/workflows/build-test-deploy.yml', head_sha: 'abc' }, rootJobs: [{ name: 'Staging validation', status: 'in_progress' }] };
  assert.throws(() => verifyParent(parent, '1', jobs, ['Validate: Lite'], provenance), /active staging parent/);
});

test('the root is no dispatching parent: its phases are called workflows', () => {
  const parent = { status: 'in_progress', run_attempt: 2, path: '.github/workflows/build-test-deploy.yml', head_sha: 'abc' };
  const jobs = [{ name: 'Staging validation', status: 'in_progress' }];
  assert.throws(() => verifyParent(parent, '2', jobs, ['Staging validation'], { sourceSha: 'abc' }), /active staging parent/);
});

test('children reject manual dispatch and reruns before verifying their parent', () => {
  verifyChildRun('github-actions[bot]', '1');
  assert.throws(() => verifyChildRun('maintainer', '1'), /dispatched once by their parent/);
  assert.throws(() => verifyChildRun('github-actions[bot]', '2'), /rerun the root/);
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
  const jobs = [{ name: 'E2E validation', status: 'in_progress' }];
  verifyParent(parent, '2', jobs, ['E2E validation']);
  verifyParent({ ...parent, status: 'pending' }, '2', jobs, ['E2E validation']);
  verifyParent({ ...parent, status: 'queued' }, '2', jobs, ['E2E validation']);
  assert.throws(() => verifyParent(parent, '2', [], ['E2E validation']), /active staging parent/);
  assert.throws(() => verifyParent(parent, '2', jobs, ['Validate: Full']), /active staging parent/);
  for (const invalid of [{ ...parent, status: 'completed' }, { ...parent, run_attempt: 1 }, { ...parent, path: '.github/workflows/release.yml' }]) {
    assert.throws(() => verifyParent(invalid, '2', jobs, ['E2E validation']), /active staging parent/);
  }
});

test('root option artifact binds manual controls to source, run and attempt', async () => {
  const { rootOptions, verifyRootOptions } = await import('./wait-for-e2e.mjs');
  const env = { GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc', GITHUB_EVENT_NAME: 'workflow_dispatch', FULL_TESTS: 'true', BYPASS_REGRESSION_GATE: 'true', BYPASS_REASON: ' urgent fix\nwith context ' };
  const options = rootOptions(env);
  const root = { id: 12, run_attempt: 2, head_sha: 'abc', event: 'workflow_dispatch', path: '.github/workflows/build-test-deploy.yml' };
  assert.equal(options.full_tests, true);
  assert.equal(options.bypass_reason, 'urgent fix\nwith context');
  verifyRootOptions(options, root, '12', '2', 'abc');
  for (const mutation of [{ source_sha: 'other' }, { root_attempt: '1' }, { root_run_id: '13' }, { root_event: 'push' }, { bypass_reason: ' ' }, { full_tests: 'true' }]) {
    assert.throws(() => verifyRootOptions({ ...options, ...mutation }, root, '12', '2', 'abc'), /verified root/);
  }
  assert.throws(() => rootOptions({ ...env, BYPASS_REASON: ' ' }), /requires a reason/);
  const push = rootOptions({ ...env, GITHUB_EVENT_NAME: 'push' });
  assert.equal(push.full_tests, false);
  assert.equal(push.bypass_regression_gate, false);
  assert.equal(push.bypass_reason, '');
  assert.throws(() => verifyRootOptions(options, { ...root, event: 'push' }, '12', '2', 'abc'), /verified root/);
});

test('root accepts a blocked daily gate only from its own run and attempt', async () => {
  const { verifyDailyGate } = await import('./wait-for-e2e.mjs');
  // The draft phase is a called workflow, so the producer is the root run itself.
  const gate = { producer_run_id: '12', root_run_id: '12', root_attempt: '2', source_sha: 'abc', allowed: 'false', 'gate-reason': 'Latest daily regression failed' };
  assert.equal(verifyDailyGate(gate, '12', '2', 'abc')['gate-reason'], 'Latest daily regression failed');
  for (const patch of [{ producer_run_id: '44' }, { root_run_id: '13' }, { root_attempt: '1' }, { source_sha: 'other' }, { allowed: true }, { 'gate-reason': 1 }]) {
    assert.throws(() => verifyDailyGate({ ...gate, ...patch }, '12', '2', 'abc'), /does not match/);
  }
});

test('a phase reads the root options of its own run and attempt', async () => {
  const { loadRootOptions, rootOptions } = await import('./wait-for-e2e.mjs');
  const env = { GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', SOURCE_SHA: 'abc' };
  const root = { id: 12, run_attempt: 2, head_sha: 'abc', event: 'push', path: '.github/workflows/build-test-deploy.yml' };
  const recorded = rootOptions({ GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc', GITHUB_EVENT_NAME: 'push' });
  const asked = [];
  const download = (name, file) => { asked.push([name, file]); return recorded; };
  assert.deepEqual(loadRootOptions(env, path => { asked.push(path); return root; }, download), recorded);
  assert.deepEqual(asked, ['actions/runs/12', ['main-root-options-2', 'main-root-options.json']]);
  // Options recorded by an earlier attempt, or for another source, are refused.
  assert.throws(() => loadRootOptions(env, () => root, () => ({ ...recorded, root_attempt: '1' })), /verified root/);
  assert.throws(() => loadRootOptions({ ...env, SOURCE_SHA: 'other' }, () => root, download), /verified root/);
});

test('child discovery reads a run listing larger than the default 1 MiB buffer', async () => {
  const title = 'PR E2E · parent 12 · attempt 2 · source abc';
  await withFakeGh({ '/runs?': largeRunListing({ id: 777, display_title: title }) }, () => {
    const api = createApi('repos/example/repo');
    const { workflow_runs } = api('actions/workflows/pr-e2e-validation.yml/runs?event=workflow_dispatch&per_page=100');
    assert.equal(findChild(workflow_runs, title).id, 777);
  });
});

test('cleanup finds the dispatched child in a run listing larger than 1 MiB', async () => {
  const title = 'Staging validation · parent 12 · attempt 2 · source abc';
  await withFakeGh({ '/runs?': largeRunListing({ id: 778, display_title: title }) }, async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 200));
    await closeChild(createApi('repos/example/repo'), title, 'main-staging-validation.yml', pause, Date.now() + 2000, true);
  });
});

const retryState = (status, jobStatus, extra = {}) => ({
  parent: { status, run_attempt: 2, path: '.github/workflows/pr-validation.yml', ...extra },
  attempt: '2', jobs: [{ name: 'E2E validation', status: jobStatus }], expectedJobs: ['E2E validation'], provenance: {},
});

test('parent verification retries stale GitHub state and succeeds once it is fresh', async () => {
  const states = [retryState('queued', 'queued'), retryState('queued', 'in_progress')];
  let fetches = 0, pauses = 0;
  const logs = [];
  await verifyParentWithRetry(() => states[fetches++], 6, async () => { pauses++; }, line => logs.push(line));
  assert.equal(fetches, 2);
  assert.equal(pauses, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /queued/);
});

test('parent verification throws the original error after the last attempt', async () => {
  let fetches = 0;
  await assert.rejects(
    verifyParentWithRetry(() => { fetches++; return retryState('completed', 'completed'); }, 3, async () => {}),
    /requires an active staging parent/);
  assert.equal(fetches, 3);
});

test('parent verification does not retry an error other than an inactive parent', async () => {
  let fetches = 0, pauses = 0;
  const state = () => { fetches++; throw new Error('gh: Not Found (HTTP 404)'); };
  await assert.rejects(verifyParentWithRetry(state, 6, async () => { pauses++; }), /Not Found/);
  assert.equal(fetches, 1);
  assert.equal(pauses, 0);
});

test('a definitively rejected dispatch skips cleanup discovery', async () => {
  const { dispatchWithRecord, cleanupWithRecord } = await import('./wait-for-e2e.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-record-'));
  const marker = join(dir, 'dispatch');
  try {
    const reject = () => { const error = new Error('dispatch failed'); error.status = 1; error.stderr = 'gh: No ref found for: deleted (HTTP 422)\n'; throw error; };
    assert.throws(() => dispatchWithRecord(reject, 'child.yml', {}, marker), /dispatch failed/);
    let lookups = 0;
    await cleanupWithRecord(() => { lookups++; }, 'title', 'child.yml', async () => {}, marker);
    assert.equal(lookups, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ambiguous dispatch errors still discover and cancel a possible child', async () => {
  const { dispatchWithRecord, cleanupWithRecord } = await import('./wait-for-e2e.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-record-'));
  const marker = join(dir, 'dispatch');
  try {
    assert.throws(() => dispatchWithRecord(() => { throw new Error('connection reset'); }, 'child.yml', {}, marker), /connection reset/);
    let cancelled = false;
    const api = path => {
      if (path.includes('/runs?')) return { workflow_runs: [{ id: 5, display_title: 'title', status: 'in_progress' }] };
      if (path.endsWith('/cancel')) { cancelled = true; return null; }
      return { status: 'completed' };
    };
    await cleanupWithRecord(api, 'title', 'child.yml', async () => {}, marker);
    assert.equal(cancelled, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('CLI records the actual gh missing-ref response across workflow steps', async () => {
  const { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-cli-'));
  try {
    const gh = join(dir, 'gh');
    const calls = join(dir, 'calls');
    writeFileSync(gh, `#!/bin/sh\necho call >> "$FAKE_GH_CALLS"\necho 'gh: No ref found for: deleted (HTTP 422)' >&2\nexit 1\n`);
    chmodSync(gh, 0o755);
    const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, FAKE_GH_CALLS: calls,
      RUNNER_TEMP: dir, GITHUB_REPOSITORY: 'example/repo', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1',
      CHILD_KIND: 'pr', MODE: 'selected', CHILD_WORKFLOW: 'child.yml', CHILD_TITLE: 'Child', SOURCE_SHA: 'abc', DISPATCH_REF: 'deleted' };
    const script = new URL('./wait-for-e2e.mjs', import.meta.url).pathname;
    const dispatch = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 3000 });
    assert.equal(dispatch.status, 1);
    const cleanup = spawnSync(process.execPath, [script, '--cleanup'], { env, encoding: 'utf8', timeout: 3000 });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.equal(readFileSync(calls, 'utf8'), 'call\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup skips discovery when dispatch was never attempted', async () => {
  const { cleanupWithRecord } = await import('./wait-for-e2e.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-not-attempted-'));
  let lookups = 0;
  try {
    await cleanupWithRecord(() => { lookups++; return { workflow_runs: [] }; }, 'title', 'child.yml',
      async () => { throw new Error('unexpected discovery wait'); }, join(dir, 'dispatch'));
    assert.equal(lookups, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy PR dispatch does not gain new required inputs', () => {
  const { inputs } = dispatchBody({ CHILD_KIND: 'pr', SOURCE_SHA: 'abc', MODE: 'all', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' });
  assert.equal('pr-number' in inputs, false);
  assert.equal('decision-id' in inputs, false);
});

// Fake clock: pause() advances time instead of sleeping.
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, pause: async () => { t += 5000; }, at: () => t };
}

test('creation discovery finds a child that becomes visible only after 3.5 minutes', async () => {
  const clock = fakeClock();
  const start = clock.now();
  const api = () => ({ workflow_runs: clock.now() - start >= 210000 ? [{ id: 9, display_title: 'target', status: 'queued' }] : [] });
  const logs = [];
  const child = await discoverChild(api, 'dia.yml', 'target', clock.pause, start + discoveryWindowMs({}),
    { now: clock.now, log: line => logs.push(line) });
  assert.equal(child.id, 9);
  assert.equal(logs.length, 3, 'one progress line per minute, not per poll');
});

test('creation discovery gives up only after the configured window', async () => {
  const clock = fakeClock();
  const start = clock.now();
  const child = await discoverChild(() => ({ workflow_runs: [] }), 'dia.yml', 'target', clock.pause,
    start + discoveryWindowMs({ CHILD_DISCOVERY_SECONDS: '300' }), { now: clock.now, log: () => {} });
  assert.equal(child, undefined);
  assert.ok(clock.now() - start >= 300000 && clock.now() - start < 310000);
});

test('discovery window defaults to 10 minutes and rejects bad values', () => {
  assert.equal(discoveryWindowMs({}), 600000);
  assert.equal(discoveryWindowMs({ CHILD_DISCOVERY_SECONDS: '90' }), 90000);
  assert.throws(() => discoveryWindowMs({ CHILD_DISCOVERY_SECONDS: 'abc' }), /Invalid child discovery window/);
  assert.throws(() => discoveryWindowMs({ CHILD_DISCOVERY_SECONDS: '0' }), /Invalid child discovery window/);
});

test('cleanup discovery honours the same window and still cancels a late-visible child', async () => {
  const clock = fakeClock();
  const start = clock.now();
  let cancelled = false;
  const api = path => {
    if (path.includes('/runs?')) return { workflow_runs: clock.now() - start >= 240000 ? [{ id: 9, display_title: 'target', status: 'queued' }] : [] };
    if (path.endsWith('/cancel')) { cancelled = true; return null; }
    return { id: 9, status: 'completed' };
  };
  await closeChild(api, 'target', 'dia.yml', clock.pause, undefined, true, { now: clock.now, log: () => {} });
  assert.equal(cancelled, true);
});

test('cleanup stops looking after the window when the child never appears', async () => {
  const clock = fakeClock();
  const start = clock.now();
  await assert.rejects(closeChild(() => ({ workflow_runs: [] }), 'target', 'dia.yml', clock.pause, undefined, true,
    { now: clock.now, discoveryMs: 120000, log: () => {} }), /Dispatched child not found/);
  assert.ok(clock.now() - start >= 120000 && clock.now() - start < 130000);
});
