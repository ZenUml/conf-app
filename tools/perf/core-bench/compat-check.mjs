import { chromium } from '@playwright/test';
const browser = await chromium.launch();
async function run(v) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:5599/compat.html?v=${v}`);
  await page.waitForFunction(() => document.title === 'COMPAT_DONE', { timeout: 60000 });
  const r = await page.evaluate(() => window.__compat);
  await ctx.close();
  return r;
}
const a = await run('new'), b = await run('v4');
await browser.close();
console.log('\ncase                       3.50.1                    4.2.0');
console.log('─'.repeat(72));
for (const k of Object.keys(a)) {
  const f = x => x.ok ? `ok chars=${String(x.chars).padStart(6)} dom=${x.hasSvgOrDom ? 'Y' : 'N'}` : `THREW`;
  const flag = (a[k].ok !== b[k].ok || a[k].hasSvgOrDom !== b[k].hasSvgOrDom || Math.abs((a[k].chars||0)-(b[k].chars||0)) > 50) ? '  <<< DIFF' : '';
  console.log(`${k.padEnd(25)} ${f(a[k]).padEnd(25)} ${f(b[k])}${flag}`);
}
