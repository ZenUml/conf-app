import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPhaseFailures } from './phase-recovery.mjs';

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
  assert.deepEqual(expandPhaseFailures(['Draft preparation', 'Build preparation'], root, api([{ ...phase, display_title: phase.display_title.replace('Staging validation', 'Build preparation') }], ['Build and Unit Test'])), ['Draft preparation', 'Build and Unit Test']);
});
