import { test, expect } from '@playwright/test';
import { openStory } from './story';

test('harness opens a story', async ({ page }) => {
  await openStory(page, 'shared-publishbutton--idle');
  await expect(page.locator('#storybook-root button').first()).toBeVisible();
});
