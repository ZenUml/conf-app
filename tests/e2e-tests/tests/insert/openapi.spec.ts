import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';

const macroType = 'openapi' as const;
const skip = !testConfig.macros.includes(macroType);

test.describe(`Smoke Test - ${macroType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('insert OpenAPI / Swagger macro and verify render', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType}`);

    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert OpenAPI / Swagger macro', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('OpenAPI / Swagger');
      console.log(`  → Inserting "${macroName}"`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('openapi', macroName);
      await editorPage.interactWithOpenApiMacro(`Test OpenAPI${variantLabel}`);
      console.log(`  ✓ OpenAPI macro inserted`);
    });

    await publishAndVerifyMacros(page, editorPage, 1, 'smoke-openapi');
  });
});
