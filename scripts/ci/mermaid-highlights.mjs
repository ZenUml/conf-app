// Runs tools/mermaid-highlights/test/mermaid-highlights.node-test.mjs with the
// inputs its browser tests need, and fails if any test was skipped.
//
//   pnpm test:mermaid-highlights
//
// CI (the "E2E: Viewer preview" job) and developers run this same command. Its
// test file skips every browser test unless MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE
// and MERMAID_HIGHLIGHTS_MERMAID_BUNDLE are set, and a skip exits 0. So this
// script finds both itself, stops with the missing path when it cannot, and
// treats any skipped, cancelled or todo test as a failure.
//
// Set either variable first to use a different Playwright or bundle; set
// MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE to use a different browser.
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TEST_FILE = path.join(ROOT, 'tools/mermaid-highlights/test/mermaid-highlights.node-test.mjs');

function missing(what, file) {
  return new Error(`${what} not found at ${file}. Run \`pnpm install\` first, or point the variable at an existing file.`);
}

/**
 * The two variables the browser tests read. Under pnpm the root cannot import
 * `playwright` directly; it is only reachable through `@playwright/test`, which
 * is also the Playwright the repo's own browser cache is built for.
 */
export function resolveInputs({ root = ROOT, env = process.env } = {}) {
  const fromRoot = createRequire(path.join(root, 'package.json'));
  let playwright = env.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE;
  if (!playwright) {
    const test = fromRoot.resolve('@playwright/test/package.json');
    playwright = path.dirname(createRequire(test).resolve('playwright/package.json'));
  }
  let bundle = env.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE;
  if (!bundle) bundle = path.join(path.dirname(fromRoot.resolve('mermaid/package.json')), 'dist', 'mermaid.min.js');
  if (!existsSync(playwright)) throw missing('Playwright module MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE', playwright);
  if (!existsSync(bundle)) throw missing('Mermaid bundle MERMAID_HIGHLIGHTS_MERMAID_BUNDLE', bundle);
  return { MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE: playwright, MERMAID_HIGHLIGHTS_MERMAID_BUNDLE: bundle };
}

/** `counts` is node:test's overall summary. A skipped test is a failed gate. */
export function verdict(counts) {
  if (!counts) return { ok: false, message: 'no test summary was produced' };
  if (!counts.tests) return { ok: false, message: 'no tests ran' };
  const problems = [['failed', counts.failed], ['cancelled', counts.cancelled], ['skipped', counts.skipped], ['todo', counts.todo]]
    .filter(([, count]) => count).map(([label, count]) => `${count} ${label}`);
  if (problems.length) return { ok: false, message: `${problems.join(', ')} of ${counts.tests} tests` };
  return { ok: true, message: `${counts.tests} tests, ${counts.passed} passed, 0 skipped` };
}

async function main() {
  // The test file runs in a child process, which inherits these.
  Object.assign(process.env, resolveInputs());
  const stream = run({ files: [TEST_FILE], cwd: ROOT });
  let counts;
  stream.on('test:summary', summary => { if (!summary.file) counts = summary.counts; });
  const report = stream.compose(spec);
  report.pipe(process.stdout);
  await once(report, 'end');
  const result = verdict(counts);
  console.error(`mermaid-highlights: ${result.ok ? 'ok' : 'FAILED'} - ${result.message}`);
  process.exitCode = result.ok ? 0 : 1;
}

// Compare real paths: Node resolves import.meta.url through symlinks but keeps
// argv[1] as typed, and a false "not the entry point" would exit 0 untested.
const realPath = file => { try { return realpathSync(file); } catch { return path.resolve(file); } };
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(`mermaid-highlights: FAILED - ${error.message}`);
    process.exitCode = 1;
  });
}
