import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';

const macroType = 'mermaid' as const;
const skip = !testConfig.macros.includes(macroType);

test.describe(`Smoke Test - ${macroType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('insert PlantUML macro and verify render', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType}`);

    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert PlantUML macro - PlantUML tab', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram as Code');
      console.log(`  → Inserting "${macroName}" (PlantUML tab)`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Test PlantUML${variantLabel}`, 'PlantUML');
      console.log(`  ✓ PlantUML macro inserted`);
    });

    await publishAndVerifyMacros(page, editorPage, 1, 'smoke-mermaid');
  });
});
