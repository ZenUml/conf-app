#!/usr/bin/env node
// Retry only deployment readiness: health first, then the static asset manifest,
// because a new Worker can answer health while the previous deploy's assets are
// still being served. The protocol/render smoke runs once.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function waitForRenderMcp({
  url, sha, timeoutMs = 120_000, intervalMs = 5000, requestTimeoutMs = 5000,
  fetchImpl = fetch, now = Date.now,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
}) {
  assert.equal(new URL(url).protocol, 'https:', 'Health readiness requires HTTPS');
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Expected commit must be a full 40-character SHA');
  assert.ok(timeoutMs > 0 && timeoutMs <= 120_000, 'Readiness budget must be at most 120 seconds');
  assert.ok(intervalMs > 0 && intervalMs <= 5000, 'Health polling interval must be at most 5 seconds');
  assert.ok(requestTimeoutMs > 0 && requestTimeoutMs <= 5000, 'Health request timeout must be at most 5 seconds');
  const manifestUrl = new URL('/mcp-app/build-info.json', url).href;
  const started = now();
  const evidence = { ok: false, url, expectedCommit: sha, startedAt: new Date(started).toISOString(), elapsedMs: 0, attempts: [] };
  const finish = () => { evidence.elapsedMs = now() - started; return evidence; };
  const fail = message => {
    const error = new Error(message);
    error.evidence = { ...finish(), error: message };
    throw error;
  };
  while (now() - started < timeoutMs) {
    const attempt = { attempt: evidence.attempts.length + 1, elapsedMs: now() - started };
    evidence.attempts.push(attempt);
    let ready = false;
    let redirect = false;
    let stage = 'health';
    const readJson = async (target, record) => {
      const response = await fetchImpl(target, {
        method: 'GET', redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, timeoutMs - (now() - started)))),
      });
      record(response);
      if (response.status >= 300 && response.status < 400) {
        attempt.reason = `redirect HTTP ${response.status}`;
        redirect = true;
        return undefined;
      }
      if (response.status !== 200) {
        attempt.reason = `${stage} HTTP ${response.status}`;
        return undefined;
      }
      try {
        return await response.json();
      } catch {
        attempt.reason = `invalid ${stage} JSON`;
        return undefined;
      }
    };
    try {
      const health = await readJson(url, response => { attempt.status = response.status; });
      if (health !== undefined) {
        attempt.commit = typeof health?.commit === 'string' ? health.commit : null;
        attempt.dirty = typeof health?.dirty === 'boolean' ? health.dirty : null;
        if (health?.commit === sha && health?.dirty === false) {
          stage = 'manifest';
          const manifest = await readJson(manifestUrl, response => {
            attempt.manifestStatus = response.status;
            attempt.manifestCacheStatus = response.headers.get('cf-cache-status');
          });
          if (manifest !== undefined) {
            attempt.manifestCommit = typeof manifest?.commit === 'string' ? manifest.commit : null;
            ready = manifest?.commit === sha;
            attempt.reason = ready ? 'ready' : 'manifest commit does not match';
          }
        } else {
          attempt.reason = 'health commit or clean-source marker does not match';
        }
      }
    } catch (error) {
      attempt.reason = error.name === 'TimeoutError' || error.name === 'AbortError'
        ? `${stage} request timeout` : `${stage} network error`;
    }
    if (redirect) fail(`Readiness rejected ${attempt.reason}; redirects are not accepted`);
    if (ready && now() - started < timeoutMs) {
      evidence.ok = true;
      return finish();
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }
  fail(`Readiness timed out after ${timeoutMs}ms; last result: ${evidence.attempts.at(-1)?.reason ?? 'no response'}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/ci/wait-for-render-mcp.mjs --sha <40-character-commit> [--output evidence.json] <https://endpoint/mcp/health>');
    return;
  }
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args.splice(index, 2)[1];
  };
  const sha = option('--sha');
  const output = option('--output');
  let evidence;
  try {
    assert.equal(args.length, 1, 'Provide exactly one health endpoint URL');
    evidence = await waitForRenderMcp({ url: args[0], sha });
    console.log(`Render MCP health and asset manifest ready for commit ${sha} after ${evidence.elapsedMs}ms (${evidence.attempts.length} request(s))`);
  } catch (error) {
    evidence = error.evidence ?? { ok: false, url: args[0], expectedCommit: sha, error: error.message };
    process.exitCode = 1;
    console.error(error.message);
  } finally {
    if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
