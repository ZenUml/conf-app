// Storybook check for the inline Magic layout survey race.
// Usage: node survey-race.cjs <storybook-base-url> <out-dir> <label>
// Votes "Original" as a viewer with no storage key (accountId cleared, as for
// an anonymous viewer), runs the late second loadMagicFeedback that the Magic
// view's attach triggers, waits out the 4 s thanks, and reports whether the
// survey strip retired.
const { chromium } = require('playwright');
const [base, out, label] = process.argv.slice(2);
const STORY = 'viewer-genericviewer--staged-header-mermaid-long-title';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await page.goto(`${base}/iframe.html?id=${STORY}&viewMode=story`, { waitUntil: 'load', timeout: 120000 });
  const strip = page.locator('[data-testid="magic-layout-feedback"]');
  await strip.waitFor({ state: 'visible', timeout: 120000 });

  // Find the GenericViewer instance behind the strip.
  const vmState = () => page.evaluate(() => {
    let c = document.querySelector('[data-testid="magic-layout-feedback"]')?.__vueParentComponent
      ?? window.__genericViewerProxy?.$?.vnode?.component;
    while (c && typeof c.proxy?.loadMagicFeedback !== 'function') c = c.parent;
    if (c) window.__genericViewerProxy = c.proxy;
    const p = window.__genericViewerProxy;
    return p ? { accountId: p.currentAccountId, previous: p.magicPreviousFeedback, thanked: p.magicFeedbackThanked } : null;
  });

  const initial = await vmState();
  await page.evaluate(() => { window.__genericViewerProxy.currentAccountId = null; });
  await page.screenshot({ path: `${out}/${label}-1-survey.png` });

  await strip.getByRole('button', { name: 'Original' }).click();
  await page.getByText('Thanks for sharing').waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${out}/${label}-2-thanks.png` });
  const afterClick = await vmState();

  // The second load, as the Magic view's attach runs it.
  await page.evaluate(async () => {
    const p = window.__genericViewerProxy;
    await p.loadMagicFeedback(p.diagram.magic, p.diagram.mermaidCode);
  });
  const afterReload = await vmState();

  await page.waitForTimeout(4600);
  const stripAfter = await strip.count();
  await page.screenshot({ path: `${out}/${label}-3-after-thanks.png` });
  const final = await vmState();

  console.log(JSON.stringify({ label, initial, afterClick, afterReload, final, stripVisibleAfterThanks: stripAfter > 0 }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
