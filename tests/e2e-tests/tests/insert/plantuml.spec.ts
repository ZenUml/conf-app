import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros, moveToPvt } from './insert-helpers.js';

// Named for the tab it actually drives. This file was called mermaid.spec.ts
// while every step in it selected the PlantUML tab and asserted PlantUML output,
// so Mermaid looked covered and was not. Real Mermaid coverage now lives in
// mermaid.spec.ts. `macroType` stays 'mermaid' because that is the profile axis
// key for the shared Diagram macro — PlantUML is one of its tabs, not a separate
// entry in testConfig.macros.
const macroType = 'mermaid' as const;
const skip = !testConfig.macros.includes(macroType);
const createdPageIds: string[] = [];

test.describe(`Smoke Test - plantuml`, () => {
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

    // PlantUML renders to an injected SVG (via the PlantUML server). Text-based
    // assertions are avoided because PlantUML SVGs embed participant names in
    // non-visible <title> nodes as well as visible <text> nodes, causing
    // strict-mode violations — so the assertion is geometric instead.
    //
    // assertMacroHasSvg (presence only) is not enough here: this is the exact
    // macro whose SVG arrives with preserveAspectRatio="none", and a squashed
    // render keeps a perfectly visible <svg> while the diagram is unreadable.
    // assertMacroRendersDiagram compares the rendered box against the viewBox,
    // which is the property the 2026-09-07 fix was verified on.
    const pageId = await publishAndVerifyMacros(page, editorPage, 1, 'smoke-plantuml', async (macroPage) => {
      await macroPage.assertMacroRendersDiagram(macroPage.getSequenceMacroFrame());
    });
    if (pageId) createdPageIds.push(pageId);
  });
});
