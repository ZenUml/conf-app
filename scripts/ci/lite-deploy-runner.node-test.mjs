import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { runtimeEvidence } from './lite-deploy-evidence.mjs';

const deploy = yaml.load(await readFile(new URL('../../.github/workflows/staging-deploy.yml', import.meta.url), 'utf8'));
const benchmark = yaml.load(await readFile(new URL('../../.github/workflows/lite-deploy-benchmark.yml', import.meta.url), 'utf8'));
const action = yaml.load(await readFile(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8'));

const current = 'a'.repeat(40), old = 'b'.repeat(40), explicit = 'c'.repeat(40);
async function withResolver(run) {
  const directory = await mkdtemp(join(tmpdir(), 'lite-runner-test-'));
  let invocation = 0;
  try {
    const resolve = async overrides => {
      const output = join(directory, `${invocation++}.txt`);
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', deploy.jobs.resolve.steps[0].run], {
        env: { VARIANT: 'lite', IN_LICENSE: '', IN_PROJECT: '', IN_ENVIRONMENT: '', IN_RUNNER: '', PREPARATION_MODE: '', IN_TOOLING_REF: '', APP_REF: current, WORKFLOW_SHA: current, GITHUB_OUTPUT: output, ...overrides },
        encoding: 'utf8',
      });
      let values = '';
      try { values = await readFile(output, 'utf8'); } catch { /* rejected before output */ }
      return { status: result.status, values, stderr: result.stderr, outputs: Object.fromEntries(values.trim().split('\n').filter(Boolean).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; })) };
    };
    await run(resolve);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('actual resolver automatically optimizes only exact Lite staging and supports baseline/hardware overrides', async () => {
  await withResolver(async resolve => {
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
      const result = await resolve({ VARIANT: variant });
      assert.equal(result.status, 0);
      assert.equal(result.outputs['preparation-mode'], variant === 'lite' ? 'candidate' : 'baseline');
      assert.equal(result.outputs.runner, variant === 'lite' ? 'ubuntu-24.04-arm' : 'ubuntu-latest');
      assert.equal(result.outputs['tooling-ref'], '');
      const rollback = await resolve({ VARIANT: variant, PREPARATION_MODE: 'baseline' });
      assert.equal(rollback.status, 0);
      assert.equal(rollback.outputs.runner, 'ubuntu-latest');
      assert.equal(rollback.outputs['preparation-mode'], 'baseline');
    }
    assert.equal((await resolve({ PREPARATION_MODE: 'candidate', IN_RUNNER: 'ubuntu-latest' })).outputs.runner, 'ubuntu-latest');
    for (const scope of [{ IN_LICENSE: 'full' }, { IN_PROJECT: 'conf-lite' }, { IN_ENVIRONMENT: 'production-lite' }]) {
      const ordinary = await resolve(scope);
      assert.equal(ordinary.status, 0);
      assert.equal(ordinary.outputs['preparation-mode'], 'baseline');
      assert.equal(ordinary.outputs.runner, 'ubuntu-latest');
    }
  });
});

test('invalid modes, hardware and explicit candidate scope fail before publishing any output', async () => {
  await withResolver(async resolve => {
    const arm = { PREPARATION_MODE: 'candidate', IN_RUNNER: 'ubuntu-24.04-arm' };
    const accepted = await resolve(arm);
    assert.equal(accepted.status, 0);
    assert.match(accepted.values, /runner=ubuntu-24.04-arm\n/);
    for (const invalid of [
      { PREPARATION_MODE: 'baseline' }, { PREPARATION_MODE: 'unknown' },
      { PREPARATION_MODE: 'candidate\nrunner=self-hosted' },
      { VARIANT: 'full' }, { VARIANT: 'asyncapi' }, { VARIANT: 'diagramly' },
      { IN_LICENSE: 'full' }, { IN_PROJECT: 'conf-lite' },
      { IN_ENVIRONMENT: 'production-lite' }, { IN_RUNNER: 'self-hosted' },
      { IN_RUNNER: 'ubuntu-latest\nrunner=self-hosted' },
    ]) {
      const result = await resolve({ ...arm, ...invalid });
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
      assert.equal(result.values, '', 'invalid runner/scope must fail before publishing resolver output');
    }
    for (const variant of ['full', 'diagramly', 'asyncapi']) {
      const result = await resolve({ VARIANT: variant, IN_RUNNER: 'ubuntu-24.04-arm' });
      assert.notEqual(result.status, 0);
      assert.equal(result.values, '');
    }
  });
});

test('all supplied resolver fields reject line delimiters before outputs and never echo the supplied value', async () => {
  await withResolver(async resolve => {
    for (const field of ['VARIANT', 'IN_LICENSE', 'IN_PROJECT', 'IN_ENVIRONMENT', 'IN_RUNNER', 'PREPARATION_MODE', 'IN_TOOLING_REF', 'APP_REF', 'WORKFLOW_SHA']) {
      for (const delimiter of ['\r', '\n']) {
        const result = await resolve({ [field]: `private-value${delimiter}runner=self-hosted${delimiter}preparation-mode=baseline` });
        assert.notEqual(result.status, 0, `${field} ${JSON.stringify(delimiter)}`);
        assert.equal(result.values, '');
        assert.equal(result.stderr, 'Invalid staging input delimiters\n');
      }
    }
  });
});

test('automatic overlay requires a full immutable SHA while explicit aliases and unused workflow refs remain compatible', async () => {
  await withResolver(async resolve => {
    for (const workflow of ['', 'main', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), 'refs/heads/main']) {
      const result = await resolve({ APP_REF: old, WORKFLOW_SHA: workflow });
      assert.notEqual(result.status, 0);
      assert.equal(result.values, '');
      assert.equal(result.stderr, 'Automatic deployment tooling requires an immutable Git SHA\n');
    }
    assert.equal((await resolve({ APP_REF: old, WORKFLOW_SHA: current.toUpperCase() })).outputs['tooling-ref'], current.toUpperCase());
    for (const alias of ['main', 'refs/heads/tooling-branch', 'release/1.2', 'v1.2.3']) {
      const result = await resolve({ APP_REF: 'app-branch', WORKFLOW_SHA: 'unused', IN_TOOLING_REF: alias });
      assert.equal(result.status, 0);
      assert.equal(result.outputs['tooling-ref'], alias);
    }
    assert.equal((await resolve({ PREPARATION_MODE: 'baseline', WORKFLOW_SHA: 'unused' })).status, 0);
    assert.equal((await resolve({ VARIANT: 'full', WORKFLOW_SHA: '' })).status, 0);
  });
});

test('main, PR, daily, rerun and manual defaults resolve safely for current and older app source', async () => {
  const main = yaml.load(await readFile(new URL('../../.github/workflows/main-staging-validation.yml', import.meta.url), 'utf8'));
  const pr = yaml.load(await readFile(new URL('../../.github/workflows/pr-validation.yml', import.meta.url), 'utf8'));
  const transaction = yaml.load(await readFile(new URL('../../.github/workflows/staging-transaction.yml', import.meta.url), 'utf8'));
  for (const caller of [main.jobs['staging-lite'], pr.jobs['staging-lite'], transaction.jobs.deploy]) {
    assert.equal(caller.with['preparation-mode'], undefined);
    assert.equal(caller.with['candidate-runner'], undefined);
  }
  assert.equal(transaction.jobs.deploy.with['workflow-ref'], '${{ inputs.workflow-ref }}');
  assert.deepEqual(Object.keys(deploy.on.workflow_dispatch.inputs), ['variant'], 'no extra manual controls are required');
  await withResolver(async resolve => {
    for (const caller of [main.jobs['staging-lite'], pr.jobs['staging-lite']]) for (const app of [current, old]) {
      const result = await resolve({ VARIANT: caller.with.variant, IN_LICENSE: caller.with.license, IN_PROJECT: caller.with.project,
        IN_ENVIRONMENT: caller.with.environment, APP_REF: app });
      assert.equal(result.status, 0);
      assert.equal(result.outputs['preparation-mode'], 'candidate');
      assert.equal(result.outputs.runner, 'ubuntu-24.04-arm');
      assert.equal(result.outputs['tooling-ref'], app === current ? '' : current, 'queued/recovered old source receives current immutable workflow tooling');
    }
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
      const daily = await resolve({ VARIANT: variant, IN_LICENSE: variant, IN_PROJECT: variant === 'full' ? 'conf-stg-full' : 'conf-stg-lite',
        IN_ENVIRONMENT: `staging-${variant}`, APP_REF: old, IN_TOOLING_REF: explicit });
      assert.equal(daily.status, 0);
      assert.equal(daily.outputs['tooling-ref'], explicit, 'daily explicit tooling pin must be honored for every product');
      assert.equal(daily.outputs['preparation-mode'], variant === 'lite' ? 'candidate' : 'baseline');
    }
    const manual = await resolve({ APP_REF: old });
    assert.equal(manual.outputs['tooling-ref'], current);
    const rollback = await resolve({ APP_REF: old, PREPARATION_MODE: 'baseline' });
    assert.equal(rollback.outputs['tooling-ref'], '', 'baseline retains its original no-overlay behavior');
    assert.equal((await resolve({ APP_REF: old, IN_TOOLING_REF: explicit })).outputs['tooling-ref'], explicit);
  });
});

test('every downstream branch consumes resolved mode and actual checkout provenance', () => {
  assert.equal(deploy.on.workflow_call.inputs['preparation-mode'].default, 'auto');
  assert.equal(JSON.stringify(deploy.jobs.deploy).includes('inputs.preparation-mode'), false);
  assert.equal(JSON.stringify(deploy.jobs.deploy).includes('inputs.candidate-runner'), false);
  const steps = deploy.jobs.deploy.steps;
  const checkout = steps.find(step => step.name === 'Checkout pinned workflow tooling');
  const copy = steps.find(step => step.name === 'Use pinned workflow deployment tooling');
  assert.equal(checkout.if, "needs.resolve.outputs.tooling-ref != ''");
  assert.equal(checkout.with.ref, '${{ needs.resolve.outputs.tooling-ref }}');
  assert.equal(copy.if, checkout.if);
  assert.equal(steps.find(step => step.uses === './.github/actions/wrangler-publish').with['preparation-mode'], '${{ needs.resolve.outputs.preparation-mode }}');
  const evidence = steps.find(step => step.name === 'Verify benchmark deployment identity and record metadata');
  assert.equal(evidence.env.TARGET_SHA, '${{ steps.provenance.outputs.app-sha }}');
  assert.equal(evidence.env.TOOLING_SHA, '${{ steps.provenance.outputs.tooling-sha }}');
  assert.equal(evidence.env.PREPARATION_MODE, '${{ needs.resolve.outputs.preparation-mode }}');
});

test('pinned candidate tooling fills an older source checkout and rejects missing runtime helpers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-tooling-copy-test-'));
  const copy = deploy.jobs.deploy.steps.find(step => step.name === 'Use pinned workflow deployment tooling');
  const helpers = ['lite-deploy-prepare.mjs', 'lite-deploy-evidence.mjs', 'lite-deploy-forge-timing.mjs', 'lite-deploy-permissions-cache.mjs', 'lite-deploy-studio-cache.mjs'];
  try {
    for (const path of ['.github/actions/wrangler-publish', 'scripts/ci', '.ci-workflow/.github/actions/wrangler-publish', '.ci-workflow/scripts/ci']) await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, '.ci-workflow/.github/actions/wrangler-publish/action.yml'), 'pinned deployment action');
    for (const helper of helpers) await writeFile(join(directory, '.ci-workflow/scripts/ci', helper), `pinned ${helper}`);
    const run = mode => spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', copy.run], { cwd: directory, env: { PREPARATION_MODE: mode, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(run('candidate').status, 0);
    for (const helper of helpers) assert.equal(await readFile(join(directory, 'scripts/ci', helper), 'utf8'), `pinned ${helper}`);
    await rm(join(directory, '.ci-workflow/scripts/ci', helpers.at(-1)));
    const missing = run('candidate');
    assert.notEqual(missing.status, 0);
    assert.equal(missing.stderr, 'Pinned candidate deployment tooling is incomplete\n');
    assert.equal(run('baseline').status, 0, 'baseline retains its earlier optional helper-copy behavior');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('deployment provenance resolves app/tooling aliases to their actual Git commit SHAs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-tooling-provenance-test-'));
  const step = deploy.jobs.deploy.steps.find(item => item.id === 'provenance');
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.status, 0);
    return result.stdout.trim();
  };
  try {
    const pins = [];
    for (const [path, alias] of [[directory, 'app-alias'], [join(directory, '.ci-workflow'), 'tool-alias']]) {
      await mkdir(path, { recursive: true }); git(path, 'init', '-q');
      await writeFile(join(path, 'source'), alias); git(path, 'add', 'source');
      git(path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'pin');
      git(path, 'tag', alias); pins.push(git(path, 'rev-parse', 'HEAD'));
    }
    for (const [toolingRef, toolingPin] of [['', pins[0]], ['tool-alias', pins[1]]]) {
      const output = join(directory, 'output'); await writeFile(output, '');
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', step.run], { cwd: directory,
        env: { TOOLING_REF: toolingRef, GITHUB_OUTPUT: output, PATH: process.env.PATH }, encoding: 'utf8' });
      assert.equal(result.status, 0);
      assert.equal(await readFile(output, 'utf8'), `app-sha=${pins[0]}\ntooling-sha=${toolingPin}\n`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ordinary deployment summary records resolved mode/runtime and only whitelisted cache booleans', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-deployment-summary-test-'));
  const step = deploy.jobs.deploy.steps.find(item => item.name === 'Write deployment summary');
  assert.equal(step.env.APP_SHA, '${{ steps.provenance.outputs.app-sha }}');
  assert.equal(step.env.TOOLING_SHA, '${{ steps.provenance.outputs.tooling-sha }}');
  try {
    await writeFile(join(directory, 'lite-deploy-cache.json'), JSON.stringify({ installed_dependencies_hit: true, pnpm_store_requested: false, pnpm_store_hit: 'must-not-emit', ignored: 'must-not-emit' }));
    await writeFile(join(directory, 'lite-deploy-studio-cache.json'), JSON.stringify({ studio_output_hit: true, studio_legacy_arm_output_valid: false }));
    const summary = join(directory, 'summary');
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', step.run.replaceAll('${{ needs.resolve.outputs.variant }}', 'lite')], {
      cwd: directory, encoding: 'utf8', env: { PATH: dirname(process.execPath), GITHUB_STEP_SUMMARY: summary,
        PREPARATION_MODE: 'candidate', DEPLOY_RUNNER_LABEL: 'ubuntu-24.04-arm', APP_SHA: current, TOOLING_SHA: explicit },
    });
    assert.equal(result.status, 0);
    const audit = JSON.parse(result.stdout);
    assert.equal(audit.mode, 'candidate'); assert.equal(audit.runner, 'ubuntu-24.04-arm');
    assert.equal(audit.arch, process.arch); assert.equal(audit.node, process.version);
    assert.equal(audit.pnpm_store_requested, false); assert.equal(audit.pnpm_store_hit, null);
    const content = await readFile(summary, 'utf8');
    assert.match(content, /Preparation \| candidate/); assert.match(content, new RegExp(current)); assert.match(content, new RegExp(explicit));
    assert.equal((result.stdout + content).includes('must-not-emit'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('benchmark hardware input affects only candidates and ARM legacy dependencies are sanitized before use', () => {
  assert.equal(deploy.on.workflow_call.inputs['candidate-runner'].default, 'auto');
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
  const arm = steps.find(step => step.id === 'studio-legacy-arm');
  const sanitize = steps.find(step => step.name === 'Remove legacy Studio dependencies and validate ARM static seed');
  assert.equal(arm.if, "needs.resolve.outputs.preparation-mode == 'candidate' && runner.arch == 'ARM64' && steps.studio-output.outputs.cache-hit != 'true'");
  assert.equal(arm.with.path, legacy.with.path);
  assert.equal(arm.with.key, legacy.with.key);
  assert.equal(arm.with['restore-keys'], undefined);
  assert.equal(sanitize.if, arm.if);
  assert.equal(sanitize.env.LEGACY_CACHE_HIT, '${{ steps.studio-legacy-arm.outputs.cache-hit }}');
  assert.equal(sanitize.env.STUDIO_PIN, '${{ steps.studio-sha.outputs.sha }}');
  assert.equal(steps.indexOf(sanitize), steps.indexOf(arm) + 1, 'cleanup must be immediate after restore');
  assert.ok(steps.indexOf(sanitize) < steps.findIndex(step => step.uses === './.github/actions/wrangler-publish'));
  assert.match(steps.find(step => step.name === 'Use pinned workflow deployment tooling').run, /lite-deploy-studio-cache\.mjs/);
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
