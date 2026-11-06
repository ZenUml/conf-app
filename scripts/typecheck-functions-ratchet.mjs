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
    child.on('close', (code) => done({ out, code }));
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

/**
 * Decide the ratchet outcome from the tsc runs ({ out, code }) of head and base.
 * Head is unparseable whenever its tsc exits non-zero but yields zero parseable
 * error lines (missing tsconfig, TS18003, TS5083, ...): a count of 0 must not
 * read as "improved" in that case, whatever base reports.
 */
export function evaluate(headRun, baseRun) {
  const head = parseErrors(headRun.out);
  const base = parseErrors(baseRun.out);
  const summary = (sha) => `functions/ type errors: base ${total(base)} (${String(sha).slice(0, 8)}), head ${total(head)}`;
  const headUnparseable = headRun.code !== 0 && total(head) === 0;
  const bothUnparseable = total(head) === 0 && total(base) === 0 && /error|Cannot find/i.test(headRun.out + baseRun.out);
  if (headUnparseable || bothUnparseable) {
    return {
      exitCode: 2,
      summary,
      lines: ['tsc produced output with no parseable TS errors; refusing to pass:\n' + (headRun.out || baseRun.out)],
    };
  }
  if (total(head) > total(base)) {
    const added = newErrors(base, head);
    return {
      exitCode: 1,
      summary,
      lines: [
        `\nHead has ${total(head) - total(base)} more error(s) than base. Errors not matched in base (${added.length}):`,
        ...added.map((e) => `  ${e}`),
        '\nFix them, or lower the count elsewhere in this PR. Run: pnpm typecheck:functions',
      ],
    };
  }
  return { exitCode: 0, summary, lines: ['OK: no new type errors in functions/.'] };
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
    const [headRun, baseRun] = await Promise.all([typecheck(root), typecheck(baseDir)]);
    const result = evaluate(headRun, baseRun);
    console.log(result.summary(baseSha));
    for (const line of result.lines) (result.exitCode === 0 ? console.log : console.error)(line);
    process.exitCode = result.exitCode;
  } finally {
    try { git('worktree', 'remove', '--force', baseDir); } catch { /* best effort */ }
    rmSync(tmp, { recursive: true, force: true });
    try { git('worktree', 'prune'); } catch { /* best effort */ }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
