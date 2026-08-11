/**
 * Render gate for the Lite->Full conversion pipeline.
 *
 * The ADF-level checks (extensionKey byte-identity, extensionId, localId,
 * version bump) all passed on a converted page whose macro rendered NOTHING —
 * the body travelled through the D1 mirror double-wrapped. Data-level
 * assertions cannot see that. This spec opens the converted page and looks at
 * what the reader sees.
 *
 * Run:
 *   cd tests/e2e-tests
 *   APP=zenuml-full@stg CONVERT_PAGE_ID=1867779 \
 *     npx playwright test -c playwright.lite2full.config.ts --project=lite2full
 *
 * CONVERT_LABEL names the screenshot (before/after a fix), CONVERT_EXPECT_TEXT
 * is a string the rendered diagram must contain.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PAGE_ID = process.env.CONVERT_PAGE_ID ?? '1867779';
const DOMAIN = process.env.CONVERT_DOMAIN ?? 'full-stg.atlassian.net';
const LABEL = process.env.CONVERT_LABEL ?? 'converted';
const SHOT_DIR = process.env.CONVERT_SHOT_DIR ?? path.join(process.cwd(), '..', '..', 'shots');

test.describe('Lite->Full converted macro renders', () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  test(`page ${PAGE_ID} shows diagram content, not an empty macro`, async ({ page }) => {
    await page.goto(`https://${DOMAIN}/wiki/pages/viewpage.action?pageId=${PAGE_ID}`, {
      waitUntil: 'domcontentloaded',
    });

    // Forge Custom UI macros are cross-origin iframes; one per macro on the page.
    const frames = page.locator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]');
    await expect(frames.first()).toBeVisible({ timeout: 60_000 });
    const count = await frames.count();

    // Renderers mount asynchronously inside the iframe (DrawIO in particular
    // loads its own bundle first). Poll rather than assert on first paint.
    const results: { index: number; svgArea: number; text: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const frame = frames.nth(i).contentFrame();
      let best = { svgArea: 0, text: '' };
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const probe = await frame.locator('body').evaluate((node) => {
          const body = node as HTMLElement;
          const svgs = Array.from(body.querySelectorAll('svg'));
          const area = svgs.reduce((m, s) => Math.max(m, s.clientWidth * s.clientHeight), 0);
          return { svgArea: area, text: (body.innerText || '').slice(0, 400) };
        }).catch(() => ({ svgArea: 0, text: '' }));
        if (probe.svgArea > best.svgArea) best = probe;
        if (best.svgArea > 10_000) break;
        await page.waitForTimeout(1000);
      }
      results.push({ index: i, ...best });
    }

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `lite2full-${LABEL}-${PAGE_ID}.png`), fullPage: true });
    console.log(`[render] ${JSON.stringify(results)}`);

    for (const r of results) {
      // A macro that fails to load its body still paints chrome and small
      // icons; a real diagram canvas is orders of magnitude larger.
      expect(r.svgArea, `macro ${r.index} rendered no diagram canvas (text: ${r.text.slice(0, 120)})`).toBeGreaterThan(10_000);
    }

    if (process.env.CONVERT_EXPECT_TEXT) {
      const joined = results.map((r) => r.text).join('\n');
      expect(joined).toContain(process.env.CONVERT_EXPECT_TEXT);
    }
  });
});
