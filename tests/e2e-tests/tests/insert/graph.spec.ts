import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';

const macroType = 'graph' as const;
const skip = !testConfig.macros.includes(macroType);

test.describe(`Smoke Test - ${macroType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('insert Graph (DrawIO) macro and verify render', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType}`);

    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert Graph (DrawIO) macro', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Graph (DrawIO)');
      console.log(`  → Inserting "${macroName}"`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('graph', macroName);
      await editorPage.interactWithGraphMacro(`Test Graph${variantLabel}`);
      console.log(`  ✓ Graph macro inserted`);
    });

    await publishAndVerifyMacros(page, editorPage, 1, 'smoke-graph');
  });
});
