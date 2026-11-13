// @vitest-environment node
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { waitForRenderMcp } from './wait-for-render-mcp.mjs';

const sha = 'a'.repeat(40);
const url = 'https://preview.example/mcp/health';
const manifestUrl = 'https://preview.example/mcp-app/build-info.json';
const ready = () => Response.json({ commit: sha, dirty: false });
const currentManifest = () => Response.json({ commit: sha });
function fixture(responses, timeoutMs = 120_000, manifests = [currentManifest]) {
  let clock = 0;
  const requests = [];
  const manifestRequests = [];
  const sleeps = [];
  return {
    requests, manifestRequests, sleeps, elapsed: () => clock,
    run: () => waitForRenderMcp({
      url, sha, timeoutMs, now: () => clock,
      sleep: async milliseconds => { sleeps.push(milliseconds); clock += milliseconds; },
      fetchImpl: async (requested, options) => {
        const isManifest = requested === manifestUrl;
        const log = isManifest ? manifestRequests : requests;
        const results = isManifest ? manifests : responses;
        log.push({ requested, options });
        const result = results[Math.min(log.length - 1, results.length - 1)];
        if (result instanceof Error) throw result;
        return typeof result === 'function' ? result() : result;
      },
    }),
  };
}
describe('bounded Render MCP asset manifest readiness', () => {
  const previous = () => Response.json({ commit: 'c'.repeat(40) });
  it('waits while health is current but the manifest is still from the previous deploy', async () => {
    const f = fixture([ready], 120_000, [previous, previous, currentManifest]);
    const report = await f.run();
    expect(report.ok).toBe(true);
    expect(report.attempts).toHaveLength(3);
    expect(report.attempts[0].manifestCommit).toBe('c'.repeat(40));
    expect(report.attempts[0].reason).toMatch(/manifest commit/);
    expect(report.attempts[2].manifestCommit).toBe(sha);
    expect(f.sleeps).toEqual([5000, 5000]);
  });
  it('still fails when the manifest never reaches the expected commit', async () => {
    const f = fixture([ready], 12_000, [previous]);
    await expect(f.run()).rejects.toMatchObject({
      message: expect.stringMatching(/manifest commit/),
      evidence: { ok: false, elapsedMs: 12_000 },
    });
  });
  it('does not read the manifest until health is ready', async () => {
    const f = fixture([new Response('', { status: 404 }), ready]);
    await f.run();
    expect(f.manifestRequests).toHaveLength(1);
  });
  it('records the edge cache status so the next stale read can be diagnosed', async () => {
    const stale = () => Response.json({ commit: 'c'.repeat(40) }, { headers: { 'cf-cache-status': 'HIT' } });
    const f = fixture([ready], 120_000, [stale, currentManifest]);
    const report = await f.run();
    expect(report.attempts[0].manifestCacheStatus).toBe('HIT');
  });
  it('retries manifest HTTP errors and invalid JSON', async () => {
    const f = fixture([ready], 120_000, [new Response('', { status: 500 }), () => new Response('<html>'), currentManifest]);
    const report = await f.run();
    expect(report.ok).toBe(true);
    expect(report.attempts[0].reason).toMatch(/manifest HTTP 500/);
    expect(report.attempts[1].reason).toMatch(/invalid manifest JSON/);
  });
  it('rejects a manifest redirect immediately', async () => {
    const redirect = new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } });
    const f = fixture([ready], 120_000, [redirect, currentManifest]);
    await expect(f.run()).rejects.toThrow(/redirect.*302/i);
    expect(f.manifestRequests).toHaveLength(1);
    expect(f.manifestRequests[0].options.redirect).toBe('manual');
  });
});
describe('Render MCP workflow artifact handoff', () => {
  const { jobs } = yaml.load(readFileSync(new URL('../../.github/workflows/render-mcp-deploy.yml', import.meta.url), 'utf8'));
  const step = (job, action, path) => job.steps.find(item => item.uses?.startsWith(action) && item.with?.path === path);
  const assets = 'workers/render-mcp/dist/assets';
  it('downloads the name the check job uploaded, so a failed-only deploy rerun finds it', () => {
    const uploaded = step(jobs.check, 'actions/upload-artifact', assets).with.name;
    const downloaded = step(jobs.deploy, 'actions/download-artifact', assets).with.name;
    expect(jobs.check.outputs['assets-artifact']).toBe(uploaded);
    expect(downloaded).toBe('${{ needs.check.outputs.assets-artifact }}');
  });
});
describe('bounded Render MCP health readiness', () => {
  it('waits for a first-deployment 404 to become the expected clean commit', async () => {
    const f = fixture([new Response('', { status: 404 }), ready]);
    const report = await f.run();
    expect(report.ok).toBe(true);
    expect(report.attempts).toHaveLength(2);
    expect(f.sleeps).toEqual([5000]);
    expect(f.requests.every(request => request.options.method === 'GET' && request.options.redirect === 'manual')).toBe(true);
    expect(f.requests.every(request => request.requested === url && request.options.signal instanceof AbortSignal)).toBe(true);
  });
  it('waits for the exact commit instead of accepting an older healthy deployment', async () => {
    const f = fixture([Response.json({ commit: 'b'.repeat(40), dirty: false }), ready]);
    const report = await f.run();
    expect(report.ok).toBe(true);
    expect(report.attempts[0].reason).toMatch(/commit/);
  });
  it('recovers from a health network error without rerunning tool calls', async () => {
    const f = fixture([new TypeError('fetch failed'), ready]);
    const report = await f.run();
    expect(report.ok).toBe(true);
    expect(report.attempts[0].reason).toMatch(/network/);
    expect(f.requests).toHaveLength(2);
  });
  it('recovers from a short request timeout', async () => {
    const error = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    const report = await fixture([error, ready]).run();
    expect(report.ok).toBe(true);
    expect(report.attempts[0].reason).toMatch(/timeout/);
  });
  it('never accepts a matching commit marked dirty', async () => {
    const f = fixture([() => Response.json({ commit: sha, dirty: true })], 11_000);
    await expect(f.run()).rejects.toMatchObject({ evidence: { ok: false, elapsedMs: 11_000 } });
    expect(f.elapsed()).toBe(11_000);
    expect(f.sleeps).toEqual([5000, 5000, 1000]);
  });
  it('bounds invalid health JSON to the deadline', async () => {
    const f = fixture([() => new Response('<html>SPA</html>')], 12_000);
    try { await f.run(); throw new Error('Unexpected success'); }
    catch (error) {
      expect(error.evidence.ok).toBe(false);
      expect(error.evidence.elapsedMs).toBe(12_000);
      expect(error.evidence.attempts.every(attempt => /invalid/.test(attempt.reason))).toBe(true);
    }
  });
  it('stops persistent 404 responses within the 120 second total budget', async () => {
    const f = fixture([() => new Response('', { status: 404 })]);
    await expect(f.run()).rejects.toMatchObject({ evidence: { ok: false, elapsedMs: 120_000 } });
    expect(f.elapsed()).toBe(120_000);
    expect(f.requests).toHaveLength(24);
    expect(f.sleeps.every(delay => delay <= 5000)).toBe(true);
  });
  it('rejects redirects immediately without following or retrying', async () => {
    const f = fixture([new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } }), ready]);
    await expect(f.run()).rejects.toThrow(/redirect.*302/i);
    expect(f.requests).toHaveLength(1);
    expect(f.sleeps).toEqual([]);
  });
  it('rejects insecure URLs or malformed expected commits before any request', async () => {
    await expect(waitForRenderMcp({ url: 'http://example.test/health', sha })).rejects.toThrow(/HTTPS/);
    await expect(waitForRenderMcp({ url, sha: 'short' })).rejects.toThrow(/commit/);
  });
});
