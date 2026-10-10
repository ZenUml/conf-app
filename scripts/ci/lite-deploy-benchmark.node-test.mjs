import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { runParallel } from './lite-deploy-prepare.mjs';
import { summarize } from './lite-deploy-report.mjs';
import { phaseForLine } from './lite-deploy-forge-timing.mjs';

const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/lite-deploy-benchmark.yml', import.meta.url), 'utf8'));
const deploy = yaml.load(readFileSync(new URL('../../.github/workflows/staging-deploy.yml', import.meta.url), 'utf8'));
const action = yaml.load(readFileSync(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8'));

test('parallel preparation joins pending writes after another branch fails', async () => {
  let complete = false;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const joined = runParallel([async () => { throw new Error('build failed'); }, async () => { await pending; complete = true; }]);
  await Promise.resolve();
  assert.equal(complete, false);
  release();
  await assert.rejects(joined, /build failed/);
  assert.equal(complete, true);
});

test('benchmark retains shared staging lock and sequential, pinned alternating arms', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.concurrency.group, 'conf-app-staging');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const sequence = ['baseline-1', 'candidate-1', 'candidate-2', 'baseline-2', 'baseline-3', 'candidate-3'];
  sequence.forEach((sample, index) => {
    const job = workflow.jobs[sample];
    assert.ok([job.needs].flat().includes(index ? sequence[index - 1] : 'migrations'));
    assert.equal(job.with.ref, '${{ needs.target.outputs.sha }}');
    assert.equal(job.with['workflow-ref'], '${{ needs.target.outputs.tooling-sha }}');
    assert.equal(job.with['skip-migrations'], true);
    assert.equal(job.with['benchmark-sample'], sample);
  });
  assert.equal(workflow.jobs.smoke, undefined);
  assert.equal(workflow.jobs.report.needs.includes('smoke'), false);
  assert.equal(JSON.stringify(workflow).includes('e2e-test.yml'), false);
  assert.equal(JSON.stringify(workflow).includes('e2e-auth.yml'), false);
  assert.equal(JSON.stringify(workflow).includes('playwright'), false);
  assert.equal(deploy.on.workflow_call.inputs['preparation-mode'].default, 'baseline');
  assert.match(deploy.concurrency.group, /staging-inner/);
  assert.equal(action.inputs['preparation-mode'].default, 'baseline');
  assert.match(action.runs.steps.find(step => step.name === 'Install dependencies').run, /--frozen-lockfile --ignore-scripts/);
  assert.equal(action.runs.steps.find(step => step.name === 'Cache installed dependencies (Lite staging experiment)').with.path, 'node_modules');
  assert.equal(deploy.jobs.deploy.steps.find(step => step.id === 'studio-output').with.path, 'static/asyncapi-studio');
  assert.equal(action.runs.steps.some(step => step.with?.path === 'dist'), false);
});

test('every benchmark sample requires successful Lite install or upgrade', () => {
  const install = deploy.jobs.deploy.steps.find(step => step.name === 'Install Lite to lite-stg.atlassian.net');
  assert.equal(install['continue-on-error'], "${{ inputs.benchmark-sample == '' }}");
  assert.equal(install.run, 'pnpm forge:install:lite:staging || pnpm forge:upgrade:lite:staging');
});

test('Studio fallback restores the original aggregate cache version before seeding lean output', () => {
  const steps = deploy.jobs.deploy.steps;
  const baseline = steps.find(step => step.name === 'Cache asyncapi Studio build');
  const lean = steps.find(step => step.id === 'studio-output');
  const legacy = steps.find(step => step.id === 'studio-legacy');
  assert.ok(legacy, 'different cache path lists require separate legacy restore');
  assert.equal(lean.with['restore-keys'], undefined, 'lean cache must not claim aggregate-version fallback');
  assert.equal(legacy.uses, 'actions/cache/restore@v5');
  assert.equal(legacy.with.path, baseline.with.path, 'cache version uses the original path metadata');
  assert.equal(legacy.with.key, baseline.with.key);
  assert.equal(legacy.with['restore-keys'], baseline.with['restore-keys']);
  assert.equal(legacy.if, "inputs.preparation-mode == 'candidate' && steps.studio-output.outputs.cache-hit != 'true'");
  assert.ok(steps.indexOf(lean) < steps.indexOf(legacy));
  assert.ok(steps.indexOf(legacy) < steps.findIndex(step => step.uses === './.github/actions/wrangler-publish'));
  assert.equal(lean.uses, 'actions/cache@v5', 'lean output is saved by the successful job post step');
});

function fixture(pairs = 3, candidateMs = 70000) {
  const jobs = [], evidence = [];
  for (let pair = 1; pair <= pairs; pair++) for (const mode of ['baseline', 'candidate']) {
    const sample = `${mode}-${pair}`;
    const duration = mode === 'baseline' ? 100000 : candidateMs;
    jobs.push({ id: jobs.length + 1, name: `${sample} / deploy`, conclusion: 'success', started_at: new Date(0).toISOString(), completed_at: new Date(duration).toISOString() });
    evidence.push({ sample, mode, source_sha: 'source', tooling_sha: 'tooling', manifest_sha256: 'manifest', assets_sha256: 'assets', backend_marker_verified: true, deployment_completed_at: new Date(duration - 5000).toISOString(), forge_attempts: [{ exit_code: 0 }] });
  }
  return [jobs, evidence, pairs];
}
test('accepts only three complete matched clean pairs and uses whole job median', () => {
  const result = summarize(...fixture());
  assert.equal(result.reduction_fraction, 0.30000000000000004);
  assert.equal(result.target_met, true);
  assert.equal(summarize(...fixture(1)).target_met, false);
  assert.equal(summarize(...fixture(3, 81000)).target_met, false);
});
test('rejects unequal assets, manifests and missing marker evidence', () => {
  for (const key of ['source_sha', 'tooling_sha', 'manifest_sha256', 'assets_sha256']) {
    const data = fixture(); data[1][0][key] = 'different';
    assert.throws(() => summarize(...data), new RegExp(key));
  }
  const data = fixture(); data[1][0].backend_marker_verified = false;
  assert.throws(() => summarize(...data), /successful verified/);
});
test('retry-driven faster median cannot establish the 20% goal', () => {
  const data = fixture(); data[1][0].forge_attempts.push({ exit_code: 0 });
  const result = summarize(...data);
  assert.equal(result.retries_present, true);
  assert.equal(result.target_met, false);
});
test('phase parser retains only fixed names, ignoring signed URLs and resource paths', () => {
  assert.equal(phaseForLine('Running forge lint...'), 'lint');
  assert.equal(phaseForLine('  Packaging bundled files'), 'resource_archive');
  assert.equal(phaseForLine('Uploading archive to https://example.invalid/?secret=value'), null);
  assert.equal(phaseForLine('Added archive content "private-path"'), null);
});

test('candidate cannot prepare production and always reports all branch failures', async () => {
  const { mkdtemp, writeFile, readFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'lite-prepare-test-'));
  try {
    const executable = join(directory, 'pnpm');
    await writeFile(executable, '#!/bin/sh\nif [ "$1" = build:lite ]; then exit 7; fi\ncat >/dev/null\nexit 0\n');
    await chmod(executable, 0o755);
    await writeFile(join(directory, 'wrangler-stg.toml'), 'name="conf-stg"\n[vars]\n');
    const run = environment => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [new URL('./lite-deploy-prepare.mjs', import.meta.url).pathname], { cwd: directory, env: { PATH: directory, DEPLOY_LICENSE: 'lite', DEPLOY_PROJECT: 'conf-stg-lite', DEPLOY_ENVIRONMENT: environment, VITE_MIXPANEL_TOKEN: 'public-test-token', SENTRY_DSN: 'public-test-dsn' }, stdio: 'ignore' });
      child.once('error', reject); child.once('close', resolve);
    });
    assert.equal(await run('prod'), 1);
    await assert.rejects(readFile(join(directory, 'wrangler.toml')));
    assert.equal(await run('stg'), 1);
    const evidence = JSON.parse(await readFile(join(directory, 'lite-deploy-preparation.json'), 'utf8'));
    assert.equal(evidence.build.outcome, 'failure');
    assert.equal(evidence.pages_configuration_and_migrations.outcome, 'success');
    assert.equal(evidence.forge_configuration.outcome, 'success');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
