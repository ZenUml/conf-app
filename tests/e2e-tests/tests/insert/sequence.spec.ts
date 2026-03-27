import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';

const macroType = 'sequence' as const;
const skip = !testConfig.macros.includes(macroType);

test.describe(`Smoke Test - ${macroType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('insert Diagram macro and verify render', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType}`);

    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert Diagram macro - Sequence tab', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      console.log(`  → Inserting "${macroName}" (Sequence)`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Test Diagram${variantLabel}`);
      console.log(`  ✓ Sequence macro inserted`);
    });

    await publishAndVerifyMacros(page, editorPage, 1, 'smoke-sequence');
  });
});
