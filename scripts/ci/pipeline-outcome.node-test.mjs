import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { evaluateOutcome } from './pipeline-outcome.mjs';

const ok = { result: 'success' };
const skipped = { result: 'skipped' };
const healthy = () => ({
  gate: ok, build: ok, 'staging-lite': ok, select: ok, 'e2e-auth-lite': ok,
  'preview-e2e': ok, 'export-e2e': ok, 'pr-e2e-validation': ok,
});
// What a PR sees while the trusted controller is not yet on the default branch.
const bootstrapping = () => ({
  ...healthy(), select: { result: 'failure' },
  'e2e-auth-lite': skipped, 'preview-e2e': skipped, 'export-e2e': skipped, 'pr-e2e-validation': skipped,
});

test('a fully successful pipeline passes', () => {
  assert.deepEqual(evaluateOutcome(healthy(), 'present'), { pass: true, bootstrap: false });
});

test('a failed selection fails when the controller is already on the default branch', () => {
  assert.equal(evaluateOutcome(bootstrapping(), 'present').pass, false);
});

test('bootstrap passes only when the controller is verifiably absent, and says so', () => {
  assert.deepEqual(evaluateOutcome(bootstrapping(), 'absent'), { pass: true, bootstrap: true });
});

test('an unknown controller state fails closed', () => {
  for (const state of ['unknown', '', undefined, 'ABSENT', 'absent '])
    assert.equal(evaluateOutcome(bootstrapping(), state).pass, false, String(state));
});

test('bootstrap never forgives a real failure or any executed E2E stage', () => {
  for (const job of ['build', 'staging-lite', 'gate'])
    for (const result of ['failure', 'cancelled', 'skipped'])
      assert.equal(evaluateOutcome({ ...bootstrapping(), [job]: { result } }, 'absent').pass, false, `${job} ${result}`);
  for (const job of ['e2e-auth-lite', 'preview-e2e', 'export-e2e', 'pr-e2e-validation'])
    for (const result of ['success', 'failure', 'cancelled'])
      assert.equal(evaluateOutcome({ ...bootstrapping(), [job]: { result } }, 'absent').pass, false, `${job} ${result}`);
});

test('bootstrap needs the selection itself to have failed, not been cancelled or skipped', () => {
  for (const result of ['cancelled', 'skipped'])
    assert.equal(evaluateOutcome({ ...bootstrapping(), select: { result } }, 'absent').pass, false, result);
});

test('the workflow derives controller state from the default branch, never from the candidate files', async () => {
  const pr = yaml.load(await readFile(new URL('../../.github/workflows/pr-validation.yml', import.meta.url), 'utf8'));
  const text = JSON.stringify(pr.jobs['pr-pipeline-outcome']);
  assert.match(text, /contents\/scripts\/test-selection\/pr-decision\.mjs\?ref=\$DEFAULT_BRANCH/);
  assert.match(text, /HTTP 404/);
  assert.match(text, /pipeline-outcome\.mjs/);
  const probe = pr.jobs['pr-pipeline-outcome'].steps.find(step => step.id === 'controller');
  assert.doesNotMatch(JSON.stringify(probe), /candidate/);
  assert.equal(pr.jobs['pr-pipeline-outcome'].permissions, undefined); // workflow default: read-only
});
