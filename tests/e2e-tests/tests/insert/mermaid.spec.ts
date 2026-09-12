import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros, moveToPvt } from './insert-helpers.js';

// Mermaid had NO insert coverage until this spec: the file that used to be named
// mermaid.spec.ts drove the PlantUML tab (see plantuml.spec.ts, its accurate
// name). The three macro formats share one macro but not one render path —
// Mermaid renders through the bundled vendor build, PlantUML through the
// plantuml.com server — so PlantUML passing says nothing about Mermaid.
const macroType = 'mermaid' as const;
const skip = !testConfig.macros.includes(macroType);
const createdPageIds: string[] = [];

test.describe(`Smoke Test - ${macroType}`, { tag: ['@editor', '@viewer', '@mermaid', '@smoke'] }, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test.afterAll(async ({ request }) => {
    if (!testConfig.isProd) return;
    for (const id of createdPageIds) {
      await moveToPvt(request, id).catch(e => console.warn(`  ⚠ PVT move failed for ${id}: ${e.message}`));
    }
  });

  test('insert Mermaid macro and verify render', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType}`);

    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert Diagram macro - Mermaid tab', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      console.log(`  → Inserting "${macroName}" (Mermaid tab)`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Test Mermaid${variantLabel}`, 'Mermaid');
      console.log(`  ✓ Mermaid macro inserted`);
    });

    // The Mermaid seed (src/utils/sequence/Example.ts) is a sequenceDiagram
    // between Alice and John, so the rendered SVG carries both names as visible
    // text. Asserting the text proves Mermaid actually parsed and drew the
    // diagram rather than leaving the load-failed panel — which lives inside
    // this same iframe and would otherwise pass an iframe-visibility check.
    const pageId = await publishAndVerifyMacros(page, editorPage, 1, 'smoke-mermaid', async (macroPage) => {
      await macroPage.assertMacroContent(macroPage.getSequenceMacroFrame(), 'Alice');
      await macroPage.assertMacroRendersDiagram(macroPage.getSequenceMacroFrame());
    });
    if (pageId) createdPageIds.push(pageId);
  });
});
