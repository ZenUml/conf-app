import type { Page } from '@playwright/test';
import path from 'node:path';

/** Opens one story by id (`<group>-<leaf>--<export>`, kebab-cased) and waits for it to mount. */
export async function openStory(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator('#storybook-root > *').first().waitFor();
}

/** Screenshot evidence for the report; written outside the repo when UI_DETAILS_SHOTS is set. */
export async function evidence(page: Page, name: string) {
  const dir = process.env.UI_DETAILS_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}
