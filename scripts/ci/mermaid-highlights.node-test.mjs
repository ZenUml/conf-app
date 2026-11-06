import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

// The Mermaid highlight runtime tests are the only tests that drive the real
// Mermaid renderer in a browser. Their file skips every browser test when the
// Playwright module or the Mermaid bundle is not configured, so the file passed
// CI-style runs with most tests skipped. These tests keep that from coming
// back: the gate is wired into both pipelines, the runner resolves its own
// inputs, and a skipped browser test fails the run.

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const workflow = name => yaml.load(read(`.github/workflows/${name}.yml`));
const HIGHLIGHT_TESTS = path.join(root, 'tools/mermaid-highlights/test/mermaid-highlights.node-test.mjs');
const RUNNER = path.join(root, 'scripts/ci/mermaid-highlights.mjs');
const runner = () => import('./mermaid-highlights.mjs');

// A nested `node --test` must not inherit the outer test context, and neither
// the developer's browser settings nor CI should leak into the child run.
function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ['NODE_TEST_CONTEXT', 'CI', 'MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE', 'MERMAID_HIGHLIGHTS_MERMAID_BUNDLE', 'MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE']) delete env[key];
  return { ...env, ...extra };
}

for (const name of ['pr-validation', 'main-build-preparation']) {
  test(`${name} runs the Mermaid highlight runtime tests in the Viewer preview job, after Chromium is installed`, () => {
    const steps = workflow(name).jobs['preview-e2e'].steps;
    const index = stepName => steps.findIndex(step => step.name === stepName);
    const gate = steps.findIndex(step => step.run === 'pnpm test:mermaid-highlights');
    assert.ok(gate >= 0, 'a step runs `pnpm test:mermaid-highlights`');
    for (const required of ['Install dependencies', 'Cache Playwright browsers', 'Install Playwright browsers']) {
      assert.ok(index(required) >= 0, `${required} is present`);
      assert.ok(index(required) < gate, `${required} runs before the highlight tests`);
    }
    assert.ok(gate < index('Run preview specs against a local Vite dev server'));
    // A conditional or non-blocking step is a gate that can quietly stop gating.
    assert.equal(steps[gate].if, undefined);
    assert.equal(steps[gate]['continue-on-error'], undefined);
  });
}

test('package.json exposes one command that CI and developers share', () => {
  assert.equal(JSON.parse(read('package.json')).scripts['test:mermaid-highlights'], 'node scripts/ci/mermaid-highlights.mjs');
});

test('under CI, the highlight test file fails when its browser inputs are missing instead of skipping', () => {
  const result = spawnSync(process.execPath, ['--test', HIGHLIGHT_TESTS], { env: childEnv({ CI: 'true' }), encoding: 'utf8' });
  assert.notEqual(result.status, 0, `exit ${result.status}\n${result.stdout}`);
  assert.match(`${result.stdout}${result.stderr}`, /MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE/);
});

test('outside CI, the highlight test file still skips its browser tests so a plain checkout stays usable', () => {
  const result = spawnSync(process.execPath, ['--test', HIGHLIGHT_TESTS], { env: childEnv(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout);
  // Count rather than pin: every test that does not pass must be a skip, and at
  // least one browser test must have been skipped.
  const count = name => Number(result.stdout.match(new RegExp(`^(?:#|ℹ) ${name} (\\d+)$`, 'm'))?.[1]);
  assert.ok(count('skipped') > 0, result.stdout);
  assert.equal(count('pass') + count('skipped'), count('tests'), result.stdout);
});

test('the runner finds Playwright and the Mermaid bundle in this checkout', async () => {
  const { resolveInputs } = await runner();
  const inputs = resolveInputs({ root, env: {} });
  const playwright = inputs.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE;
  assert.equal(JSON.parse(readFileSync(path.join(playwright, 'package.json'), 'utf8')).name, 'playwright');
  assert.equal(path.basename(inputs.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE), 'mermaid.min.js');
  assert.ok(existsSync(inputs.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE));
});

test('the runner keeps explicit inputs so a custom Playwright or bundle still works', async () => {
  const { resolveInputs } = await runner();
  const here = fileURLToPath(import.meta.url);
  const inputs = resolveInputs({ root, env: { MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE: path.dirname(here), MERMAID_HIGHLIGHTS_MERMAID_BUNDLE: here } });
  assert.equal(inputs.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE, path.dirname(here));
  assert.equal(inputs.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE, here);
});

test('the runner names the missing file instead of letting browser tests skip', async () => {
  const { resolveInputs } = await runner();
  assert.throws(() => resolveInputs({ root, env: { MERMAID_HIGHLIGHTS_MERMAID_BUNDLE: '/nonexistent/mermaid.min.js' } }), /\/nonexistent\/mermaid\.min\.js/);
  assert.throws(() => resolveInputs({ root, env: { MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE: '/nonexistent/playwright' } }), /\/nonexistent\/playwright/);
});

test('the runner command exits non-zero with the missing path, before any browser starts', () => {
  const result = spawnSync(process.execPath, [RUNNER], { env: childEnv({ MERMAID_HIGHLIGHTS_MERMAID_BUNDLE: '/nonexistent/mermaid.min.js' }), encoding: 'utf8' });
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /\/nonexistent\/mermaid\.min\.js/);
});

// Node gives process.argv[1] as typed but import.meta.url as the real path, so a
// plain comparison treats a run through a symlinked checkout as "imported" and
// exits 0 without running a single test.
test('the runner command still runs when the checkout is reached through a symlink', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mermaid-highlights-'));
  const link = path.join(dir, 'checkout');
  symlinkSync(root, link, 'dir');
  try {
    const result = spawnSync(process.execPath, [path.join(link, 'scripts/ci/mermaid-highlights.mjs')], { env: childEnv({ MERMAID_HIGHLIGHTS_MERMAID_BUNDLE: '/nonexistent/mermaid.min.js' }), encoding: 'utf8' });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /\/nonexistent\/mermaid\.min\.js/);
  } finally {
    unlinkSync(link);
    rmdirSync(dir);
  }
});

test('a run only passes when every test ran and passed', async () => {
  const { verdict } = await runner();
  assert.deepEqual(verdict({ tests: 18, passed: 18, failed: 0, cancelled: 0, skipped: 0, todo: 0 }), { ok: true, message: '18 tests, 18 passed, 0 skipped' });
  for (const [counts, reason] of [
    [{ tests: 18, passed: 2, failed: 0, cancelled: 0, skipped: 16, todo: 0 }, /16 skipped/],
    [{ tests: 18, passed: 17, failed: 1, cancelled: 0, skipped: 0, todo: 0 }, /1 failed/],
    [{ tests: 18, passed: 17, failed: 0, cancelled: 1, skipped: 0, todo: 0 }, /1 cancelled/],
    [{ tests: 18, passed: 17, failed: 0, cancelled: 0, skipped: 0, todo: 1 }, /1 todo/],
    [{ tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 }, /no tests ran/],
    [undefined, /no test summary/],
  ]) {
    const result = verdict(counts);
    assert.equal(result.ok, false);
    assert.match(result.message, reason);
  }
});

test('Chromium installed for the E2E workspace is the Chromium the highlight tests launch', () => {
  // preview-e2e installs browsers with tests/e2e-tests' Playwright, while the
  // highlight tests launch the root Playwright. The two only share a browser
  // build while they pin the same playwright-core.
  const versions = file => [...new Set([...read(file).matchAll(/^ {2}playwright-core@(\d[^:(\s]*)/gm)].map(match => match[1]))];
  assert.deepEqual(versions('pnpm-lock.yaml'), versions('tests/e2e-tests/pnpm-lock.yaml'),
    'root and tests/e2e-tests must pin the same playwright-core, or the cached Chromium will not match');
  assert.equal(versions('pnpm-lock.yaml').length, 1);
});
