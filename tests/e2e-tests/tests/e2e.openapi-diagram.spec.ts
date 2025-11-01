import { test, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import { getPageId } from '../utils/test-page-registry.js';

test.describe('OpenAPI Diagram Tests', () => {
  let pageId: string;

  test.beforeAll(() => {
    pageId = getPageId('openapi');
    console.log(`Using pre-created OpenAPI test page: ${pageId}`);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the pre-created page
    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();
  });

  test('should display OpenAPI diagram correctly', async ({ page }) => {
    const macroPage = new MacroPage(page);
    const openapiFrame = macroPage.getOpenApiMacroFrame();

    // Verify OpenAPI content is visible
    await expect(openapiFrame.locator('body')).toBeVisible({ timeout: 15000 });
    await expect(
      openapiFrame.getByText('/users', { exact: false })
    ).toBeVisible({ timeout: 15000 });
  });
});
