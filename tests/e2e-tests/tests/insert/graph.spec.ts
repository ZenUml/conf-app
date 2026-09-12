import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros, moveToPvt } from './insert-helpers.js';

const macroType = 'graph' as const;
const skip = !testConfig.macros.includes(macroType);
const createdPageIds: string[] = [];

test.describe(`Smoke Test - ${macroType}`, { tag: ['@editor', '@viewer', '@graph', '@smoke'] }, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test.afterAll(async ({ request }) => {
    if (!testConfig.isProd) return;
    for (const id of createdPageIds) {
      await moveToPvt(request, id).catch(e => console.warn(`  ⚠ PVT move failed for ${id}: ${e.message}`));
    }
  });

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

    // DrawIO renders an SVG canvas whose shapes carry no predictable text, so
    // the assertion has to be geometric. It must not be "an SVG is visible":
    // the frame also holds the viewer toolbar, whose icons are SVGs, so that
    // check passes on the load-failed panel and on an empty canvas alike.
    // assertMacroRendersDiagram measures the LARGEST SVG — the canvas, at
    // 758x150 on lite-stg, against 16x16 icons — so a failed render leaves only
    // icons behind and fails. DrawIO emits no viewBox, so the aspect-ratio half
    // of that assertion is skipped here; the non-degenerate box is the part
    // that does the work for this macro.
    const pageId = await publishAndVerifyMacros(page, editorPage, 1, 'smoke-graph', async (macroPage) => {
      await macroPage.assertMacroRendersDiagram(macroPage.getGraphMacroFrame());
    });
    if (pageId) createdPageIds.push(pageId);
  });
});
