import { test, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import { getPageId } from '../utils/test-page-registry.js';

test.describe('Mermaid Diagram Tests', () => {
  let pageId: string;

  test.beforeAll(() => {
    pageId = getPageId('mermaid');
    console.log(`Using pre-created mermaid test page: ${pageId}`);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the pre-created page
    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();
  });

  test('should display mermaid diagram correctly', async ({ page }) => {
    const macroPage = new MacroPage(page);
    // Mermaid uses the sequence macro frame
    const mermaidFrame = macroPage.getSequenceMacroFrame();

    // Verify macro content is visible
    await macroPage.assertMacroContent(
      mermaidFrame,
      'A Gantt Diagram'
    );
  });
});
