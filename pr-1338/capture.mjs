// Renders one synthetic flowchart with the production Mermaid build
// (dist/mermaid.esm.min.mjs, the file the viewer loads from vendor/mermaid),
// unpatched vs patched, with the edge-point leak injected, and screenshots each.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const [, , unpatchedDist, patchedDist, outDir] = process.argv;
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('@playwright/test');
const CODE = 'flowchart TD\n  A[Bắt đầu] --> B{Kiểm tra dữ liệu}\n  B -->|Có| C[Đăng nhập]\n  B -->|Không| A';
const browser = await chromium.launch();
const results = {};
for (const [name, dist] of [['before', unpatchedDist], ['after', patchedDist]]) {
  const page = await browser.newPage({ viewport: { width: 640, height: 520 } });
  await page.route('http://mm.test/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body style="font-family:sans-serif;margin:16px"><h3 id="t"></h3><div id="out"></div></body></html>' });
    route.fulfill({ contentType: 'text/javascript', body: readFileSync(dist + p) });
  });
  await page.goto('http://mm.test/');
  results[name] = await page.evaluate(async ({ CODE, name }) => {
    const { default: mermaid } = await import('/mermaid.esm.min.mjs');
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    const orig = JSON.stringify;
    JSON.stringify = function (v, ...rest) {
      if (Array.isArray(v) && v.length && v.every((p) => p && typeof p.x === 'number' && typeof p.y === 'number')) v = [{ ...v[0], label: 'Kiểm tra dữ liệu' }, ...v.slice(1)];
      return orig.call(this, v, ...rest);
    };
    document.getElementById('t').textContent = `${name === 'before' ? 'BEFORE (mermaid 11.17.2)' : 'AFTER (patched 11.17.2)'}: production esm.min build, non-Latin1 edge points`;
    try {
      const { svg } = await mermaid.render('m', CODE);
      document.getElementById('out').innerHTML = svg;
      return { result: 'rendered', edgesWithPoints: (svg.match(/data-points="/g) || []).length };
    } catch (e) {
      document.getElementById('out').innerHTML = '<pre style="color:#b00;white-space:pre-wrap">mermaid.render threw:\n' + e.message + '</pre>';
      return { result: 'error', message: e.message };
    } finally { JSON.stringify = orig; }
  }, { CODE, name });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
