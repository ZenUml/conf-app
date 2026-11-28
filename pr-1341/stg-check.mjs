import { chromium } from 'playwright';
const [,, url, outDir, label] = process.argv;
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: process.env.HOME + '/.agent-browser/sessions/stg-conf-app.json', viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (/inverse|SVGMatrix|not invertible/i.test(m.text())) errors.push(`console(${m.type()}): ${m.text()}`); });
page.on('pageerror', e => errors.push('top pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
const appFrame = () => page.frames().filter(f => f.url().includes('8ad26115'));
await page.waitForTimeout(12000);
for (const f of appFrame()) { try { await f.evaluate(() => localStorage.setItem('zenumlDebug', 'true')); } catch {} }
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
// Inline macro frame with a Fullscreen button
let inline;
for (const f of appFrame()) { if (await f.locator('button:has-text("Fullscreen")').count()) { inline = f; break; } }
if (!inline) throw new Error('no inline macro frame with Fullscreen button');
const version = await inline.evaluate(() => (document.body.innerText.match(/v\d{4}\.[^\s]+/g) || []).concat(document.body.innerText.match(/[\w\/.-]+:[0-9a-f]{7,10}/g) || []).join(' '));
await page.screenshot({ path: `${outDir}/${label}-0-inline-version.png` });
await inline.locator('button:has-text("Fullscreen")').first().click();
await page.waitForSelector('[role="dialog"] iframe', { timeout: 20000 });
await page.waitForTimeout(8000);
const fsHandle = await page.$('[role="dialog"] iframe');
const fs = await fsHandle.contentFrame();
await fs.evaluate(() => { window.__errs = []; addEventListener('error', e => window.__errs.push(e.message)); });
const read = () => fs.evaluate(() => {
  const g = document.querySelector('.svg-pan-zoom_viewport');
  const sv = document.querySelector('.diagram-viewport svg');
  const seq = document.querySelector('.sequence-diagram, .zenuml, [class*="zenuml"]');
  return { transform: g?.getAttribute('transform') ?? null, svgRect: sv ? [Math.round(sv.getBoundingClientRect().width), Math.round(sv.getBoundingClientRect().height)] : null,
    seqRect: seq ? [Math.round(seq.getBoundingClientRect().width), Math.round(seq.getBoundingClientRect().height)] : null, errs: window.__errs, vw: innerWidth };
});
const r0 = await read();
await page.screenshot({ path: `${outDir}/${label}-1-fullscreen.png` });
// Real window resizes (Confluence re-lays out the Fullscreen dialog)
await page.setViewportSize({ width: 700, height: 500 }); await page.waitForTimeout(1500);
await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(1500);
const r1 = await read();
// Force the viewport to zero width, zoom while it is zero, then restore (the customer's failure mode)
const forced = await fs.evaluate(async () => {
  const vp = document.querySelector('.diagram-viewport'); if (!vp) return 'no .diagram-viewport (not an svg-pan-zoom diagram)';
  const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  vp.style.width = '0px'; await raf(); await raf();
  document.querySelector('button[aria-label="Zoom in"]')?.click();
  vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, clientX: 5, clientY: 5, bubbles: true, cancelable: true })); await raf();
  vp.style.removeProperty('width'); await raf(); await raf(); await new Promise(r => setTimeout(r, 500));
  return 'done';
});
const r2 = await read();
await page.screenshot({ path: `${outDir}/${label}-2-after-resize.png` });
console.log(JSON.stringify({ label, version, r0, r1, forced, r2, pageErrors: errors }, null, 1));
await browser.close();
