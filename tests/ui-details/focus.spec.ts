import { test, expect, type Locator, type Page } from '@playwright/test';
import { evidence, openStory } from './story';

// The paywall story's root div has zero height (the modal is a fixed Teleport),
// so openStory's visibility wait never resolves; wait for the modal button instead.
async function open(page: Page, story: string) {
  if (!story.startsWith('shared-upgradeprompt')) return openStory(page, story);
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  await page.getByTestId('unlock-space-btn').waitFor();
}

// Item 1: mouse clicks leave no ring; keyboard focus shows an offset blue ring;
// text fields keep their border colour and gain a soft gray ring instead.
const BLUE = 'rgb(12, 102, 228)';

const buttons: { name: string; story: string; target: (page: Page) => Locator }[] = [
  { name: 'publish', story: 'shared-publishbutton--idle', target: (p) => p.getByRole('button', { name: 'Publish' }) },
  { name: 'unlock-space', story: 'shared-upgradeprompt--default-unlimited-continue', target: (p) => p.getByTestId('unlock-space-btn') },
  { name: 'request-extension', story: 'shared-upgradeprompt--default-unlimited-continue', target: (p) => p.getByTestId('request-extension-btn') },
];

async function boxShadow(btn: Locator) {
  return btn.evaluate((el) => getComputedStyle(el).boxShadow);
}

async function tabTo(page: Page, btn: Locator) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await btn.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('button never received keyboard focus');
}

for (const { name, story, target } of buttons) {
  test(`${name} button: no ring on click, offset ring on keyboard focus`, async ({ page }) => {
    await open(page, story);
    const btn = target(page);
    await btn.waitFor();

    const box = (await btn.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(0, 0);
    expect(await boxShadow(btn)).toBe('none');
    await evidence(page, `focus-${name}-after-click`);

    await tabTo(page, btn);
    const shadow = await boxShadow(btn);
    expect(shadow).toContain(BLUE);
    expect(shadow).toContain('4px');
    await evidence(page, `focus-${name}-keyboard`);
  });
}

async function fieldFocus(page: Page, field: Locator, ringHost: Locator) {
  const before = await ringHost.evaluate((el) => getComputedStyle(el).borderColor);
  const beforeShadow = await ringHost.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(beforeShadow).toBe('none');
  await field.click();
  await page.waitForTimeout(300); // let colour transitions settle
  const after = await ringHost.evaluate((el) => ({ border: getComputedStyle(el).borderColor, shadow: getComputedStyle(el).boxShadow, outline: getComputedStyle(el).outlineStyle === 'none' || getComputedStyle(el).outlineColor === 'rgba(0, 0, 0, 0)' }));
  expect(after.border).not.toContain('0, 148, 217');
  expect(after.border).not.toContain('59, 130, 246');
  expect(after.shadow).not.toBe('none');
  expect(after.shadow).toContain('rgba(9, 30, 66, 0.16)');
  return { before, after };
}

test('document list search input: keeps its border colour, gains soft ring', async ({ page }) => {
  await openStory(page, 'shared-documentlist--populated');
  const input = page.getByPlaceholder('search in title and content');
  await input.waitFor();
  const { before, after } = await fieldFocus(page, input, input);
  expect(after.border).toBe(before);
  expect(after.outline).toBe(true); // Tailwind outline-none is a transparent outline
  await evidence(page, 'focus-documentlist-input');
});

test('diagram title input: no blue border on focus, gains soft ring', async ({ page }) => {
  await openStory(page, 'editor-diagram-diagramtitleinput--default');
  const input = page.getByPlaceholder('Untitled diagram');
  await input.waitFor();
  const host = input.locator('xpath=..');
  const { after } = await fieldFocus(page, input, host);
  expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle === 'none' || getComputedStyle(el).outlineColor === 'rgba(0, 0, 0, 0)')).toBe(true);
  expect(after.border).not.toBe('');
  await evidence(page, 'focus-title-input');
});
