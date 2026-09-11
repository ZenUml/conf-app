import { chromium } from '@playwright/test';
const ids = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const id of ids) {
  await page.goto(`http://localhost:6006/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.diagram-viewport svg', { timeout: 25000 }).catch(()=>{});
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const vp = document.querySelector('.diagram-viewport');
    if (!vp) return { error: 'no .diagram-viewport' };
    const svg = vp.querySelector('.diagram-viewport-content > svg');
    const g = svg?.querySelector('g.svg-pan-zoom_viewport');
    const b = vp.getBoundingClientRect();
    const d = g?.getBoundingClientRect();
    return {
      classes: vp.className,
      contentClasses: vp.querySelector('.diagram-viewport-content')?.className,
      box: [Math.round(b.width), Math.round(b.height)],
      drawing: d ? [Math.round(d.width), Math.round(d.height)] : null,
      toolbar: !!vp.querySelector('.diagram-viewport-toolbar'),
    };
  });
  console.log(id, JSON.stringify(out));
  await page.screenshot({ path: `/tmp/claude-0/-home-user-conf-app/04376805-f7d4-5586-aaa6-7be026dde2ba/scratchpad/x-${id}.png` });
}
await browser.close();
