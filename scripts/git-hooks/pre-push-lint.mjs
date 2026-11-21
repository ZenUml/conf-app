// Pre-push lint: oxlint on the files changed versus origin/main only.
//
// Deliberately NOT included:
//  - typecheck: the baseline is red (564+ errors), so it would block every push.
//  - formatter: the repo has no formatter.
// Budget: 9000 ms. A run over budget fails (owner rule: a step over its
// budget fails), so the hook cannot silently become slow.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BUDGET_MS = 9000;
// Keep in sync with the `lint` script in package.json.
export const LINT_DIRS = ['src/', 'functions/', 'scripts/', 'tests/unit/'];
export const LINT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'];

export function filterLintable(files, exists = existsSync) {
  return files.filter(
    (f) =>
      LINT_EXTENSIONS.some((ext) => f.endsWith(ext)) &&
      LINT_DIRS.some((dir) => f.startsWith(dir)) &&
      exists(f),
  );
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const start = performance.now();
  const done = (code, msg) => {
    const ms = Math.round(performance.now() - start);
    if (msg) console.log(msg);
    console.log(`pre-push lint: ${ms} ms (budget ${BUDGET_MS} ms)`);
    if (code === 0 && ms > BUDGET_MS) {
      console.error(
        `pre-push lint: OVER BUDGET (${ms} ms > ${BUDGET_MS} ms). A step over its budget fails; ` +
          'fix the slowness instead of raising the budget.',
      );
      process.exit(1);
    }
    process.exit(code);
  };

  let base;
  try {
    base = git(['merge-base', 'HEAD', 'origin/main']);
  } catch {
    return done(0, 'pre-push lint: no origin/main found, skipping (run `git fetch origin main`).');
  }
  const changed = git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])
    .split('\n')
    .filter(Boolean);
  const files = filterLintable(changed);
  if (files.length === 0) return done(0, 'pre-push lint: no lintable changed files.');

  console.log(`pre-push lint: ${files.length} file(s) changed vs origin/main`);
  const r = spawnSync('node_modules/.bin/oxlint', ['-c', '.oxlintrc.json', ...files], {
    stdio: 'inherit',
  });
  if (r.error) return done(1, `pre-push lint: cannot run oxlint (${r.error.message}); run pnpm install.`);
  done(r.status === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
