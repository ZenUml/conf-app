import { test, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';

test.describe('Smoke Test - Macro Insertion via Editor UI', () => {
  test('insert all macros and verify rendering', async ({ page }) => {
    const editorPage = new ConfluenceEditorPage(page);
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const macros = testConfig.macros;

    await test.step('Navigate to parent page', async () => {
      await editorPage.navigateToParentPage();
    });

    await test.step('Create child page via editor UI', async () => {
      await editorPage.createChildPage();
      const pageTitle = ConfluenceEditorPage.generatePageTitle(variantLabel);
      await editorPage.typePageTitle(pageTitle);
    });

    // Insert macros dynamically based on app profile
    if (macros.includes('sequence')) {
      await test.step('Insert Diagram (ZenUML) macro - Sequence tab', async () => {
        await editorPage.dismissLearnTheBasicsPanel();
        const macroName = editorPage.getMacroName('Diagram (ZenUML & Mermaid)');
        await editorPage.clickInsertElements();
        await editorPage.searchAndSelectMacro('zenuml', macroName);
        await editorPage.interactWithDiagramMacro(`Test Diagram${variantLabel}`);
      });
    }

    if (macros.includes('mermaid')) {
      await test.step('Insert PlantUML macro - PlantUML tab', async () => {
        await editorPage.positionCursorBelowMacros();
        const macroName = editorPage.getMacroName('Diagram (ZenUML & Mermaid)');
        await editorPage.clickInsertElements();
        await editorPage.searchAndSelectMacro('zenuml', macroName);
        await editorPage.interactWithDiagramMacro(`Test PlantUML${variantLabel}`, 'PlantUML');
      });
    }

    if (macros.includes('graph')) {
      await test.step('Insert Graph (DrawIO) macro', async () => {
        await editorPage.positionCursorBelowMacros();
        const macroName = editorPage.getMacroName('Graph (DrawIO)');
        await editorPage.clickInsertElements();
        await editorPage.searchAndSelectMacro('graph', macroName);
        await editorPage.interactWithGraphMacro(`Test Graph${variantLabel}`);
      });
    }

    if (macros.includes('openapi')) {
      await test.step('Insert OpenAPI / Swagger macro', async () => {
        await editorPage.positionCursorBelowMacros();
        const macroName = editorPage.getMacroName('OpenAPI / Swagger');
        await editorPage.clickInsertElements();
        await editorPage.searchAndSelectMacro('openapi', macroName);
        await editorPage.interactWithOpenApiMacro(`Test OpenAPI${variantLabel}`);
      });
    }

    await test.step('Publish the page', async () => {
      await editorPage.publishPage();
    });

    await test.step('Verify all macros render on published page', async () => {
      const macroPage = new MacroPage(page);
      await macroPage.dismissSpotlightModal();

      await expect(page.locator('#title-text')).toContainText('Smoke Test');

      if (testConfig.isForge || testConfig.isLite) {
        const forgeIframes = page.locator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]');
        await expect(forgeIframes.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
        // Expected count: sequence + mermaid + graph + openapi (only those in profile)
        const expectedCount = ['sequence', 'mermaid', 'graph', 'openapi']
          .filter(m => macros.includes(m as any)).length;
        await expect(forgeIframes).toHaveCount(expectedCount, { timeout: TIMEOUTS.FRAME_LOAD });
      } else {
        // Connect iframes share module keys (sequence + PlantUML both use zenuml-sequence-macro),
        // so use count-based verification like Forge to avoid strict mode violations.
        const connectIframes = page.locator(`iframe.ap-iframe[id*="${testConfig.addonKey}"]`);
        await expect(connectIframes.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
        const expectedCount = ['sequence', 'mermaid', 'graph', 'openapi']
          .filter(m => macros.includes(m as any)).length;
        await expect(connectIframes).toHaveCount(expectedCount, { timeout: TIMEOUTS.FRAME_LOAD });
      }

      await page.screenshot({
        path: `smoke-test-result-${Date.now()}.png`,
        fullPage: true,
      });
    });
  });
});
