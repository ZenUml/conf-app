#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareMixpanelConfig } from './mixpanel-staging-config.mjs';

export async function runParallel(tasks) {
  // Always join every branch. A failed build must not leave a migration or
  // variable write running while the caller begins another deployment.
  const results = await Promise.allSettled(tasks.map(task => task()));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}

async function main() {
  if (process.env.DEPLOY_LICENSE !== 'lite' || process.env.DEPLOY_ENVIRONMENT !== 'stg' || process.env.DEPLOY_PROJECT !== 'conf-stg-lite') {
    throw new Error('Parallel preparation is restricted to Lite staging');
  }
  const timings = {};
  const command = (args, options = {}) => new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', ...args], { stdio: ['pipe', 'inherit', 'inherit'], env: process.env });
    child.stdin.end(options.input ?? '');
    child.once('error', reject);
    child.once('close', code => code === 0 || options.ignoreFailure ? resolve() : reject(new Error(`${args[0]} operation failed`)));
  });
  const timed = (name, task) => async () => {
    const start = Date.now();
    try { await task(); timings[name] = { duration_ms: Date.now() - start, outcome: 'success' }; }
    catch (error) { timings[name] = { duration_ms: Date.now() - start, outcome: 'failure' }; throw error; }
  };
  try {
    await runParallel([
      timed('build', async () => {
        await new Promise((resolve, reject) => {
          const child = spawn('pnpm', ['build:lite'], { stdio: 'inherit', env: process.env });
          child.once('error', reject);
          child.once('close', code => code === 0 ? resolve() : reject(new Error('Lite build failed')));
        });
      }),
      timed('pages_configuration_and_migrations', async () => {
        await command(['wrangler', 'pages', 'secret', 'put', 'MIXPANEL_TOKEN', '--project-name=conf-stg-lite'], { input: process.env.VITE_MIXPANEL_TOKEN });
        await command(['wrangler', 'pages', 'secret', 'put', 'SENTRY_DSN', '--project-name=conf-stg-lite'], { input: process.env.SENTRY_DSN });
        if (process.env.PAGE_CAPTURE_SECRET) await command(['wrangler', 'pages', 'secret', 'put', 'PAGE_CAPTURE_SECRET', '--project-name=conf-stg-lite'], { input: process.env.PAGE_CAPTURE_SECRET });
        // Match the existing action's tolerated missing secret; the plain var
        // below must take precedence over any older secret of the same name.
        await command(['wrangler', 'pages', 'secret', 'delete', 'PAGE_CAPTURE_ALLOWED_DOMAINS', '--project-name=conf-stg-lite'], { input: 'y\n', ignoreFailure: true });
        let config = (await readFile('wrangler-stg.toml', 'utf8')).replace('name="conf-stg"', 'name="conf-stg-lite"');
        if (process.env.PAGE_CAPTURE_ALLOWED_DOMAINS) {
          config = config.replace(/^(\[vars\]|\[env\.production\.vars\])$/gm, `$1\nPAGE_CAPTURE_ALLOWED_DOMAINS = ${JSON.stringify(process.env.PAGE_CAPTURE_ALLOWED_DOMAINS)}`);
        }
        await writeFile('wrangler.toml', prepareMixpanelConfig(config, process.env.DEPLOY_ENVIRONMENT));
        if (process.env.DEPLOY_SKIP_MIGRATIONS !== 'true') await command(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--env', 'production']);
      }),
      timed('forge_configuration', async () => {
        await command(['forge', 'settings', 'set', 'usage-analytics', 'false']);
        await command(['forge', 'variables', 'set', 'MIXPANEL_TOKEN', process.env.VITE_MIXPANEL_TOKEN, '-e', 'staging']);
        await command(['forge', 'variables', 'set', 'BACKEND_API_BASE_URL', 'https://conf-stg-lite.zenuml.com', '-e', 'staging']);
      }),
    ]);
  } finally {
    // Metadata only: no environment values, subprocess arguments or raw logs.
    await writeFile('lite-deploy-preparation.json', JSON.stringify(timings, null, 2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
