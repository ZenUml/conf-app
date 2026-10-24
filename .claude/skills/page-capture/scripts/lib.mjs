// Shared constants and CLI/REST helpers for the page-capture skill scripts.
// All four scripts in this directory import from here instead of duplicating
// credential resolution or the app/project ID tables.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPS = {
  lite: '8ad26115-211f-4216-971b-0540f606303d',
  full: 'd9e4002b-120b-426b-834b-402a4a5adce7',
  diagramly: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
  asyncapi: '49017727-af19-4ab6-8d5a-7d28108936b6',
};

// Cloudflare Pages project each app's backend deploys to, per Forge
// environment. diagramly and asyncapi share Lite's backend project.
export const CF_PROJECT = {
  production: { lite: 'conf-lite', full: 'conf-full', diagramly: 'conf-lite', asyncapi: 'conf-lite' },
  staging: { lite: 'conf-stg-lite', full: 'conf-stg-full', diagramly: 'conf-stg-lite', asyncapi: 'conf-stg-lite' },
};

export const D1 = {
  staging: { name: 'conf-zenuml-stg', id: '5894387c-08be-43d7-b8dc-0b7b8eb7c264' },
  production: { name: 'conf-zenuml-prod', id: '2e34f32e-5ddd-40dc-9e3d-019f9b1d431f' },
};

export const R2_BUCKET = 'atlassian-events';
export const R2_TTL_DAYS = 7; // objects under page-snapshots/ expire after 7 days (see wrangler-prod.toml comment)
export const REPO = 'ZenUml/conf-app';
export const ALLOWLIST_VAR = { staging: 'PAGE_CAPTURE_ALLOWED_DOMAINS_STG', production: 'PAGE_CAPTURE_ALLOWED_DOMAINS_PROD' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..'); // scripts/ -> page-capture/ -> skills/ -> .claude/ -> repo root

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

// --- Cloudflare account id ---------------------------------------------

export function cfAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  for (const envPath of [join(process.cwd(), '.env'), join(REPO_ROOT, '.env')]) {
    if (!existsSync(envPath)) continue;
    const match = readFileSync(envPath, 'utf8').match(/^CLOUDFLARE_ACCOUNT_ID=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error('CLOUDFLARE_ACCOUNT_ID not found in env or .env');
}

// --- Cloudflare REST token (R2 object listing has no wrangler CLI equivalent) ---
// Priority: CLOUDFLARE_API_TOKEN env var (documented container credential),
// then wrangler's own OAuth session (local `wrangler login`, developer laptop).

export function cfApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return { token: process.env.CLOUDFLARE_API_TOKEN, source: 'env:CLOUDFLARE_API_TOKEN' };
  }
  for (const cfgPath of [
    join(homedir(), '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.config', '.wrangler', 'config', 'default.toml'),
  ]) {
    if (!existsSync(cfgPath)) continue;
    const match = readFileSync(cfgPath, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
    if (match) return { token: match[1], source: `wrangler-oauth:${cfgPath}` };
  }
  throw new Error('No Cloudflare API token found (CLOUDFLARE_API_TOKEN unset, no wrangler OAuth session)');
}

export async function cfApiGet(path) {
  const { token } = cfApiToken();
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!body.success) throw new Error(`Cloudflare API ${path} failed: ${JSON.stringify(body.errors)}`);
  return body.result;
}

// --- D1 (via wrangler CLI, works standalone with no wrangler.toml present) ---

export function d1Query(env, sql) {
  const db = D1[env];
  if (!db) throw new Error(`Unknown D1 env: ${env}`);
  const out = run('npx', ['wrangler', 'd1', 'execute', db.name, '--remote', '--json', '--command', sql]);
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

// --- R2 (list via REST, single-object read via wrangler CLI) ---

export async function r2ListObjects(prefix) {
  const account = cfAccountId();
  const result = await cfApiGet(
    `/accounts/${account}/r2/buckets/${R2_BUCKET}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000`,
  );
  return result;
}

export function r2ObjectGet(key) {
  const out = run('npx', ['wrangler', 'r2', 'object', 'get', `${R2_BUCKET}/${key}`, '--remote', '--pipe']);
  return JSON.parse(out);
}

// --- Forge variables (kill switch) ---

export function forgeVariablesList(env, app) {
  const appId = APPS[app];
  if (!appId) throw new Error(`Unknown app: ${app}`);
  const envVars = app === 'lite' ? process.env : { ...process.env, APP_ID: appId };
  const out = run('npx', ['forge', 'variables', 'list', '-e', env, '--json'], { env: envVars });
  return JSON.parse(out);
}

export function forgeVariablesSet(env, app, key, value, { encrypt = false } = {}) {
  const appId = APPS[app];
  if (!appId) throw new Error(`Unknown app: ${app}`);
  const envVars = app === 'lite' ? process.env : { ...process.env, APP_ID: appId };
  const args = ['forge', 'variables', 'set', '-e', env];
  if (encrypt) args.push('--encrypt');
  args.push(key, value);
  run('npx', args, { env: envVars });
}

// --- GitHub Actions repo variables (allowlist) ---

export function ghVariableGet(name) {
  try {
    return run('gh', ['variable', 'get', name, '--repo', REPO]).trim();
  } catch (err) {
    if (String(err.stderr || err.message).includes('not found')) return null;
    throw err;
  }
}

export function ghVariableSet(name, value) {
  run('gh', ['variable', 'set', name, '--repo', REPO, '--body', value]);
}

// --- misc ---

export function splitDomains(value) {
  return (value ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

export function daysSince(isoTimestamp, nowMs = Date.now()) {
  return (nowMs - new Date(isoTimestamp).getTime()) / 86_400_000;
}
