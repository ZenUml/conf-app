import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros, moveToPvt } from './insert-helpers.js';

const macroType = 'mermaid' as const;
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

  test('insert PlantUML macro and verify render', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType}`);

    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert PlantUML macro - PlantUML tab', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      console.log(`  → Inserting "${macroName}" (PlantUML tab)`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Test PlantUML${variantLabel}`, 'PlantUML');
      console.log(`  ✓ PlantUML macro inserted`);
    });

    // PlantUML renders to an injected SVG (via the PlantUML server). Asserting
    // the SVG element is present confirms the viewer rendered the diagram rather
    // than showing the load-failed error panel. Text-based assertions are avoided
    // because PlantUML SVGs embed participant names in non-visible <title> nodes
    // as well as visible <text> nodes, causing strict-mode violations.
    const pageId = await publishAndVerifyMacros(page, editorPage, 1, 'smoke-mermaid', async (macroPage) => {
      await macroPage.assertMacroHasSvg(macroPage.getSequenceMacroFrame());
    });
    if (pageId) createdPageIds.push(pageId);
  });
});
