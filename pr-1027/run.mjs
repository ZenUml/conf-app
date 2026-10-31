import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
import { build } from 'vite'; import { chromium } from '@playwright/test';
const repo = '/home/user/conf-app'; const here = process.cwd(); const out = path.join(here, 'dist');
await build({ configFile: false, logLevel: 'warn', root: here,
  resolve: { alias: [ { find: /^\.\/renderer$/, replacement: path.join(here, 'renderer-stub.ts') }, { find: '@/utils/analytics/trackAnalyticsEvent', replacement: path.join(here, 'track-stub.ts') }, { find: '@', replacement: path.join(repo, 'src') } ] },
  define: { 'process.env': '{}' },
  build: { outDir: out, emptyOutDir: true, lib: { entry: path.join(here, 'harness.ts'), formats: ['es'], fileName: () => 'harness.js' } } });
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="harness.js"></script>');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => { const f = path.join(out, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const h = { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' };
  if (f.endsWith('.html')) h['content-security-policy'] = "script-src 'self'; img-src 'self' data: blob:";
  res.writeHead(200, h); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); const page = await browser.newPage();
const external = []; page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
const csp = []; page.on('pageerror', (e) => console.error('PAGEERROR', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text().slice(0,300)); }); page.on('console', (m) => { if (/Content Security Policy|Refused/i.test(m.text())) csp.push(m.text().slice(0, 200)); });
await page.goto(`${base}/index.html`); await page.waitForFunction(() => 'harness' in window, null, { timeout: 20000 });
const cases = {
  sequence: '@startuml\nAlice -> Bob: Hello\nBob --> Alice: Hi back\n@enduml',
  class: '@startuml\nclass Order {\n +id: int\n +total(): Money\n}\nclass Line\nOrder "1" *-- "many" Line\n@enduml',
  c4: '@startuml\n!include <C4/C4_Context>\nPerson(u, "User")\nSystem(s, "Shop")\nRel(u, s, "Uses")\n@enduml',
};
const report = {};
for (const [k, code] of Object.entries(cases)) {
  const r = await page.evaluate((c) => window.harness.run(c), code);
  for (const key of ['backup', 'exp', 'domCapture']) if (r[key]?.dataUrl) { fs.writeFileSync(path.join(here, `${k}.${key}.png`), Buffer.from(r[key].dataUrl.split(',')[1], 'base64')); delete r[key].dataUrl; }
  report[k] = r;
}
report.events = await page.evaluate(() => window.events); report.externalRequests = external; report.cspMessages = csp;
console.log(JSON.stringify(report, null, 2));
await browser.close(); server.close();
