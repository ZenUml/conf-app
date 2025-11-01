import { test, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import { getPageId } from '../utils/test-page-registry.js';

test.describe.configure({ mode: 'serial' });

test.describe('Embed Diagram Tests', () => {
  let pageId: string;

  test.beforeAll(() => {
    pageId = getPageId('embed');
    console.log(`Using pre-created embed test page: ${pageId}`);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the pre-created page
    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();

  });

  test('should display embed diagram correctly', async ({ page }) => {
    const macroPage = new MacroPage(page);
    const embedFrame = macroPage.getEmbedMacroFrame();

    // Verify macro content is visible
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );
  });

  test('should edit embed diagram successfully', async ({ page }) => {
    const macroPage = new MacroPage(page);
    const embedFrame = macroPage.getEmbedMacroFrame();

    // Verify macro is loaded
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );

    // Edit the macro
    await macroPage.editMacro(embedFrame);
    await macroPage.saveInEditor();

    // Verify macro reloaded after edit
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );
  });
});
