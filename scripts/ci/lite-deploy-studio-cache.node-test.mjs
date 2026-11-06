import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizeStudioCache } from './lite-deploy-studio-cache.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'lite-studio-cache-test-'));
  const vendor = join(root, 'vendor/asyncapi-studio');
  const output = join(root, 'static/asyncapi-studio');
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.status, 0, 'fixture Git operation must succeed');
    return result.stdout.trim();
  };
  try {
    await mkdir(vendor, { recursive: true });
    await mkdir(output, { recursive: true });
    git(vendor, 'init', '-q');
    await writeFile(join(vendor, 'source.txt'), 'pinned Studio source');
    git(vendor, 'add', 'source.txt');
    git(vendor, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'source');
    const pin = git(vendor, 'rev-parse', 'HEAD');
    git(root, 'init', '-q');
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${pin},vendor/asyncapi-studio`);
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'pin');
    await writeFile(join(output, '.studio-commit'), `${pin}\n`);
    await writeFile(join(output, 'index.html'), '<html>complete static Studio</html>');
    await writeFile(join(output, 'asset.js'), 'unchanged browser asset');
    await run({ root, vendor, output, pin, git });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('valid pinned static output survives while nested native dependencies and links are removed', async () => {
  await fixture(async ({ root, vendor, output, pin }) => {
    const outside = join(root, 'untouched-target');
    await mkdir(outside);
    await writeFile(join(outside, 'native.node'), 'must survive');
    await mkdir(join(vendor, 'node_modules/nested/node_modules'), { recursive: true });
    await writeFile(join(vendor, 'node_modules/native.node'), 'x64 binary');
    await mkdir(join(vendor, 'apps/studio'), { recursive: true });
    await symlink(outside, join(vendor, 'apps/studio/node_modules'), 'dir');
    await mkdir(join(vendor, 'packages/deep/package/node_modules'), { recursive: true });
    const before = await Promise.all(['.studio-commit', 'index.html', 'asset.js'].map(file => readFile(join(output, file))));
    const result = await sanitizeStudioCache({ root, pin, exactHit: true });
    assert.deepEqual(result, { studio_legacy_arm_exact_hit: true, studio_legacy_arm_output_valid: true, studio_legacy_arm_removed_node_modules: 3, studio_legacy_arm_remaining_node_modules: 0 });
    for (const path of ['node_modules', 'apps/studio/node_modules', 'packages/deep/package/node_modules']) {
      await assert.rejects(lstat(join(vendor, path)), { code: 'ENOENT' });
    }
    assert.equal(await readFile(join(outside, 'native.node'), 'utf8'), 'must survive');
    const after = await Promise.all(['.studio-commit', 'index.html', 'asset.js'].map(file => readFile(join(output, file))));
    assert.deepEqual(after, before, 'accepted static output must be byte-identical');
  });
});

for (const kind of ['partial-hit', 'wrong-stamp', 'whitespace-stamp', 'missing-index', 'stamp-link', 'index-link', 'nested-static-link', 'output-link']) {
  test(`rejects ${kind}, removes static output and still cleans restored dependencies`, async () => {
    await fixture(async ({ root, vendor, output, pin }) => {
      await mkdir(join(vendor, 'node_modules'), { recursive: true });
      const outside = join(root, 'untouched-static');
      await mkdir(outside);
      await writeFile(join(outside, 'index.html'), 'must survive');
      if (kind === 'wrong-stamp') await writeFile(join(output, '.studio-commit'), `${'a'.repeat(40)}\n`);
      if (kind === 'whitespace-stamp') await writeFile(join(output, '.studio-commit'), ` ${pin}\n`);
      if (kind === 'missing-index') await rm(join(output, 'index.html'));
      if (['stamp-link', 'index-link'].includes(kind)) {
        const name = kind === 'stamp-link' ? '.studio-commit' : 'index.html';
        await rm(join(output, name));
        await symlink(join(outside, 'index.html'), join(output, name));
      }
      if (kind === 'nested-static-link') await symlink(outside, join(output, 'external'), 'dir');
      if (kind === 'output-link') {
        await rm(output, { recursive: true });
        await symlink(outside, output, 'dir');
      }
      const result = await sanitizeStudioCache({ root, pin, exactHit: kind !== 'partial-hit' });
      assert.equal(result.studio_legacy_arm_output_valid, false);
      assert.equal(result.studio_legacy_arm_removed_node_modules, 1);
      assert.equal(result.studio_legacy_arm_remaining_node_modules, 0);
      await assert.rejects(lstat(output), { code: 'ENOENT' });
      assert.equal(await readFile(join(outside, 'index.html'), 'utf8'), 'must survive');
    });
  });
}

test('mismatched Git source fails safely rather than rebuilding the wrong pin', async () => {
  await fixture(async ({ root, vendor, output, pin, git }) => {
    await mkdir(join(vendor, 'node_modules'));
    await writeFile(join(vendor, 'source.txt'), 'different checkout');
    git(vendor, 'add', 'source.txt');
    git(vendor, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'different');
    await assert.rejects(sanitizeStudioCache({ root, pin, exactHit: true }), /gitlink, checkout and requested pin must match/);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
    await assert.rejects(lstat(join(vendor, 'node_modules')), { code: 'ENOENT' });
  });
});

test('symlinked parent directories are rejected without traversing their targets', async () => {
  await fixture(async ({ root, vendor, pin }) => {
    const saved = join(root, 'saved-vendor');
    const { rename } = await import('node:fs/promises');
    await rename(join(root, 'vendor'), saved);
    await mkdir(join(saved, 'asyncapi-studio/node_modules'));
    await symlink(saved, join(root, 'vendor'), 'dir');
    await assert.rejects(sanitizeStudioCache({ root, pin, exactHit: true }), /parent directories must be regular/);
    assert.deepEqual(await readdir(join(saved, 'asyncapi-studio/node_modules')), []);
  });
});
