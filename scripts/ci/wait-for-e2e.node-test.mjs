import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, dispatchBody, findChild, closeChild, verifyParent, verifyParentWithRetry, verifyChildRun } from './wait-for-e2e.mjs';
import { largeRunListing, withFakeGh } from './fake-gh.mjs';

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

test('phase dispatch carries version and exact producing run IDs without E2E inputs', () => {
  const body = dispatchBody({ CHILD_KIND: 'phase', VERSION: 'v1', ARTIFACT_RUN_ID: '42', STAGING_RUN_ID: '43' });
  assert.equal(body.inputs.version, 'v1');
  assert.equal(body.inputs['artifact-run-id'], '42');
  assert.equal(body.inputs['staging-run-id'], '43');
  assert.equal('grep' in body.inputs, false);
  assert.equal('suite' in body.inputs, false);
});

test('phase E2E requires an active root and matching source provenance', () => {
  const parent = { status: 'in_progress', run_attempt: 1, path: '.github/workflows/main-staging-validation.yml', display_title: 'Staging validation · parent 12 · attempt 2 · source abc' };
  const jobs = [{ name: 'Validate: Lite', status: 'in_progress' }];
  const provenance = { sourceSha: 'abc', rootId: '12', rootAttempt: '2', root: { status: 'in_progress', run_attempt: 2, path: '.github/workflows/build-test-deploy.yml', head_sha: 'abc' }, rootJobs: [{ name: 'Staging validation', status: 'in_progress' }] };
  verifyParent(parent, '1', jobs, ['Validate: Lite'], provenance);
  assert.throws(() => verifyParent(parent, '1', jobs, ['Validate: Lite']), /root/);
  assert.throws(() => verifyParent(parent, '1', jobs, ['Validate: Lite'], { ...provenance, sourceSha: 'other' }), /source/);
  assert.throws(() => verifyParent(parent, '1', jobs, ['Validate: Lite'], { ...provenance, rootJobs: [] }), /active staging parent/);
  assert.throws(() => verifyParent(parent, '1', jobs, ['Validate: Lite'], { ...provenance, rootAttempt: '1' }), /active staging parent/);
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

test('root accepts a blocked daily gate only from its immutable draft producer', async () => {
  const { verifyDailyGate } = await import('./wait-for-e2e.mjs');
  const producer = { id: 43, path: '.github/workflows/main-draft-preparation.yml', display_title: 'Draft preparation · parent 12 · attempt 2 · source abc', status: 'completed', conclusion: 'failure', run_attempt: 1, event: 'workflow_dispatch', actor: { login: 'github-actions[bot]' } };
  const gate = { producer_run_id: '43', root_run_id: '12', root_attempt: '2', source_sha: 'abc', allowed: 'false', 'gate-reason': 'Latest daily regression failed' };
  assert.equal(verifyDailyGate(gate, producer, '12', '2', 'abc', '43')['gate-reason'], 'Latest daily regression failed');
  for (const patch of [{ producer_run_id: '44' }, { root_run_id: '13' }, { root_attempt: '1' }, { source_sha: 'other' }, { allowed: true }]) {
    assert.throws(() => verifyDailyGate({ ...gate, ...patch }, producer, '12', '2', 'abc', '43'), /does not match/);
  }
  for (const patch of [{ run_attempt: 2 }, { status: 'in_progress' }, { actor: { login: 'maintainer' } }, { display_title: producer.display_title.replace('attempt 2', 'attempt 1') }]) {
    assert.throws(() => verifyDailyGate(gate, { ...producer, ...patch }, '12', '2', 'abc', '43'), /does not match/);
  }
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

test('parent verification does not retry real provenance errors', async () => {
  let fetches = 0, pauses = 0;
  const state = () => {
    fetches++;
    return { ...retryState('in_progress', 'in_progress', { path: '.github/workflows/build-test-deploy.yml', head_sha: 'abc' }), provenance: { sourceSha: 'other' } };
  };
  await assert.rejects(verifyParentWithRetry(state, 6, async () => { pauses++; }), /source does not match/);
  assert.equal(fetches, 1);
  assert.equal(pauses, 0);
});

test('PR child rejects another PR or candidate despite an active parent', async () => {
  const { verifyPrProvenance } = await import('./wait-for-e2e.mjs');
  const source = 'a'.repeat(40), other = 'b'.repeat(40);
  const parent = { id: 12, path: '.github/workflows/pr-validation.yml' };
  const record = { run: '12', attempt: '2', pr: '42', candidate: source };
  verifyPrProvenance(record, parent, '12', '2', '42', source);
  for (const [run, attempt, pr, sha] of [['12','2','43',source], ['12','2','42',other], ['12','1','42',source], ['13','2','42',source]]) {
    assert.throws(() => verifyPrProvenance(record, parent, run, attempt, pr, sha), /staging parent provenance/);
  }
  assert.throws(() => verifyPrProvenance({}, parent, '12', '2', '42', source), /staging parent provenance/);
});
