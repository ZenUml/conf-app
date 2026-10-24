import { test, expect, type Page } from '@playwright/test';
import { evidence } from './story';

// Copy-success feedback: the "Copied" state holds 2.5 s, fades out over 0.3 s,
// then returns to the original label. Time is driven by Playwright's clock so
// the assertions are about exact moments, not about sleeping.

const HOLD_MS = 2500;

// Capture and clipboard APIs are stubbed so the click always succeeds in headless Chromium.
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const clipboard = {
      write: async () => {},
      writeText: async () => {},
      read: async () => [],
      readText: async () => '',
    };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  });
}

/** Advance the fake clock in small steps until `isReady` is true; returns the ms spent. */
async function runUntil(page: Page, isReady: () => Promise<boolean>, stepMs = 10, maxMs = 8000) {
  let spent = 0;
  while (spent < maxMs) {
    if (await isReady()) return spent;
    await page.clock.runFor(stepMs);
    spent += stepMs;
  }
  throw new Error(`condition not reached within ${maxMs} fake ms`);
}

const opacityOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity));

const cases = [
  {
    name: 'ExportModal',
    storyId: 'modal-exportmodal--copy-feedback',
    shot: 'copy-exportmodal',
    click: (page: Page) => page.getByRole('button', { name: 'Copy image' }).click(),
    ready: (page: Page) => page.getByRole('button', { name: 'Copy image' }),
    copied: '.stage-message[role="status"]',
    original: async (page: Page) => {
      await expect(page.locator('.stage-message[role="status"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Copy image' })).toBeEnabled();
    },
  },
  {
    name: 'AdvocacyButton',
    storyId: 'shared-advocacybutton--idle',
    shot: 'copy-advocacy',
    click: (page: Page) => page.getByTestId('advocacy-copy-btn').click(),
    ready: (page: Page) => page.getByTestId('advocacy-copy-btn'),
    copied: '[data-testid="advocacy-copy-btn"] span',
    original: async (page: Page) => {
      await expect(page.getByTestId('advocacy-copy-btn')).toHaveText('Copy upgrade request');
    },
  },
];

for (const c of cases) {
  for (const reduced of [false, true]) {
    test(`${c.name}: ${reduced ? 'reduced motion resets by 2.6 s without fading' : 'holds 2.5 s, fades, then resets'}`, async ({ page }) => {
      await stubClipboard(page);
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.clock.install();
      // Not openStory(): ExportModal's first root child is a zero-height capture stage, which never counts as visible.
      await page.goto(`/iframe.html?id=${c.storyId}&viewMode=story`);
      await c.ready(page).waitFor();
      // Let the story finish mounting (ExportModal captures its preview), then freeze time.
      await page.clock.runFor(2000);
      await page.clock.pauseAt(new Date(Date.now() + 60_000));

      await c.click(page);
      const copied = page.locator(c.copied);
      // Fake ms elapsed between the click and the Copied label showing up.
      const lag = await runUntil(page, async () => (await copied.count()) > 0);
      await expect(copied).toBeVisible();
      await evidence(page, `${c.shot}-copied${reduced ? '-reduced' : ''}`);

      if (reduced) {
        await page.clock.runFor(HOLD_MS + 100 - lag);
        await c.original(page);
        return;
      }

      // 1.6 s after the click the old 1.5 s timer would already have reset it.
      await page.clock.runFor(1600 - lag);
      await expect(copied).toBeVisible();
      expect(await opacityOf(page, c.copied)).toBe(1);

      // 2.65 s: 150 ms into the 300 ms fade, opacity is strictly between 0 and 1.
      await page.clock.runFor(1050);
      await expect(copied).toBeVisible();
      // CSS transitions run on the browser's real timeline, not on the fake clock, so wait in real time.
      await expect.poll(() => opacityOf(page, c.copied), { timeout: 1000 }).toBeLessThan(1);
      await evidence(page, `${c.shot}-fading`);

      // 2.9 s: fade done, original label back.
      await page.clock.runFor(250);
      await c.original(page);
      await evidence(page, `${c.shot}-reset`);
    });
  }
}
