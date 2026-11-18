import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/ci/flake-merge.mjs');

test('merges separate suites with large output, preserving rows and warning on failed merges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flake-merge-test-'));
  try {
    const input = join(dir, 'input');
    for (const suite of ['full', 'lite', 'broken']) await mkdir(join(input, '100', suite), { recursive: true });
    const fake = join(dir, 'playwright');
    await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const suite = require('node:path').basename(process.argv.at(-1));
fs.appendFileSync(process.env.FAKE_LOG, 'start\\n');
const deadline = Date.now() + 3000;
const wait = () => {
  if (Date.now() > deadline) { console.error('concurrency timeout'); process.exit(1); }
  if ((fs.readFileSync(process.env.FAKE_LOG, 'utf8').match(/start/g) || []).length < 2) return setTimeout(wait, 10);
  if (suite === 'broken') { console.error('merge failed'); process.exitCode = 1; }
  else {
    const tests = Array.from({length: 1000}, (_,i) => ({title: suite+i, file: suite+'.spec.ts', tests:[{projectName:'chromium',status:'expected'}]}));
    process.stdout.write(JSON.stringify({suites:[{specs:tests}]}));
  }
  fs.appendFileSync(process.env.FAKE_LOG, 'end\\n');
};
wait();
`);
    await chmod(fake, 0o755);
    const output = join(dir, 'rows.jsonl');
    const log = join(dir, 'calls');
    const result = spawnSync(process.execPath, [script, input, output, fake], { encoding: 'utf8', timeout: 15000, env: {...process.env, FAKE_LOG: log} });
    let active = 0, maxActive = 0;
    for (const event of (await readFile(log, 'utf8')).trim().split('\n')) {
      active += event === 'start' ? 1 : -1;
      maxActive = Math.max(maxActive, active);
    }
    assert.equal(active, 0);
    assert.equal(maxActive, 2);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /warning.*100.*broken/i);
    const rows = (await readFile(output, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 2000);
    assert.equal(rows.filter(row => row.suite === 'full' && row.run === '100').length, 1000);
    assert.equal(rows.filter(row => row.suite === 'lite' && row.project === 'chromium').length, 1000);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects truncated JSON even if the merge process exits successfully', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flake-merge-bad-'));
  try {
    const input = join(dir, 'input');
    await mkdir(join(input, '100', 'full'), { recursive: true });
    const fake = join(dir, 'playwright');
    await writeFile(fake, '#!/bin/sh\nprintf "{\\\"suites\\\":["\n');
    await chmod(fake, 0o755);
    const result = spawnSync(process.execPath, [script, input, join(dir, 'rows'), fake], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(result.status, 0);
    await writeFile(fake, '#!/bin/sh\nexit 0\n');
    const empty = spawnSync(process.execPath, [script, input, join(dir, 'rows'), fake], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(empty.status, 0, 'an empty report must fail');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
