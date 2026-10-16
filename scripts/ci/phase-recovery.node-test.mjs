import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expandPhaseFailures } from './phase-recovery.mjs';
import { largeRunListing, withFakeGh } from './fake-gh.mjs';

const root = { id: 12, run_attempt: 1, head_sha: 'abc' };
const phase = { id: 42, display_title: 'Staging validation · parent 12 · attempt 1 · source abc', status: 'completed', run_attempt: 1 };
const api = (runs, failures) => path => path.includes('/runs?') ? { workflow_runs: runs } : { jobs: failures.map(name => ({ name, conclusion: 'failure' })) };

test('recovery inspects phase failures rather than treating deployments as E2E', () => {
  assert.deepEqual(expandPhaseFailures(['Staging validation', 'Pipeline outcome'], root, api([phase], ['Deploy: Lite / deploy'])), ['Deploy: Lite / deploy', 'Pipeline outcome']);
  assert.deepEqual(expandPhaseFailures(['Staging validation'], root, api([phase], ['Validate: Lite'])), ['Validate: Lite']);
});

test('recovery rejects missing, ambiguous, running and rerun phase producers', () => {
  for (const runs of [[], [phase, phase], [{ ...phase, status: 'in_progress' }], [{ ...phase, run_attempt: 2 }], [{ ...phase, display_title: phase.display_title.replace('abc', 'other') }]]) {
    assert.deepEqual(expandPhaseFailures(['Staging validation'], root, api(runs, ['Validate: Lite'])), ['Unverified phase failure']);
  }
});

test('recovery preserves build and draft failures as blockers', () => {
  // No draft child run is available here, so Draft preparation cannot be shown to be a
  // consequence of an E2E failure. It stays a blocker, now as an unverified phase.
  assert.deepEqual(expandPhaseFailures(['Draft preparation', 'Build preparation'], root, api([{ ...phase, display_title: phase.display_title.replace('Staging validation', 'Build preparation') }], ['Build and Unit Test'])), ['Unverified phase failure', 'Build and Unit Test']);
});

test('recovery CLI reads a phase run listing larger than the default 1 MiB buffer', async () => {
  const title = 'Staging validation · parent 12 · attempt 1 · source abc';
  const routes = {
    '/runs?': largeRunListing({ id: 42, display_title: title }),
    '/jobs': JSON.stringify({ jobs: [{ name: 'Validate: Lite', conclusion: 'failure' }] }),
    'actions/runs/12': JSON.stringify(root),
  };
  await withFakeGh(routes, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./phase-recovery.mjs', import.meta.url))], {
      encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'example/repo', RUN_ID: '12', FAILED: '["Staging validation"]' },
    });
    assert.equal(result.status, 0, result.stderr.slice(0, 400));
    assert.deepEqual(JSON.parse(result.stdout), ['Validate: Lite']);
  });
});

// The whitelist production recovery applies to the expanded list. Parse the jq string
// literal out of the workflow, as tests/unit/testSelectionWorkflow.spec.ts does, so the
// examples below exercise the real rule rather than a second copy of it.
const rerunWorkflow = readFileSync(new URL('../../.github/workflows/e2e-rerun.yml', import.meta.url), 'utf8');
const whitelist = new RegExp(JSON.parse(rerunWorkflow.match(/select\(test\(("(?:[^"\\]|\\.)*")\)/)[1]));
const canRecover = names => names.length > 0 && names.every(name => whitelist.test(name));

// A root run whose Staging validation and Draft preparation phases each have one child run.
const stagingRun = phase;
const draftRun = { ...phase, id: 43, display_title: 'Draft preparation · parent 12 · attempt 1 · source abc' };
const jobsOf = rows => rows.map(([name, conclusion]) => ({ name, conclusion }));
const pipeline = ({ staging, draft, draftRuns = [draftRun] }) => path => {
  const listing = path.match(/^actions\/workflows\/(.+)\/runs\?/);
  if (listing) return { workflow_runs: { 'main-staging-validation.yml': [stagingRun], 'main-draft-preparation.yml': draftRuns }[listing[1]] ?? [] };
  const jobs = path.match(/^actions\/runs\/(\d+)\/attempts\/1\/jobs/);
  if (jobs) return { jobs: jobsOf({ 42: staging, 43: draft }[jobs[1]]) };
  throw new Error(`unexpected api call: ${path}`);
};
const rootFailures = ['Staging validation', 'Draft preparation', 'Pipeline outcome'];

// Main run 38745939051, attempt 1: a slash-menu flake failed the Full and Diagramly validators.
const stagingWithFullAndDiagramlyRed = [
  ['Verify root ownership', 'success'], ['Shared staging D1 migrations', 'success'],
  ['E2E auth: Full / auth bootstrap', 'success'], ['E2E auth: Lite / auth bootstrap', 'success'],
  ['E2E auth: Diagramly / auth bootstrap', 'success'], ['E2E auth: AsyncAPI / auth bootstrap', 'success'],
  ['Deploy: Full / deploy', 'success'], ['Deploy: Lite / deploy', 'success'],
  ['Deploy: Diagramly / deploy', 'success'], ['Deploy: AsyncAPI / deploy', 'success'],
  ['Validate: Lite', 'success'], ['Validate: AsyncAPI', 'success'],
  ['Validate: Full', 'failure'], ['Validate: Diagramly', 'failure'], ['Record variant validation results', 'success'],
];
const draftSkippedForFullAndDiagramly = [
  ['Verify root ownership', 'success'], ['Resolve variant draft eligibility', 'success'],
  ['Draft: Lite', 'success'], ['Draft: AsyncAPI', 'success'],
  ['Draft: Diagramly', 'skipped'], ['Draft: Full', 'skipped'], ['Draft gate outcome', 'failure'],
];

test('recovery re-runs a root whose only real failures are E2E validations and the drafts they skipped', () => {
  const notes = [];
  const expanded = expandPhaseFailures(rootFailures, root, pipeline({ staging: stagingWithFullAndDiagramlyRed, draft: draftSkippedForFullAndDiagramly }), note => notes.push(note));
  assert.equal(canRecover(expanded), true, `would not re-run: ${JSON.stringify(expanded)}`);
  assert.deepEqual(expanded, ['Validate: Full', 'Validate: Diagramly', 'Pipeline outcome']);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Draft: Diagramly, Draft: Full skipped because the E2E validation of full, diagramly failed/);
});

test('recovery explains a skipped draft by a failed auth bootstrap, which skips that variant validation', () => {
  const staging = stagingWithFullAndDiagramlyRed.map(([name, conclusion]) =>
    name === 'E2E auth: Full / auth bootstrap' ? [name, 'failure'] : name === 'Validate: Full' ? [name, 'skipped'] : name === 'Validate: Diagramly' ? [name, 'success'] : [name, conclusion]);
  const draft = draftSkippedForFullAndDiagramly.map(([name, conclusion]) => name === 'Draft: Diagramly' ? [name, 'success'] : [name, conclusion]);
  const expanded = expandPhaseFailures(rootFailures, root, pipeline({ staging, draft }));
  assert.deepEqual(expanded, ['E2E auth: Full / auth bootstrap', 'Pipeline outcome']);
  assert.equal(canRecover(expanded), true);
});

test('recovery still refuses when a draft failed for a reason other than a failed E2E validation', () => {
  const draftRow = (name, conclusion) => draftSkippedForFullAndDiagramly.map(row => row[0] === name ? [name, conclusion] : row);
  const notValidated = name => `${name} (skipped although its validation did not fail)`;
  const cases = [
    ['a draft job that really failed', draftRow('Draft: Lite', 'failure'), ['Draft: Lite']],
    ['root ownership that failed', draftRow('Verify root ownership', 'failure'), ['Verify root ownership']],
    ['eligibility that failed to resolve', draftRow('Resolve variant draft eligibility', 'failure'), ['Resolve variant draft eligibility']],
    ['a draft job that was cancelled', draftRow('Draft: AsyncAPI', 'cancelled'), ['Unverified phase failure']],
    ['a draft skipped although its validation passed', draftRow('Draft: Lite', 'skipped'), [notValidated('Draft: Lite')]],
    // The daily regression gate skips all four drafts whatever the E2E results were; the
    // two variants whose validation passed show that this is not an E2E failure.
    ['a closed daily gate', draftSkippedForFullAndDiagramly.map(([name, conclusion]) => [name, name.startsWith('Draft: ') ? 'skipped' : conclusion]),
      [notValidated('Draft: Lite'), notValidated('Draft: AsyncAPI')]],
    ['skipped drafts although the gate did not fail', draftRow('Draft gate outcome', 'success'), ['Unverified phase failure']],
    ['a gate failure with nothing to explain it', draftSkippedForFullAndDiagramly.map(([name, conclusion]) => [name, name.startsWith('Draft: ') ? 'success' : conclusion]), ['Unverified phase failure']],
  ];
  for (const [reason, draft, blockers] of cases) {
    const expanded = expandPhaseFailures(rootFailures, root, pipeline({ staging: stagingWithFullAndDiagramlyRed, draft }));
    assert.deepEqual(expanded, ['Validate: Full', 'Validate: Diagramly', ...blockers, 'Pipeline outcome'], reason);
    assert.equal(canRecover(expanded), false, reason);
  }
});

test('recovery does not excuse a draft skipped by a failed build or migration', () => {
  // Nothing in the staging child failed at E2E level, so no skipped draft has an excuse.
  const staging = stagingWithFullAndDiagramlyRed.map(([name, conclusion]) => [name, name.startsWith('Validate: ') ? 'success' : name === 'Shared staging D1 migrations' ? 'failure' : conclusion]);
  const expanded = expandPhaseFailures(rootFailures, root, pipeline({ staging, draft: draftSkippedForFullAndDiagramly }));
  assert.equal(canRecover(expanded), false, JSON.stringify(expanded));
  assert.ok(expanded.includes('Shared staging D1 migrations'));
  assert.ok(expanded.includes('Draft: Full (skipped although its validation did not fail)'), JSON.stringify(expanded));
});

test('recovery refuses when the draft phase run is missing, ambiguous, running or already rerun', () => {
  for (const draftRuns of [[], [draftRun, draftRun], [{ ...draftRun, status: 'in_progress' }], [{ ...draftRun, run_attempt: 2 }]]) {
    const expanded = expandPhaseFailures(rootFailures, root, pipeline({ staging: stagingWithFullAndDiagramlyRed, draft: draftSkippedForFullAndDiagramly, draftRuns }));
    assert.equal(canRecover(expanded), false, JSON.stringify(expanded));
  }
});

test('recovery CLI prints the E2E-only list for the observed draft cascade', async () => {
  const listing = run => JSON.stringify({ workflow_runs: [run] });
  const routes = {
    'workflows/main-staging-validation.yml/runs': listing(stagingRun),
    'workflows/main-draft-preparation.yml/runs': listing(draftRun),
    '/runs/42/attempts/1/jobs': JSON.stringify({ jobs: jobsOf(stagingWithFullAndDiagramlyRed) }),
    '/runs/43/attempts/1/jobs': JSON.stringify({ jobs: jobsOf(draftSkippedForFullAndDiagramly) }),
    'actions/runs/12': JSON.stringify(root),
  };
  await withFakeGh(routes, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./phase-recovery.mjs', import.meta.url))], {
      encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'example/repo', RUN_ID: '12', FAILED: JSON.stringify(rootFailures) },
    });
    assert.equal(result.status, 0, result.stderr.slice(0, 400));
    assert.deepEqual(JSON.parse(result.stdout), ['Validate: Full', 'Validate: Diagramly', 'Pipeline outcome']);
  });
});
