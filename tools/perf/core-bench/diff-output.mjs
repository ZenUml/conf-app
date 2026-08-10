import { chromium } from '@playwright/test';

const browser = await chromium.launch();
async function dump(v) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`http://localhost:5599/dump.html?v=${v}`);
  await page.waitForFunction(() => document.title === 'DUMP_DONE', { timeout: 300000 });
  const d = await page.evaluate(() => window.__dump);
  await ctx.close();
  return d;
}
const A = await dump('new'), B = await dump('v4');   // 3.50.1 vs 4.2.0
await browser.close();

const keys = Object.keys(A.out);
let identical = 0;
const htmlDiff = [], threwOnly3 = [], threwOnly4 = [], errOnly3 = [], errOnly4 = [];

for (const k of keys) {
  const a = A.out[k], b = B.out[k];
  if (a.html === b.html && a.threw === b.threw) identical++;
  else if (a.html !== b.html) htmlDiff.push({ k, a: a.html.length, b: b.html.length });
  if (a.threw && !b.threw) threwOnly3.push(k);
  if (!a.threw && b.threw) threwOnly4.push(k);
  const ea = (A.errs[k] || []).length, eb = (B.errs[k] || []).length;
  if (ea && !eb) errOnly3.push({ k, sample: A.errs[k][0] });
  if (!ea && eb) errOnly4.push({ k, sample: B.errs[k][0] });
}

console.log(`\ndiagrams tested: ${keys.length}`);
console.log(`identical output: ${identical}/${keys.length}`);
console.log(`html differs:     ${htmlDiff.length}`);
console.log(`threw on 3.50.1 only: ${threwOnly3.length}   threw on 4.2.0 only: ${threwOnly4.length}`);
console.log(`parse errors on 3.50.1 only: ${errOnly3.length}   on 4.2.0 only: ${errOnly4.length}`);

if (htmlDiff.length) {
  console.log('\n-- output differences (chars 3.50.1 → 4.2.0) --');
  for (const d of htmlDiff.slice(0, 15)) console.log(`  ${d.k}  ${d.a} → ${d.b}  (${d.b - d.a >= 0 ? '+' : ''}${d.b - d.a})`);
  if (htmlDiff.length > 15) console.log(`  … ${htmlDiff.length - 15} more`);
}
if (errOnly3.length) {
  console.log('\n-- 3.50.1 rejects, 4.2.0 accepts (the divergence that matters) --');
  for (const e of errOnly3.slice(0, 10)) console.log(`  ${e.k}: ${e.sample}`);
  if (errOnly3.length > 10) console.log(`  … ${errOnly3.length - 10} more`);
}
if (errOnly4.length) {
  console.log('\n-- REGRESSIONS: 4.2.0 errors where 3.50.1 was clean --');
  for (const e of errOnly4.slice(0, 10)) console.log(`  ${e.k}: ${e.sample}`);
}
