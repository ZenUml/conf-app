// regression:0..2 — Smoke gate that the broader test suites still pass.
// These cases shell out to existing test commands rather than reimplementing
// them. Each test asserts exit code 0 (or treats the command as
// `test.skip()` if it can't run in the current env, e.g. no APP env var).
//
// CAVEAT: These tests run from the repo root, NOT from inside e2e-tests.
// `process.cwd()` at this point is `tests/e2e-tests/`, so we resolve the
// repo root via `path.resolve(__dirname, '../../../../')`. We also run with
// `stdio: 'inherit'` so failures are diagnosable from the Playwright report.
//
// The regression suite is gated behind `RUN_REGRESSION=true` env var because
// it can take 5+ minutes per case and isn't appropriate for every Playwright
// run. CI invokes it explicitly when needed.

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// tests/e2e-tests/tests/fullscreen/regression.spec.ts → repo root is 4 levels
// above this file. We resolve relative to process.cwd() (which is e2e-tests/
// when Playwright runs) rather than `import.meta.url`, because the Playwright
// TS loader does not always set import.meta in CJS-style transpiled tests.
const REPO_ROOT = path.resolve(process.cwd(), '../../');

function runCommand(cmd: string): { exitCode: number; output: string } {
  try {
    const output = execSync(cmd, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return { exitCode: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      output: (e.stdout ?? '') + (e.stderr ?? ''),
    };
  }
}

test.describe('Regression baseline', () => {
  test.skip(
    process.env.RUN_REGRESSION !== 'true',
    'Skipped unless RUN_REGRESSION=true (regression cases shell out to other suites — slow)',
  );

  // regression:0 — pnpm test:unit
  test('regression:0 — pnpm test:unit passes', async () => {
    test.setTimeout(10 * 60_000); // 10 min — vitest can be slow on cold cache
    expect(existsSync(path.join(REPO_ROOT, 'package.json'))).toBe(true);
    const result = runCommand('pnpm test:unit');
    if (result.exitCode !== 0) {
      console.error(result.output.slice(-4_000));
    }
    expect(result.exitCode).toBe(0);
    // Manual run baseline: 301 tests, 54 files. Match the "passed" line.
    expect(result.output).toMatch(/Test Files\s+\d+\s+passed|Tests\s+\d+\s+passed/i);
  });

  // regression:1 — pnpm test:e2e -- tests/insert/close-guard.spec.ts
  // Requires APP env var (e.g. APP=zenuml-lite@stg). Skip if missing.
  test('regression:1 — close-guard.spec.ts passes', async () => {
    test.skip(!process.env.APP, 'Requires APP env var (e.g. APP=zenuml-lite@stg)');
    test.setTimeout(15 * 60_000);
    const result = runCommand('pnpm test:e2e -- tests/insert/close-guard.spec.ts');
    if (result.exitCode !== 0) {
      console.error(result.output.slice(-4_000));
    }
    expect(result.exitCode).toBe(0);
  });

  // regression:2 — pnpm test:lite:stg insert specs
  test('regression:2 — insert smoke specs pass on lite-stg', async () => {
    test.skip(!process.env.APP, 'Requires APP env var');
    test.setTimeout(15 * 60_000);
    const result = runCommand('pnpm test:insert');
    if (result.exitCode !== 0) {
      console.error(result.output.slice(-4_000));
    }
    expect(result.exitCode).toBe(0);
  });
});
