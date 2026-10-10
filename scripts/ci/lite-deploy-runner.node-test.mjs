import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { runtimeEvidence } from './lite-deploy-evidence.mjs';

const deploy = yaml.load(await readFile(new URL('../../.github/workflows/staging-deploy.yml', import.meta.url), 'utf8'));
const benchmark = yaml.load(await readFile(new URL('../../.github/workflows/lite-deploy-benchmark.yml', import.meta.url), 'utf8'));
const action = yaml.load(await readFile(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8'));

test('actual resolver shell restricts ARM to opt-in Lite staging before deployment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-runner-test-'));
  let invocation = 0;
  try {
    const resolve = async overrides => {
      const output = join(directory, `${invocation++}.txt`);
      const result = spawnSync('bash', ['-c', deploy.jobs.resolve.steps[0].run], {
        env: { VARIANT: 'lite', IN_LICENSE: '', IN_PROJECT: '', IN_ENVIRONMENT: '', IN_RUNNER: '', PREPARATION_MODE: 'baseline', GITHUB_OUTPUT: output, ...overrides },
        encoding: 'utf8',
      });
      let values = '';
      try { values = await readFile(output, 'utf8'); } catch { /* rejected before output */ }
      return { status: result.status, values };
    };
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
      const result = await resolve({ VARIANT: variant });
      assert.equal(result.status, 0);
      assert.match(result.values, /runner=ubuntu-latest\n/);
    }
    const arm = { PREPARATION_MODE: 'candidate', IN_RUNNER: 'ubuntu-24.04-arm' };
    const accepted = await resolve(arm);
    assert.equal(accepted.status, 0);
    assert.match(accepted.values, /runner=ubuntu-24.04-arm\n/);
    for (const invalid of [
      { PREPARATION_MODE: 'baseline' }, { PREPARATION_MODE: '' },
      { VARIANT: 'full' }, { VARIANT: 'asyncapi' }, { VARIANT: 'diagramly' },
      { IN_LICENSE: 'full' }, { IN_PROJECT: 'conf-lite' },
      { IN_ENVIRONMENT: 'production-lite' }, { IN_RUNNER: 'self-hosted' },
      { IN_RUNNER: 'ubuntu-latest\nrunner=self-hosted' },
    ]) {
      const result = await resolve({ ...arm, ...invalid });
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
      assert.equal(result.values, '', 'invalid runner/scope must fail before publishing resolver output');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('benchmark hardware input affects only candidates and native legacy cache is excluded on ARM', () => {
  assert.equal(deploy.on.workflow_call.inputs['candidate-runner'].default, 'ubuntu-latest');
  assert.equal(deploy.jobs.deploy['runs-on'], '${{ needs.resolve.outputs.runner }}');
  assert.equal(deploy.jobs.resolve['runs-on'], 'ubuntu-latest');
  assert.deepEqual(benchmark.on.workflow_dispatch.inputs['candidate-runner'].options, ['ubuntu-latest', 'ubuntu-24.04-arm']);
  assert.equal(benchmark.on.workflow_dispatch.inputs['candidate-runner'].default, 'ubuntu-latest');
  for (const [name, job] of Object.entries(benchmark.jobs)) {
    if (name.startsWith('candidate-')) assert.equal(job.with['candidate-runner'], "${{ inputs.candidate-runner || 'ubuntu-latest' }}");
    else assert.equal(job.with?.['candidate-runner'], undefined);
  }
  const steps = deploy.jobs.deploy.steps;
  const lean = steps.find(step => step.id === 'studio-output');
  const legacy = steps.find(step => step.id === 'studio-legacy');
  assert.match(legacy.if, /runner.arch != 'ARM64'/);
  assert.equal(lean.with.path, 'static/asyncapi-studio');
  assert.equal(lean.with.key.includes('runner.arch'), false, 'static Studio output is shared across architectures');
  assert.match(action.runs.steps.find(step => step.id === 'installed-dependencies').with.key, /runner.arch/);
});

test('runtime evidence uses actual Node platform/architecture and a whitelisted runner label', () => {
  for (const runner_label of ['ubuntu-latest', 'ubuntu-24.04-arm']) {
    assert.deepEqual(runtimeEvidence(runner_label), { runner_label, platform: process.platform, arch: process.arch, node: process.version });
  }
  for (const label of ['self-hosted', 'secret-value', 'ubuntu-latest\nother', null]) assert.throws(() => runtimeEvidence(label), /Unsupported deployment runner label/);
  const step = deploy.jobs.deploy.steps.find(item => item.name === 'Verify benchmark deployment identity and record metadata');
  assert.equal(step.env.DEPLOY_RUNNER_LABEL, '${{ needs.resolve.outputs.runner }}');
});
