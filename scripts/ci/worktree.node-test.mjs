import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, linkEnvironment, worktreeClean } from './worktree.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
const write = (root, path, text = 'x') => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};
const run = (fn, ...args) => {
  const lines = [];
  const options = typeof args.at(-1) === 'object' && !Array.isArray(args.at(-1)) ? args.pop() : {};
  const code = fn(...args, { ...options, log: (line) => lines.push(line) });
  return { code, out: lines.join('\n') };
};

/** Temp repo with a main worktree and one linked worktree. Never touches the real repo. */
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'worktree-tooling-')));
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, '.gitignore', '.env*\ndist\nnode_modules/\n.vercel/\n.claude/\n.wrangler/\n');
  write(main, 'README.md');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = join(base, 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', wt);
  return { base, main, wt };
}

test('link: creates symlinks for ignored .env files, including nested ones', () => {
  const { main, wt } = fixture();
  write(main, '.env', 'A=1');
  write(main, 'tests/e2e-tests/.env', 'B=2');
  const { code } = run(linkEnvironment, [main], { cwd: wt });
  assert.equal(code, 0);
  assert.equal(readlinkSync(join(wt, '.env')), join(main, '.env'));
  assert.equal(readlinkSync(join(wt, 'tests/e2e-tests/.env')), join(main, 'tests/e2e-tests/.env'));
});

test('link --dry-run: links nothing', () => {
  const { main, wt } = fixture();
  write(main, '.env');
  const { code, out } = run(linkEnvironment, [main, '--dry-run'], { cwd: wt });
  assert.equal(code, 0);
  assert.match(out, /would link: \.env/);
  assert.equal(existsSync(join(wt, '.env')), false);
});

test('link: an existing regular file blocks with exit 1 and links nothing', () => {
  const { main, wt } = fixture();
  write(main, '.env');
  write(main, '.env.local');
  write(wt, '.env.local', 'mine');
  const { code, out } = run(linkEnvironment, [main], { cwd: wt });
  assert.equal(code, 1);
  assert.match(out, /blocked: \.env\.local/);
  assert.equal(existsSync(join(wt, '.env')), false);
});

test('link: a source that vanished is skipped, not thrown', () => {
  const { main, wt } = fixture();
  write(main, '.env');
  write(main, '.env.gone');
  // Make ls-files list a path that lstat then fails on: a dangling listing via a broken-race stand-in.
  const { code, out } = run(linkEnvironment, [main], {
    cwd: wt,
    lstat: (path) => {
      if (path.endsWith('.env.gone')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return lstatSync(path);
    },
  });
  assert.equal(code, 0);
  assert.match(out, /skipped \(missing\): .*\.env\.gone/);
  assert.equal(lstatSync(join(wt, '.env')).isSymbolicLink(), true);
});

test('link: skips .vercel/, .claude/, .wrangler/, .cindy-worktrees/, dist/, node_modules/', () => {
  const { main, wt } = fixture();
  write(main, '.env');
  for (const dir of ['.vercel/output', '.claude', '.wrangler', '.cindy-worktrees/x', 'dist', 'node_modules/p'])
    write(main, `${dir}/.env.skipme`);
  const { code } = run(linkEnvironment, [main], { cwd: wt });
  assert.equal(code, 0);
  assert.equal(lstatSync(join(wt, '.env')).isSymbolicLink(), true);
  for (const dir of ['.vercel', '.claude', '.wrangler', '.cindy-worktrees', 'dist', 'node_modules'])
    assert.equal(existsSync(join(wt, dir)), false, dir);
});

test('clean: refuses in the main worktree with exit 2', () => {
  const { main } = fixture();
  mkdirSync(join(main, 'dist'));
  write(main, 'dist/a.js');
  const { code, out } = run(clean, [], { cwd: main });
  assert.equal(code, 2);
  assert.match(out, /main worktree/);
  assert.equal(existsSync(join(main, 'dist/a.js')), true);
});

test('clean --dry-run: prints would remove and deletes nothing', () => {
  const { wt } = fixture();
  write(wt, 'dist/a.js');
  const { code, out } = run(clean, ['--dry-run'], { cwd: wt });
  assert.equal(code, 0);
  assert.match(out, /would remove: dist/);
  assert.equal(existsSync(join(wt, 'dist/a.js')), true);
});

test('clean: removes an ignored dist/ directory', () => {
  const { wt } = fixture();
  write(wt, 'dist/a.js');
  const { code, out } = run(clean, [], { cwd: wt });
  assert.equal(code, 0);
  assert.match(out, /removed: dist/);
  assert.equal(existsSync(join(wt, 'dist')), false);
});

test('clean: never deletes .env files, .env symlinks, or directories holding them', () => {
  const { main, wt } = fixture();
  write(main, '.env', 'A=1');
  write(wt, '.env.local', 'mine');
  symlinkSync(join(main, '.env'), join(wt, '.env'));
  write(wt, 'node_modules/p/.env', 'inner');
  write(wt, 'node_modules/p/x.js');
  write(wt, 'dist/a.js');
  const { code, out } = run(clean, [], { cwd: wt });
  assert.equal(code, 0);
  assert.equal(lstatSync(join(wt, '.env')).isSymbolicLink(), true);
  assert.equal(existsSync(join(main, '.env')), true);
  assert.equal(existsSync(join(wt, '.env.local')), true);
  assert.equal(existsSync(join(wt, 'node_modules/p/.env')), true);
  assert.match(out, /skipped \(contains \.env\): node_modules/);
  assert.equal(existsSync(join(wt, 'dist')), false);
});

test('clean: a symlinked directory is unlinked, its target survives', () => {
  const { base, wt } = fixture();
  const target = join(base, 'elsewhere');
  mkdirSync(target);
  write(target, 'keep.txt');
  symlinkSync(target, join(wt, 'dist'));
  const { code } = run(clean, [], { cwd: wt });
  assert.equal(code, 0);
  assert.equal(existsSync(join(wt, 'dist')), false);
  assert.equal(existsSync(join(target, 'keep.txt')), true);
});

test('clean: never deletes a nested worktree or repo inside an ignored directory', () => {
  const { main, wt } = fixture();
  // Another session's worktree nested under an ignored folder, with uncommitted work.
  const nested = join(wt, '.claude/worktrees/other');
  git(main, 'worktree', 'add', '-q', '-b', 'other', nested);
  write(nested, 'unsaved.txt', 'work in progress');
  // A plain nested repo (a .git directory) under an ignored folder.
  const repo = join(wt, 'dist/vendor-repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  write(repo, 'keep.txt');
  const { code, out } = run(clean, [], { cwd: wt });
  assert.equal(code, 0);
  assert.equal(existsSync(join(nested, 'unsaved.txt')), true);
  assert.equal(existsSync(join(repo, 'keep.txt')), true);
  assert.match(out, /skipped \(contains git repo\): \.claude/);
  assert.match(out, /skipped \(contains git repo\): dist/);
});

test('worktree:clean: exit 0 when clean, 1 with untracked files, 2 outside a repo', () => {
  const { base, wt } = fixture();
  assert.equal(run(worktreeClean, { cwd: wt }).code, 0);
  write(wt, 'stray.txt');
  const dirty = run(worktreeClean, { cwd: wt });
  assert.equal(dirty.code, 1);
  assert.match(dirty.out, /stray\.txt/);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'not-a-repo-')));
  assert.equal(run(worktreeClean, { cwd: outside }).code, 2);
  assert.ok(base);
});
