#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { verifyBackend } from '../test-selection/verify-backend.mjs';
import { pathToFileURL } from 'node:url';

export function runtimeEvidence(label = process.env.DEPLOY_RUNNER_LABEL) {
  if (!['ubuntu-latest', 'ubuntu-24.04-arm'].includes(label)) throw new Error('Unsupported deployment runner label');
  return { runner_label: label, platform: process.platform, arch: process.arch, node: process.version };
}

async function assetDigest(directory = 'dist') {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(`${path}/${entry.name}`);
      else if (entry.name !== '__ci-version.json') files.push(`${path}/${entry.name}`);
    }
  }
  await visit(directory);
  const digest = createHash('sha256');
  for (const path of files.sort()) digest.update(path.slice(directory.length)).update('\0').update(await readFile(path));
  return digest.digest('hex');
}
async function cacheEvidence(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}
async function main() {
  const runtime = runtimeEvidence();
  const deploymentCompletedAt = new Date().toISOString();
  await verifyBackend({ sha: process.env.TARGET_SHA, variant: 'lite', url: 'https://conf-stg-lite.zenuml.com' });
  const manifestHash = createHash('sha256').update(await readFile('manifest.yml')).digest('hex');
  await writeFile('lite-deploy-evidence.json', JSON.stringify({
    schema_version: 1,
    runtime,
    source_sha: process.env.TARGET_SHA,
    tooling_sha: process.env.TOOLING_SHA,
    mode: process.env.PREPARATION_MODE,
    sample: process.env.BENCHMARK_SAMPLE,
    manifest_sha256: manifestHash,
    assets_sha256: await assetDigest(),
    cache: {
      dependencies: await cacheEvidence('lite-deploy-cache.json'),
      studio: await cacheEvidence('lite-deploy-studio-cache.json'),
      permission_specs: await cacheEvidence('lite-deploy-permissions-cache.json'),
    },
    deployment_completed_at: deploymentCompletedAt,
    backend_marker_verified: true,
    forge_attempts: await cacheEvidence('lite-deploy-forge.json'),
  }, null, 2));
  console.log('Pinned Lite backend marker verified; deployment metadata recorded.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
