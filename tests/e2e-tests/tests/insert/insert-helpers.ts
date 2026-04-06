import { Page, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';

/**
 * Creates a child page in Confluence and types a smoke-test title.
 * Returns the EditorPage instance for further macro insertion.
 */
export async function createPageAndSetup(page: Page, variantLabel: string): Promise<ConfluenceEditorPage> {
  const editorPage = new ConfluenceEditorPage(page);

  await editorPage.navigateToParentPage();
  console.log(`  ✓ Parent page loaded`);

  await editorPage.createChildPage();
  const rand = Math.random().toString(36).slice(2, 7);
  const pageTitle = ConfluenceEditorPage.generatePageTitle(variantLabel) + ` ${rand}`;
  await editorPage.typePageTitle(pageTitle);
  console.log(`  ✓ Editor ready: "${pageTitle}"`);

  return editorPage;
}

/**
 * Publishes the current page, dismisses any spotlight modal,
 * verifies the expected number of macro iframes render, and takes a screenshot.
 */
export async function publishAndVerifyMacros(page: Page, editorPage: ConfluenceEditorPage, macroCount: number, screenshotName: string): Promise<void> {
  await editorPage.publishPage();
  console.log(`  ✓ Page published`);

  const macroPage = new MacroPage(page);
  await macroPage.dismissSpotlightModal();

  await expect(page.locator('#title-text')).toContainText('Smoke Test');

  if (testConfig.isForge || testConfig.isLite) {
    const forgeIframes = page.locator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]');
    await expect(forgeIframes.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(forgeIframes).toHaveCount(macroCount, { timeout: TIMEOUTS.FRAME_LOAD });
  } else {
    // Connect macro iframes have IDs like "{addonKey}__{macroKey}__{hash}".
    // Avoid using iframe.ap-iframe (class added by AC.js asynchronously)
    // or iframe[src*=domain] (src is the Cloudflare URL, not the Confluence domain).
    const connectIframes = page.locator(`iframe[id*="${testConfig.addonKey}"]`);
    await expect(connectIframes.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(connectIframes).toHaveCount(macroCount, { timeout: TIMEOUTS.FRAME_LOAD });
  }

  console.log(`  ✓ ${macroCount} macro iframe(s) visible on published page`);

  await page.screenshot({
    path: `${screenshotName}-${Date.now()}.png`,
    fullPage: true,
  });
}
