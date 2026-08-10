// Reproduction for `svg element not in render tree` (30 events/day, Chrome, mermaid 11.12.2).
//
// Hypothesis under test: mermaid.render() measures text via getBBox on a temp
// node appended to document.body. When the document has no layout, the
// measurement throws. Candidate "no layout" conditions, tested one per case:
//   A  document.body { display: none }
//   B  render inside an iframe that is display:none
//   C  render inside an iframe that is scrolled far out of the top-level viewport
//   D  control — normal, laid-out document
//
// Run: node repro.mjs      (serves node_modules/mermaid over http, drives Chrome)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const MERMAID = new URL('../../node_modules/mermaid/dist/mermaid.esm.min.mjs', import.meta.url).pathname;
const CODE = `sequenceDiagram\n  autonumber\n  Alice->>Bob: hello\n  Bob-->>Alice: hi`;

// The page under test: import mermaid, render, report the error message verbatim.
const inner = (bodyStyle) => `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="${bodyStyle}">
<script type="module">
  import mermaid from '/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  const report = (r) => { window.__result = r; parent.postMessage(r, '*'); };
  try {
    const { svg } = await mermaid.render('m-' + Math.floor(performance.now()), ${JSON.stringify(CODE)});
    report({ ok: true, svgLength: svg.length });
  } catch (e) {
    report({ ok: false, message: e && e.message ? e.message : String(e) });
  }
</script></body></html>`;

const outer = (frameStyle) => `<!doctype html><html><body style="margin:0">
<div style="height:${frameStyle.spacer || '0px'}"></div>
<iframe src="/inner.html" style="${frameStyle.css}" width="800" height="600"></iframe>
<script>
  window.__result = null;
  addEventListener('message', (e) => { window.__result = e.data; });
</script></body></html>`;

const routes = {
  '/inner.html': async () => [inner(''), 'text/html'],
  // A: the rendering document itself has no layout box.
  '/a.html': async () => [inner('display:none'), 'text/html'],
  // B: the iframe holding the rendering document is display:none.
  '/b.html': async () => [outer({ css: 'display:none' }), 'text/html'],
  // C: the iframe is laid out but far below the top-level viewport.
  '/c.html': async () => [outer({ css: 'border:0', spacer: '20000px' }), 'text/html'],
  // D: control.
  '/d.html': async () => [inner(''), 'text/html'],
  // E: the fix's premise — the first render throws in a document with no
  // layout box; once the box exists the SAME input renders. If this fails,
  // retrying is the wrong strategy.
  '/e.html': async () => [`<!doctype html><html><head><meta charset="utf-8"></head>
<body style="display:none">
<script type="module">
  import mermaid from '/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  const code = ${JSON.stringify(CODE)};
  const attempt = async (id) => {
    try { return { ok: true, svgLength: (await mermaid.render(id, code)).svg.length }; }
    catch (e) { return { ok: false, message: e && e.message ? e.message : String(e) }; }
  };
  const first = await attempt('e-first');
  document.body.style.display = 'block';
  // One frame for the box to exist before the retry measures anything.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const second = await attempt('e-second');
  window.__result = { ok: first.ok === false && second.ok === true, first, second };
</script></body></html>`, 'text/html'],
};

// mermaid's ESM entry pulls diagram code from ./chunks/*, so the whole dist
// directory has to be reachable, not just the entry file.
const MERMAID_DIST = MERMAID.slice(0, MERMAID.lastIndexOf('/'));
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const handler = routes[path];
  if (handler) {
    const [body, type] = await handler();
    res.writeHead(200, { 'content-type': type });
    return res.end(body);
  }
  try {
    const file = await readFile(MERMAID_DIST + path);
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(file);
  } catch {
    res.writeHead(404);
    return res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome' });
const cases = [
  ['A  body display:none          ', '/a.html'],
  ['B  iframe display:none        ', '/b.html'],
  ['C  iframe 20000px offscreen   ', '/c.html'],
  ['D  control (laid out)         ', '/d.html'],
  ['E  hidden -> shown -> retry   ', '/e.html'],
];
for (const [label, path] of cases) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path);
  let result = null;
  try {
    await page.waitForFunction(() => window.__result !== null && window.__result !== undefined, { timeout: 15000 });
    result = await page.evaluate(() => window.__result);
  } catch {
    result = { ok: null, message: 'TIMEOUT — no result within 15s' };
  }
  const detail = result.first
    ? `first ${result.first.ok ? 'ok' : 'THREW: ' + result.first.message}; retry ${result.second.ok ? 'ok, svg ' + result.second.svgLength + ' chars' : 'THREW: ' + result.second.message}`
    : result.ok ? `ok, svg ${result.svgLength} chars` : `THREW: ${result.message}`;
  console.log(`${label} ${detail}`);
  if (errors.length) console.log(`${' '.repeat(label.length)} pageerror: ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
server.close();
