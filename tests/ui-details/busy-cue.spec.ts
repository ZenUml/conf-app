import { test, expect, type Page } from '@playwright/test';
import { evidence } from './story';

// The export toolbar's busy cue ("Copying…" + dimmed buttons) must not flash for
// an action that finishes before anyone can read it, and must never move the
// tool buttons when it does appear.

const BUSY_CUE_DELAY_MS = 300;

async function openWithCopyDelay(page: Page, delayMs: number) {
  await page.addInitScript((ms) => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, ms));
    const clipboard = { write: wait, writeText: wait, read: async () => [], readText: async () => '' };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  }, delayMs);
  await page.goto('/iframe.html?id=modal-exportmodal--copy-feedback&viewMode=story');
  await page.getByRole('button', { name: 'Copy image' }).waitFor();
  await page.waitForTimeout(1500); // preview capture finishes; toolbar settles
}

/** Samples the toolbar every frame for `ms` after clicking Copy. */
async function recordCopy(page: Page, ms: number) {
  await page.evaluate((duration) => {
    const w = window as any;
    w.frames = [];
    const t0 = performance.now();
    const tick = () => {
      const tb = document.querySelector('[role=toolbar]')!;
      const select = tb.querySelector('[aria-label="Select and move"]')!;
      const download = tb.querySelector('[aria-label="Download image"]')!;
      w.frames.push({
        t: performance.now() - t0,
        selectX: select.getBoundingClientRect().x,
        downloadOpacity: Number(getComputedStyle(download).opacity),
        label: tb.querySelector('.busy-status')?.textContent ?? '',
      });
      if (performance.now() - t0 < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
  await page.getByRole('button', { name: 'Copy image' }).click();
  await page.waitForTimeout(ms + 100);
  return page.evaluate(() => (window as any).frames as { t: number; selectX: number; downloadOpacity: number; label: string }[]);
}

test('a fast copy shows no busy cue at all', async ({ page }) => {
  await openWithCopyDelay(page, 20);
  const frames = await recordCopy(page, 800);
  expect(frames.filter((f) => f.label !== '')).toEqual([]);
  expect(Math.min(...frames.map((f) => f.downloadOpacity))).toBe(1);
  expect(new Set(frames.map((f) => f.selectX)).size).toBe(1);
});

test('a slow copy shows the cue after the delay, without moving the tools', async ({ page }) => {
  await openWithCopyDelay(page, 1500);
  const frames = await recordCopy(page, 1200);
  const early = frames.filter((f) => f.t < BUSY_CUE_DELAY_MS - 50);
  const late = frames.filter((f) => f.t > BUSY_CUE_DELAY_MS + 300 && f.t < 1200);
  expect(early.every((f) => f.label === '' && f.downloadOpacity === 1)).toBe(true);
  expect(late.length).toBeGreaterThan(0);
  expect(late.every((f) => f.label === 'Copying…' && f.downloadOpacity < 1)).toBe(true);
  expect(new Set(frames.map((f) => f.selectX)).size).toBe(1);
  await evidence(page, 'busy-cue-slow-copy');
});
