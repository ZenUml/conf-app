#!/usr/bin/env node
// Compare the in-browser PlantUML renderer with plantuml.com (ADR-0010, rollout
// step 3). For every diagram in a corpus it renders with the real engine.ts in
// headless Chromium, under the strict `script-src 'self'` CSP of the Full and
// Diagramly macro iframes, and, with --server, also asks plantuml.com for the
// same diagram. It then reports per diagram: the local outcome, whether every
// text label the server drew is also in the local drawing, both sizes, and
// side-by-side PNGs.
//
// --server SENDS EVERY DIAGRAM'S SOURCE TO www.plantuml.com. Use it only on a
// corpus that may go there (the synthetic one). For customer diagrams run
// without --server: nothing leaves the machine and only the local outcomes
// are measured. Keep any output made from customer content out of this repo.
//
// usage: [CHROMIUM_PATH=...] node scripts/plantuml-compare/compare.mjs --corpus <file.mjs|file.json> --out <dir> [--server] [--no-images]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const corpusPath = opt('--corpus');
const outDir = opt('--out');
const useServer = args.includes('--server');
const images = !args.includes('--no-images');
if (!corpusPath || !outDir) {
  console.error('usage: compare.mjs --corpus <file.mjs|file.json> --out <dir> [--server] [--no-images]');
  process.exit(2);
}

const corpus = corpusPath.endsWith('.json')
  ? JSON.parse(fs.readFileSync(corpusPath, 'utf8'))
  : (await import(pathToFileURL(path.resolve(corpusPath)).href)).default;

// 1. Bundle the harness around the real engine.ts.
const harnessDir = path.join(outDir, 'harness');
await build({
  configFile: false,
  logLevel: 'warn',
  root: here,
  resolve: { alias: { '@': path.join(repo, 'src') } },
  build: {
    outDir: harnessDir,
    emptyOutDir: true,
    lib: { entry: path.join(here, 'harness.ts'), formats: ['es'], fileName: () => 'harness.js' },
  },
});
fs.writeFileSync(path.join(harnessDir, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="harness.js"></script>\n');

// 2. Serve it with the strict CSP.
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(harnessDir, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(harnessDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const headers = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' };
  if (file.endsWith('.html')) headers['content-security-policy'] = "script-src 'self'; connect-src 'self'";
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// CHROMIUM_PATH: a Chromium the repo's @playwright/test version did not install itself.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const external = [];
page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
const cspViolations = [];
page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)); });
await page.goto(`${base}/index.html`);
await page.waitForFunction(() => 'harness' in window, null, { timeout: 60000 });

// 3. Render and compare.
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const labels = (svg) => new Set([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => decode(m[1]).trim()).filter(Boolean));
function size(svg) {
  const vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(svg);
  if (vb) return { w: Math.round(+vb[1]), h: Math.round(+vb[2]) };
  const w = /\bwidth="([\d.]+)/.exec(svg); const h = /\bheight="([\d.]+)/.exec(svg);
  return w && h ? { w: Math.round(+w[1]), h: Math.round(+h[1]) } : null;
}

const imgDir = path.join(outDir, 'images');
if (images) fs.mkdirSync(imgDir, { recursive: true });
const writePng = (file, dataUrl) => { if (dataUrl) fs.writeFileSync(path.join(imgDir, file), Buffer.from(dataUrl.split(',')[1], 'base64')); return dataUrl ? `images/${file}` : null; };

const results = [];
for (const item of corpus) {
  const local = await page.evaluate((code) => window.harness.local(code), item.source);
  const row = { id: item.id, kind: item.kind, local: { status: local.status, ms: local.ms, rewritten: local.rewritten, unresolvedInclude: local.unresolvedInclude, message: local.message, size: local.svg ? size(local.svg) : null } };
  let serverSvg = null;
  if (useServer) {
    const encoded = await page.evaluate((code) => window.harness.encode(code.trim()), item.source);
    const resp = await fetch(`https://www.plantuml.com/plantuml/svg/${encoded}`);
    serverSvg = await resp.text();
    row.server = { status: resp.status, size: size(serverSvg) };
    if (local.svg) {
      const want = labels(serverSvg); const got = labels(local.svg);
      row.labels = { server: want.size, local: got.size, missingLocally: [...want].filter((t) => !got.has(t)), extraLocally: [...got].filter((t) => !want.has(t)) };
    }
  }
  if (images) {
    row.localPng = local.svg ? writePng(`${item.id}.local.png`, await page.evaluate((svg) => window.harness.rasterize(svg), local.svg)) : null;
    row.serverPng = serverSvg ? writePng(`${item.id}.server.png`, await page.evaluate((svg) => window.harness.rasterize(svg), serverSvg)) : null;
  }
  results.push(row);
  console.log(`${item.id.padEnd(28)} local=${local.status.padEnd(12)} ${String(local.ms).padStart(5)}ms` + (row.labels ? `  labels missing locally: ${row.labels.missingLocally.length}` : '') + (row.server ? `  size local ${row.local.size?.w}x${row.local.size?.h} / server ${row.server.size?.w}x${row.server.size?.h}` : ''));
}
await browser.close();
server.close();

const summary = {
  diagrams: results.length,
  byStatus: results.reduce((acc, r) => ({ ...acc, [r.local.status]: (acc[r.local.status] ?? 0) + 1 }), {}),
  rewritten: results.filter((r) => r.local.rewritten).length,
  labelMismatches: results.filter((r) => r.labels && r.labels.missingLocally.length).map((r) => r.id),
  externalRequestsFromPage: external,
  cspViolations: [...new Set(cspViolations)],
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
