import { test, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import { getPageId } from '../utils/test-page-registry.js';

test.describe.configure({ mode: 'serial' });

test.describe('Sequence Diagram Tests', () => {
  let pageId: string;

  test.beforeAll(() => {
    pageId = getPageId('sequence');
    console.log(`Using pre-created sequence test page: ${pageId}`);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the pre-created page
    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();
  });

  test('should display sequence diagram correctly', async ({ page }) => {
    const macroPage = new MacroPage(page);
    const sequenceFrame = macroPage.getSequenceMacroFrame();

    // Verify macro content is visible
    await macroPage.assertMacroContent(
      sequenceFrame,
      'Order Service (Demonstration only)'
    );
  });

  test('should edit sequence diagram successfully', async ({ page }) => {
    const macroPage = new MacroPage(page);
    const sequenceFrame = macroPage.getSequenceMacroFrame();

    // Verify macro is loaded
    await macroPage.assertMacroContent(
      sequenceFrame,
      'Order Service (Demonstration only)'
    );

    // Edit the macro
    await macroPage.editMacro(sequenceFrame);
    await macroPage.saveInEditor();

    // Verify macro reloaded after edit
    await macroPage.assertMacroContent(
      sequenceFrame,
      'Order Service (Demonstration only)'
    );
  });
});
