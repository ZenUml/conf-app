#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const windowMs = 12 * 60 * 60 * 1000;
export function validatePermissionCachePath(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || /[\r\n\0]/.test(file)) throw new Error('Invalid public permission cache path');
  const path = resolve(file);
  if (basename(path) !== 'config.json' || basename(dirname(path)) !== 'PERMISSIONS_LINTER-nodejs') {
    throw new Error('Only the dedicated public permission-linter cache may be restored');
  }
  return path;
}

export async function permissionCacheInfo({ now = Date.now(), lockFile = 'pnpm-lock.yaml' } = {}) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid permission cache clock');
  // Resolve only the installed CLI's dedicated public schema store. Do not
  // select its general configuration project, credentials or parent folder.
  const cliPackage = require.resolve('@forge/cli/package.json');
  const cliRequire = createRequire(cliPackage);
  const { CachedConf } = cliRequire('@forge/cli-shared');
  const path = validatePermissionCachePath(CachedConf.getCache('PERMISSIONS_LINTER').conf.path);
  const cliVersion = cliRequire('./package.json').version;
  const lintVersion = cliRequire('@forge/lint/package.json').version;
  const lockDigest = createHash('sha256').update(await readFile(lockFile)).digest('hex');
  const window = Math.floor(now / windowMs);
  const prefix = `lite-deploy-permission-specs-v1-${process.platform}-${cliVersion}-${lintVersion}-${lockDigest}`;
  return { path, key: `${prefix}-${window}`, restoreKey: `${prefix}-${window - 1}` };
}
async function main() {
  const info = await permissionCacheInfo();
  await appendFile(process.env.GITHUB_OUTPUT, `path=${info.path}\nkey=${info.key}\nrestore-key=${info.restoreKey}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
