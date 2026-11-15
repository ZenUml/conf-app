import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');

test('CLI entrypoints run through a symlinked checkout without invoking GitHub', () => {
  const temp = mkdtempSync(join(tmpdir(), 'pr-cli-symlink-'));
  try {
    const checkout = join(temp, 'checkout');
    symlinkSync(root, checkout, 'dir');
    for (const [script, args, expected] of [
      ['pr-decision.mjs', ['inspect', '--pr'], /Expected --name value/],
      ['request-pr-e2e.mjs', ['--repo', 'example/repo', '--pr', 'invalid'], /Invalid PR number/],
      ['api-plan.mjs', ['invalid'], /Usage: api-plan\.mjs/],
    ]) {
      const result = spawnSync(process.execPath, [join(checkout, 'scripts/test-selection', script), ...args], { encoding: 'utf8', cwd: root });
      assert.equal(result.status, 1, `${script}: ${result.stderr}`);
      assert.match(result.stderr, expected, script);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('importing CLI modules does not execute their entrypoints', () => {
  const source = ['pr-decision.mjs', 'request-pr-e2e.mjs', 'api-plan.mjs']
    .map(name => `await import(${JSON.stringify(new URL(`../${name}`, import.meta.url).href)})`).join(';');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, 'nonexistent-entrypoint'], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const stdin = spawnSync(process.execPath, ['--input-type=module', '-'], { input: source, encoding: 'utf8', cwd: root });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, '');
  assert.equal(stdin.stderr, '');
});
