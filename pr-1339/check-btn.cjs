// whimet4/lite-stg: force each arm with the QA override, read the Connect MCP
// button at rest (mouse outside the macro), screenshot the macro header.
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const OTPAuth = require(process.env.OTPAUTH_PATH);
const [, , pageUrl, out, sha, stateFile] = process.argv;
const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: process.env.ATLASSIAN_OTP });
const STATE = path.join(__dirname, stateFile || 'state.json');
const mcpFrame = async (page) => {
  for (const f of page.frames().filter((f) => /atlassian-dev\.net|cdn\.prod/.test(f.url()))) {
    if (await f.locator('[data-testid="connect-mcp-btn"]').count().catch(() => 0)) return f;
  }
  return null;
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2, ...(fs.existsSync(STATE) ? { storageState: STATE } : {}) });
  const page = await ctx.newPage();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  if (/id\.atlassian\.com|login/.test(page.url())) {
    await page.fill('input[name=username]', process.env.ATLASSIAN_USERNAME); await page.click('#login-submit');
    await page.fill('input[name=password]', process.env.ATLASSIAN_PASSWORD); await page.click('#login-submit');
    for (let i = 0; i < 3; i++) {
      await page.waitForSelector('#two-step-verification-otp-code-input', { timeout: 20000 });
      await page.fill('#two-step-verification-otp-code-input', totp.generate());
      await page.getByRole('button', { name: 'Log in' }).click();
      try { await page.waitForURL(/atlassian\.net\/wiki/, { timeout: 20000 }); break; } catch { await page.waitForTimeout(15000); }
    }
    await ctx.storageState({ path: STATE });
    if (!page.url().includes(new URL(pageUrl).pathname)) await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(25000);
  let frame = await mcpFrame(page);
  if (!frame) { console.log('no macro frame with Connect MCP'); return browser.close(); }
  const build = await frame.evaluate(async (sha) => {
    for (const src of [...document.scripts].map((s) => s.src).filter(Boolean)) {
      const body = await fetch(src).then((r) => r.text()).catch(() => '');
      if (body.includes(sha)) return 'tested build ' + sha.slice(0, 7);
      if (body.includes('zenuml.mcpButtonVariant')) return 'has button test (sha not embedded)';
    }
    return 'other build';
  }, sha);
  console.log('build:', build);
  if (build === 'other build') return browser.close();
  for (const variant of ['control', 'outcome_label']) {
    await frame.evaluate((v) => localStorage.setItem('zenuml.mcpButtonVariant', v), variant);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(25000);
    await page.mouse.move(5, 995);
    await page.waitForTimeout(1500);
    frame = await mcpFrame(page);
    const info = await frame.evaluate(() => {
      const b = document.querySelector('[data-testid="connect-mcp-btn"]');
      return { variant: b.dataset.mcpVariant, label: b.textContent.trim(), opacity: getComputedStyle(b).opacity, pinned: b.classList.contains('viewer-act-connect-mcp--pinned'), title: b.title };
    });
    console.log(variant, JSON.stringify(info));
    const el = await frame.frameElement();
    const box = await el.boundingBox();
    await page.screenshot({ path: `${out}-${variant}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(140, box.height) } });
  }
  await frame.evaluate(() => localStorage.removeItem('zenuml.mcpButtonVariant'));
  await browser.close();
})();
