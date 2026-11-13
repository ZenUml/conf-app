import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkWorktree, cleanWorktree, linkEnvironment } from './worktree.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

// A primary checkout with ignored config, plus a linked worktree beside it.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-')));
  const primary = join(root, 'primary');
  mkdirSync(primary);
  git(primary, 'init', '-q', '-b', 'main');
  git(primary, 'config', 'user.email', 't@example.com');
  git(primary, 'config', 'user.name', 't');
  writeFileSync(join(primary, '.gitignore'), '.env\n.env.forge.local\nwrangler.toml\ndist\ncoverage\n');
  writeFileSync(join(primary, 'README.md'), 'x\n');
  git(primary, 'add', '.');
  git(primary, 'commit', '-q', '-m', 'init');
  writeFileSync(join(primary, '.env'), 'A=1\n');
  writeFileSync(join(primary, '.env.forge.local'), 'FORGE=secret\n');
  const wt = join(root, 'wt');
  git(primary, 'worktree', 'add', '-q', '-b', 'feature', wt);
  return { root, primary, wt, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('links ignored config that exists in the primary, skips what does not exist', () => {
  const f = fixture();
  try {
    const r = linkEnvironment({ primary: f.primary, cwd: f.wt });
    assert.deepEqual(r.linked.sort(), ['.env', '.env.forge.local']);
    assert.equal(lstatSync(join(f.wt, '.env')).isSymbolicLink(), true);
    assert.equal(readlinkSync(join(f.wt, '.env')), join(f.primary, '.env'));
    assert.equal(existsSync(join(f.wt, 'wrangler.toml')), false);
    assert.deepEqual(r.conflicts, []);
  } finally {
    f.done();
  }
});

test('dry run changes nothing', () => {
  const f = fixture();
  try {
    const r = linkEnvironment({ primary: f.primary, cwd: f.wt, dryRun: true });
    assert.deepEqual(r.linked.sort(), ['.env', '.env.forge.local']);
    assert.equal(existsSync(join(f.wt, '.env')), false);
  } finally {
    f.done();
  }
});

test('a second run is a no-op and a real file is reported, never overwritten', () => {
  const f = fixture();
  try {
    linkEnvironment({ primary: f.primary, cwd: f.wt });
    const again = linkEnvironment({ primary: f.primary, cwd: f.wt });
    assert.deepEqual(again.linked, []);
    assert.deepEqual(again.alreadyLinked.sort(), ['.env', '.env.forge.local']);

    rmSync(join(f.wt, '.env'));
    writeFileSync(join(f.wt, '.env'), 'LOCAL=1\n');
    const conflict = linkEnvironment({ primary: f.primary, cwd: f.wt });
    assert.deepEqual(conflict.conflicts, ['.env']);
    assert.equal(lstatSync(join(f.wt, '.env')).isSymbolicLink(), false);
  } finally {
    f.done();
  }
});

test('refuses to run inside the primary checkout or against a foreign repository', () => {
  const f = fixture();
  const other = join(f.root, 'other');
  try {
    assert.throws(() => linkEnvironment({ primary: f.primary, cwd: f.primary }), /primary checkout/);
    mkdirSync(other);
    git(other, 'init', '-q');
    assert.throws(() => linkEnvironment({ primary: other, cwd: f.wt }), /same repository/);
  } finally {
    f.done();
  }
});

test('refuses another worktree as the source: only the primary checkout holds the real config', () => {
  const f = fixture();
  const sibling = join(f.root, 'sibling');
  try {
    git(f.primary, 'worktree', 'add', '-q', '-b', 'other', sibling);
    linkEnvironment({ primary: f.primary, cwd: sibling });
    assert.throws(() => linkEnvironment({ primary: sibling, cwd: f.wt }), /primary checkout/);
    assert.equal(existsSync(join(f.wt, '.env')), false);
  } finally {
    f.done();
  }
});

test('check passes for a clean worktree with linked config', () => {
  const f = fixture();
  try {
    linkEnvironment({ primary: f.primary, cwd: f.wt });
    const r = checkWorktree({ cwd: f.wt, primary: f.primary });
    assert.deepEqual(r.problems, []);
  } finally {
    f.done();
  }
});

test('check fails for uncommitted changes and for config that is a copy', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.wt, 'new.txt'), 'x\n');
    writeFileSync(join(f.wt, '.env'), 'COPY=1\n');
    const r = checkWorktree({ cwd: f.wt, primary: f.primary });
    assert.equal(r.problems.some(p => /uncommitted/.test(p)), true);
    assert.equal(r.problems.some(p => /\.env is a copy/.test(p)), true);
  } finally {
    f.done();
  }
});

test('clean removes generated output and our links, and never touches the primary', () => {
  const f = fixture();
  try {
    linkEnvironment({ primary: f.primary, cwd: f.wt });
    mkdirSync(join(f.wt, 'dist'));
    writeFileSync(join(f.wt, 'dist', 'a.js'), '1');
    mkdirSync(join(f.wt, 'coverage'));
    // A link that points somewhere else is not ours to remove.
    symlinkSync(join(f.root, 'elsewhere'), join(f.wt, 'wrangler.toml'));

    const dry = cleanWorktree({ cwd: f.wt, primary: f.primary, dryRun: true });
    assert.equal(existsSync(join(f.wt, 'dist')), true);
    assert.deepEqual(dry.removed.sort(), ['.env', '.env.forge.local', 'coverage', 'dist']);

    const r = cleanWorktree({ cwd: f.wt, primary: f.primary });
    assert.deepEqual(r.removed.sort(), ['.env', '.env.forge.local', 'coverage', 'dist']);
    assert.equal(existsSync(join(f.wt, 'dist')), false);
    assert.equal(lstatSync(join(f.wt, 'wrangler.toml')).isSymbolicLink(), true);
    assert.equal(existsSync(join(f.primary, '.env')), true);
    assert.equal(existsSync(join(f.primary, '.env.forge.local')), true);
  } finally {
    f.done();
  }
});

test('clean never deletes a nested worktree or repo inside generated output', () => {
  const f = fixture();
  try {
    // Another session's worktree with unsaved work, under a generated folder.
    const nested = join(f.wt, 'dist', 'other-worktree');
    git(f.primary, 'worktree', 'add', '-q', '-b', 'other', nested);
    writeFileSync(join(nested, 'unsaved.txt'), 'work in progress');
    // A plain nested repo (a .git directory).
    const repo = join(f.wt, 'coverage', 'vendor-repo');
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'keep.txt'), 'x');
    // A generated folder with nothing precious is still removed.
    mkdirSync(join(f.wt, 'test-results'));

    const r = cleanWorktree({ cwd: f.wt, primary: f.primary });
    assert.equal(existsSync(join(nested, 'unsaved.txt')), true);
    assert.equal(existsSync(join(repo, 'keep.txt')), true);
    assert.equal(existsSync(join(f.wt, 'test-results')), false);
    assert.deepEqual(r.removed, ['test-results']);
    assert.deepEqual(r.kept.sort(), ['coverage', 'dist']);
  } finally {
    f.done();
  }
});
