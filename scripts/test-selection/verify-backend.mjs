#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// __ci-version.json describes a staging Cloudflare Pages backend. The backend
// is one component per project (functions/ is identical across variants, and
// both projects bind the same D1/KV/R2), so it is identified by project, not
// by the variant that happened to publish it.
const PROJECTS = ['conf-stg-lite', 'conf-stg-full'];
export async function verifyBackend({ sha, project, url, fetchImpl = fetch, attempts = 6, delayMs = 5000, timeoutMs = 5000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!sha || !PROJECTS.includes(project)) throw new Error('Expected SHA and valid project are required');
  const endpoint = new URL('/__ci-version.json', url);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid backend URL');
  const count = Math.max(1, Math.min(6, attempts));
  for (let attempt = 0; attempt < count; attempt++) {
    try {
      const response = await fetchImpl(endpoint.href, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(Math.min(5000, timeoutMs)) });
      if (response.ok && /application\/json/i.test(response.headers.get('content-type') || '')) {
        const actual = await response.json();
        if (actual.sha === sha && actual.project === project) return { sha, project, verified: true };
      }
    } catch { /* Retry propagation or transient network errors without logging response bodies. */ }
    if (attempt + 1 < count) await sleep(Math.min(5000, delayMs));
  }
  throw new Error('Backend version verification failed: expected pinned SHA and project were not observed');
}
async function main() {
  const args = process.argv.slice(2); const options = {};
  while (args.length) { const key = args.shift(); if (!['--sha', '--project', '--url'].includes(key) || !args.length) throw new Error('Invalid arguments'); options[key.slice(2)] = args.shift(); }
  await verifyBackend(options);
  console.log('Backend pinned version verified');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Backend pinned version verification failed'); process.exitCode = 1; });
