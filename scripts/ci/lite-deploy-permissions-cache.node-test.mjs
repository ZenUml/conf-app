import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { permissionCacheInfo, validatePermissionCachePath } from './lite-deploy-permissions-cache.mjs';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@forge/cli/package.json'));

test('public cache selection rejects auth stores, folders and output injection', () => {
  for (const path of ['/tmp/@forge-cli-nodejs/config.json', '/tmp/PERMISSIONS_LINTER-nodejs', '/tmp/PERMISSIONS_LINTER-nodejs/credentials.json', '/tmp/PERMISSIONS_LINTER-nodejs/config.json\nkey=other', 'PERMISSIONS_LINTER-nodejs/config.json']) {
    assert.throws(() => validatePermissionCachePath(path));
  }
  assert.equal(validatePermissionCachePath('/tmp/PERMISSIONS_LINTER-nodejs/config.json'), '/tmp/PERMISSIONS_LINTER-nodejs/config.json');
});
test('installed CLI public cache path and versions define exact 12h keys', async () => {
  const first = await permissionCacheInfo({ now: 24 * 60 * 60 * 1000 });
  const same = await permissionCacheInfo({ now: 30 * 60 * 60 * 1000 });
  const next = await permissionCacheInfo({ now: 36 * 60 * 60 * 1000 });
  assert.equal(basename(first.path), 'config.json');
  assert.equal(basename(dirname(first.path)), 'PERMISSIONS_LINTER-nodejs');
  assert.equal(first.key, same.key);
  assert.equal(next.restoreKey, first.key);
  assert.ok(first.key.includes(`-${process.platform}-${cliRequire('./package.json').version}-${cliRequire('@forge/lint/package.json').version}-`));
  const directory = await mkdtemp(join(tmpdir(), 'permission-cache-lock-'));
  try {
    const file = join(directory, 'lock'); await writeFile(file, 'different lock');
    assert.notEqual((await permissionCacheInfo({ now: 24 * 60 * 60 * 1000, lockFile: file })).key, first.key);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('installed CLI cache naturally rejects expired Swagger entries without changing expiry', () => {
  const { CachedConf } = cliRequire('@forge/cli-shared');
  const store = new Map();
  const cache = new CachedConf(store);
  const expired = { value: { paths: {} }, expiry: Date.now() - 1000 };
  const fresh = { value: { paths: { '/example': {} } }, expiry: Date.now() + 60000 };
  store.set('expired-public-spec', expired); store.set('fresh-public-spec', fresh);
  assert.equal(cache.get('expired-public-spec'), undefined);
  assert.deepEqual(cache.get('fresh-public-spec'), fresh.value);
  assert.equal(store.get('expired-public-spec').expiry, expired.expiry);
  assert.equal(store.get('fresh-public-spec').expiry, fresh.expiry);
});
test('installed permission linter refetches expired public docs and keeps fresh cached docs', async () => {
  const { CachedConf } = cliRequire('@forge/cli-shared');
  const lintDirectory = dirname(cliRequire.resolve('@forge/lint/package.json'));
  const { PermissionLinter } = cliRequire(join(lintDirectory, 'out/lint/linters/permission-linter/permission-linter.js'));
  const store = new Map();
  const cache = new CachedConf(store);
  const cachedDoc = { paths: { '/cached': {} } };
  const newDoc = { paths: { '/fresh': {} } };
  store.set('fresh-public-spec', { value: cachedDoc, expiry: Date.now() + 60000 });
  store.set('expired-public-spec', { value: cachedDoc, expiry: Date.now() - 1000 });
  const linter = new PermissionLinter('staging', {}, {});
  linter.cache = cache;
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return { json: async () => newDoc }; };
  try {
    assert.deepEqual(await linter.getProductPaths('fresh-public-spec', 'https://example.invalid/public-spec'), cachedDoc);
    assert.equal(calls.length, 0);
    const before = Date.now();
    assert.deepEqual(await linter.getProductPaths('expired-public-spec', 'https://example.invalid/public-spec'), newDoc);
    assert.deepEqual(calls, ['https://example.invalid/public-spec']);
    const expiry = store.get('expired-public-spec').expiry;
    assert.ok(expiry >= before + 12 * 60 * 60 * 1000);
    assert.ok(expiry <= Date.now() + 12 * 60 * 60 * 1000);
  } finally { globalThis.fetch = originalFetch; }
});

test('candidate restores exactly the dedicated cache after frozen install and before preparation', async () => {
  const action = yaml.load(await readFile(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8'));
  const steps = action.runs.steps;
  const install = steps.findIndex(step => step.name === 'Install dependencies');
  const resolve = steps.findIndex(step => step.id === 'permissions-cache-path');
  const cache = steps.findIndex(step => step.id === 'permissions-cache');
  const prepare = steps.findIndex(step => step.name === 'Prepare Lite staging in parallel');
  assert.ok(install < resolve && resolve < cache && cache < prepare);
  assert.equal(steps[cache].if, "inputs.preparation-mode == 'candidate'");
  assert.equal(steps[cache].with.path, '${{ steps.permissions-cache-path.outputs.path }}');
  assert.equal(steps[cache].with.key, '${{ steps.permissions-cache-path.outputs.key }}');
  assert.equal(steps[cache].with['restore-keys'], '${{ steps.permissions-cache-path.outputs.restore-key }}');
});
