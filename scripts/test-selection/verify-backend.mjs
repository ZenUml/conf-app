#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const variants = ['lite', 'full', 'diagramly', 'asyncapi'];
export async function verifyBackend({ sha, variant, url, shaOnly = false, fetchImpl = fetch, attempts = 6, delayMs = 5000, timeoutMs = 5000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!sha || !variants.includes(variant)) throw new Error('Expected SHA and valid variant are required');
  const endpoint = new URL('/__ci-version.json', url);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid backend URL');
  const count = Math.max(1, Math.min(6, attempts));
  for (let attempt = 0; attempt < count; attempt++) {
    try {
      const response = await fetchImpl(endpoint.href, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(Math.min(5000, timeoutMs)) });
      if (response.ok && /application\/json/i.test(response.headers.get('content-type') || '')) {
        const actual = await response.json();
        // Daily variants republish the same backend SHA to shared Pages. The
        // last publisher's valid variant marker may differ from this caller.
        if (actual?.sha === sha && variants.includes(actual.variant) && (shaOnly === true || actual.variant === variant)) return { sha, variant: actual.variant, verified: true };
      }
    } catch { /* Retry propagation or transient network errors without logging response bodies. */ }
    if (attempt + 1 < count) await sleep(Math.min(5000, delayMs));
  }
  throw new Error(`Backend version verification failed: expected pinned SHA${shaOnly === true ? ' with a valid variant marker' : ' and variant'} was not observed`);
}
async function main() {
  const args = process.argv.slice(2); const options = {};
  while (args.length) {
    const key = args.shift();
    if (key === '--sha-only') { options.shaOnly = true; continue; }
    if (!['--sha', '--variant', '--url'].includes(key) || !args.length) throw new Error('Invalid arguments');
    options[key.slice(2)] = args.shift();
  }
  await verifyBackend(options);
  console.log('Backend pinned version verified');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Backend pinned version verification failed'); process.exitCode = 1; });
