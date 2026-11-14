import pw from '/home/user/conf-app/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;
const [,, name, payloadFile] = process.argv;
const p = Buffer.from(fs.readFileSync(payloadFile)).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
await page.goto(`http://localhost:4802/?p=${encodeURIComponent(p)}`);
await page.waitForTimeout(8000);
const frame = page.frames().find((f) => f.url().includes('/frame'));
const m = await frame.evaluate(() => {
  const app = document.getElementById('app');
  const t = document.querySelector('.zenuml')?.firstElementChild;
  return { frameWidth: document.documentElement.clientWidth, appScrollWidth: app.scrollWidth, appClientWidth: app.clientWidth,
    naturalWidth: t?.scrollWidth, renderedWidth: Math.round(t?.getBoundingClientRect().width ?? 0), transform: t?.style.transform };
});
console.log(name, JSON.stringify(m), 'lastSize', JSON.stringify(await page.evaluate(() => window.lastSize)));
await page.screenshot({ path: `${name}.png` });
await browser.close();
