import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros, moveToPvt } from './insert-helpers.js';

const macroType = 'sequence' as const;
const skip = !testConfig.macros.includes(macroType);
const createdPageIds: string[] = [];

// `@smoke` marks the SMOKE TIER (ADR-0006): one insert-and-render per shipped
// macro type (sequence, mermaid, plantuml, openapi, graph), one edit
// (edit-graph) and one embed paste (embed-deeplink-autoconvert). The production
// release smoke in release.yml runs `--grep @smoke` and nothing else; staging
// and the nightly smoke-test.yml run the whole suite. A new spec joins the tier
// only if a release must not go out without it — every tagged test runs against
// production on every release of every variant, so the tier's total runtime is
// the release's tail.
test.describe(`Smoke Test - ${macroType}`, { tag: ['@editor', '@viewer', '@sequence', '@smoke'] }, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test.afterAll(async ({ request }) => {
    if (!testConfig.isProd) return;
    for (const id of createdPageIds) {
      await moveToPvt(request, id).catch(e => console.warn(`  ⚠ PVT move failed for ${id}: ${e.message}`));
    }
  });

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

    // Default sequence content (Example.Sequence) renders "OrderController" as a
    // participant. If the viewer shows the load-failed panel instead, this text
    // won't appear and the test fails — catching the ZEN-1172 class of regression.
    const pageId = await publishAndVerifyMacros(page, editorPage, 1, 'smoke-sequence', async (macroPage) => {
      await macroPage.assertMacroContent(macroPage.getSequenceMacroFrame(), 'OrderController');
    });
    if (pageId) createdPageIds.push(pageId);
  });
});
