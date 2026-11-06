#!/usr/bin/env node
// Read-only deployment check. No diagram bodies or credentials enter evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/ci/check-render-mcp.mjs --sha <40-character-commit> [--output evidence.json] <https://endpoint/mcp> [...]');
  process.exit(0);
}
const option = name => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args.splice(index, 2)[1];
};
const sha = option('--sha');
const output = option('--output');
assert.match(sha ?? '', /^[a-f0-9]{40}$/, '--sha requires the exact source commit');
assert.ok(args.length, 'Provide one or more MCP endpoint URLs');
const evidence = { ok: false, expectedCommit: sha, checkedAt: new Date().toISOString(), endpoints: [] };
const marker = '<meta name="mcp-app" content="zenuml-diagram">';
let requestId = 0;
const compatibleMime = (actual, expected) => {
  const mime = actual.split(';', 1)[0].trim().toLowerCase();
  if (/^(?:application|text)\/(?:javascript|ecmascript)$/.test(expected)) {
    return /^(?:application|text)\/(?:javascript|ecmascript)$/.test(mime);
  }
  if (/^(?:application|text)\/xml$/.test(expected)) return /^(?:application|text)\/xml$/.test(mime);
  return mime === expected;
};
const checkedFetch = async (url, init = {}) => {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `${url}: HTTP ${response.status}`);
  return response;
};
async function rpc(url, method, params = {}) {
  const response = await checkedFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  const text = await response.text();
  // The stateless transport may return JSON or one JSON-RPC SSE message.
  const payload = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim())).find(value => value.id === requestId)
    : JSON.parse(text);
  assert.ok(payload?.result && !payload.error, `${url}: ${method} did not return a JSON-RPC result`);
  return payload.result;
}
try {
  let reference;
  for (const endpoint of args) {
    const url = new URL(endpoint);
    const origin = ['zenuml.com', 'conf-lite.zenuml.com'].includes(url.hostname) ? 'https://zenuml.com' : url.origin;
    assert.equal(url.protocol, 'https:', 'Deployment checks require HTTPS');
    const record = { endpoint, assets: [] };
    evidence.endpoints.push(record);
    const health = await (await checkedFetch(new URL('/mcp/health', url))).json();
    assert.equal(health.commit, sha, `${endpoint}: wrong deployed commit`);
    assert.equal(health.dirty, false, `${endpoint}: deployed source was dirty`);
    assert.match(health.viewSha256 ?? '', /^[a-f0-9]{64}$/);
    record.health = health;
    const initialized = await rpc(endpoint, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } },
      clientInfo: { name: 'render-mcp-ci-smoke', version: '1' },
    });
    assert.ok(initialized.capabilities?.tools, 'Server must expose tools');
    await checkedFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    const tools = await rpc(endpoint, 'tools/list');
    assert.ok(tools.tools?.some(tool => tool.name === 'render_diagram'), 'render_diagram missing');
    record.tools = tools.tools.map(tool => tool.name);
    const rendered = await rpc(endpoint, 'tools/call', {
      name: 'render_diagram',
      arguments: { diagramType: 'sequence', source: 'Alice -> Bob: CI smoke' },
    });
    assert.equal(rendered.structuredContent?.valid, true, 'Synthetic sequence did not parse');
    assert.notEqual(rendered.isError, true, 'Synthetic render tool returned an error');
    record.renderValid = true;
    const resources = await rpc(endpoint, 'resources/list');
    const listed = resources.resources?.find(resource => resource.uri === 'ui://zenuml/diagram');
    assert.ok(listed, 'Diagram resource missing');
    const read = await rpc(endpoint, 'resources/read', { uri: listed.uri });
    const view = read.contents?.find(content => content.uri === listed.uri);
    assert.ok(view?.text?.includes(marker), 'Resource is not the MCP Apps view');
    assert.equal(view.mimeType, 'text/html;profile=mcp-app');
    assert.ok(view._meta?.ui?.csp, 'Resource CSP missing');
    assert.deepEqual(view._meta.ui.csp, {
      resourceDomains: [origin], connectDomains: [origin], frameDomains: [],
    }, 'Resource CSP does not match the allowed origins');
    assert.deepEqual(view._meta.ui.csp, listed._meta?.ui?.csp, 'Listed/read resource CSP differs');
    const parity = { html: view.text, csp: view._meta.ui.csp };
    if (reference) assert.deepEqual(parity, reference, 'Canonical and compatibility resource HTML/CSP differ');
    else reference = parity;
    record.csp = view._meta.ui.csp;
    // The resource HTML points at the actual independently deployed bundles.
    const refs = [...view.text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => new URL(match[1], url));
    assert.ok(refs.some(ref => ref.pathname.endsWith('.js')), 'View must reference its JavaScript bundle');
    for (const asset of refs) {
      const response = await checkedFetch(asset);
      const type = response.headers.get('content-type') ?? '';
      assert.ok(compatibleMime(type, asset.pathname.endsWith('.js') ? 'application/javascript' : 'text/css'), `${asset}: wrong asset MIME ${type}`);
      assert.equal(response.headers.get('access-control-allow-origin'), '*', `${asset}: missing public CORS`);
      const body = await response.text();
      assert.ok(!/^\s*(?:<!doctype|<html)/i.test(body), `${asset}: HTML returned for an asset`);
      assert.ok(body.length > 0, `${asset}: empty asset`);
      record.assets.push({ url: asset.href, contentType: type, bytes: Buffer.byteLength(body) });
    }
    const direct = await checkedFetch(new URL('/mcp-app/view.html', refs[0]));
    const directHtml = await direct.text();
    assert.ok(directHtml.includes(marker), 'Direct HTML path returned the SPA shell');
    assert.equal(createHash('sha256').update(directHtml).digest('hex'), health.viewSha256, 'Direct view hash differs from deployed build metadata');
    const missing = await fetch(`${origin}/mcp-app/assets/not-found-ci-check.js`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    assert.equal(missing.status, 404, 'Missing asset must return 404 instead of an SPA shell');
    const manifest = await (await checkedFetch(`${origin}/mcp-app/build-info.json`)).json();
    assert.equal(manifest.commit, sha, 'Asset manifest comes from a different build');
    assert.ok(Array.isArray(manifest.smokeAssets), 'Asset manifest missing');
    const required = manifest.smokeAssets;
    assert.ok(required.some(asset => /IBMPlexSans-Regular-Latin1.*\.woff2$/.test(asset.path)), 'IBM Plex font missing from asset manifest');
    assert.ok(required.some(asset => /MS-Sans-Serif.*\.ttf$/.test(asset.path)), 'MS Sans font missing from asset manifest');
    for (const path of ['/drawio/js/viewer-static.min.js', '/drawio/stencils/aws4.xml', '/drawio/math4/es5/startup.js']) {
      assert.ok(required.some(asset => asset.path === path), `${path}: required DrawIO asset missing from manifest`);
    }
    for (const expected of required) {
      const { path } = expected;
      assert.ok(typeof path === 'string' && (path.startsWith('/mcp-app/assets/') || path.startsWith('/drawio/')), 'Unexpected asset manifest path');
      const asset = new URL(path, origin);
      assert.equal(asset.origin, origin, 'Asset manifest must stay on the canonical origin');
      const response = await checkedFetch(asset);
      const type = response.headers.get('content-type') ?? '';
      assert.ok(!type.includes('text/html'), `${asset}: SPA HTML returned for an asset`);
      assert.ok(typeof expected.contentType === 'string' && compatibleMime(type, expected.contentType), `${asset}: unexpected MIME ${type}`);
      assert.equal(response.headers.get('access-control-allow-origin'), '*', `${asset}: missing public CORS`);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(body).digest('hex'), expected.sha256, `${asset}: bytes differ from deployed manifest`);
      record.assets.push({ url: asset.href, contentType: type, bytes: body.length, sha256: expected.sha256 });
    }
  }
  evidence.ok = true;
  console.log(`Render MCP smoke passed for ${evidence.endpoints.length} endpoint(s), commit ${sha}`);
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
}
