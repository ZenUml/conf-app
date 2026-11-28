const { chromium } = require('playwright');
const [base, out, ...ids] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const id of ids) {
    const pg = await b.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
    const errs = []; pg.on('pageerror', e => errs.push(e.message.slice(0, 150)));
    await pg.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { timeout: 120000 });
    await pg.waitForSelector('[data-testid="connect-mcp-btn"]', { state: 'attached', timeout: 90000 }).catch(() => {});
    await pg.mouse.move(890, 415);
    // Let the play function finish.
    await pg.waitForFunction(() => ['finished', 'completed', 'errored', 'aborted'].includes(window.__STORYBOOK_PREVIEW__?.storyRenders?.[0]?.phase), null, { timeout: 60000 }).catch(() => {});
    await pg.waitForTimeout(1000);
    const info = await pg.evaluate(() => {
      const b = document.querySelector('[data-testid="connect-mcp-btn"]');
      const r = window.__STORYBOOK_PREVIEW__?.storyRenders?.[0];
      return { phase: r?.phase, errorShown: document.body.classList.contains('sb-show-errordisplay'), err: document.querySelector('#error-message')?.textContent?.slice(0, 200) || null,
        btn: b && { variant: b.dataset.mcpVariant, label: b.textContent.trim(), opacity: getComputedStyle(b).opacity, pinned: b.classList.contains('viewer-act-connect-mcp--pinned'), title: b.title } };
    });
    console.log(id.split('--')[1], JSON.stringify(info), errs.length ? 'pageerrors:' + errs.join(' | ') : '');
    await pg.screenshot({ path: `${out}/${id.split('--')[1]}.png`, clip: { x: 0, y: 0, width: 900, height: 120 } });
    await pg.close();
  }
  await b.close();
})();
