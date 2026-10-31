import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { chromium } from '@playwright/test';
const OUT = process.env.OUT; const PAGE = process.env.PAGE_URL;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function totp(secret) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')) bits += alpha.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const statePath = path.join(OUT, 'state.json');
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...(fs.existsSync(statePath) ? { storageState: statePath } : {}) });
// Runs in every frame, before any app code: the documented per-browser override (renderer.ts).
await context.addInitScript(() => {
  if (location.host.endsWith('.cdn.prod.atlassian-dev.net')) {
    try { localStorage.setItem('plantumlRenderer', 'local'); localStorage.setItem('zenumlDebug', 'true'); } catch {}
  }
});
const page = await context.newPage();
const requests = []; const mixpanel = [];
page.on('request', (r) => {
  const u = r.url(); let frameUrl = ''; try { frameUrl = r.frame()?.url() ?? ''; } catch {}
  requests.push({ t: Date.now(), url: u.slice(0, 200), method: r.method(), frame: frameUrl.slice(0, 120) });
  if (/mixpanel/.test(u)) { const body = r.postData() ?? ''; mixpanel.push(body); }
});
page.on('console', (m) => { if (/plantuml|PlantUML|Content Security/i.test(m.text())) log('CONSOLE', m.type(), m.text().slice(0, 200)); });

await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
if (/id\.atlassian\.com|login/.test(page.url())) {
  log('logging in');
  await page.fill('input[name=username]', process.env.ATLASSIAN_USERNAME); await page.click('#login-submit');
  await page.fill('input[name=password]', process.env.ATLASSIAN_PASSWORD); await page.click('#login-submit');
  await page.waitForSelector('#two-step-verification-otp-code-input', { timeout: 30000 });
  await page.fill('#two-step-verification-otp-code-input', totp(process.env.ATLASSIAN_OTP));
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/lite-stg\.atlassian\.net\/wiki/, { timeout: 60000 });
  await context.storageState({ path: statePath });
  requests.length = 0; mixpanel.length = 0;
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
}
const t0 = Date.now();
log('page loaded', page.url());
// Wait for the macro frame to draw an SVG.
let app;
for (let i = 0; i < 60 && !app; i++) {
  for (const f of page.frames()) {
    if (!f.url().includes('cdn.prod.atlassian-dev.net')) continue;
    try { if (await f.evaluate(() => !!document.querySelector('svg g') && /Order Service/.test(document.body.innerText + document.body.innerHTML))) app = f; } catch {}
  }
  if (!app) await page.waitForTimeout(1000);
}
if (!app) { await page.screenshot({ path: path.join(OUT, 'no-macro.png') }); throw new Error('macro frame never drew'); }
log('macro drawn in', app.url().slice(0, 100));
const info = await app.evaluate(async () => {
  const res = performance.getEntriesByType('resource').map((e) => e.name);
  const scripts = [...new Set([...document.scripts].map((s) => s.src).filter(Boolean).concat(res.filter((n) => /\.m?js(\?|$)/.test(n))))];
  const hits = {};
  for (const s of scripts) {
    try { const t = await (await fetch(s)).text(); if (t.includes('plantuml_png_produced')) hits[s.split('/').pop()] = true; } catch {}
  }
  return {
    override: localStorage.getItem('plantumlRenderer'),
    version: (document.body.innerText.match(/v20\d\d\.\d{2}\.\d+[-\w]*/) || [null])[0],
    bundleHasNewEvent: Object.keys(hits),
    engineChunks: res.filter((n) => /plantuml-|engine-/.test(n)).map((n) => n.split('/').pop()),
    pngChunk: res.filter((n) => /\/png-[^/]*\.js/.test(n)).map((n) => n.split('/').pop()),
  };
});
log('frame info', JSON.stringify(info));
await page.waitForTimeout(40000); // let the view-time backup run and upload
await page.screenshot({ path: path.join(OUT, '1-viewer.png') });
const viewPhase = requests.filter((r) => r.t >= t0);
const plantumlView = viewPhase.filter((r) => /plantuml\.com/.test(r.url));
log('view phase: requests', viewPhase.length, 'to plantuml.com', plantumlView.length);
log('attachment upload requests', viewPhase.filter((r) => /attachment/i.test(r.url) && r.method !== 'GET').map((r) => r.method + ' ' + r.url).slice(0, 5));

// Export PNG.
const t1 = Date.now();
await app.locator('body').hover();
let opened = false;
for (const loc of [app.getByRole('button', { name: 'Export PNG' }), app.getByRole('menuitem', { name: 'Export PNG' })]) {
  if (await loc.count()) { await loc.first().click({ force: true }); opened = true; break; }
}
if (!opened) {
  const more = app.getByRole('button', { name: /more|actions|menu/i });
  log('more-buttons', await more.count());
  if (await more.count()) { await more.first().click({ force: true }); await page.waitForTimeout(500);
    const item = app.getByText('Export PNG', { exact: true }); if (await item.count()) { await item.first().click(); opened = true; } }
}
log('export opened', opened);
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(OUT, '2-export-modal.png') });
let exportFrame;
for (const f of page.frames()) { try { if (await f.getByRole('button', { name: 'Download image' }).count()) exportFrame = f; } catch {} }
let download = null;
if (exportFrame) {
  const dl = page.waitForEvent('download', { timeout: 30000 }).catch((e) => e);
  await exportFrame.getByRole('button', { name: 'Download image' }).click();
  const d = await dl;
  if (d && d.saveAs) { const p = path.join(OUT, 'export-download.png'); await d.saveAs(p); download = { name: d.suggestedFilename(), bytes: fs.statSync(p).size }; }
  else download = { error: String(d) };
}
await page.waitForTimeout(3000);
const exportPhase = requests.filter((r) => r.t >= t1);
const plantumlExport = exportPhase.filter((r) => /plantuml\.com/.test(r.url));
const events = mixpanel.map((b) => { try { const m = b.match(/data=([^&]+)/); const raw = decodeURIComponent(m ? m[1] : b); const j = JSON.parse(raw.startsWith('[') || raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString()); return (Array.isArray(j) ? j : [j]).map((e) => ({ event: e.event, src: e.properties?.plantuml_png_source, purpose: e.properties?.plantuml_png_purpose, upscaled: e.properties?.plantuml_png_upscaled, failure: e.properties?.plantuml_png_failure })); } catch { return []; } }).flat().filter((e) => /plantuml|attachment|export_png/.test(e.event ?? ''));
const report = { page: PAGE, frameInfo: info, viewPhase: { total: viewPhase.length, plantumlCom: plantumlView }, exportPhase: { opened, exportFrameFound: !!exportFrame, download, total: exportPhase.length, plantumlCom: plantumlExport }, allPlantumlCom: requests.filter((r) => /plantuml\.com/.test(r.url)), mixpanelEvents: events };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(requests, null, 1));
console.log(JSON.stringify({ ...report, allPlantumlCom: report.allPlantumlCom.length }, null, 2));
await context.storageState({ path: statePath });
await browser.close();
