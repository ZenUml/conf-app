import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const deploy = yaml.load(await readFile(new URL('../../.github/workflows/staging-deploy.yml', import.meta.url), 'utf8'));
const install = deploy.jobs.deploy.steps.find(step => step.name === 'Install Lite to lite-stg.atlassian.net');

// Execute the actual workflow shell against a persistent installation state.
// The fake commands model Forge's existing-install conflict, missing upgrade
// context, successful/already-current upgrade and remote-operation failures.
async function lifecycle({ mode = 'candidate', initial = 'old', upgradeFailure = false, installFailure = false }) {
  const directory = await mkdtemp(join(tmpdir(), 'lite-install-lifecycle-'));
  try {
    const state = join(directory, 'state.json');
    const calls = join(directory, 'calls.jsonl');
    await writeFile(state, JSON.stringify({ installation: initial }));
    const executable = join(directory, 'pnpm');
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const command = process.argv[2];
const state = JSON.parse(fs.readFileSync(process.env.STATE, 'utf8'));
fs.appendFileSync(process.env.CALLS, JSON.stringify({command, before: state.installation})+'\\n');
if (command === 'forge:upgrade:lite:staging') {
  if (state.installation === 'absent' || process.env.UPGRADE_FAILURE === 'true') process.exit(1);
} else if (command === 'forge:install:lite:staging') {
  if (state.installation !== 'absent' || process.env.INSTALL_FAILURE === 'true') process.exit(1);
} else process.exit(99);
state.installation = 'latest';
fs.writeFileSync(process.env.STATE, JSON.stringify(state));
`);
    await chmod(executable, 0o755);
    const result = spawnSync('/bin/bash', ['-e', '-c', install.run], {
      env: { PATH: directory, PREPARATION_MODE: mode, STATE: state, CALLS: calls, UPGRADE_FAILURE: String(upgradeFailure), INSTALL_FAILURE: String(installFailure) },
      encoding: 'utf8',
    });
    return { status: result.status, state: JSON.parse(await readFile(state, 'utf8')).installation,
      calls: (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line).command) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('candidate upgrades an existing installation directly and accepts already-current success', async () => {
  for (const initial of ['old', 'latest']) {
    assert.deepEqual(await lifecycle({ initial }), { status: 0, state: 'latest', calls: ['forge:upgrade:lite:staging'] });
  }
});

test('candidate installs a new site after the expected missing-upgrade-context failure', async () => {
  assert.deepEqual(await lifecycle({ initial: 'absent' }), { status: 0, state: 'latest', calls: ['forge:upgrade:lite:staging', 'forge:install:lite:staging'] });
});

test('failed existing upgrade cannot qualify through an unsuccessful duplicate install', async () => {
  assert.deepEqual(await lifecycle({ upgradeFailure: true }), { status: 1, state: 'old', calls: ['forge:upgrade:lite:staging', 'forge:install:lite:staging'] });
});

test('both command failures retain failure status and leave the site uninstalled', async () => {
  assert.deepEqual(await lifecycle({ initial: 'absent', upgradeFailure: true, installFailure: true }), { status: 1, state: 'absent', calls: ['forge:upgrade:lite:staging', 'forge:install:lite:staging'] });
});

test('baseline and ordinary default retain original install-first lifecycle and failure semantics', async () => {
  for (const mode of ['baseline', '']) {
    assert.deepEqual(await lifecycle({ mode }), { status: 0, state: 'latest', calls: ['forge:install:lite:staging', 'forge:upgrade:lite:staging'] });
    assert.deepEqual(await lifecycle({ mode, initial: 'absent' }), { status: 0, state: 'latest', calls: ['forge:install:lite:staging'] });
    assert.equal((await lifecycle({ mode, upgradeFailure: true })).status, 1);
  }
  assert.equal(install['continue-on-error'], "${{ inputs.benchmark-sample == '' && needs.resolve.outputs.forge-site == '' }}");
  for (const variant of ['Full', 'Diagramly', 'AsyncAPI']) {
    const step = deploy.jobs.deploy.steps.find(item => item.name?.startsWith(`Install ${variant} to `));
    if (step) assert.equal(step.env?.PREPARATION_MODE, undefined);
  }
});

// Dedicated slot: the same actual shell, with a site and Forge environment.
async function slotRun({ site = 'lite-dev.atlassian.net', environment = 'pr', mode = 'candidate', initial = 'old' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lite-slot-install-'));
  try {
    const state = join(directory, 'state.json');
    const calls = join(directory, 'calls.jsonl');
    await writeFile(state, JSON.stringify({ installation: initial }));
    const executable = join(directory, 'pnpm');
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.STATE, 'utf8'));
fs.appendFileSync(process.env.CALLS, JSON.stringify(args)+'\\n');
const upgrade = args.includes('--upgrade');
if (args[0] !== 'exec' || args[1] !== 'forge') process.exit(99);
if (upgrade && state.installation === 'absent') process.exit(1);
if (!upgrade && state.installation !== 'absent') process.exit(1);
state.installation = 'latest';
fs.writeFileSync(process.env.STATE, JSON.stringify(state));
`);
    await chmod(executable, 0o755);
    const result = spawnSync('/bin/bash', ['-e', '-c', install.run], {
      env: { PATH: directory, PREPARATION_MODE: mode, FORGE_SITE: site, FORGE_ENVIRONMENT: environment, STATE: state, CALLS: calls },
      encoding: 'utf8',
    });
    return { status: result.status, calls: (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('dedicated slot installs on its own site and environment, never the shared staging scripts', async () => {
  const upgrade = ['exec', 'forge', 'install', '--upgrade', '--site', 'lite-dev.atlassian.net', '--product', 'confluence', '--non-interactive', '-e', 'pr', '--verbose'];
  const fresh = ['exec', 'forge', 'install', '--site', 'lite-dev.atlassian.net', '--product', 'confluence', '--non-interactive', '-e', 'pr', '--verbose'];
  assert.deepEqual(await slotRun(), { status: 0, calls: [upgrade] });
  assert.deepEqual(await slotRun({ initial: 'absent' }), { status: 0, calls: [upgrade, fresh] });
  assert.deepEqual(await slotRun({ mode: 'baseline', initial: 'absent' }), { status: 0, calls: [fresh] });
});

test('dedicated slot install failure fails the step, and the job through continue-on-error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-slot-fail-'));
  try {
    const executable = join(directory, 'pnpm');
    await writeFile(executable, '#!/bin/sh\nexit 1\n');
    await chmod(executable, 0o755);
    const result = spawnSync('/bin/bash', ['-e', '-c', install.run], { env: { PATH: directory, PREPARATION_MODE: 'candidate', FORGE_SITE: 'lite-dev.atlassian.net', FORGE_ENVIRONMENT: 'pr' }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
