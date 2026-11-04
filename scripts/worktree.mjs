#!/usr/bin/env node
// Worktree helpers: link git-ignored config from the primary checkout instead of copying
// it, check that a worktree is clean before it is removed, and clear generated output.
//
//   pnpm link:environment <primary-checkout> [--dry-run]
//   pnpm worktree:clean
//   pnpm clean [--dry-run]
//
// Policy: docs/policies/git-workflow.md. Config is linked, never copied, so a secret exists
// in one place. Nothing here deletes a real file outside this worktree.
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Git-ignored files a worktree needs and git does not carry over.
export const ENV_FILES = [
  '.env',
  '.env.forge',
  '.env.forge.local',
  '.env.mixpanel',
  '.env.sentry-build-plugin',
  '.mcp.json',
  'tests/e2e-tests/.env',
  'wrangler.toml',
  '.claude/settings.local.json',
];

// Generated output that is safe to delete and is rebuilt on demand.
export const GENERATED = ['dist', 'storybook-static', 'coverage', 'test-results', 'playwright-report'];

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const isSymlink = p => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const present = p => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

function commonDir(dir) {
  return realpathSync(resolve(dir, git(dir, 'rev-parse', '--git-common-dir')));
}

function topLevel(dir) {
  return realpathSync(git(dir, 'rev-parse', '--show-toplevel'));
}

// Is this path ignored by the repository that owns `dir`?
function isIgnored(dir, rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function linkEnvironment({ primary, cwd = process.cwd(), dryRun = false }) {
  const here = topLevel(cwd);
  const main = topLevel(primary);
  if (here === main) throw new Error('This is the primary checkout; run this inside a worktree.');
  if (commonDir(here) !== commonDir(main)) {
    throw new Error(`${main} is not in the same repository as ${here}.`);
  }
  // Another worktree only holds links. The real files live in the primary checkout.
  if (main !== realpathSync(resolve(commonDir(here), '..'))) {
    throw new Error(`${main} is a worktree, not the primary checkout (${resolve(commonDir(here), '..')}).`);
  }
  const result = { linked: [], alreadyLinked: [], conflicts: [], skipped: [] };
  for (const rel of ENV_FILES) {
    const source = join(main, rel);
    const target = join(here, rel);
    if (!present(source)) {
      result.skipped.push(rel);
      continue;
    }
    // Only ever link files git ignores in the primary; a tracked file comes with the checkout.
    if (!isIgnored(main, rel)) {
      result.skipped.push(rel);
      continue;
    }
    if (isSymlink(target)) {
      if (readlinkSync(target) === source) result.alreadyLinked.push(rel);
      else result.conflicts.push(rel);
      continue;
    }
    if (present(target)) {
      result.conflicts.push(rel);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target);
    }
    result.linked.push(rel);
  }
  return result;
}

export function checkWorktree({ cwd = process.cwd(), primary }) {
  const here = topLevel(cwd);
  const problems = [];
  const status = git(here, 'status', '--porcelain');
  if (status) problems.push(`uncommitted changes:\n${status}`);
  if (primary) {
    const main = topLevel(primary);
    for (const rel of ENV_FILES) {
      const target = join(here, rel);
      if (present(join(main, rel)) && present(target) && !isSymlink(target)) {
        problems.push(`${rel} is a copy, not a link to the primary checkout`);
      }
    }
  }
  return { problems };
}

export function cleanWorktree({ cwd = process.cwd(), primary, dryRun = false }) {
  const here = topLevel(cwd);
  const removed = [];
  for (const rel of GENERATED) {
    const target = join(here, rel);
    if (present(target)) {
      if (!dryRun) rmSync(target, { recursive: true, force: true });
      removed.push(rel);
    }
  }
  if (primary) {
    const main = topLevel(primary);
    for (const rel of ENV_FILES) {
      const target = join(here, rel);
      // Remove only a link that points at the primary's own file.
      if (isSymlink(target) && readlinkSync(target) === join(main, rel)) {
        if (!dryRun) rmSync(target, { force: true });
        removed.push(rel);
      }
    }
  }
  return { removed };
}

function parse(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const args = argv.filter(a => !a.startsWith('--'));
  return { flags, args };
}

// The primary checkout is where the common git dir lives.
function primaryOf(dir) {
  return resolve(commonDir(dir), '..');
}

function main(argv) {
  const [command, ...rest] = argv;
  const { flags, args } = parse(rest);
  const dryRun = flags.has('--dry-run');
  if (command === 'link-environment') {
    if (!args[0]) throw new Error('Usage: pnpm link:environment <primary-checkout> [--dry-run]');
    const r = linkEnvironment({ primary: args[0], dryRun });
    const verb = dryRun ? 'would link' : 'linked';
    for (const f of r.linked) console.log(`${verb}  ${f}`);
    for (const f of r.alreadyLinked) console.log(`already linked  ${f}`);
    for (const f of r.conflicts) console.log(`CONFLICT  ${f} exists here and is not a link to the primary; left alone`);
    for (const f of r.skipped) console.log(`skipped  ${f} (not present or not ignored in the primary)`);
    return r.conflicts.length ? 1 : 0;
  }
  if (command === 'check') {
    const r = checkWorktree({ primary: args[0] || primaryOf(process.cwd()) });
    if (r.problems.length) {
      for (const p of r.problems) console.error(p);
      return 1;
    }
    console.log('worktree is clean');
    return 0;
  }
  if (command === 'clean') {
    const r = cleanWorktree({ primary: args[0] || primaryOf(process.cwd()), dryRun });
    const verb = dryRun ? 'would remove' : 'removed';
    for (const f of r.removed) console.log(`${verb}  ${f}`);
    if (!r.removed.length) console.log('nothing to remove');
    return 0;
  }
  throw new Error('Usage: worktree.mjs link-environment <primary> | check | clean [--dry-run]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
