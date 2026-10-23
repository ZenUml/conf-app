#!/usr/bin/env node
// No-regression ratchet for `tsc -p functions` (issue #960).
//
// Counts the TypeScript errors in functions/ for the working tree (head) and for
// a base commit, and fails only when head has MORE errors than the base. The
// base is measured on every run instead of read from a committed baseline, so
// two PRs that each lower the count never conflict on a number in a file.
//
// Base commit: $TYPECHECK_BASE_SHA, else `git merge-base HEAD origin/main`.
// The base is checked out in a temporary `git worktree --detach`, reusing the
// head's node_modules through a symlink. Run from the repository root.
//
// Errors are compared as a multiset of messages with the (line,col) position
// removed, so moving code does not look like a new error.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function resolveBase() {
  const explicit = process.env.TYPECHECK_BASE_SHA;
  if (explicit) return explicit;
  return git('merge-base', 'HEAD', process.env.TYPECHECK_BASE_REF || 'origin/main');
}

function typecheck(cwd) {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [tsc, '-p', 'functions', '--noEmit', '--pretty', 'false'], { cwd });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', fail);
    child.on('close', () => done(out));
  });
}

/** Map of "path: error TSxxxx: message" -> occurrences. Continuation lines are ignored. */
export function parseErrors(output) {
  const counts = new Map();
  for (const line of output.split('\n')) {
    const m = /^(.+?)\(\d+,\d+\): (error TS\d+: .*)$/.exec(line.trim());
    if (!m) continue;
    const key = `${m[1]}: ${m[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function total(counts) {
  let n = 0;
  for (const v of counts.values()) n += v;
  return n;
}

/** Errors present more often in head than in base. */
export function newErrors(base, head) {
  const added = [];
  for (const [key, n] of head) {
    const extra = n - (base.get(key) ?? 0);
    for (let i = 0; i < extra; i++) added.push(key);
  }
  return added.sort();
}

async function main() {
  const baseSha = resolveBase();
  const tmp = mkdtempSync(join(tmpdir(), 'functions-tc-base-'));
  const baseDir = join(tmp, 'base');
  try {
    git('worktree', 'add', '--detach', baseDir, baseSha);
    symlinkSync(join(root, 'node_modules'), join(baseDir, 'node_modules'));
    // The first PR to add the config has no functions/tsconfig.json at base.
    if (!existsSync(join(baseDir, 'functions', 'tsconfig.json'))) {
      copyFileSync(join(root, 'functions', 'tsconfig.json'), join(baseDir, 'functions', 'tsconfig.json'));
    }
    const [headOut, baseOut] = await Promise.all([typecheck(root), typecheck(baseDir)]);
    const head = parseErrors(headOut);
    const base = parseErrors(baseOut);
    if (total(head) === 0 && total(base) === 0 && /error|Cannot find/i.test(headOut + baseOut)) {
      console.error('tsc produced output with no parseable TS errors; refusing to pass:\n' + (headOut || baseOut));
      process.exitCode = 2;
      return;
    }
    console.log(`functions/ type errors: base ${total(base)} (${baseSha.slice(0, 8)}), head ${total(head)}`);
    const added = newErrors(base, head);
    if (total(head) > total(base)) {
      console.error(`\nHead has ${total(head) - total(base)} more error(s) than base. Errors not matched in base (${added.length}):`);
      for (const e of added) console.error(`  ${e}`);
      console.error('\nFix them, or lower the count elsewhere in this PR. Run: pnpm typecheck:functions');
      process.exitCode = 1;
      return;
    }
    console.log('OK: no new type errors in functions/.');
  } finally {
    try { git('worktree', 'remove', '--force', baseDir); } catch { /* best effort */ }
    rmSync(tmp, { recursive: true, force: true });
    try { git('worktree', 'prune'); } catch { /* best effort */ }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
