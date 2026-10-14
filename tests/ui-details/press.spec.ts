import { test, expect, type Locator, type Page } from '@playwright/test';
import { evidence, openStory } from './story';

// The paywall story's root div has zero height (the modal is a fixed Teleport),
// so openStory's visibility wait never resolves; wait for the modal button instead.
async function open(page: Page, story: string) {
  if (!story.startsWith('shared-upgradeprompt')) return openStory(page, story);
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  await page.getByTestId('unlock-space-btn').waitFor();
}

// Item 4: primary and secondary text buttons scale to 0.95 while pressed;
// icon-only buttons do not; reduced motion disables the scale.
const targets: { name: string; story: string; target: (page: Page) => Locator }[] = [
  { name: 'publish', story: 'shared-publishbutton--idle', target: (p) => p.getByRole('button', { name: 'Publish' }) },
  { name: 'unlock-space', story: 'shared-upgradeprompt--default-unlimited-continue', target: (p) => p.getByTestId('unlock-space-btn') },
  { name: 'request-extension', story: 'shared-upgradeprompt--default-unlimited-continue', target: (p) => p.getByTestId('request-extension-btn') },
];

async function pressedTransform(page: Page, btn: Locator, shot: string) {
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const t = await btn.evaluate((el) => getComputedStyle(el).transform);
  await evidence(page, shot);
  await page.mouse.up();
  return t;
}

// 'none' and the identity matrix both mean "not scaled".
const scaleX = (t: string) => (t === 'none' ? 1 : Number(t.match(/^matrix\(([^,]+),/)![1]));

for (const { name, story, target } of targets) {
  test(`${name}: scales to 0.95 while pressed`, async ({ page }) => {
    await open(page, story);
    const btn = target(page);
    await btn.waitFor();
    expect(await btn.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    const t = await pressedTransform(page, btn, `press-${name}`);
    expect(t).toMatch(/^matrix\(0\.95, 0, 0, 0\.95,/);
  });

  test(`${name}: no scale under reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, story);
    const btn = target(page);
    await btn.waitFor();
    const t = await pressedTransform(page, btn, `press-${name}-reduced`);
    expect(scaleX(t)).toBe(1);
  });
}

test('icon-only spark button does not scale', async ({ page }) => {
  await openStory(page, 'editor-diagram-diagramtitleinput--default');
  const btn = page.getByTitle('Generate title with AI');
  await btn.waitFor();
  const t = await pressedTransform(page, btn, 'press-spark-icon');
  expect(scaleX(t)).toBe(1);
});
