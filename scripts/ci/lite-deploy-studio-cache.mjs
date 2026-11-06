#!/usr/bin/env node
import { lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

async function info(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Never follow links: unlinking a cached node_modules link must not remove its target.
async function dependencyDirectories(directory, remove = false) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === 'node_modules') {
      count++;
      if (remove) await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) count += await dependencyDirectories(path, remove);
  }
  return count;
}

async function regularTree(directory) {
  if (!(await info(directory))?.isDirectory()) return false;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!await regularTree(join(directory, entry.name))) return false; }
    else if (!entry.isFile()) return false;
  }
  return true;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

export async function sanitizeStudioCache({ root = process.cwd(), pin, exactHit }) {
  root = resolve(root);
  const vendor = join(root, 'vendor/asyncapi-studio');
  const output = join(root, 'static/asyncapi-studio');
  const staticParent = await info(join(root, 'static'));
  if (!(await info(join(root, 'vendor')))?.isDirectory() || (staticParent && !staticParent.isDirectory())) {
    throw new Error('Studio cache parent directories must be regular directories');
  }
  // A symlinked source root cannot be safely traversed or used for native installation.
  if (!(await info(vendor))?.isDirectory()) throw new Error('Studio source directory must be a regular directory');
  const removed = await dependencyDirectories(vendor, true);
  const remaining = await dependencyDirectories(vendor);
  if (remaining !== 0) throw new Error('Restored Studio dependencies remain');

  const gitlink = git(root, ['ls-tree', 'HEAD', '--', 'vendor/asyncapi-studio']);
  const gitlinkPin = /^160000 commit ([0-9a-f]{40})\tvendor\/asyncapi-studio$/.exec(gitlink)?.[1];
  const head = git(vendor, ['rev-parse', 'HEAD']);
  const sourceMatches = /^[0-9a-f]{40}$/.test(pin ?? '') && gitlinkPin === pin && head === pin;
  const stamp = join(output, '.studio-commit');
  const index = join(output, 'index.html');
  let valid = exactHit === true && sourceMatches && await regularTree(output) &&
    (await info(stamp))?.isFile() && (await info(index))?.isFile();
  if (valid) {
    const value = await readFile(stamp, 'utf8');
    valid = value === pin || value === `${pin}\n`;
  }
  if (!valid) await rm(output, { recursive: true, force: true });
  // Rebuilding a mismatched checkout would silently build the wrong source.
  if (!sourceMatches) throw new Error('Studio gitlink, checkout and requested pin must match');
  return {
    studio_legacy_arm_exact_hit: exactHit === true,
    studio_legacy_arm_output_valid: Boolean(valid),
    studio_legacy_arm_removed_node_modules: removed,
    studio_legacy_arm_remaining_node_modules: remaining,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await sanitizeStudioCache({ pin: process.env.STUDIO_PIN, exactHit: process.env.LEGACY_CACHE_HIT === 'true' });
    await writeFile('lite-deploy-studio-legacy-sanitization.json', JSON.stringify(evidence));
    console.log(JSON.stringify(evidence));
  } catch {
    console.error('Studio legacy cache validation failed');
    process.exitCode = 1;
  }
}
