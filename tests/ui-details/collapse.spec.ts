import { test, expect, type Page } from '@playwright/test';
import { evidence, openStory } from './story';

// Item 3: the feedback dialog's "8 fields attached automatically" disclosure animates open and
// closed with a CSS grid-rows collapse instead of toggling instantly.
const STORY = 'modal-feedbackdialog--idle';
const PANEL = '.context-details .context-panel';

const toggle = (page: Page) => page.locator('.context-disclosure');
const panel = (page: Page) => page.locator(PANEL);
const height = (page: Page) => panel(page).evaluate((el) => el.getBoundingClientRect().height);

/**
 * Clicks the disclosure, waits two frames so the transition has started, then freezes the panel's
 * transitions at `ms` and reports its height. The transitions are finished afterwards.
 */
async function clickAndSeek(page: Page, ms: number) {
  return page.evaluate(
    async ({ sel, panelSel, ms }) => {
      (document.querySelector(sel) as HTMLElement).click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.querySelector(panelSel) as HTMLElement;
      const running = document.getAnimations().filter((a) => a instanceof CSSTransition);
      running.forEach((a) => { a.pause(); a.currentTime = ms; });
      const h = el.getBoundingClientRect().height;
      return { h, transitions: running.length, props: running.map((a) => (a as CSSTransition).transitionProperty) };
    },
    { sel: '.context-disclosure', panelSel: PANEL, ms },
  );
}

async function finishTransitions(page: Page) {
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
}

test('disclosure collapses with a grid-rows transition, not instant display toggling', async ({ page }) => {
  await openStory(page, STORY);
  const wrapper = panel(page);
  await expect(wrapper).toHaveCount(1);

  // Structure: grid wrapper, clipped inner child, no inline height or max-height.
  const rows = () => wrapper.evaluate((el) => getComputedStyle(el).gridTemplateRows);
  const collapsedRows = await rows();
  expect(await wrapper.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
  expect(await wrapper.evaluate((el) => (el as HTMLElement).style.cssText)).not.toMatch(/height/);
  expect(await wrapper.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('grid-template-rows');
  expect(await wrapper.evaluate((el) => getComputedStyle(el).maxHeight)).toBe('none');
  const inner = wrapper.locator('> *').first();
  expect(await inner.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  expect(await inner.evaluate((el) => getComputedStyle(el).minHeight)).toBe('0px');

  // aria wiring.
  const id = await wrapper.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(toggle(page)).toHaveAttribute('aria-controls', id!);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await height(page)).toBe(0);
  await evidence(page, 'collapse-collapsed');

  // Expand: mid-transition height is strictly between 0 and full.
  const mid = await clickAndSeek(page, 40);
  expect(mid.props).toContain('grid-template-rows');
  expect(mid.h).toBeGreaterThan(0);
  await evidence(page, 'collapse-mid-expand');
  await finishTransitions(page);
  await page.waitForTimeout(250);
  const full = await height(page);
  expect(full).toBeGreaterThan(40);
  expect(mid.h).toBeLessThan(full);
  const expandedRows = await rows();
  expect(expandedRows).not.toBe(collapsedRows);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await evidence(page, 'collapse-expanded');

  // Collapse reverses: mid-transition is between full and 0, then 0.
  const midBack = await clickAndSeek(page, 40);
  await evidence(page, 'collapse-mid-collapse');
  expect(midBack.h).toBeGreaterThan(0);
  expect(midBack.h).toBeLessThan(full);
  await finishTransitions(page);
  await page.waitForTimeout(250);
  expect(await height(page)).toBe(0);
  expect(await rows()).toBe(collapsedRows);
});

test('collapsed content is hidden from assistive tech and tab order', async ({ page }) => {
  await openStory(page, STORY);
  const wrapper = panel(page);
  await expect(wrapper).toHaveCount(1);
  await expect(wrapper).toHaveAttribute('inert', /.*/);
  await expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  await toggle(page).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate((sel) => !!document.activeElement?.closest(sel), PANEL)).toBe(false);

  await toggle(page).click();
  await expect(wrapper).not.toHaveAttribute('inert', /.*/);
  await expect(wrapper).not.toHaveAttribute('aria-hidden', 'true');
  await page.waitForTimeout(300);
  expect(await wrapper.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');

  await toggle(page).click();
  await page.waitForTimeout(300);
  await expect(wrapper).toHaveAttribute('inert', /.*/);
  expect(await wrapper.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
});

test('prefers-reduced-motion: height is final immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStory(page, STORY);
  await expect(panel(page)).toHaveCount(1);
  expect(await height(page)).toBe(0);
  const state = await page.evaluate(async () => {
    (document.querySelector('.context-disclosure') as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      h: document.querySelector('.context-details .context-panel')!.getBoundingClientRect().height,
      // Only the panel's own transitions; the chevron and button colour still animate.
      transitions: document.getAnimations().filter((a) => a instanceof CSSTransition && (a.effect as KeyframeEffect).target?.classList.contains('context-panel')).length,
    };
  });
  expect(state.transitions).toBe(0);
  expect(state.h).toBeGreaterThan(40);
  await evidence(page, 'collapse-reduced-motion-expanded');
});
