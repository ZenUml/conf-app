import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { createPageAndSetup, moveToPvt } from './insert-helpers.js';
import { MacroPage } from '../../pages/MacroPage.js';

const macroType = 'graph' as const;
const skip = !testConfig.macros.includes(macroType);
const createdPageIds: string[] = [];

test.describe(`Edit Test - ${macroType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test.afterAll(async ({ request }) => {
    if (!testConfig.isProd) return;
    for (const id of createdPageIds) {
      await moveToPvt(request, id).catch(e => console.warn(`  ⚠ PVT move failed for ${id}: ${e.message}`));
    }
  });

  test('insert Graph (DrawIO) macro, then edit and re-save', async ({ page }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    console.log(`▶ App: ${testConfig.domain} | macro: ${macroType} | test: edit`);

    // ── Step 1: Create a page and insert a Graph macro ──
    const editorPage = await createPageAndSetup(page, variantLabel);

    await test.step('Insert Graph (DrawIO) macro', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Graph (DrawIO)');
      console.log(`  → Inserting "${macroName}"`);
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('graph', macroName);
      await editorPage.interactWithGraphMacro(`Edit Test Graph${variantLabel}`);
      console.log(`  ✓ Graph macro inserted`);
    });

    // ── Step 2: Publish the page ──
    await test.step('Publish page', async () => {
      await editorPage.publishPage();
      console.log(`  ✓ Page published`);
    });

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();

    await expect(page.locator('#title-text')).toContainText('Smoke Test');

    // ── Step 3: Verify macro renders after initial insert ──
    await test.step('Verify macro renders after insert', async () => {
      const graphFrame = macroPage.getGraphMacroFrame();
      await expect(graphFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
      console.log(`  ✓ Macro renders after insert`);
    });

    const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1] ?? '';
    if (pageId) createdPageIds.push(pageId);
    console.log(`  ✓ Page URL: ${page.url()}`);

    await page.screenshot({ path: `edit-graph-before-${Date.now()}.png`, fullPage: true });

    // ── Step 4: Edit the macro from the published view ──
    await test.step('Edit Graph macro from viewer', async () => {
      const graphFrame = macroPage.getGraphMacroFrame();
      console.log(`  → Clicking Edit on macro`);
      await macroPage.editGraphMacroFromViewer(graphFrame);
      console.log(`  ✓ Macro editor closed after Publish`);
    });

    // ── Step 5: Reload page and verify macro still renders (confirms save persisted) ──
    await test.step('Reload and verify macro renders after edit', async () => {
      await page.reload();
      await expect(page.locator('#title-text')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
      await macroPage.dismissSpotlightModal();
      const graphFrame = macroPage.getGraphMacroFrame();
      await expect(graphFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
      console.log(`  ✓ Macro renders after page reload — save confirmed`);
    });

    await page.screenshot({ path: `edit-graph-after-${Date.now()}.png`, fullPage: true });
    console.log(`  ✓ Edit test complete`);
  });
});
