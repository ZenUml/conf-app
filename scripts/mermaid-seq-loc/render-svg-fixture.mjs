#!/usr/bin/env node
// Render a Mermaid fixture (.mmd) to the SVG the app would put on screen and
// write it next to the source as .svg. Used for the inline-edit DOM fixtures
// (src/features/mermaidInlineEdit/ui/__fixtures__/*.svg).
//
// Same path as the app: the installed mermaid ESM bundle, `mermaid.render` in
// headless Chromium, MERMAID_CONFIG (theme 'neutral', default strict security
// level, so the output has been through DOMPurify).
//
// Usage: node scripts/mermaid-seq-loc/render-svg-fixture.mjs <fixture.mmd> [--id <svg id>]
// The svg id defaults to `fixture`; the SVG keeps it in its own <style> rules.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const input = args.find((a) => a.endsWith('.mmd'));
const idFlag = args.indexOf('--id');
const svgId = idFlag >= 0 ? args[idFlag + 1] : 'fixture';
if (!input) {
  console.error('usage: render-svg-fixture.mjs <fixture.mmd> [--id <svg id>]');
  process.exit(2);
}
const root = resolve(new URL('../..', import.meta.url).pathname);
const code = await readFile(resolve(input), 'utf8');

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><html><body><div id="host"></div></body></html>');
  }
  if (!path.startsWith('/node_modules/mermaid/dist/')) { res.statusCode = 404; return res.end(); }
  try {
    res.setHeader('content-type', extname(path) === '.mjs' || extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(join(root, path)));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const { svg } = await page.evaluate(async ({ code, svgId }) => {
    const mermaid = (await import('/node_modules/mermaid/dist/mermaid.esm.min.mjs')).default;
    // = MERMAID_CONFIG in src/utils/mermaid/loadMermaid.ts
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    const out = await mermaid.render(svgId, code);
    return { svg: out.svg };
  }, { code, svgId });
  const output = resolve(input).replace(/\.mmd$/, '.svg');
  await writeFile(output, `${svg}\n`);
  const { version } = JSON.parse(await readFile(join(root, 'node_modules/mermaid/package.json'), 'utf8'));
  console.log(`mermaid ${version}: wrote ${output}`);
} finally {
  await browser.close();
  server.close();
}
