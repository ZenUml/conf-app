import { Page, expect } from '@playwright/test';
import { PageCreator } from './page-creator.js';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';

export interface MacroOptions {
  sequence?: boolean | { bodyOnly?: boolean };
  graph?: boolean;
  openapi?: boolean;
  embed?: boolean;
  mermaid?: boolean;
}

export async function withTestPage(
  page: Page,
  callback: (macroPage: MacroPage) => Promise<void>,
  options: MacroOptions
): Promise<void> {
  let pageId: string | undefined;

  try {
    const pageCreator = new PageCreator(page);
    pageId = await pageCreator.createTestPage(options);

    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();

    await callback(macroPage);
  } finally {
    if (pageId) {
      const pageCreator = new PageCreator(page);
      await pageCreator.deletePage(pageId);
    }
  }
}
