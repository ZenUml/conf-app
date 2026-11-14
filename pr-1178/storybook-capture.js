const { chromium } = require('playwright');
(async () => {
  const label = process.argv[2];
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  const logs = []; p.on('console', m => { if (/error|mermaid/i.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 160)); });
  await p.goto('http://localhost:6106/iframe.html?id=viewer-mermaidhiddenlayout--state-diagram-revealed-after-hidden&viewMode=story');
  await p.waitForTimeout(12000);
  const r = await p.evaluate(() => { const s = document.querySelector('svg[id^="mermaid-"]'); return { bodyDisplay: document.body.style.display || '(visible)', svg: !!s, edgeLabels: s ? s.querySelectorAll('g.edgeLabel').length : 0 }; });
  await p.screenshot({ path: `/tmp/spot-check/conf-app/storybook-${label}.png` });
  console.log(label, JSON.stringify(r)); console.log(logs.slice(0, 4).join('\n'));
  await b.close();
})();
