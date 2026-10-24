import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir, arch } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const action = yaml.load(await readFile(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8'));
const steps = action.runs.steps;
const installed = steps.find(step => step.id === 'installed-dependencies');
const resolve = steps.find(step => step.id === 'pnpm-store-path');
const store = steps.find(step => step.id === 'pnpm-store');

test('candidate store restore/save runs only after an installed-tree miss; frozen install always runs', () => {
  const baseline = steps.find(step => step.uses === 'actions/setup-node@v5' && step.with.cache === 'pnpm');
  const candidate = steps.find(step => step.name === 'Setup candidate Node without duplicate store cache');
  assert.equal(baseline.if, "inputs.preparation-mode != 'candidate'");
  assert.deepEqual(baseline.with, { 'node-version': '${{ inputs.node-version }}', cache: 'pnpm' });
  assert.equal(candidate.if, "inputs.preparation-mode == 'candidate'");
  assert.equal(candidate.with.cache, undefined);
  assert.equal(candidate.with['package-manager-cache'], false);
  const condition = "inputs.preparation-mode == 'candidate' && steps.installed-dependencies.outputs.cache-hit != 'true'";
  assert.equal(resolve.if, condition);
  assert.equal(store.if, condition);
  assert.ok(steps.indexOf(installed) < steps.indexOf(resolve));
  assert.equal(steps.indexOf(store), steps.indexOf(resolve) + 1);
  const install = steps.find(step => step.name === 'Install dependencies');
  assert.ok(steps.indexOf(store) < steps.indexOf(install));
  assert.equal(install.if, undefined, 'no cache state may skip the frozen workspace install');
  assert.equal(install.run, 'pnpm install --frozen-lockfile --ignore-scripts');
  assert.equal(store.uses, 'actions/cache@v5', 'restore/save share one conditional action invocation');
  assert.equal(store.with['restore-keys'], undefined);
  assert.equal(store.with['save-always'], undefined, 'default successful-job-only cache save is retained');
});

async function runResolver({ path = '/tmp/pnpm store/v10', hash = 'a'.repeat(64), platform = 'Linux', failure = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lite-dependency-cache-test-'));
  try {
    const executable = join(directory, 'pnpm');
    await writeFile(executable, `#!${process.execPath}
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['store','path','--silent'])) process.exit(99);
if (process.env.FAKE_FAILURE === 'true') { console.error('private command error must not escape'); process.exit(1); }
process.stdout.write(process.env.FAKE_STORE);
`);
    await chmod(executable, 0o755);
    const output = join(directory, 'output');
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', resolve.run], { encoding: 'utf8',
      env: { PATH: `${directory}:${dirname(process.execPath)}`, GITHUB_OUTPUT: output, RUNNER_OS: platform, CACHE_LOCK_HASH: hash, FAKE_STORE: path, FAKE_FAILURE: String(failure) } });
    let values = '';
    try { values = await readFile(output, 'utf8'); } catch { /* failure must not publish output */ }
    return { status: result.status, values, stdout: result.stdout, stderr: result.stderr };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('actual resolver preserves setup-node v5 store path/cache version inputs and lowercase Node architecture key', async () => {
  const path = '/tmp/pnpm store/v10';
  const hash = 'a'.repeat(64);
  const result = await runResolver({ path, hash });
  assert.equal(result.status, 0);
  assert.equal(result.values, `path=${path}\nkey=node-cache-Linux-${arch()}-pnpm-${hash}\n`);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(resolve.env.CACHE_LOCK_HASH, "${{ hashFiles('pnpm-lock.yaml') }}");
  assert.equal(store.with.path, '${{ steps.pnpm-store-path.outputs.path }}');
  assert.equal(store.with.key, '${{ steps.pnpm-store-path.outputs.key }}');
  // setup-node v5 uses [pnpm store path --silent] with default compression/
  // cross-OS settings; identical path metadata gives its existing cache version.
  assert.equal(store.with.enableCrossOsArchive, undefined);
  assert.equal(Object.keys(store.with).length, 2, 'no extra paths may change the legacy archive version');
  const changed = await runResolver({ path, hash: 'b'.repeat(64) });
  assert.notEqual(changed.values, result.values, 'a lockfile change must select a different store cache');
  assert.equal(result.values.includes('ARM64'), false, 'runner.arch casing must not replace os.arch()');
});

test('store resolution rejects empty/relative/multiline paths, invalid keys and command failures without exposing errors', async () => {
  for (const options of [{ path: '' }, { path: 'relative/store' }, { path: '/tmp/store\nkey=other' }, { hash: '' }, { hash: 'a'.repeat(64) + '\nother' }, { platform: 'Linux\nother' }, { failure: true }]) {
    const result = await runResolver(options);
    assert.notEqual(result.status, 0);
    assert.equal(result.values, '');
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Unable to resolve pnpm store cache\n');
  }
});

test('candidate cache evidence distinguishes skipped store restore from attempted miss using booleans only', async () => {
  const record = steps.find(step => step.name === 'Record dependency cache result');
  assert.equal(record.env.STORE_CACHE_HIT, '${{ steps.pnpm-store.outputs.cache-hit }}');
  const directory = await mkdtemp(join(tmpdir(), 'lite-dependency-evidence-test-'));
  try {
    for (const [installedHit, storeHit, expected] of [
      ['true', '', { installed_dependencies_hit: true, pnpm_store_requested: false, pnpm_store_hit: false }],
      ['false', 'true', { installed_dependencies_hit: false, pnpm_store_requested: true, pnpm_store_hit: true }],
      ['', '', { installed_dependencies_hit: false, pnpm_store_requested: true, pnpm_store_hit: false }],
    ]) {
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', record.run], { cwd: directory, encoding: 'utf8',
        env: { PATH: dirname(process.execPath), CACHE_HIT: installedHit, STORE_CACHE_HIT: storeHit } });
      assert.equal(result.status, 0);
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'lite-deploy-cache.json'), 'utf8')), expected);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
