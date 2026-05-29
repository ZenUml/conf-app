import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros, moveToPvt } from './insert-helpers.js';

const macroType = 'openapi' as const;
const skip = !testConfig.macros.includes(macroType);
const createdPageIds: string[] = [];

test.describe(`Smoke Test - ${macroType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test.afterAll(async ({ request }) => {
    if (!testConfig.isProd) return;
    for (const id of createdPageIds) {
      await moveToPvt(request, id).catch(e => console.warn(`  ⚠ PVT move failed for ${id}: ${e.message}`));
    }
  });

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

    // ZEN-1172: assert the rendered spec is actually visible inside the iframe.
    // A freshly inserted macro renders OpenApiExample, whose spec contains the
    // "/users" path. The load-failed panel does NOT contain "/users", so this
    // catches the broken-viewer regression that an iframe-count check missed.
    const pageId = await publishAndVerifyMacros(page, editorPage, 1, 'smoke-openapi', async (macroPage) => {
      await macroPage.assertMacroContent(macroPage.getOpenApiMacroFrame(), '/users');
    });
    if (pageId) createdPageIds.push(pageId);
  });
});
