// Measure what the MCP App view downloads for a first diagram of each type.
//
// usage: node measure.mjs <dist-dir> <out.json> [kbps]
//
// Serves <dist-dir> on 127.0.0.1:<port> (the view's origin) and a host page on
// localhost:<port2> (a different origin, like a real host's sandbox), plays the
// host side of the MCP Apps handshake, sends one tool-input then one
// tool-result, and records every response the view's frame received. Sizes
// are brotli at quality 4, which matches what Cloudflare serves (zenuml chunk: 841,382 B served, 844,687 B at q4) and raw.
// With [kbps], the network is throttled to that bandwidth and 100 ms latency
// via CDP, and the time to a drawn diagram is recorded too.
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [, , distDir, outFile, kbpsArg] = process.argv;
const kbps = kbpsArg ? Number(kbpsArg) : 0;

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.xml': 'text/xml', '.png': 'image/png', '.json': 'application/json' };

function serveDist(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      let file = join(distDir, path);
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      let body = readFileSync(file);
      // Compressed as Cloudflare would, so throttled timings reflect real transfer sizes.
      if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '') && /\.(js|css|html|svg|xml|json)$/.test(file)) {
        body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
        headers['content-encoding'] = 'br';
      }
      res.writeHead(200, headers);
      res.end(body);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const SOURCES = {
  sequence: 'title Login\nUser->WebApp.login(email, password) {\n  WebApp->AuthService.authenticate(email, password) {\n    AuthService->UserDB.findUser(email)\n    return token\n  }\n  return session\n}',
  mermaid: 'flowchart TD\n  A[Build] --> B[Test]\n  B --> C[Deploy to staging]\n  C --> D{Smoke test}\n  D -->|pass| E[Deploy to production]\n  D -->|fail| F[Roll back]',
};

function hostPage(viewUrl, type) {
  const source = JSON.stringify(SOURCES[type]);
  return `<!doctype html><html><body>
<iframe id="v" src="${viewUrl}" style="width:900px;height:900px;border:0"></iframe>
<script>
const frame = document.getElementById('v');
window.drawn = false;
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || e.source !== frame.contentWindow) return;
  if (m.method === 'ui/initialize') {
    frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'harness', version: '1' }, hostCapabilities: {}, hostContext: {} } }, '*');
  } else if (m.method === 'ui/notifications/initialized') {
    const args = { diagramType: '${type}', source: ${source} };
    frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: args } }, '*');
    // the tool answers in ~50 ms (Mixpanel, #1038)
    setTimeout(() => frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { diagramType: '${type}', source: ${source}, valid: true } } }, '*'), 50);
  } else if (m.method === 'ui/notifications/size-changed') {
    window.lastHeight = m.params.height;
  }
});
</script></body></html>`;
}

async function measure(browser, viewOrigin, hostPort, type) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const responses = [];
  page.on('response', async (r) => {
    if (!r.url().startsWith(viewOrigin)) return;
    try {
      const body = await r.body();
      responses.push({ url: r.url().slice(viewOrigin.length), raw: body.length, br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length });
    } catch { /* aborted */ }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (kbps) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: (kbps * 1000) / 8, uploadThroughput: (kbps * 1000) / 8 });
  }
  const hostServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(hostPage(`${viewOrigin}/mcp-app/view.html`, type)); });
  await new Promise((r) => hostServer.listen(hostPort, 'localhost', r));
  const t0 = Date.now();
  await page.goto(`http://localhost:${hostPort}/`);
  const frame = await (await page.waitForSelector('#v')).contentFrame();
  const statuses = new Set();
  let drawnMs = null;
  const deadline = Date.now() + (kbps ? 180_000 : Number(process.env.DEADLINE_MS ?? 60_000));
  while (Date.now() < deadline) {
    const state = await frame.evaluate(() => ({ svg: !!document.querySelector('#app svg') && !document.querySelector('.zen-mcp-status'), status: document.querySelector('.zen-mcp-status')?.textContent ?? null })).catch(() => null);
    if (state?.status) statuses.add(state.status);
    if (state?.svg) { drawnMs = Date.now() - t0; break; }
    await page.waitForTimeout(100);
  }
  const shot = outFile.replace(/\.json$/, `-${type}.png`);
  await page.screenshot({ path: shot });
  await context.close();
  hostServer.close();
  const totals = responses.reduce((a, r) => ({ raw: a.raw + r.raw, br: a.br + r.br }), { raw: 0, br: 0 });
  return { type, kbps, drawnMs, statuses: [...statuses], files: responses.length, totals, responses, screenshot: shot };
}

const port = 47100 + Math.floor(Math.random() * 500);
const server = await serveDist(port);
const browser = await chromium.launch();
const results = [];
let hostPort = port + 1000;
for (const type of Object.keys(SOURCES)) results.push(await measure(browser, `http://127.0.0.1:${port}`, hostPort++, type));
await browser.close();
server.close();
writeFileSync(outFile, JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`${r.type}: ${r.files} files, br ${(r.totals.br / 1024).toFixed(0)} KB, raw ${(r.totals.raw / 1024).toFixed(0)} KB, drawn ${r.drawnMs ?? 'NO'} ms${kbps ? ` at ${kbps} kbps` : ''}; statuses: ${r.statuses.join(' | ')}`);
}
