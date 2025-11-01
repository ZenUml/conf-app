import { test, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import { getPageId } from '../utils/test-page-registry.js';

test.describe.configure({ mode: 'serial' });

test.describe('Graph Diagram Tests', () => {
  let pageId: string;

  test.beforeAll(() => {
    pageId = getPageId('graph');
    console.log(`Using pre-created graph test page: ${pageId}`);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the pre-created page
    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();
  });

  test('should display graph diagram correctly', async ({ page }) => {
    const macroPage = new MacroPage(page);
    const graphFrame = macroPage.getGraphMacroFrame();

    // Verify macro content is visible
    await macroPage.assertMacroContent(
      graphFrame,
      "Lamp doesn't work"
    );
  });
});
